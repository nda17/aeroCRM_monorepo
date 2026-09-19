import {
	hasExactKeys,
	isIsoDate,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'
import { isIanaTimeZone } from '@/shared/lib/time-zones'

export type SeriesFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY'
export type SeriesStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED'
export interface SeriesBinding {
	subject: string
	membershipId: string | null
}
export interface SeriesContent {
	title: string
	localTime: string
	timeZone: string
	assignee: SeriesBinding
}
export interface TaskSeries extends SeriesContent {
	id: string
	workspaceId: string
	version: number
	dealId: string | null
	teamId: string | null
	frequency: SeriesFrequency
	startDate: string
	status: SeriesStatus
	nextRunAt: string
	blockedReason:
		| null
		| 'READ_ONLY'
		| 'CREATOR_REVOKED'
		| 'ASSIGNEE_REVOKED'
		| 'SCOPE_CHANGED'
		| 'DEAL_CLOSED'
	createdAt: string
	updatedAt: string
}
export interface SeriesPageRequest {
	workspaceId: string
	page: number
	pageSize: number
	status: SeriesStatus | 'ALL'
	search?: string
}
export interface SeriesPage {
	schemaVersion: 1
	workspaceId: string
	page: number
	pageSize: number
	total: number
	items: TaskSeries[]
}
export type SeriesMutation =
	| {
			kind: 'create'
			content: SeriesContent
			frequency: SeriesFrequency
			startDate: string
			dealId: string | null
			teamId: string | null
	  }
	| {
			kind: 'edit'
			id: string
			expectedVersion: number
			content: SeriesContent
	  }
	| {
			kind: 'status'
			id: string
			expectedVersion: number
			status: SeriesStatus
	  }
export interface SeriesCommand {
	workspaceId: string
	subject: string
	sessionRevision: number
	actorMembershipId: string | null
	commandId: string
	mutation: SeriesMutation
}
const exact = (
	value: unknown,
	keys: string[]
): value is Record<string, unknown> =>
	isRecord(value) && hasExactKeys(value, keys)
const integer = (value: unknown, min: number, max: number) =>
	Number.isSafeInteger(value) &&
	Number(value) >= min &&
	Number(value) <= max
export const validSeriesDate = (value: unknown): value is string =>
	typeof value === 'string' &&
	/^20\d{2}-\d{2}-\d{2}$/.test(value) &&
	Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) &&
	new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
export const validSeriesBinding = (
	value: unknown
): value is SeriesBinding =>
	exact(value, ['subject', 'membershipId']) &&
	typeof value.subject === 'string' &&
	/^[^\s\x00-\x1f\x7f]{1,256}$/.test(value.subject) &&
	(value.membershipId === null || isUuidV4(value.membershipId))
export const validSeriesContent = (
	value: unknown
): value is SeriesContent =>
	exact(value, ['title', 'localTime', 'timeZone', 'assignee']) &&
	isNonEmptyString(value.title, 200) &&
	typeof value.localTime === 'string' &&
	/^([01]\d|2[0-3]):[0-5]\d$/.test(value.localTime) &&
	isIanaTimeZone(value.timeZone) &&
	validSeriesBinding(value.assignee)
export const validSeriesPageRequest = (request: SeriesPageRequest) =>
	isUuidV4(request.workspaceId) &&
	integer(request.page, 1, 1000000) &&
	integer(request.pageSize, 1, 100) &&
	['ACTIVE', 'PAUSED', 'CANCELLED', 'ALL'].includes(request.status) &&
	(request.search === undefined ||
		(typeof request.search === 'string' && request.search.length <= 200))
