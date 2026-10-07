import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { hasExactKeys, isRecord, isUuidV4 } from '@/shared/lib/contract'
import {
	parseSalesDealResult,
	parseSalesPageV2,
	parseSalesPage,
	parseSalesTask,
	parseTimelineEntryV2,
	type SalesTimelineEntryV2
} from '../model/sales.contract'

export interface SalesCompanyContext {
	contactId: string
	company: null | { id: string; name: string; inn: string | null }
}
export interface SalesAssignmentDetails {
	beforeSubject: string
	afterSubject: string
	afterMembershipId: string
	transferredTaskCount: number
}
export type SalesTimelineEntryV3 = Omit<SalesTimelineEntryV2, 'kind'> & {
	kind: SalesTimelineEntryV2['kind'] | 'ASSIGNEE_CHANGED'
	details: SalesAssignmentDetails | null
}
export const getSalesDealContext = async (
	accessToken: string,
	workspaceId: string,
	id: string,
	archive: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE'
) => {
	const value: unknown = await authenticatedRequest({
		accessToken,
		method: 'GET',
		url: `/crm/sales/deals/${id}`,
		params: { workspaceId, archive, context: 'company' }
	})
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'deal', 'companyContext'])
	)
		throw invalidContractError()
	const deal = parseSalesDealResult(
		{ schemaVersion: value.schemaVersion, deal: value.deal },
		workspaceId,
		id
	)
	if (
		!deal ||
		(archive === 'ARCHIVED') !== (deal.archivedAt !== null) ||
		!Array.isArray(value.companyContext) ||
		value.companyContext.length !== 1
	)
		throw invalidContractError()
	const item = value.companyContext[0]
	if (
		!isRecord(item) ||
		!hasExactKeys(item, ['contactId', 'company']) ||
		item.contactId !== deal.contactId
	)
		throw invalidContractError()
	const company = item.company
	if (
		company !== null &&
		(!isRecord(company) ||
			!hasExactKeys(company, ['id', 'name', 'inn']) ||
			!isUuidV4(company.id) ||
			typeof company.name !== 'string' ||
			!company.name.trim() ||
			company.name.length > 200 ||
			(company.inn !== null &&
				(typeof company.inn !== 'string' ||
					!/^\d{10}(\d{2})?$/.test(company.inn))))
	)
		throw invalidContractError()
	return { deal, company: company as SalesCompanyContext['company'] }
}
export const listSalesTimelineV3 = async (
	accessToken: string,
	workspaceId: string,
	dealId: string,
	page: number,
	archive: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE'
) => {
	const value: unknown = await authenticatedRequest({
		accessToken,
		method: 'GET',
		url: `/crm/sales/deals/${dealId}/timeline-v3`,
		params: { workspaceId, archive, page: String(page), pageSize: '10' }
	})
	if (!isRecord(value) || value.schemaVersion !== 3)
		throw invalidContractError()
	const result = parseSalesPageV2(
		{ ...value, schemaVersion: 2 },
		page,
		10,
		(row): SalesTimelineEntryV3 | null => {
			if (
				!isRecord(row) ||
				!hasExactKeys(row, [
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
			if (row.kind !== 'ASSIGNEE_CHANGED')
				return details === null ? { ...entry, details: null } : null
			if (
				!isRecord(details) ||
				!hasExactKeys(details, [
					'beforeSubject',
					'afterSubject',
					'afterMembershipId',
					'transferredTaskCount'
				]) ||
				typeof details.beforeSubject !== 'string' ||
				!/^[^\s\x00-\x1f\x7f]{1,256}$/.test(details.beforeSubject) ||
				typeof details.afterSubject !== 'string' ||
				!/^[^\s\x00-\x1f\x7f]{1,256}$/.test(details.afterSubject) ||
				!isUuidV4(details.afterMembershipId) ||
				!Number.isSafeInteger(details.transferredTaskCount) ||
				Number(details.transferredTaskCount) < 0
			)
				return null
			return {
				...entry,
				kind: 'ASSIGNEE_CHANGED',
				details: details as unknown as SalesAssignmentDetails
			}
		}
	)
	if (!result) throw invalidContractError()
	return { ...result, schemaVersion: 3 as const }
}

export const listArchivedDealTasks = async (
	accessToken: string,
	workspaceId: string,
	dealId: string,
	page: number
) => {
	const result = parseSalesPage(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: `/crm/sales/deals/${dealId}/tasks`,
			params: {
				workspaceId,
				archive: 'ARCHIVED',
				page: String(page),
				pageSize: '10'
			}
		}),
		page,
		10,
		row => {
			const task = parseSalesTask(row, workspaceId)
			return task?.dealId === dealId ? task : null
		}
	)
	if (!result) throw invalidContractError()
	return result
}
