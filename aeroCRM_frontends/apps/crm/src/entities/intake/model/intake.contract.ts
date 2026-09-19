import {
	hasExactKeys,
	isIsoDate,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'

export type InboxStatus = 'NEW' | 'ACCEPTED' | 'REJECTED'
interface InboxEntryBase {
	id: string
	workspaceId: string
	title: string
	phone: string | null
	email: string | null
	message: string | null
	status: InboxStatus
	createdBySubject: string
	teamId: string | null
	version: number
	contactId: string | null
	dealId: string | null
	rejectionReason: string | null
	receivedAt: string
	updatedAt: string
	acceptedAt: string | null
	rejectedAt: string | null
}
export type InboxEntry = InboxEntryBase &
	(
		| { origin: 'MANUAL' | 'CSV'; name: string; sourceId: null }
		| { origin: 'API'; name: string; sourceId: string }
	)
export interface IntakeSource {
	id: string
	workspaceId: string
	name: string
	kind: 'API'
	tokenVersion: number
	createdBySubject: string
	teamId: string | null
	version: number
	revokedAt: string | null
	createdAt: string
	updatedAt: string
}
export interface IntakeActivity {
	id: string
	workspaceId: string
	entityId: string
	entityKind: 'entry'
	commandId: string
	actorSubject: string
	action:
		| 'CREATED'
		| 'REJECTED'
		| 'ACCEPTANCE_REQUESTED'
		| 'ACCEPTANCE_RETRIED'
		| 'ACCEPTANCE_RECOVERY_REQUESTED'
		| 'ACCEPTANCE_CANCELLED'
		| 'ACCEPTED'
	entityVersion: number
	createdAt: string
}
export interface IntakePage<T> {
	schemaVersion: 1
	items: T[]
	page: number
	pageSize: number
	total: number
}
const nullableText = (value: unknown, max: number) =>
	value === null || (typeof value === 'string' && value.length <= max)
const nullableUuid = (value: unknown) => value === null || isUuidV4(value)
const nullableDate = (value: unknown) => value === null || isIsoDate(value)
const version = (value: unknown) =>
	Number.isSafeInteger(value) &&
	Number(value) > 0 &&
	Number(value) <= 2147483647
const scoped = (value: Record<string, unknown>, workspaceId: string) =>
	isUuidV4(value.id) &&
	isUuidV4(workspaceId) &&
	value.workspaceId === workspaceId

export const parseInboxEntry = (
	value: unknown,
	workspaceId: string
): InboxEntry | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'id',
			'workspaceId',
			'title',
			'name',
			'phone',
			'email',
			'message',
			'origin',
			'sourceId',
			'status',
			'createdBySubject',
			'teamId',
			'version',
			'contactId',
			'dealId',
			'rejectionReason',
			'receivedAt',
			'updatedAt',
			'acceptedAt',
			'rejectedAt'
		]) ||
		!scoped(value, workspaceId) ||
		!isNonEmptyString(value.title, 200) ||
		!isNonEmptyString(value.name, 200) ||
		!(
			value.phone === null ||
			(typeof value.phone === 'string' &&
				/^\+[1-9][0-9]{6,14}$/.test(value.phone))
		) ||
		!nullableText(value.email, 254) ||
		!nullableText(value.message, 5000) ||
		!isNonEmptyString(value.createdBySubject, 256) ||
		!nullableUuid(value.teamId) ||
		!version(value.version) ||
		!nullableUuid(value.contactId) ||
		!nullableUuid(value.dealId) ||
		!nullableText(value.rejectionReason, 2000) ||
		!isIsoDate(value.receivedAt) ||
		!isIsoDate(value.updatedAt) ||
		!nullableDate(value.acceptedAt) ||
		!nullableDate(value.rejectedAt)
	)
		return null
	if (
		!(value.origin === 'MANUAL' && value.sourceId === null) &&
		!(value.origin === 'CSV' && value.sourceId === null) &&
		!(
			value.origin === 'API' &&
			isUuidV4(value.sourceId)
		)
	)
		return null
	const untouched =
		value.contactId === null &&
		value.dealId === null &&
		value.acceptedAt === null
	if (value.status === 'NEW') {
		if (
			!untouched ||
			value.rejectedAt !== null ||
			value.rejectionReason !== null
		)
			return null
	} else if (value.status === 'REJECTED') {
		if (
			!untouched ||
			!isIsoDate(value.rejectedAt) ||
			!isNonEmptyString(value.rejectionReason, 2000)
		)
			return null
	} else if (value.status === 'ACCEPTED') {
		if (
			!isUuidV4(value.contactId) ||
			!isUuidV4(value.dealId) ||
			!isIsoDate(value.acceptedAt) ||
			value.rejectedAt !== null ||
			value.rejectionReason !== null
		)
			return null
	} else return null
	return value as unknown as InboxEntry
}

