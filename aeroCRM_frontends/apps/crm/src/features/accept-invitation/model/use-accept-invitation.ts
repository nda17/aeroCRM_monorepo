'use client'

import { useSessionStore } from '@/entities/session'
import {
	acceptWorkspaceInvitation,
	getWorkspaceInvitation,
	type AcceptInvitationCommand,
	type WorkspaceInvitation,
	type WorkspaceInvitationAcceptance
} from '@/entities/workspace-invitation'
import {
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import {
	commandOwner,
	useMemoryCommand
} from '@/shared/lib/pending-command'

export const useAcceptInvitation = (
	invitation: WorkspaceInvitation,
	online: boolean,
	onAccepted: (result: WorkspaceInvitationAcceptance) => void
) => {
	const { session, sessionRevision, status } = useSessionStore()
	const isCurrent = () => {
		const now = useSessionStore.getState()
		return (
			now.status === 'authenticated' &&
			now.session?.userId === session?.userId &&
			now.session?.accessToken === session?.accessToken &&
			now.sessionRevision === sessionRevision
		)
	}
	const request = async <R>(send: (token: string) => Promise<R>) => {
		if (!session || !isCurrent() || !navigator.onLine)
			throw new AuthenticatedApiError(
				'temporary',
				'Проверьте вход и подключение. Сохранённая команда не изменена.'
			)
		// A command's 401 cannot erase an earlier unknown outcome. The session
		// gates remain authoritative; this editor keeps its exact pending intent.
		const result = await send(session.accessToken)
		if (!isCurrent()) throw invalidContractError()
		return result
	}
	return useMemoryCommand<
		AcceptInvitationCommand,
		WorkspaceInvitationAcceptance
	>(
		{
			owner: commandOwner(session?.userId, sessionRevision),
			workspaceId: invitation.workspaceId,
			view: invitation.id
		},
		`identity:accept-invitation:${invitation.id}`,
		online && status === 'authenticated' && !!session,
		() =>
			request(async token => {
				const fresh = await getWorkspaceInvitation(token, invitation.id)
				if (fresh.workspaceId !== invitation.workspaceId)
					throw invalidContractError()
				// Even ACCEPTED/REVOKED/EXPIRED previews must not replace a pending UUID:
				// the original command is replayed and Identity decides its result.
				return token
			}),
		(_token, command) =>
			request(token =>
				acceptWorkspaceInvitation(
					token,
					invitation.id,
					invitation.workspaceId,
					session!.userId,
					command
				)
			),
		onAccepted
	)
}
