'use client'

import {
	crmPermissionScope,
	getCrmPermissions,
	useCrmPermissions,
	useCrmWorkspaceAccess,
	type CrmPermissions
} from '@/entities/crm-access'
import { useSessionStore } from '@/entities/session'
import {
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLayoutEffect, useRef } from 'react'
import {
	getWorkdayTask,
	listWorkdayTasks,
	listWorkdayTimeline
} from '../api/workday.api'
import type { WorkdayFilters, WorkdayTask } from './workday.types'
import { validWorkdayFilters } from './workday.contract'

export const allowedWorkdayScopes = (
	permissions: CrmPermissions | undefined
) =>
	permissions?.role === 'ANALYST' ||
	!permissions?.permissions.includes('sales:read')
		? []
		: permissions.dataScope === 'ALL'
			? (['MINE', 'TEAM', 'ALL'] as const)
			: permissions.dataScope === 'TEAM'
				? (['MINE', 'TEAM'] as const)
				: (['MINE'] as const)

// Linked tasks depend on the deal's ownership, which this task DTO deliberately
// does not expose. Never infer linked-task visibility from task assignee alone.
export const taskFitsWorkdayAuthority = (
	task: WorkdayTask,
	permissions: CrmPermissions
) =>
	task.workspaceId === permissions.workspaceId &&
	(task.dealId !== null ||
		permissions.dataScope === 'ALL' ||
		task.assignedToSubject === permissions.subject ||
		(permissions.dataScope === 'TEAM' &&
			task.teamId !== null &&
			permissions.teamIds.includes(task.teamId)))

export const useWorkdaySession = () => {
	const workspace = useCrmWorkspaceAccess()
	const { session, sessionRevision, status } = useSessionStore()
	const permissions = useCrmPermissions(
		workspace.workspaceId,
		session,
		sessionRevision
	)
	const canRead =
		status === 'authenticated' &&
		!!session &&
		permissions.isSuccess &&
		!permissions.isFetching &&
		permissions.data.subject === session.userId &&
		permissions.data.workspaceId === workspace.workspaceId &&
		permissions.data.role !== 'ANALYST' &&
		permissions.data.permissions.includes('sales:read')
	const canWrite =
		canRead &&
		workspace.canWrite &&
		permissions.data?.state !== 'READ_ONLY' &&
		permissions.data?.permissions.includes('sales:write') === true
	const scopeKey = JSON.stringify([
		crmPermissionScope(permissions.data),
		permissions.data?.state
	])
	const key = [
		workspace.workspaceId,
		session?.userId,
		sessionRevision,
		scopeKey
	] as const
	const signature = JSON.stringify(key)
	const latest = useRef({ signature, canRead, canWrite })
	useLayoutEffect(() => {
		latest.current = { signature, canRead, canWrite }
	}, [signature, canRead, canWrite])
	const client = useQueryClient()
	const current = () => {
		const state = useSessionStore.getState()
		return (
			state.status === 'authenticated' &&
			state.session?.accessToken === session?.accessToken &&
			state.session?.userId === session?.userId &&
			state.sessionRevision === sessionRevision &&
			latest.current.signature === signature &&
			latest.current.canRead
		)
	}
	const authorize = async () => {
		if (!canWrite || !current() || !latest.current.canWrite || !session)
			throw new AuthenticatedApiError(
				'forbidden',
				'Изменения задач недоступны.'
			)
		if (!navigator.onLine)
			throw new AuthenticatedApiError(
				'temporary',
				'Нет подключения к сети.'
			)
		const fresh = await getCrmPermissions(
			session.accessToken,
			workspace.workspaceId
		)
		if (!current())
			throw new AuthenticatedApiError(
				'unauthorized',
				'Сессия или пространство изменились.'
			)
		if (
			fresh.subject !== session.userId ||
			fresh.workspaceId !== workspace.workspaceId ||
			fresh.role === 'ANALYST' ||
			fresh.state === 'READ_ONLY' ||
			!fresh.permissions.includes('sales:write') ||
			JSON.stringify([crmPermissionScope(fresh), fresh.state]) !== scopeKey
		) {
			void client.invalidateQueries({
				queryKey: [
					'crm-permissions',
					workspace.workspaceId,
					session.userId,
					sessionRevision
				],
				exact: true
			})
			throw new AuthenticatedApiError(
				'forbidden',
				'Права изменились. Обновите доступ перед сохранением.'
			)
		}
		return session.accessToken
	}
	return {
		workspace,
		session,
		sessionRevision,
		permissions,
		canRead,
		canWrite,
		key,
		scopeKey,
		current,
		authorize,
		scopes: allowedWorkdayScopes(permissions.data)
	}
}

