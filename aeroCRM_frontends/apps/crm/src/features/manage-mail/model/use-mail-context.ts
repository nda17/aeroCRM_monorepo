'use client'

import { useQuery } from '@tanstack/react-query'
import { useCrmWorkspaceAccess } from '@/entities/crm-access'
import { useSessionStore } from '@/entities/session'
import { getMailCapabilities } from '@/entities/mail/api/mail.api'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import {
	commandOwner,
	useMemoryCommand
} from '@/shared/lib/pending-command'

export const useMailContext = () => {
	const workspace = useCrmWorkspaceAccess()
	const { session, sessionRevision } = useSessionStore()
	const key = [
		workspace.workspaceId,
		session?.userId,
		sessionRevision
	] as const
	const capabilities = useQuery({
		queryKey: ['mail-capabilities', ...key],
		enabled: !!session,
		queryFn: () =>
			getMailCapabilities(session!.accessToken, workspace.workspaceId),
		gcTime: 0,
		staleTime: 15_000,
		retry: false
	})
	return { workspace, session, sessionRevision, key, capabilities }
}

export const useMailCommand = <C extends { commandId: string }, R>(
	context: ReturnType<typeof useMailContext>,
	view: string,
	permission: 'mail:read' | 'mail:send' | 'mail:manage',
	send: (token: string, command: C) => Promise<R>,
	success: (result: R, command: C) => void
) => {
	const { session, sessionRevision, workspace, capabilities } = context
	const enabled =
		!!session &&
		!capabilities.isError &&
		!capabilities.isFetching &&
		(permission === 'mail:read' || workspace.canWrite) &&
		capabilities.data?.enabled === true &&
		capabilities.data.mailPermissions.includes(permission)
	const command = useMemoryCommand<C, R>(
		{
			owner: commandOwner(session?.userId, sessionRevision),
			workspaceId: workspace.workspaceId,
			view
		},
		view,
		enabled,
		async () => {
			if (!session)
				throw new AuthenticatedApiError('unauthorized', 'Войдите в CRM.')
			const fresh = await getMailCapabilities(
				session.accessToken,
				workspace.workspaceId
			)
			const current = useSessionStore.getState()
			if (
				current.session?.userId !== session.userId ||
				current.sessionRevision !== sessionRevision
			)
				throw new AuthenticatedApiError(
					'unauthorized',
					'Сессия изменилась.'
				)
			if (!fresh.enabled || !fresh.mailPermissions.includes(permission))
				throw new AuthenticatedApiError(
					'forbidden',
					'Доступ к почте изменился.'
				)
			return current.session.accessToken
		},
		send,
		success,
		// Every mail mutation uses a durable command receipt. An explicit recovery
		// replays the same private capsule; a lost response may not contain a sendId.
		send
	)
	return {
		...command,
		enabled,
		checkingAccess: capabilities.isFetching,
		recheckAccess: () => capabilities.refetch()
	}
}

export const newMailCommand = (workspaceId: string) => ({
	schemaVersion: 1 as const,
	workspaceId,
	commandId: crypto.randomUUID()
})

export const isMailAccessDenied = (error: unknown) =>
	error instanceof AuthenticatedApiError &&
	['unauthorized', 'forbidden', 'notFound'].includes(error.kind)
