import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { isUuidV4 } from '@/shared/lib/contract'
import {
	isAcceptInvitationCommand,
	parseInvitationAcceptance,
	parseWorkspaceInvitation,
	type AcceptInvitationCommand
} from '../model/workspace-invitation.contract'

export const getWorkspaceInvitation = async (
	accessToken: string,
	invitationId: string
) => {
	if (!isUuidV4(invitationId)) throw invalidContractError()
	const parsed = parseWorkspaceInvitation(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: `/workspace-invitations/${invitationId}`
		}),
		invitationId
	)
	if (!parsed) throw invalidContractError()
	return parsed
}

export const acceptWorkspaceInvitation = async (
	accessToken: string,
	invitationId: string,
	workspaceId: string,
	subject: string,
	command: AcceptInvitationCommand
) => {
	if (
		!isUuidV4(invitationId) ||
		!isUuidV4(workspaceId) ||
		!isAcceptInvitationCommand(command)
	)
		throw invalidContractError()
	const parsed = parseInvitationAcceptance(
		await authenticatedRequest({
			accessToken,
			method: 'POST',
			url: `/workspace-invitations/${invitationId}/accept`,
			data: command,
			headers: { 'Idempotency-Key': command.commandId }
		}),
		invitationId,
		workspaceId,
		subject
	)
	if (!parsed) throw invalidContractError()
	return parsed
}
