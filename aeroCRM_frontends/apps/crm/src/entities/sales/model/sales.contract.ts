import {
	hasExactKeys,
	isIsoDate,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'

export type DealStatus = 'OPEN' | 'WON' | 'LOST'
export interface SalesDealFilters {
	stageId?: string
	assignedToSubject?: string
	overdue?: boolean
	overdueBefore?: string
	createdFrom?: string
	createdTo?: string
	sort?:
		| 'created_desc'
		| 'updated_desc'
		| 'amount_desc'
		| 'next_action_asc'
}
export interface SalesTask {
	id: string
	workspaceId: string
	dealId: string
	version: number
	title: string
	dueAt: string
	status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
	assignedToSubject: string
	completedAt: string | null
	createdAt: string
	updatedAt: string
}
export interface SalesDeal {
	id: string
	workspaceId: string
	version: number
	title: string
	currency: 'RUB'
	amountMinor: number
	pipelineId: string
	stageId: string
	status: DealStatus
	contactId: string
	contactName: string
	assignedToSubject: string
	teamId: string | null
	archivedAt: string | null
	createdAt: string
	updatedAt: string
	nextTask: SalesTask | null
}
export interface SalesStage {
	id: string
	key: string
	name: string
	position: number
	state: DealStatus
}
export interface SalesPipeline {
	id: string
	workspaceId: string
	name: string
	templateKey: string
	templateVersion: number
	stages: SalesStage[]
}
export interface SalesTimelineEntry {
	id: string
	dealId: string
	kind: 'CREATED' | 'TRANSITIONED' | 'TASK_COMPLETED' | 'ARCHIVED'
	actorSubject: string
	outcome: string
	fromStageId: string | null
	toStageId: string | null
	createdAt: string
}
export interface SalesPage<T> {
	schemaVersion: 1
	page: number
	pageSize: number
	total: number
	items: T[]
}
const version = (value: unknown) =>
	Number.isSafeInteger(value) &&
	Number(value) > 0 &&
	Number(value) <= 2147483647
const nullableUuid = (value: unknown) => value === null || isUuidV4(value)
const nullableDate = (value: unknown) => value === null || isIsoDate(value)

export const parseSalesTask = (
	value: unknown,
	workspaceId: string
): SalesTask | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'id',
			'workspaceId',
			'dealId',
			'version',
			'title',
			'dueAt',
			'status',
			'assignedToSubject',
			'completedAt',
			'createdAt',
			'updatedAt'
		]) ||
		!isUuidV4(value.id) ||
		value.workspaceId !== workspaceId ||
		!isUuidV4(value.workspaceId) ||
		!isUuidV4(value.dealId) ||
		!version(value.version) ||
		!isNonEmptyString(value.title, 200) ||
		!isIsoDate(value.dueAt) ||
		!['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(
			String(value.status)
		) ||
		!isNonEmptyString(value.assignedToSubject, 256) ||
		!nullableDate(value.completedAt) ||
		!isIsoDate(value.createdAt) ||
		!isIsoDate(value.updatedAt) ||
		(value.status === 'OPEN' || value.status === 'IN_PROGRESS') !==
			(value.completedAt === null)
	)
		return null
	return value as unknown as SalesTask
}
export const parseSalesDeal = (
	value: unknown,
	workspaceId: string
): SalesDeal | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
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
			'archivedAt',
			'createdAt',
			'updatedAt',
			'nextTask'
		]) ||
		!isUuidV4(value.id) ||
		!isUuidV4(value.workspaceId) ||
		value.workspaceId !== workspaceId ||
		!version(value.version) ||
		!isNonEmptyString(value.title, 200) ||
		value.currency !== 'RUB' ||
		!Number.isSafeInteger(value.amountMinor) ||
		Number(value.amountMinor) < 0 ||
		Number(value.amountMinor) > 2147483647 ||
		!isUuidV4(value.pipelineId) ||
		!isUuidV4(value.stageId) ||
		!['OPEN', 'WON', 'LOST'].includes(String(value.status)) ||
		!isUuidV4(value.contactId) ||
		!isNonEmptyString(value.contactName, 200) ||
		!isNonEmptyString(value.assignedToSubject, 256) ||
		!nullableUuid(value.teamId) ||
		!nullableDate(value.archivedAt) ||
		!isIsoDate(value.createdAt) ||
		!isIsoDate(value.updatedAt)
	)
		return null
	const nextTask =
		value.nextTask === null
			? null
			: parseSalesTask(value.nextTask, workspaceId)
	if (
		value.nextTask !== null &&
		(!nextTask ||
			nextTask.dealId !== value.id ||
			(nextTask.status !== 'OPEN' && nextTask.status !== 'IN_PROGRESS'))
	)
		return null
	if (
		(value.status !== 'OPEN' || value.archivedAt !== null) &&
		nextTask !== null
	)
		return null
	return { ...value, nextTask } as unknown as SalesDeal
}
export const parseSalesDealResult = (
	value: unknown,
	workspaceId: string,
	id?: string
) => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'deal']) ||
		value.schemaVersion !== 1
	)
		return null
	const deal = parseSalesDeal(value.deal, workspaceId)
	return deal && (!id || deal.id === id) ? deal : null
}
export const parseSalesPage = <T extends { id: string }>(
	value: unknown,
	page: number,
	pageSize: number,
	parser: (row: unknown) => T | null
): SalesPage<T> | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'page',
			'pageSize',
			'total',
			'items'
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
	const items = value.items.map(parser)
	if (
		items.some(item => !item) ||
		new Set(items.map(item => item?.id)).size !== items.length
	)
		return null
	return {
		schemaVersion: 1,
		page,
		pageSize,
		total: Number(value.total),
		items: items as T[]
	}
}
export const parsePipelines = (
	value: unknown,
	workspaceId: string
): SalesPipeline[] | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'items']) ||
		value.schemaVersion !== 1 ||
		!Array.isArray(value.items) ||
		value.items.length > 1000
	)
		return null
	for (const row of value.items) {
		if (
			!isRecord(row) ||
			!hasExactKeys(row, [
				'id',
				'workspaceId',
				'name',
				'templateKey',
				'templateVersion',
				'stages'
			]) ||
			!isUuidV4(row.id) ||
			row.workspaceId !== workspaceId ||
			!isNonEmptyString(row.name, 200) ||
			!isNonEmptyString(row.templateKey, 64) ||
			!version(row.templateVersion) ||
			!Array.isArray(row.stages) ||
			row.stages.length > 100 ||
			!row.stages.length
		)
			return null
		for (const stage of row.stages)
			if (
				!isRecord(stage) ||
				!hasExactKeys(stage, ['id', 'key', 'name', 'position', 'state']) ||
				!isUuidV4(stage.id) ||
				!isNonEmptyString(stage.key, 64) ||
				!isNonEmptyString(stage.name, 200) ||
				!version(stage.position) ||
				!['OPEN', 'WON', 'LOST'].includes(String(stage.state))
			)
				return null
		if (
			new Set(row.stages.map(stage => stage.id)).size !==
				row.stages.length ||
			new Set(row.stages.map(stage => stage.position)).size !==
				row.stages.length
		)
			return null
	}
	return new Set(value.items.map(row => row.id)).size ===
		value.items.length
		? (value.items as SalesPipeline[])
		: null
}
export const parseTimelineEntry = (
	value: unknown,
	dealId: string
): SalesTimelineEntry | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'id',
			'dealId',
			'kind',
			'actorSubject',
			'outcome',
			'fromStageId',
			'toStageId',
			'createdAt'
		]) ||
		!isUuidV4(value.id) ||
		value.dealId !== dealId ||
		!['CREATED', 'TRANSITIONED', 'TASK_COMPLETED', 'ARCHIVED'].includes(
			String(value.kind)
		) ||
		!isNonEmptyString(value.actorSubject, 256) ||
		typeof value.outcome !== 'string' ||
		value.outcome.length > 4000 ||
		!nullableUuid(value.fromStageId) ||
		!nullableUuid(value.toStageId) ||
		!isIsoDate(value.createdAt)
	)
		return null
	return value as unknown as SalesTimelineEntry
}
