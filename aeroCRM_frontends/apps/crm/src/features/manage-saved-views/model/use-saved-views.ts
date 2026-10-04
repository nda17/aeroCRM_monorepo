'use client'

import { useLayoutEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
	crmPermissionScope,
	getCrmPermissions
} from '@/entities/crm-access'
import { useSessionStore } from '@/entities/session'
import {
	listSavedViews,
	mutateSavedView,
	type SavedViewCommand,
	type SavedViewCommandResult,
	type SavedViewMutation,
	type SavedViewScope
} from '@/entities/crm-saved-views'
import type { useSalesSession } from '@/features/manage-sales/model/use-sales-session'
import {
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import {
	commandOwner,
	useMemoryCommand
} from '@/shared/lib/pending-command'

export type SavedViewsContext = Pick<
	ReturnType<typeof useSalesSession>,
	| 'workspace'
	| 'session'
	| 'sessionRevision'
	| 'permissions'
	| 'canRead'
	| 'scopeKey'
	| 'key'
>

export const useSavedViews = (
	context: SavedViewsContext,
	scope: SavedViewScope,
	onSaved: (
		result: SavedViewCommandResult,
		command: SavedViewCommand
	) => void
) => {
	const { workspace, session, sessionRevision } = context
	const client = useQueryClient()
	const signature = JSON.stringify([context.key, scope])
	const latest = useRef({ signature, canRead: context.canRead })
	useLayoutEffect(() => {
		latest.current = { signature, canRead: context.canRead }
	}, [signature, context.canRead])
	const current = () => {
		const state = useSessionStore.getState()
		return (
			latest.current.signature === signature &&
			latest.current.canRead &&
			state.session?.userId === session?.userId &&
			state.session?.accessToken === session?.accessToken &&
			state.sessionRevision === sessionRevision
		)
	}
	const binding = {
		workspaceId: workspace.workspaceId,
		subject: session?.userId ?? '',
		scope
	}
	const queryKey = ['crm-saved-views', ...context.key, scope] as const
	const query = useQuery({
		queryKey,
		enabled: context.canRead && !!session,
		retry: false,
		gcTime: 0,
		staleTime: 0,
		refetchOnWindowFocus: true,
		queryFn: async () => {
			if (!session || !current()) throw invalidContractError()
			const result = await listSavedViews(session.accessToken, binding)
			if (!current()) throw invalidContractError()
			return result
		}
	})
	const canManage =
		context.canRead &&
		workspace.canWrite &&
		!context.permissions.isFetching &&
		context.permissions.data?.state !== 'READ_ONLY'
	const command = useMemoryCommand<
		SavedViewCommand,
		SavedViewCommandResult
	>(
		{
			owner: commandOwner(session?.userId, sessionRevision),
			workspaceId: workspace.workspaceId,
			view: context.scopeKey
		},
		`saved-views:${scope}`,
		canManage,
		async () => {
			if (!session || !current())
				throw new AuthenticatedApiError(
					'unauthorized',
					'Сессия или пространство изменились.'
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
				fresh.workspaceId !== workspace.workspaceId ||
				fresh.subject !== session.userId ||
				fresh.state === 'READ_ONLY' ||
				!fresh.permissions.includes('sales:read') ||
				crmPermissionScope(fresh) !==
					crmPermissionScope(context.permissions.data)
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
					'Права изменились. Обновите доступ перед сохранением представления.'
				)
			}
			return session.accessToken
		},
		mutateSavedView,
		(result, accepted) => {
			void client.invalidateQueries({
				queryKey: ['crm-saved-views', workspace.workspaceId]
			})
			onSaved(result, accepted)
		}
	)
	const blocked =
		!!command.error &&
		command.error.kind !== 'validation' &&
		!command.uncertain
	return {
		query,
		items:
			context.canRead && !query.isError ? (query.data?.items ?? []) : [],
		canManage,
		command: {
			...command,
			blocked,
			locked: command.locked || blocked,
			execute: async (mutation?: SavedViewMutation) => {
				if (blocked) return
				await command.execute(
					mutation
						? () => ({
								...binding,
								commandId: crypto.randomUUID(),
								mutation
							})
						: undefined
				)
			}
		}
	}
}
