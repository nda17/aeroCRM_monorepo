import {
	hasExactKeys,
	isIsoDate,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'

export const salesExportDealColumns = [
	'id',
	'workspaceId',
	'version',
	'title',
	'currency',
	'amountMinor',
	'pipelineId',
	'stageId',
	'status',
	'contactId',
	'contactName',
	'assignedToSubject',
	'teamId',
	'nextTaskId',
	'archivedAt',
	'createdAt',
	'updatedAt',
	'pipelineName',
	'templateKey',
	'templateVersion',
	'stageKey',
	'stageName',
	'stagePosition'
] as const
const positive = (value: unknown) =>
	Number.isSafeInteger(value) &&
	Number(value) >= 1 &&
	Number(value) <= 2147483647
export const isSalesExportDeal = (
	value: unknown,
	workspaceId: string
): value is Record<string, unknown> => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, salesExportDealColumns) ||
		value.workspaceId !== workspaceId ||
		!isUuidV4(workspaceId)
	)
		return false
	if (
		!['id', 'pipelineId', 'stageId', 'contactId'].every(key =>
			isUuidV4(value[key])
		) ||
		!['teamId', 'nextTaskId'].every(
			key => value[key] === null || isUuidV4(value[key])
		) ||
		!['version', 'templateVersion', 'stagePosition'].every(key =>
			positive(value[key])
		) ||
		!['title', 'contactName', 'pipelineName', 'stageName'].every(key =>
			isNonEmptyString(value[key], 200)
		) ||
		!['templateKey', 'stageKey'].every(key =>
			isNonEmptyString(value[key], 100)
		) ||
		!isNonEmptyString(value.assignedToSubject, 256) ||
		value.currency !== 'RUB' ||
		!Number.isSafeInteger(value.amountMinor) ||
		Number(value.amountMinor) < 0 ||
		Number(value.amountMinor) > 2147483647 ||
		!['OPEN', 'WON', 'LOST'].includes(String(value.status)) ||
		!(value.archivedAt === null || isIsoDate(value.archivedAt)) ||
		!isIsoDate(value.createdAt) ||
		!isIsoDate(value.updatedAt)
	)
		return false
	return (
		(value.status === 'OPEN' && value.archivedAt === null) ||
		value.nextTaskId === null
	)
}
