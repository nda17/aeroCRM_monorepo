import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import {
	hasExactKeys,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'

export type MailIntakeDraft = {
	title: string
	name: string
	phone: string | null
	email: string | null
	message: string | null
	teamId: string | null
}
export type MailIntakePreview = {
	schemaVersion: 1
	workspaceId: string
	source: { messageId: string; sourceHash: string }
	draft: MailIntakeDraft
	bodyStatus: 'COMPLETE' | 'UNAVAILABLE' | 'TOO_LARGE'
	textTruncated: boolean
}
export type MailIntakeCreate = MailIntakeDraft & {
	schemaVersion: 1
	workspaceId: string
	commandId: string
	messageId: string
	sourceHash: string
	copyConfirmed: true
}
export type MailIntakeCreated = {
	schemaVersion: 1
	workspaceId: string
	sourceKind: 'MAIL'
	entryId: string
}
const root = '/crm/intake/mail'
const safeId = (value: string) => {
	if (!isUuidV4(value)) throw invalidContractError()
	return value
}
const nullableString = (value: unknown, max: number) =>
	value === null || (typeof value === 'string' && value.length <= max)

export function parseMailIntakePreview(
	value: unknown,
	workspaceId: string,
	messageId: string
): MailIntakePreview {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'source',
			'draft',
			'bodyStatus',
			'textTruncated'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		!isRecord(value.source) ||
		!hasExactKeys(value.source, ['messageId', 'sourceHash']) ||
		value.source.messageId !== messageId ||
		typeof value.source.sourceHash !== 'string' ||
		!/^[0-9a-f]{64}$/.test(value.source.sourceHash) ||
		!isRecord(value.draft) ||
		!hasExactKeys(value.draft, [
			'title',
			'name',
			'phone',
			'email',
			'message',
			'teamId'
		]) ||
		!isNonEmptyString(value.draft.title, 200) ||
		!isNonEmptyString(value.draft.name, 200) ||
		value.draft.phone !== null ||
		!nullableString(value.draft.email, 254) ||
		!nullableString(value.draft.message, 5000) ||
		value.draft.teamId !== null ||
		typeof value.bodyStatus !== 'string' ||
		!['COMPLETE', 'UNAVAILABLE', 'TOO_LARGE'].includes(value.bodyStatus) ||
		typeof value.textTruncated !== 'boolean'
	)
		throw invalidContractError()
	return value as unknown as MailIntakePreview
}
export function parseMailIntakeCreated(
	value: unknown,
	workspaceId: string
): MailIntakeCreated {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'sourceKind',
			'entryId'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		value.sourceKind !== 'MAIL' ||
		!isUuidV4(value.entryId)
	)
		throw invalidContractError()
	return value as MailIntakeCreated
}
export const getMailIntakePreview = async (
	accessToken: string,
	workspaceId: string,
	messageId: string
) =>
	parseMailIntakePreview(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: `${root}/preview`,
			params: {
				workspaceId: safeId(workspaceId),
				messageId: safeId(messageId)
			}
		}),
		workspaceId,
		messageId
	)
export const createMailIntake = async (
	accessToken: string,
	command: MailIntakeCreate
) =>
	parseMailIntakeCreated(
		await authenticatedRequest({
			accessToken,
			method: 'POST',
			url: `${root}/entries`,
			data: command,
			headers: { 'Idempotency-Key': safeId(command.commandId) }
		}),
		command.workspaceId
	)
export const getMailIntakeCommand = async (
	accessToken: string,
	workspaceId: string,
	commandId: string
) => {
	const value = await authenticatedRequest({
		accessToken,
		method: 'GET',
		url: `${root}/commands/${safeId(commandId)}`,
		params: { workspaceId: safeId(workspaceId) }
	})
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'status',
			'entryId'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		!(value.status === 'ABSENT'
			? value.entryId === null
			: value.status === 'COMMITTED' && isUuidV4(value.entryId))
	)
		throw invalidContractError()
	return value as {
		schemaVersion: 1
		workspaceId: string
		status: 'ABSENT' | 'COMMITTED'
		entryId: string | null
	}
}
export const getMailIntakeSource = async (
	accessToken: string,
	workspaceId: string,
	entryId: string
) => {
	const value = await authenticatedRequest({
		accessToken,
		method: 'GET',
		url: `${root}/entries/${safeId(entryId)}/source`,
		params: { workspaceId: safeId(workspaceId) }
	})
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'entryId',
			'source'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		value.entryId !== entryId ||
		!isRecord(value.source) ||
		!hasExactKeys(value.source, ['kind', 'canOpen', 'messageId']) ||
		value.source.kind !== 'MAIL' ||
		!(value.source.canOpen === true
			? isUuidV4(value.source.messageId)
			: value.source.canOpen === false && value.source.messageId === null)
	)
		throw invalidContractError()
	return value.source as {
		kind: 'MAIL'
		canOpen: boolean
		messageId: string | null
	}
}