const readOptions = {
	retry: false,
	staleTime: 0,
	gcTime: 0,
	refetchOnWindowFocus: false,
	refetchOnReconnect: 'always' as const
}

export const useWorkdayTasks = (
	filters: WorkdayFilters,
	enabled = true
) => {
	const context = useWorkdaySession()
	const permitted =
		validWorkdayFilters(filters) &&
		context.scopes.some(scope => scope === filters.scope) &&
		(filters.teamId === undefined ||
			context.permissions.data?.teamIds.includes(filters.teamId) === true)
	const key = ['crm-workday', 'list', ...context.key, filters] as const
	const query = useQuery({
		queryKey: key,
		enabled: enabled && context.canRead && permitted,
		...readOptions,
		queryFn: async () => {
			if (
				!enabled ||
				!permitted ||
				!context.current() ||
				!context.session ||
				!context.permissions.data
			)
				throw invalidContractError()
			const result = await listWorkdayTasks(context.session.accessToken, {
				...filters,
				workspaceId: context.workspace.workspaceId,
				subject: context.session.userId
			})
			if (
				!context.current() ||
				result.items.some(
					task =>
						!taskFitsWorkdayAuthority(task, context.permissions.data!) ||
						(filters.scope === 'TEAM' &&
							(task.teamId === null ||
								!context.permissions.data!.teamIds.includes(task.teamId)))
				)
			)
				throw invalidContractError()
			return result
		}
	})
	return {
		context,
		query,
		key,
		permitted,
		data:
			enabled && context.canRead && permitted && !query.isError
				? query.data
				: undefined
	}
}
export const useWorkdayTask = (id: string | null, enabled = true) => {
	const context = useWorkdaySession()
	const key = ['crm-workday', 'detail', ...context.key, id] as const
	const query = useQuery({
		queryKey: key,
		enabled: enabled && context.canRead && id !== null,
		...readOptions,
		queryFn: async () => {
			if (
				!enabled ||
				!id ||
				!context.current() ||
				!context.session ||
				!context.permissions.data
			)
				throw invalidContractError()
			const result = await getWorkdayTask(context.session.accessToken, {
				workspaceId: context.workspace.workspaceId,
				subject: context.session.userId,
				id
			})
			if (
				!context.current() ||
				!taskFitsWorkdayAuthority(result, context.permissions.data)
			)
				throw invalidContractError()
			return result
		}
	})
	return {
		context,
		query,
		key,
		data:
			enabled && context.canRead && id !== null && !query.isError
				? query.data
				: undefined
	}
}
export const useWorkdayTimeline = (
	id: string | null,
	page: number,
	pageSize = 25,
	enabled = true
) => {
	const context = useWorkdaySession()
	const key = [
		'crm-workday',
		'timeline',
		...context.key,
		id,
		page,
		pageSize
	] as const
	const query = useQuery({
		queryKey: key,
		enabled: enabled && context.canRead && id !== null,
		...readOptions,
		queryFn: async () => {
			if (!enabled || !id || !context.current() || !context.session)
				throw invalidContractError()
			const result = await listWorkdayTimeline(
				context.session.accessToken,
				{
					workspaceId: context.workspace.workspaceId,
					subject: context.session.userId,
					id,
					page,
					pageSize
				}
			)
			if (!context.current()) throw invalidContractError()
			return result
		}
	})
	return {
		context,
		query,
		key,
		data:
			enabled && context.canRead && id !== null && !query.isError
				? query.data
				: undefined
	}
}
