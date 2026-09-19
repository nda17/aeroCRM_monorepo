'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { invalidContractError } from '@/shared/api/authenticated-http-client'
import { listTeamOptions } from '../api/team.api'

interface Context {
	workspaceId: string
	subject?: string
	accessToken?: string
	sessionRevision: number
	permissionScope: string
	teamIds: readonly string[]
	enabled: boolean
	isCurrent?: () => boolean
}

export const useTeamOptions = (context: Context, selectedId: string) => {
	const scope = JSON.stringify([
		context.workspaceId,
		context.subject,
		context.sessionRevision,
		context.permissionScope,
		[...context.teamIds].sort()
	])
	const [pagination, setPagination] = useState({ scope, page: 1 })
	const page = pagination.scope === scope ? pagination.page : 1
	const enabled =
		context.enabled &&
		!!context.subject &&
		!!context.accessToken &&
		context.teamIds.length > 0
	const current = () => enabled && (context.isCurrent?.() ?? true)
	const records = useQuery({
		queryKey: ['crm-team-options', scope, page, selectedId],
		enabled,
		queryFn: async () => {
			if (!current()) throw invalidContractError()
			const response = await listTeamOptions(context.accessToken!, {
				workspaceId: context.workspaceId,
				subject: context.subject!,
				teamIds: context.teamIds,
				page,
				pageSize: 20,
				selectedId
			})
			if (!current()) throw invalidContractError()
			return response
		},
		retry: false,
		staleTime: 0,
		gcTime: 0
	})
	// Never display stale names from an old actor, scope or failed refresh.
	const confirmed = current() && records.isSuccess && !records.isFetching
	const data = confirmed ? records.data : undefined
	return {
		data,
		page,
		loading: enabled && (records.isPending || records.isFetching),
		error: enabled && records.isError,
		enabled,
		validSelection:
			!selectedId ||
			!!(
				data?.selected?.id === selectedId &&
				context.teamIds.includes(selectedId)
			),
		refetch: records.refetch,
		setPage: (next: number) => {
			if (current()) setPagination({ scope, page: next })
		}
	}
}
