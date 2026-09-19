import {
	hasExactKeys,
	isIsoDate,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'

export interface WorkspaceInvitation {
	id: string
	workspaceId: string
	productCode: 'WINCRM'
	version: number
	status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'
	expiresAt: string
	acceptedAt: string | null
}
export interface AcceptInvitationCommand {
	schemaVersion: 1
	commandId: string
	expectedVersion: number
}
export interface WorkspaceInvitationAcceptance {
	id: string
	invitationId: string
	invitationVersion: number
	workspaceId: string
	productCode: 'WINCRM'
	subject: string
	membershipId: string
	acceptedAt: string
	emailVerifiedAt: string
}
const version = (value: unknown): value is number =>
	Number.isInteger(value) &&
	Number(value) >= 1 &&
	Number(value) <= 2147483647

export const parseWorkspaceInvitation = (
	value: unknown,
	invitationId: string
): WorkspaceInvitation | null => {
	if (
		!isUuidV4(invitationId) ||
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'invitation']) ||
		value.schemaVersion !== 1 ||
		!isRecord(value.invitation)
	)
		return null
	const invitation = value.invitation
	if (
		!hasExactKeys(invitation, [
			'id',
			'workspaceId',
			'productCode',
			'version',
			'status',
			'expiresAt',
			'acceptedAt'
		]) ||
		invitation.id !== invitationId ||
		!isUuidV4(invitation.workspaceId) ||
		invitation.productCode !== 'WINCRM' ||
		!version(invitation.version) ||
		!['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'].includes(
			String(invitation.status)
		) ||
		!isIsoDate(invitation.expiresAt) ||
		(invitation.acceptedAt !== null && !isIsoDate(invitation.acceptedAt))
	)
		return null
	if (invitation.status === 'ACCEPTED' && invitation.acceptedAt === null)
		return null
	if (
		['PENDING', 'EXPIRED'].includes(String(invitation.status)) &&
		invitation.acceptedAt !== null
	)
		return null
	return invitation as unknown as WorkspaceInvitation
}

export const parseInvitationAcceptance = (
	value: unknown,
	invitationId: string,
	workspaceId: string,
	subject: string
): WorkspaceInvitationAcceptance | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'acceptance']) ||
		value.schemaVersion !== 1 ||
		!isRecord(value.acceptance)
	)
		return null
	const accepted = value.acceptance
	if (
		!hasExactKeys(accepted, [
			'id',
			'invitationId',
			'invitationVersion',
			'workspaceId',
			'productCode',
			'subject',
			'membershipId',
			'acceptedAt',
			'emailVerifiedAt'
		]) ||
		!isUuidV4(accepted.id) ||
		accepted.invitationId !== invitationId ||
		!isUuidV4(invitationId) ||
		accepted.workspaceId !== workspaceId ||
		!isUuidV4(workspaceId) ||
		accepted.subject !== subject ||
		!isNonEmptyString(subject, 256) ||
		!isUuidV4(accepted.membershipId) ||
		!version(accepted.invitationVersion) ||
		accepted.productCode !== 'WINCRM' ||
		!isIsoDate(accepted.acceptedAt) ||
		!isIsoDate(accepted.emailVerifiedAt) ||
		accepted.emailVerifiedAt > accepted.acceptedAt
	)
		return null
	return accepted as unknown as WorkspaceInvitationAcceptance
}

export const isAcceptInvitationCommand = (
	command: AcceptInvitationCommand
) =>
	isRecord(command) &&
	hasExactKeys(command, [
		'schemaVersion',
		'commandId',
		'expectedVersion'
	]) &&
	command.schemaVersion === 1 &&
	isUuidV4(command.commandId) &&
	version(command.expectedVersion)
