import {
	hasExactKeys,
	isIsoDate,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'

export const acceptanceStatuses = [
	'QUEUED',
	'RUNNING',
	'RETRY_WAIT',
	'BLOCKED',
	'FAILED',
	'RECOVERING',
	'CANCELLED',
	'COMPLETED'
] as const
export type AcceptanceStatus = (typeof acceptanceStatuses)[number]
export interface InboxAcceptance {
	id: string
	workspaceId: string
	entryId: string
	actorSubject: string
	status: AcceptanceStatus
	version: number
	mode: 'EXECUTE' | 'RECOVER'
	contactId: string | null
	dealId: string | null
	firstTaskId: string | null
	lastErrorCode:
		| 'WORKFLOW_ACCESS_BLOCKED'
		| 'WORKFLOW_REFERENCE_CONFLICT'
		| 'WORKFLOW_DEPENDENCY_UNAVAILABLE'
		| null
	retryAt: string | null
	completedAt: string | null
	createdAt: string
	updatedAt: string
}
export interface AcceptanceResponse {
	schemaVersion: 1
	acceptance: InboxAcceptance | null
}
export const isAcceptanceTerminal = (status: AcceptanceStatus) =>
	status === 'COMPLETED' || status === 'CANCELLED'
export const parseAcceptanceResponse = (
	value: unknown,
	workspaceId: string,
	entryId: string
): AcceptanceResponse | null => {
	if (
		!isUuidV4(workspaceId) ||
		!isUuidV4(entryId) ||
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'acceptance']) ||
		value.schemaVersion !== 1
	)
		return null
	if (value.acceptance === null)
		return { schemaVersion: 1, acceptance: null }
	const row = value.acceptance
	if (
		!isRecord(row) ||
		!hasExactKeys(row, [
			'id',
			'workspaceId',
			'entryId',
			'actorSubject',
			'status',
			'version',
			'mode',
			'contactId',
			'dealId',
			'firstTaskId',
			'lastErrorCode',
			'retryAt',
			'completedAt',
			'createdAt',
			'updatedAt'
		]) ||
		!isUuidV4(row.id) ||
		row.workspaceId !== workspaceId ||
		row.entryId !== entryId ||
		!isNonEmptyString(row.actorSubject, 256) ||
		!acceptanceStatuses.includes(row.status as AcceptanceStatus) ||
		!Number.isSafeInteger(row.version) ||
		Number(row.version) < 1 ||
		Number(row.version) > 2147483647 ||
		!['EXECUTE', 'RECOVER'].includes(String(row.mode)) ||
		![row.contactId, row.dealId, row.firstTaskId].every(
			id => id === null || isUuidV4(id)
		) ||
		!(
			row.lastErrorCode === null ||
			[
				'WORKFLOW_ACCESS_BLOCKED',
				'WORKFLOW_REFERENCE_CONFLICT',
				'WORKFLOW_DEPENDENCY_UNAVAILABLE'
			].includes(String(row.lastErrorCode))
		) ||
		!(row.retryAt === null || isIsoDate(row.retryAt)) ||
		!isIsoDate(row.createdAt) ||
		!isIsoDate(row.updatedAt)
	)
		return null
	if (isAcceptanceTerminal(row.status as AcceptanceStatus)) {
		if (!isIsoDate(row.completedAt)) return null
	} else if (row.completedAt !== null) return null
	if (
		row.status === 'COMPLETED' &&
		![row.contactId, row.dealId, row.firstTaskId].every(isUuidV4)
	)
		return null
	if (
		(row.dealId === null) !== (row.firstTaskId === null) ||
		(row.dealId !== null && row.contactId === null)
	)
		return null
	return {
		schemaVersion: 1,
		acceptance: row as unknown as InboxAcceptance
	}
}

interface AcceptanceCommandBase {
	workspaceId: string
	entryId: string
	commandId: string
	expectedVersion: number
}
export type AcceptanceCommand = AcceptanceCommandBase &
	(
		| {
				operation: 'accept'
				contact:
					| { mode: 'CREATE_FROM_ENTRY'; name?: string }
					| { mode: 'EXISTING'; contactId: string }
				deal: {
					title: string
					currency: 'RUB'
					amountMinor: number
					pipelineId: string
					stageId: string
					nextTask: { title: string; dueAt: string }
				}
		  }
		| { operation: 'retry' | 'recover' }
	)
