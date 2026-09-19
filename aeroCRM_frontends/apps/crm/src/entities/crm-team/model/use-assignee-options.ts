'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useMemo, useState } from 'react'
import { invalidContractError } from '@/shared/api/authenticated-http-client'
import { isUuidV4 } from '@/shared/lib/contract'
import { listAssigneeOptions } from '../api/assignee-options.api'
import {
	assigneeRoles,
	isAssigneeSubject,
	type AssigneeOption
} from './assignee-options.contract'

export interface AssigneeDirectoryContext {
	workspaceId: string
	subject?: string
	accessToken?: string
	sessionRevision: number
	canRead: boolean
	isCurrent: () => boolean
	authority?: {
		workspaceId: string
		subject: string
		role: string
		state: string
		dataScope: 'ALL' | 'TEAM' | 'OWN'
		teamIds: readonly string[]
		permissions: readonly string[]
	}
}
export interface AssigneeOptionsSelection {
	selectedSubject?: string
	teamId?: string
}

// Imperative cancellation handle for requests/callbacks, not render state.
// Keep its lifetime outside React's render closures, like a subscription handle.
const createRequestFrame = (initiallyActive: boolean) => {
	let active = initiallyActive
	return {
		isActive: () => active,
		activate: () => {
			active = true
		},
		deactivate: () => {
			active = false
		}
	}
}

export const useAssigneeOptions = (
	context: AssigneeDirectoryContext,
	selection: AssigneeOptionsSelection = {}
) => {
	const observerId = useId()
	const authority = context.authority
	const scopeKey = JSON.stringify([
		context.workspaceId,
		context.subject,
		context.sessionRevision,
		authority?.workspaceId,
		authority?.subject,
		authority?.role,
		authority?.state,
		authority?.dataScope,
		[...(authority?.teamIds ?? [])].sort(),
		[...(authority?.permissions ?? [])].sort(),
		selection.teamId
	])
	const [filters, setFilters] = useState({ scopeKey, page: 1, search: '' })
	const page = filters.scopeKey === scopeKey ? filters.page : 1
	const search = filters.scopeKey === scopeKey ? filters.search : ''
	const enabled =
		context.canRead &&
		!!context.accessToken &&
		isAssigneeSubject(context.subject) &&
		isUuidV4(context.workspaceId) &&
		Number.isSafeInteger(context.sessionRevision) &&
		context.sessionRevision >= 0 &&
		!!authority &&
		authority.workspaceId === context.workspaceId &&
		authority.subject === context.subject &&
		assigneeRoles.includes(authority.role as AssigneeOption['role']) &&
		['ACTIVE', 'GRACE', 'READ_ONLY'].includes(authority.state) &&
		authority.permissions.includes('sales:read') &&
		['ALL', 'TEAM', 'OWN'].includes(authority.dataScope) &&
		authority.teamIds.length <= 1000 &&
		authority.teamIds.every(isUuidV4) &&
		new Set(authority.teamIds).size === authority.teamIds.length &&
		(!selection.teamId ||
			(isUuidV4(selection.teamId) &&
				authority.teamIds.includes(selection.teamId))) &&
		(!selection.selectedSubject ||
			isAssigneeSubject(selection.selectedSubject))
	// A lifecycle token, not browser persistence or an auth/session replacement.
	// Old callbacks/responses become unusable on unmount or an authority frame change.
	const requestKey = JSON.stringify([
		scopeKey,
		page,
		search,
		selection.selectedSubject,
		enabled
	])
	const frame = useMemo(
		() => createRequestFrame(!!requestKey && !!context.accessToken),
		[requestKey, context.accessToken]
	)
	const [lifecycle, setLifecycle] = useState({ frame, generation: 0 })
	const generation =
		lifecycle.frame === frame
			? lifecycle.generation
			: lifecycle.generation + 1
	if (lifecycle.frame !== frame) setLifecycle({ frame, generation })
	useEffect(() => {
		frame.activate()
		return frame.deactivate
	}, [frame])
	const current = () => enabled && frame.isActive() && context.isCurrent()
	const records = useQuery({
		queryKey: [
			'crm-assignee-options',
			scopeKey,
			page,
			search,
			selection.selectedSubject ?? '',
			// Responses carry a local lifecycle frame; another mounted consumer
			// must not replace it through React Query request deduplication.
			observerId,
			// Returning to the same authority after revalidation is a new frame.
			// Never deduplicate its request with a still-pending older lifetime.
			generation
		],
		// Eligibility is declarative. The parent's live guard may catch up only
		// in its layout effect; queryFn checks it after commit, before any HTTP.
		enabled,
		queryFn: async () => {
			if (!current()) throw invalidContractError()
			const response = await listAssigneeOptions(context.accessToken!, {
				workspaceId: context.workspaceId,
				subject: context.subject!,
				dataScope: authority!.dataScope,
				page,
				pageSize: 20,
				search,
				...(selection.selectedSubject
					? { selectedSubject: selection.selectedSubject }
					: {}),
				...(selection.teamId ? { teamId: selection.teamId } : {})
			})
			if (!current()) throw invalidContractError()
			return { response, frame }
		},
		retry: false,
		staleTime: 0,
		gcTime: 0,
		refetchOnWindowFocus: false,
		refetchOnReconnect: 'always'
	})
	const data =
		enabled &&
		context.isCurrent() &&
		records.isSuccess &&
		// Query structural sharing may copy the handle object on refresh, but
		// preserves this per-frame function identity. Old lifetimes still differ.
		records.data.frame.isActive === frame.isActive &&
		!records.isFetching
			? records.data.response
			: undefined
	const resolveBinding = (binding: {
		subject: string
		membershipId?: string | null
	}): AssigneeOption | null => {
		if (
			!current() ||
			!data ||
			binding.membershipId === null ||
			(binding.membershipId === undefined &&
				binding.subject !== context.subject)
		)
			return null
		const entry = [data.selected, ...data.items].find(
			item =>
				item?.subject === binding.subject &&
				(binding.membershipId === undefined ||
					item.membershipId === binding.membershipId)
		)
		return entry ?? null
	}
	return {
		scopeKey,
		data,
		page,
		pageSize: 20,
		search,
		selected: data?.selected ?? null,
		loading: current() && (records.isPending || records.isFetching),
		error: current() && records.isError,
		enabled: enabled && context.isCurrent(),
		isCurrent: current,
		resolveBinding,
		refetch: async () => {
			if (!current()) return false
			const result = await records.refetch()
			return current() && result.isSuccess
		},
		setPage: (next: number) => {
			if (
				!current() ||
				!data ||
				!Number.isSafeInteger(next) ||
				next < 1 ||
				next > Math.max(1, Math.ceil(data.total / 20))
			)
				return
			setFilters({ scopeKey, page: next, search })
		},
		setSearch: (next: string) => {
			if (!current() || next.length > 200) return
			setFilters({ scopeKey, page: 1, search: next.trim() })
		}
	}
}