export const parseIntakeSource = (
	value: unknown,
	workspaceId: string
): IntakeSource | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'id',
			'workspaceId',
			'name',
			'kind',
			'tokenVersion',
			'createdBySubject',
			'teamId',
			'version',
			'revokedAt',
			'createdAt',
			'updatedAt'
		]) ||
		!scoped(value, workspaceId) ||
		!isNonEmptyString(value.name, 200) ||
		value.kind !== 'API' ||
		!version(value.tokenVersion) ||
		!isNonEmptyString(value.createdBySubject, 256) ||
		!nullableUuid(value.teamId) ||
		!version(value.version) ||
		!nullableDate(value.revokedAt) ||
		!isIsoDate(value.createdAt) ||
		!isIsoDate(value.updatedAt)
	)
		return null
	return value as unknown as IntakeSource
}

export const parseIntakeActivity = (
	value: unknown,
	workspaceId: string,
	entryId: string
): IntakeActivity | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'id',
			'workspaceId',
			'entityId',
			'entityKind',
			'commandId',
			'actorSubject',
			'action',
			'entityVersion',
			'createdAt'
		]) ||
		!scoped(value, workspaceId) ||
		value.entityId !== entryId ||
		!isUuidV4(entryId) ||
		value.entityKind !== 'entry' ||
		!isUuidV4(value.commandId) ||
		!isNonEmptyString(value.actorSubject, 256) ||
		![
			'CREATED',
			'REJECTED',
			'ACCEPTANCE_REQUESTED',
			'ACCEPTANCE_RETRIED',
			'ACCEPTANCE_RECOVERY_REQUESTED',
			'ACCEPTANCE_CANCELLED',
			'ACCEPTED'
		].includes(String(value.action)) ||
		!version(value.entityVersion) ||
		!isIsoDate(value.createdAt)
	)
		return null
	return value as unknown as IntakeActivity
}

export const parseIntakePage = <T extends { id: string }>(
	value: unknown,
	page: number,
	pageSize: number,
	parse: (item: unknown) => T | null
): IntakePage<T> | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'items',
			'page',
			'pageSize',
			'total'
		]) ||
		value.schemaVersion !== 1 ||
		value.page !== page ||
		value.pageSize !== pageSize ||
		!Number.isSafeInteger(value.total) ||
		Number(value.total) < 0 ||
		!Array.isArray(value.items) ||
		value.items.length > pageSize ||
		value.items.length > Number(value.total)
	)
		return null
	const items = value.items.map(parse)
	if (
		items.some(item => !item) ||
		new Set(items.map(item => item?.id)).size !== items.length
	)
		return null
	return {
		schemaVersion: 1,
		items: items as T[],
		page,
		pageSize,
		total: Number(value.total)
	}
}

export const parseIntakeResult = <T extends { id: string }>(
	value: unknown,
	key: 'entry' | 'source',
	parse: (item: unknown) => T | null,
	id?: string
): T | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', key]) ||
		value.schemaVersion !== 1
	)
		return null
	const result = parse(value[key])
	return result && (!id || result.id === id) ? result : null
}
