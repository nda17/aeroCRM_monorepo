'use client'

import { useLayoutEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
	crmPermissionScope,
	getCrmPermissions,
	useCrmPermissions,
	useCrmWorkspaceAccess
} from '@/entities/crm-access'
import { useSessionStore } from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import {
	commandOwner,
	useMemoryCommand
} from '@/shared/lib/pending-command'

export const useCollaboration = () => {
	const workspace = useCrmWorkspaceAccess()
	const { session, sessionRevision } = useSessionStore()
	const permissions = useCrmPermissions(
		workspace.workspaceId,
		session,
		sessionRevision
	)
	const authority = permissions.data
	const ready =
		!!session &&
		!!authority &&
		permissions.isSuccess &&
		authority.subject === session.userId &&
		authority.workspaceId === workspace.workspaceId
	const binding = {
		workspaceId: workspace.workspaceId,
		subject: session?.userId ?? ''
	}
	const scope = crmPermissionScope(authority)
	const key = [
		workspace.workspaceId,
		session?.userId,
		sessionRevision,
		workspace.membership.membershipId,
		scope
	] as const
	const identity = JSON.stringify(key)
	const live = useRef({ identity, ready, mounted: true })
	useLayoutEffect(() => {
		live.current = { identity, ready, mounted: true }
		return () => {
			live.current.mounted = false
		}
	}, [identity, ready])
	const current = () => {
		const store = useSessionStore.getState()
		return (
			live.current.mounted &&
			live.current.ready &&
			live.current.identity === identity &&
			store.sessionRevision === sessionRevision &&
			!!session &&
			store.session?.userId === session.userId &&
			store.session?.accessToken === session.accessToken
		)
	}
	return {
		workspace,
		session,
		sessionRevision,
		permissions,
		authority,
		binding,
		scope,
		key,
		identity,
		ready,
		current,
		canWrite:
			ready &&
			workspace.canWrite &&
			authority?.state !== 'READ_ONLY' &&
			!permissions.isFetching
	}
}

export type CollaborationContext = ReturnType<typeof useCollaboration>

export const useCollaborationCommand = <
	C extends { commandId: string },
	R
>(
	context: CollaborationContext,
	intent: string,
	send: (token: string, command: C) => Promise<R>,
	onSuccess: (result: R, command: C) => void,
	write = true
) => {
	const client = useQueryClient()
	return useMemoryCommand<C, R>(
		{
			owner: commandOwner(
				context.session?.userId,
				context.sessionRevision
			),
			workspaceId: context.workspace.workspaceId,
			view: context.scope + ':' + context.workspace.membership.membershipId
		},
		intent,
		write ? context.canWrite : context.ready,
		async () => {
			if (!context.session || !context.current())
				throw new AuthenticatedApiError(
					'unauthorized',
					'Сессия изменилась. Обновите страницу.'
				)
			const fresh = await getCrmPermissions(
				context.session.accessToken,
				context.workspace.workspaceId
			)
			if (
				!context.current() ||
				fresh.subject !== context.binding.subject ||
				crmPermissionScope(fresh) !== context.scope ||
				(write && fresh.state === 'READ_ONLY')
			)
				throw new AuthenticatedApiError(
					'forbidden',
					'Доступ изменился. Обновите страницу и проверьте права.'
				)
			return context.session.accessToken
		},
		send,
		(result, command) => {
			if (!context.current()) return
			for (const root of [
				'workspace-directory',
				'workspace-chat-conversations',
				'workspace-chat-messages',
				'crm-chat-notifications',
				'crm-employee-profile',
				'crm-team'
			])
				void client.invalidateQueries({ queryKey: [root] })
			onSuccess(result, command)
		}
	)
}
