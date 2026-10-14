import {
	hasExactKeys,
	isIsoDate,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'
import type { SalesDeal } from './sales.contract'

const DAY_MS = 86_400_000
const validVersion = (value: unknown) =>
	Number.isSafeInteger(value) &&
	Number(value) > 0 &&
	Number(value) <= 2_147_483_646
const validLimit = (value: unknown) =>
	Number.isSafeInteger(value) &&
	Number(value) >= 1 &&
	Number(value) <= 3650

export interface StageDurationInfo {
	dealId: string
	stageId: string
	dealVersion: number
	enteredAt: string | null
	limitDays: number | null
	deadlineAt: string | null
	elapsedDays: number | null
	overdue: boolean
}

export interface StageDurationSettings {
	schemaVersion: 1
	workspaceId: string
	pipelineId: string
	pipelineVersion: number
	items: Array<{ stageId: string; limitDays: number | null }>
}

export interface SalesStageDurationPage {
	asOf: string
	overdueCount: number
	items: StageDurationInfo[]
}

export interface SalesStageDurationDetail {
	asOf: string
	item: StageDurationInfo
}

export const parseStageDurationSettings = (
	value: unknown,
	workspaceId: string,
	pipelineId: string
): StageDurationSettings | null => {
	if (
		!isUuidV4(workspaceId) ||
		!isUuidV4(pipelineId) ||
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'pipelineId',
			'pipelineVersion',
			'items'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		value.pipelineId !== pipelineId ||
		!validVersion(value.pipelineVersion) ||
		!Array.isArray(value.items)
	)
		return null

	const stageIds = new Set<string>()
	const items: StageDurationSettings['items'] = []
	for (const item of value.items) {
		if (
			!isRecord(item) ||
			!hasExactKeys(item, ['stageId', 'limitDays']) ||
			!isUuidV4(item.stageId) ||
			stageIds.has(item.stageId) ||
			(item.limitDays !== null && !validLimit(item.limitDays))
		)
			return null
		stageIds.add(item.stageId)
		items.push({
			stageId: item.stageId,
			limitDays: item.limitDays as number | null
		})
	}
	return {
		schemaVersion: 1,
		workspaceId,
		pipelineId,
		pipelineVersion: value.pipelineVersion as number,
		items
	}
}

const parseStageDurationInfo = (
	value: unknown,
	deal: SalesDeal,
	asOf: string
): StageDurationInfo | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'dealId',
			'stageId',
			'dealVersion',
			'enteredAt',
			'limitDays',
			'deadlineAt',
			'elapsedDays',
			'overdue'
		]) ||
		value.dealId !== deal.id ||
		value.stageId !== deal.stageId ||
		value.dealVersion !== deal.version ||
		(value.enteredAt !== null && !isIsoDate(value.enteredAt)) ||
		(value.limitDays !== null && !validLimit(value.limitDays)) ||
		(value.deadlineAt !== null && !isIsoDate(value.deadlineAt)) ||
		(value.elapsedDays !== null &&
			(!Number.isSafeInteger(value.elapsedDays) ||
				Number(value.elapsedDays) < 0)) ||
		typeof value.overdue !== 'boolean'
	)
		return null

	const active = deal.status === 'OPEN' && deal.archivedAt === null
	const enteredAt = value.enteredAt as string | null
	const limitDays = active ? (value.limitDays as number | null) : null
	const elapsedDays =
		active && enteredAt !== null
			? Math.floor(
					Math.max(0, Date.parse(asOf) - Date.parse(enteredAt)) / DAY_MS
				)
			: null
	const deadlineAt =
		active && enteredAt !== null && limitDays !== null
			? new Date(Date.parse(enteredAt) + limitDays * DAY_MS).toISOString()
			: null
	const overdue =
		deadlineAt !== null && Date.parse(asOf) > Date.parse(deadlineAt)

	if (
		value.limitDays !== limitDays ||
		value.elapsedDays !== elapsedDays ||
		value.deadlineAt !== deadlineAt ||
		value.overdue !== overdue
	)
		return null

	return {
		dealId: deal.id,
		stageId: deal.stageId,
		dealVersion: deal.version,
		enteredAt,
		limitDays,
		deadlineAt,
		elapsedDays,
		overdue
	}
}

export const parseSalesStageDurationPage = (
	value: unknown,
	deals: SalesDeal[],
	stageOverdue?: boolean
): SalesStageDurationPage | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['asOf', 'overdueCount', 'items']) ||
		!isIsoDate(value.asOf) ||
		!Number.isSafeInteger(value.overdueCount) ||
		Number(value.overdueCount) < 0 ||
		!Array.isArray(value.items) ||
		value.items.length !== deals.length
	)
		return null

	const items: StageDurationInfo[] = []
	for (let index = 0; index < deals.length; index += 1) {
		const item = parseStageDurationInfo(
			value.items[index],
			deals[index],
			value.asOf
		)
		if (!item || (stageOverdue === true && !item.overdue)) return null
		items.push(item)
	}
	const visibleOverdueCount = items.filter(item => item.overdue).length
	if (Number(value.overdueCount) < visibleOverdueCount) return null

	return {
		asOf: value.asOf,
		overdueCount: value.overdueCount as number,
		items
	}
}

export const parseSalesStageDurationDetail = (
	value: unknown,
	deal: SalesDeal
): SalesStageDurationDetail | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['asOf', 'item']) ||
		!isIsoDate(value.asOf)
	)
		return null
	const item = parseStageDurationInfo(value.item, deal, value.asOf)
	return item ? { asOf: value.asOf, item } : null
}
