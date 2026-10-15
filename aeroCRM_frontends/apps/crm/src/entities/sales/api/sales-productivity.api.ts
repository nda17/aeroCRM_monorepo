import {
	authenticatedRequest,
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import {
	hasExactKeys,
	isIsoDate,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'
import {
	parseSalesPageV2,
	parseTimelineEntryV2
} from '../model/sales.contract'
import type {
	SalesTimelineEntryV3,
	SalesAssignmentDetails
} from './sales-workflows.api'

export interface LossReason {
	id: string
	title: string
	archived: boolean
}
export interface LossReasons {
	schemaVersion: 1
	workspaceId: string
	version: number
	reasons: LossReason[]
}
export interface SaveLossReasons extends Omit<LossReasons, 'version'> {
	commandId: string
	actorMembershipId: string | null
	expectedVersion: number
}
export interface DealLoss {
	schemaVersion: 1
	workspaceId: string
	dealId: string
	dealVersion: number
	status: 'OPEN' | 'WON' | 'LOST'
	lostAt: string | null
	reason: { id: string; title: string } | null
}
export interface LossReportQuery {
	pipelineId?: string
	lostFrom?: string
	lostTo?: string
}
export interface LossReport {
	schemaVersion: 1
	workspaceId: string
	currency: 'RUB'
	population: 'CURRENT_LOST'
	period: { basis: 'LOST_AT'; from: string | null; to: string | null }
	totals: { count: number; amountMinor: number }
	reasons: {
		reasonId: string | null
		title: string
		count: number
		amountMinor: number
	}[]
	unknownDate: { count: number; amountMinor: number }
}
export interface AssignmentSelection {
	schemaVersion: 1
	workspaceId: string
	actorMembershipId: string | null
	assignee: { subject: string; membershipId: string }
	deals: { id: string; expectedVersion: number }[]
}
export interface AssignmentPreview {
	schemaVersion: 1
	workspaceId: string
	actorSubject: string
	actorMembershipId: string | null
	assignee: AssignmentSelection['assignee']
	previewHash: string
	deals: (AssignmentSelection['deals'][number] & {
		title: string
		fromSubject: string
		transferredTaskCount: number
		retainedTaskCount: number
	})[]
	transferredTaskCount: number
	retainedTaskCount: number
}
export interface ApplyAssignment extends AssignmentSelection {
	commandId: string
	previewHash: string
}
export interface AssignmentResult {
	schemaVersion: 1
	workspaceId: string
	commandId: string
	assignee: AssignmentSelection['assignee']
	deals: { id: string; version: number; transferredTaskCount: number }[]
	transferredTaskCount: number
}

const integer = (
	value: unknown,
	minimum = 0,
	maximum = Number.MAX_SAFE_INTEGER
) =>
	Number.isSafeInteger(value) &&
	Number(value) >= minimum &&
	Number(value) <= maximum
const title = (value: unknown) =>
	typeof value === 'string' &&
	value.trim().length > 0 &&
	value.length <= 200 &&
	!/[\x00-\x1f\x7f]/.test(value)
const subject = (value: unknown) =>
	typeof value === 'string' && /^[^\s\x00-\x1f\x7f]{1,256}$/.test(value)
const membership = (value: unknown) => value === null || isUuidV4(value)
const exact = (
	value: unknown,
	keys: string[]
): value is Record<string, unknown> =>
	isRecord(value) && hasExactKeys(value, keys)
const validReasons = (value: unknown): value is LossReason[] =>
	Array.isArray(value) &&
	value.length <= 50 &&
	value.every(
		row =>
			exact(row, ['id', 'title', 'archived']) &&
			isUuidV4(row.id) &&
			title(row.title) &&
			typeof row.archived === 'boolean'
	) &&
	new Set(value.map(row => row.id.toLowerCase())).size === value.length
export const parseLossReasons = (
	value: unknown,
	workspaceId: string
): LossReasons | null =>
	isUuidV4(workspaceId) &&
	exact(value, ['schemaVersion', 'workspaceId', 'version', 'reasons']) &&
	value.schemaVersion === 1 &&
	value.workspaceId === workspaceId &&
	integer(value.version, 0, 2147483647) &&
	validReasons(value.reasons)
		? (value as unknown as LossReasons)
		: null
export const validSaveLossReasons = (
	value: unknown
): value is SaveLossReasons =>
	exact(value, [
		'schemaVersion',
		'workspaceId',
		'commandId',
		'actorMembershipId',
		'expectedVersion',
		'reasons'
	]) &&
	value.schemaVersion === 1 &&
	isUuidV4(value.workspaceId) &&
	isUuidV4(value.commandId) &&
	membership(value.actorMembershipId) &&
	integer(value.expectedVersion, 0, 2147483646) &&
	validReasons(value.reasons)
const lossReason = (value: unknown) =>
	value === null ||
	(exact(value, ['id', 'title']) &&
		isUuidV4(value.id) &&
		title(value.title))
export const parseDealLoss = (
	value: unknown,
	workspaceId: string,
	dealId: string
): DealLoss | null => {
	if (
		!exact(value, [
			'schemaVersion',
			'workspaceId',
			'dealId',
			'dealVersion',
			'status',
			'lostAt',
			'reason'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		value.dealId !== dealId ||
		!isUuidV4(workspaceId) ||
		!isUuidV4(dealId) ||
		!integer(value.dealVersion, 1, 2147483647) ||
		!['OPEN', 'WON', 'LOST'].includes(String(value.status)) ||
		!(value.lostAt === null || isIsoDate(value.lostAt)) ||
		!lossReason(value.reason) ||
		(value.status !== 'LOST' &&
			(value.lostAt !== null || value.reason !== null))
	)
		return null
	return value as unknown as DealLoss
}
const totals = (value: unknown) =>
	exact(value, ['count', 'amountMinor']) &&
	integer(value.count) &&
	integer(value.amountMinor) &&
	(value.count !== 0 || value.amountMinor === 0)
export const validLossReportQuery = (query: LossReportQuery) =>
	(query.pipelineId === undefined || isUuidV4(query.pipelineId)) &&
	((query.lostFrom === undefined && query.lostTo === undefined) ||
		(isIsoDate(query.lostFrom) &&
			isIsoDate(query.lostTo) &&
			Date.parse(query.lostTo) > Date.parse(query.lostFrom) &&
			Date.parse(query.lostTo) - Date.parse(query.lostFrom) <=
				366 * 86400000))
export const parseLossReport = (
	value: unknown,
	workspaceId: string,
	query: LossReportQuery
): LossReport | null => {
	if (
		!validLossReportQuery(query) ||
		!exact(value, [
			'schemaVersion',
			'workspaceId',
			'currency',
			'population',
			'period',
			'totals',
			'reasons',
			'unknownDate'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		value.currency !== 'RUB' ||
		value.population !== 'CURRENT_LOST' ||
		!exact(value.period, ['basis', 'from', 'to']) ||
		value.period.basis !== 'LOST_AT' ||
		value.period.from !== (query.lostFrom ?? null) ||
		value.period.to !== (query.lostTo ?? null) ||
		!totals(value.totals) ||
		!totals(value.unknownDate) ||
		!Array.isArray(value.reasons) ||
		value.reasons.length > 51
	)
		return null
	const seen = new Set<string | null>()
	let count = 0,
		amount = 0
	for (const row of value.reasons) {
		if (
			!exact(row, ['reasonId', 'title', 'count', 'amountMinor']) ||
			!(row.reasonId === null || isUuidV4(row.reasonId)) ||
			!title(row.title) ||
			!integer(row.count, 1) ||
			!integer(row.amountMinor) ||
			seen.has(row.reasonId as string | null)
		)
			return null
		seen.add(row.reasonId as string | null)
		count += Number(row.count)
		amount += Number(row.amountMinor)
	}
	return isRecord(value.totals) &&
		integer(count) &&
		integer(amount) &&
		value.totals.count === count &&
		value.totals.amountMinor === amount
		? (value as unknown as LossReport)
		: null
}
const validBinding = (value: unknown) =>
	exact(value, ['subject', 'membershipId']) &&
	subject(value.subject) &&
	isUuidV4(value.membershipId)
export const validAssignmentSelection = (value: AssignmentSelection) =>
	value.schemaVersion === 1 &&
	isUuidV4(value.workspaceId) &&
	membership(value.actorMembershipId) &&
	validBinding(value.assignee) &&
	Array.isArray(value.deals) &&
	value.deals.length >= 1 &&
	value.deals.length <= 25 &&
	value.deals.every(
		row =>
			exact(row, ['id', 'expectedVersion']) &&
			isUuidV4(row.id) &&
			integer(row.expectedVersion, 1, 2147483646)
	) &&
	new Set(value.deals.map(row => row.id.toLowerCase())).size ===
		value.deals.length
const sameBinding = (
	value: unknown,
	expected: AssignmentSelection['assignee']
) =>
	validBinding(value) &&
	isRecord(value) &&
	value.subject === expected.subject &&
	value.membershipId === expected.membershipId
export const parseAssignmentPreview = (
	value: unknown,
	selection: AssignmentSelection,
	actorSubject: string
): AssignmentPreview | null => {
	if (
		!validAssignmentSelection(selection) ||
		!exact(value, [
			'schemaVersion',
			'workspaceId',
			'actorSubject',
			'actorMembershipId',
			'assignee',
			'previewHash',
			'deals',
			'transferredTaskCount',
			'retainedTaskCount'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== selection.workspaceId ||
		value.actorSubject !== actorSubject ||
		value.actorMembershipId !== selection.actorMembershipId ||
		!sameBinding(value.assignee, selection.assignee) ||
		typeof value.previewHash !== 'string' ||
		!/^[a-f0-9]{64}$/.test(value.previewHash) ||
		!Array.isArray(value.deals) ||
		value.deals.length !== selection.deals.length ||
		!integer(value.transferredTaskCount, 0, 500) ||
		!integer(value.retainedTaskCount, 0, 500)
	)
		return null
	const seen = new Set<string>()
	let moved = 0,
		retained = 0
	for (const row of value.deals) {
		if (
			!exact(row, [
				'id',
				'expectedVersion',
				'title',
				'fromSubject',
				'transferredTaskCount',
				'retainedTaskCount'
			]) ||
			!isUuidV4(row.id) ||
			seen.has(row.id) ||
			!selection.deals.some(
				deal =>
					deal.id === row.id &&
					deal.expectedVersion === row.expectedVersion
			) ||
			!title(row.title) ||
			!subject(row.fromSubject) ||
			!integer(row.transferredTaskCount, 0, 500) ||
			!integer(row.retainedTaskCount, 0, 500)
		)
			return null
		seen.add(row.id)
		moved += Number(row.transferredTaskCount)
		retained += Number(row.retainedTaskCount)
	}
	return moved === value.transferredTaskCount &&
		retained === value.retainedTaskCount &&
		moved + retained <= 500
		? (value as unknown as AssignmentPreview)
		: null
}
export const parseAssignmentResult = (
	value: unknown,
	command: ApplyAssignment
): AssignmentResult | null => {
	if (
		!validAssignmentSelection(command) ||
		!exact(value, [
			'schemaVersion',
			'workspaceId',
			'commandId',
			'assignee',
			'deals',
			'transferredTaskCount'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== command.workspaceId ||
		value.commandId !== command.commandId ||
		!sameBinding(value.assignee, command.assignee) ||
		!Array.isArray(value.deals) ||
		value.deals.length !== command.deals.length ||
		!integer(value.transferredTaskCount, 0, 500)
	)
		return null
	const seen = new Set<string>()
	let moved = 0
	for (const row of value.deals) {
		if (
			!exact(row, ['id', 'version', 'transferredTaskCount']) ||
			!isUuidV4(row.id) ||
			seen.has(row.id) ||
			!command.deals.some(
				deal =>
					deal.id === row.id && deal.expectedVersion + 1 === row.version
			) ||
			!integer(row.transferredTaskCount, 0, 500)
		)
			return null
		seen.add(row.id)
		moved += Number(row.transferredTaskCount)
	}
	return moved === value.transferredTaskCount
		? (value as unknown as AssignmentResult)
		: null
}

export const getLossReasons = async (
	accessToken: string,
	workspaceId: string
) => {
	const result = parseLossReasons(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: '/crm/sales/loss-reasons',
			params: { workspaceId }
		}),
		workspaceId
	)
	if (!result) throw invalidContractError()
	return result
}
export const saveLossReasons = async (
	accessToken: string,
	command: SaveLossReasons
) => {
	if (!validSaveLossReasons(command))
		throw new AuthenticatedApiError(
			'validation',
			'Проверьте названия причин отказа.'
		)
	const result = parseLossReasons(
		await authenticatedRequest({
			accessToken,
			method: 'POST',
			url: '/crm/sales/loss-reasons',
			headers: { 'Idempotency-Key': command.commandId },
			data: command
		}),
		command.workspaceId
	)
	if (
		!result ||
		result.version !== command.expectedVersion + 1 ||
		result.reasons.length !== command.reasons.length ||
		result.reasons.some(
			(row, index) =>
				row.id.toLowerCase() !== command.reasons[index].id.toLowerCase() ||
				row.title !== command.reasons[index].title.trim() ||
				row.archived !== command.reasons[index].archived
		)
	)
		throw invalidContractError()
	return result
}
export const getDealLoss = async (
	accessToken: string,
	workspaceId: string,
	dealId: string,
	archive: 'ACTIVE' | 'ARCHIVED'
) => {
	const result = parseDealLoss(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: `/crm/sales/deals/${dealId}/loss`,
			params: { workspaceId, archive }
		}),
		workspaceId,
		dealId
	)
	if (!result) throw invalidContractError()
	return result
}
export const getLossReport = async (
	accessToken: string,
	workspaceId: string,
	query: LossReportQuery
) => {
	if (!validLossReportQuery(query)) throw invalidContractError()
	const result = parseLossReport(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: '/crm/sales/loss-report',
			params: { workspaceId, ...query }
		}),
		workspaceId,
		query
	)
	if (!result) throw invalidContractError()
	return result
}
export const previewAssignment = async (
	accessToken: string,
	selection: AssignmentSelection,
	actorSubject: string
) => {
	if (!validAssignmentSelection(selection))
		throw new AuthenticatedApiError(
			'validation',
			'Выберите от 1 до 25 сделок и нового ответственного.'
		)
	const result = parseAssignmentPreview(
		await authenticatedRequest({
			accessToken,
			method: 'POST',
			url: '/crm/sales/bulk-assignment/preview',
			data: selection
		}),
		selection,
		actorSubject
	)
	if (!result) throw invalidContractError()
	return result
}
export const applyAssignment = async (
	accessToken: string,
	command: ApplyAssignment
) => {
	if (
		!validAssignmentSelection(command) ||
		!isUuidV4(command.commandId) ||
		!/^[a-f0-9]{64}$/.test(command.previewHash)
	)
		throw invalidContractError()
	const result = parseAssignmentResult(
		await authenticatedRequest({
			accessToken,
			method: 'POST',
			url: '/crm/sales/bulk-assignment/apply',
			headers: { 'Idempotency-Key': command.commandId },
			data: command
		}),
		command
	)
	if (!result) throw invalidContractError()
	return result
}

export type SalesTimelineEntryV4 = Omit<
	SalesTimelineEntryV3,
	'details'
> & {
	details:
		| SalesAssignmentDetails
		| { loss: { lostAt: string | null; reason: DealLoss['reason'] } }
		| null
}
export const listSalesTimelineV4 = async (
	accessToken: string,
	workspaceId: string,
	dealId: string,
	page: number,
	archive: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE'
) => {
	const value: unknown = await authenticatedRequest({
		accessToken,
		method: 'GET',
		url: `/crm/sales/deals/${dealId}/timeline-v4`,
		params: { workspaceId, archive, page: String(page), pageSize: '10' }
	})
	if (!isRecord(value) || value.schemaVersion !== 4)
		throw invalidContractError()
	const result = parseSalesPageV2(
		{ ...value, schemaVersion: 2 },
		page,
		10,
		(row): SalesTimelineEntryV4 | null => {
			if (
				!exact(row, [
					'id',
					'dealId',
					'kind',
					'actorSubject',
					'outcome',
					'fromStageId',
					'toStageId',
					'createdAt',
					'details'
				])
			)
				return null
			const { details, ...legacy } = row
			const entry = parseTimelineEntryV2(
				row.kind === 'ASSIGNEE_CHANGED'
					? { ...legacy, kind: 'TRANSITIONED' }
					: legacy,
				dealId
			)
			if (!entry) return null
			if (row.kind === 'ASSIGNEE_CHANGED') {
				if (
					!exact(details, [
						'beforeSubject',
						'afterSubject',
						'afterMembershipId',
						'transferredTaskCount'
					]) ||
					!subject(details.beforeSubject) ||
					!subject(details.afterSubject) ||
					!isUuidV4(details.afterMembershipId) ||
					!integer(details.transferredTaskCount)
				)
					return null
				return {
					...entry,
					kind: 'ASSIGNEE_CHANGED',
					details: details as unknown as SalesAssignmentDetails
				}
			}
			if (details === null) return { ...entry, details: null }
			if (
				row.kind !== 'TRANSITIONED' ||
				!exact(details, ['loss']) ||
				!exact(details.loss, ['lostAt', 'reason']) ||
				!(
					details.loss.lostAt === null || isIsoDate(details.loss.lostAt)
				) ||
				!lossReason(details.loss.reason)
			)
				return null
			return {
				...entry,
				details: details as unknown as {
					loss: { lostAt: string | null; reason: DealLoss['reason'] }
				}
			}
		}
	)
	if (!result) throw invalidContractError()
	return { ...result, schemaVersion: 4 as const }
}