export const parseTaskSeries = (
	value: unknown,
	workspaceId: string
): TaskSeries | null => {
	if (
		!exact(value, [
			'id',
			'workspaceId',
			'version',
			'title',
			'dealId',
			'teamId',
			'assignee',
			'frequency',
			'startDate',
			'localTime',
			'timeZone',
			'status',
			'nextRunAt',
			'blockedReason',
			'createdAt',
			'updatedAt'
		]) ||
		!isUuidV4(value.id) ||
		value.workspaceId !== workspaceId ||
		!isUuidV4(workspaceId) ||
		!integer(value.version, 1, 2147483647) ||
		!(value.dealId === null || isUuidV4(value.dealId)) ||
		!(value.teamId === null || isUuidV4(value.teamId)) ||
		!validSeriesContent({
			title: value.title,
			localTime: value.localTime,
			timeZone: value.timeZone,
			assignee: value.assignee
		}) ||
		!['DAILY', 'WEEKLY', 'MONTHLY'].includes(String(value.frequency)) ||
		!validSeriesDate(value.startDate) ||
		!['ACTIVE', 'PAUSED', 'CANCELLED'].includes(String(value.status)) ||
		!isIsoDate(value.nextRunAt) ||
		!isIsoDate(value.createdAt) ||
		!isIsoDate(value.updatedAt) ||
		!(
			value.blockedReason === null ||
			[
				'READ_ONLY',
				'CREATOR_REVOKED',
				'ASSIGNEE_REVOKED',
				'SCOPE_CHANGED',
				'DEAL_CLOSED'
			].includes(String(value.blockedReason))
		)
	)
		return null
	return value as unknown as TaskSeries
}
export const parseSeriesPage = (
	value: unknown,
	request: SeriesPageRequest
): SeriesPage | null => {
	if (
		!validSeriesPageRequest(request) ||
		!exact(value, [
			'schemaVersion',
			'workspaceId',
			'page',
			'pageSize',
			'total',
			'items'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== request.workspaceId ||
		value.page !== request.page ||
		value.pageSize !== request.pageSize ||
		!integer(value.total, 0, Number.MAX_SAFE_INTEGER) ||
		!Array.isArray(value.items) ||
		value.items.length !==
			Math.min(
				request.pageSize,
				Math.max(
					0,
					Number(value.total) - (request.page - 1) * request.pageSize
				)
			)
	)
		return null
	const items = value.items.map(item =>
		parseTaskSeries(item, request.workspaceId)
	)
	if (
		items.some(
			item =>
				!item ||
				(request.status !== 'ALL' && item.status !== request.status)
		) ||
		new Set(items.map(item => item?.id)).size !== items.length
	)
		return null
	return value as unknown as SeriesPage
}
export const validSeriesCommand = (command: SeriesCommand) => {
	const m = command.mutation
	if (
		!isUuidV4(command.workspaceId) ||
		!isUuidV4(command.commandId) ||
		!integer(command.sessionRevision, 0, Number.MAX_SAFE_INTEGER) ||
		!validSeriesBinding({
			subject: command.subject,
			membershipId: command.actorMembershipId
		})
	)
		return false
	if (m.kind === 'create')
		return (
			validSeriesContent(m.content) &&
			['DAILY', 'WEEKLY', 'MONTHLY'].includes(m.frequency) &&
			validSeriesDate(m.startDate) &&
			(m.dealId === null || isUuidV4(m.dealId)) &&
			(m.teamId === null || isUuidV4(m.teamId))
		)
	return (
		isUuidV4(m.id) &&
		integer(m.expectedVersion, 1, 2147483646) &&
		(m.kind === 'edit'
			? validSeriesContent(m.content)
			: m.kind === 'status' &&
				['ACTIVE', 'PAUSED', 'CANCELLED'].includes(m.status))
	)
}
export const parseSeriesResult = (
	value: unknown,
	command: SeriesCommand
): TaskSeries | null => {
	if (
		!exact(value, ['schemaVersion', 'series']) ||
		value.schemaVersion !== 1
	)
		return null
	const row = parseTaskSeries(value.series, command.workspaceId),
		m = command.mutation
	if (
		!row ||
		row.version !== (m.kind === 'create' ? 1 : m.expectedVersion + 1) ||
		(m.kind !== 'create' && row.id !== m.id)
	)
		return null
	if (
		'content' in m &&
		(row.title !== m.content.title.trim() ||
			row.localTime !== m.content.localTime ||
			row.timeZone !== m.content.timeZone ||
			row.assignee.subject !== m.content.assignee.subject ||
			row.assignee.membershipId !== m.content.assignee.membershipId)
	)
		return null
	if (
		m.kind === 'create' &&
		(row.frequency !== m.frequency ||
			row.startDate !== m.startDate ||
			row.dealId !== m.dealId ||
			row.teamId !== m.teamId ||
			row.status !== 'ACTIVE')
	)
		return null
	if (m.kind === 'status' && row.status !== m.status) return null
	return row
}
