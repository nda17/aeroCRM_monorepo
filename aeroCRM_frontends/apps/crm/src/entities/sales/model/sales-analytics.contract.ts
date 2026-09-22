import {
	hasExactKeys,
	isIsoDate,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'
import type { DealStatus } from './sales.contract'

export interface SalesAnalyticsItem {
	status: DealStatus
	count: number
	amountMinor: number
}

export interface SalesAnalytics {
	schemaVersion: 1
	currency: 'RUB'
	items: SalesAnalyticsItem[]
}

export const parseSalesAnalytics = (
	value: unknown
): SalesAnalytics | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'currency', 'items']) ||
		value.schemaVersion !== 1 ||
		value.currency !== 'RUB' ||
		!Array.isArray(value.items) ||
		value.items.length !== 3
	)
		return null
	const statuses = new Set<DealStatus>()
	let totalCount = 0
	let totalAmount = 0
	for (const item of value.items) {
		if (
			!isRecord(item) ||
			!hasExactKeys(item, ['status', 'count', 'amountMinor']) ||
			!['OPEN', 'WON', 'LOST'].includes(String(item.status)) ||
			statuses.has(item.status as DealStatus) ||
			!Number.isSafeInteger(item.count) ||
			Number(item.count) < 0 ||
			!Number.isSafeInteger(item.amountMinor) ||
			Number(item.amountMinor) < 0 ||
			(item.count === 0 && item.amountMinor !== 0)
		)
			return null
		statuses.add(item.status as DealStatus)
		totalCount += Number(item.count)
		totalAmount += Number(item.amountMinor)
	}
	if (
		!Number.isSafeInteger(totalCount) ||
		!Number.isSafeInteger(totalAmount)
	)
		return null
	return value as unknown as SalesAnalytics
}

export interface SalesAnalyticsPeriod {
	createdFrom: string
	createdTo: string
}
export interface SalesAnalyticsOverviewQuery {
	pipelineId?: string
	createdFrom?: string
	createdTo?: string
	assigneePage?: number
}
export interface SalesAttention {
	open: number
	overdue: number
	withoutNextAction: number
}
export interface SalesAnalyticsOverview extends SalesAnalytics {
	overview: {
		dateBasis: 'CREATED_AT'
		period: SalesAnalyticsPeriod | null
		previous: {
			period: SalesAnalyticsPeriod
			items: SalesAnalyticsItem[]
		} | null
		asOf: string
		attention: SalesAttention
		assignees: {
			page: number
			pageSize: 20
			hasMore: boolean
			items: (SalesAttention & {
				assignedToSubject: string
				items: SalesAnalyticsItem[]
			})[]
		} | null
	}
}
const validPeriod = (value: unknown): value is SalesAnalyticsPeriod => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['createdFrom', 'createdTo']) ||
		!isIsoDate(value.createdFrom) ||
		!isIsoDate(value.createdTo)
	)
		return false
	const duration =
		Date.parse(value.createdTo) - Date.parse(value.createdFrom)
	return (
		duration > 0 &&
		duration <= 366 * 86400000 &&
		Date.parse(value.createdFrom) - duration >= 0
	)
}
export const validAnalyticsOverviewQuery = (
	query: SalesAnalyticsOverviewQuery
) =>
	((query.createdFrom === undefined && query.createdTo === undefined) ||
		validPeriod({
			createdFrom: query.createdFrom,
			createdTo: query.createdTo
		})) &&
	(query.assigneePage === undefined ||
		(Number.isSafeInteger(query.assigneePage) &&
			query.assigneePage >= 1 &&
			query.assigneePage <= 1000000)) &&
	(query.pipelineId === undefined || isUuidV4(query.pipelineId))
const validAttention = (value: unknown): value is SalesAttention =>
	isRecord(value) &&
	['open', 'overdue', 'withoutNextAction'].every(
		key => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0
	) &&
	Number(value.overdue) + Number(value.withoutNextAction) <=
		Number(value.open)
const validItems = (items: unknown) =>
	parseSalesAnalytics({ schemaVersion: 1, currency: 'RUB', items }) !==
	null

export const parseSalesAnalyticsOverview = (
	value: unknown,
	query: SalesAnalyticsOverviewQuery
): SalesAnalyticsOverview | null => {
	if (
		!validAnalyticsOverviewQuery(query) ||
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'currency',
			'items',
			'overview'
		]) ||
		!parseSalesAnalytics({
			schemaVersion: value.schemaVersion,
			currency: value.currency,
			items: value.items
		}) ||
		!isRecord(value.overview)
	)
		return null
	const overview = value.overview
	if (
		!hasExactKeys(overview, [
			'dateBasis',
			'period',
			'previous',
			'asOf',
			'attention',
			'assignees'
		]) ||
		overview.dateBasis !== 'CREATED_AT' ||
		!isIsoDate(overview.asOf) ||
		!isRecord(overview.attention) ||
		!hasExactKeys(overview.attention, [
			'open',
			'overdue',
			'withoutNextAction'
		]) ||
		!validAttention(overview.attention)
	)
		return null
	if (query.createdFrom === undefined) {
		if (overview.period !== null || overview.previous !== null) return null
	} else {
		if (
			!validPeriod(overview.period) ||
			overview.period.createdFrom !== query.createdFrom ||
			overview.period.createdTo !== query.createdTo ||
			!isRecord(overview.previous) ||
			!hasExactKeys(overview.previous, ['period', 'items']) ||
			!validPeriod(overview.previous.period) ||
			!validItems(overview.previous.items) ||
			overview.previous.period.createdTo !== overview.period.createdFrom ||
			Date.parse(overview.period.createdTo) -
				Date.parse(overview.period.createdFrom) !==
				Date.parse(overview.previous.period.createdTo) -
					Date.parse(overview.previous.period.createdFrom)
		)
			return null
	}
	if (overview.assignees !== null) {
		const employees = overview.assignees
		if (
			!isRecord(employees) ||
			!hasExactKeys(employees, ['page', 'pageSize', 'hasMore', 'items']) ||
			employees.page !== (query.assigneePage || 1) ||
			employees.pageSize !== 20 ||
			typeof employees.hasMore !== 'boolean' ||
			!Array.isArray(employees.items) ||
			employees.items.length > 20 ||
			(employees.hasMore && employees.items.length !== 20)
		)
			return null
		const subjects = new Set<string>()
		for (const row of employees.items) {
			if (
				!isRecord(row) ||
				!hasExactKeys(row, [
					'assignedToSubject',
					'items',
					'open',
					'overdue',
					'withoutNextAction'
				]) ||
				!isNonEmptyString(row.assignedToSubject, 256) ||
				subjects.has(row.assignedToSubject) ||
				!validAttention(row) ||
				!validItems(row.items) ||
				row.open > overview.attention.open ||
				row.overdue > overview.attention.overdue ||
				row.withoutNextAction > overview.attention.withoutNextAction
			)
				return null
			subjects.add(row.assignedToSubject)
		}
	}
	return value as unknown as SalesAnalyticsOverview
}
