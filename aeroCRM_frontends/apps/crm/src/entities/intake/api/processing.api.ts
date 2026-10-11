import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import {
	hasExactKeys,
	isIsoDate,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'
import {
	acceptanceStatuses,
	type AcceptanceStatus
} from '../model/acceptance.contract'

export type InboxProcessingAcceptance = {
	actorSubject: string
	status: AcceptanceStatus
	claimedAt: string
}
export type InboxProcessing = {
	schemaVersion: 1
	workspaceId: string
	items: {
		entryId: string
		acceptance: InboxProcessingAcceptance | null
	}[]
}
export type MailIntakeProcessing = {
	schemaVersion: 1
	workspaceId: string
	messageId: string
	copy: null | {
		entryId: string | null
		canOpen: boolean
		actorSubject: string
		createdAt: string
		acceptance: InboxProcessingAcceptance | null
	}
}

const root = '/crm/intake'
const parseAcceptance = (
	value: unknown
): InboxProcessingAcceptance | null => {
	if (value === null) return null
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['actorSubject', 'status', 'claimedAt']) ||
		!isNonEmptyString(value.actorSubject, 256) ||
		!isAcceptanceStatus(value.status) ||
		!isIsoDate(value.claimedAt)
	)
		return null
	return value as InboxProcessingAcceptance
}
const isAcceptanceStatus = (value: unknown): value is AcceptanceStatus =>
	typeof value === 'string' &&
	(acceptanceStatuses as readonly string[]).includes(value)

export const listInboxProcessing = async (
	token: string,
	workspaceId: string,
	entryIds: string[]
): Promise<InboxProcessing> => {
	if (
		!isUuidV4(workspaceId) ||
		entryIds.length < 1 ||
		entryIds.length > 100 ||
		entryIds.some(id => !isUuidV4(id)) ||
		new Set(entryIds).size !== entryIds.length
	)
		throw invalidContractError()
	const value = await authenticatedRequest({
		accessToken: token,
		method: 'GET',
		url: `${root}/inbox/processing`,
		params: {
			workspaceId,
			entryIds: entryIds.join(','),
			view: 'shared'
		}
	})
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'workspaceId', 'items']) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		!Array.isArray(value.items) ||
		value.items.length !== entryIds.length
	)
		throw invalidContractError()
	const expected = new Set(entryIds)
	for (const item of value.items) {
		if (
			!isRecord(item) ||
			!hasExactKeys(item, ['entryId', 'acceptance']) ||
			!isUuidV4(item.entryId) ||
			!expected.delete(item.entryId) ||
			(item.acceptance !== null && !parseAcceptance(item.acceptance))
		)
			throw invalidContractError()
	}
	if (expected.size) throw invalidContractError()
	return value as unknown as InboxProcessing
}

export const getMailIntakeProcessing = async (
	token: string,
	workspaceId: string,
	messageId: string
): Promise<MailIntakeProcessing> => {
	if (!isUuidV4(workspaceId) || !isUuidV4(messageId))
		throw invalidContractError()
	const value = await authenticatedRequest({
		accessToken: token,
		method: 'GET',
		url: `${root}/mail/messages/${messageId}/processing`,
		params: { workspaceId }
	})
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'messageId',
			'copy'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		value.messageId !== messageId
	)
		throw invalidContractError()
	if (value.copy !== null) {
		const copy = value.copy
		if (
			!isRecord(copy) ||
			!hasExactKeys(copy, [
				'entryId',
				'canOpen',
				'actorSubject',
				'createdAt',
				'acceptance'
			]) ||
			!(copy.entryId === null || isUuidV4(copy.entryId)) ||
			typeof copy.canOpen !== 'boolean' ||
			copy.canOpen !== (copy.entryId !== null) ||
			!isNonEmptyString(copy.actorSubject, 256) ||
			!isIsoDate(copy.createdAt) ||
			(copy.acceptance !== null && !parseAcceptance(copy.acceptance))
		)
			throw invalidContractError()
	}
	return value as unknown as MailIntakeProcessing
}
