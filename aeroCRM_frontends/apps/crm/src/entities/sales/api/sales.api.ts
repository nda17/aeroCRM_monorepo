import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import {
	parsePipelines,
	parseSalesDeal,
	parseSalesDealResult,
	parseSalesPage,
	parseSalesTask,
	parseTimelineEntry,
	type SalesDealFilters
} from '../model/sales.contract'

export const listSalesPipelines = async (
	accessToken: string,
	workspaceId: string
) => {
	const result = parsePipelines(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: '/crm/sales/pipelines',
			params: { workspaceId }
		}),
		workspaceId
	)
	if (!result) throw invalidContractError()
	return result
}
export const listSalesDeals = async (
	accessToken: string,
	workspaceId: string,
	page: number,
	pageSize: number,
	search: string,
	pipelineId: string,
	status: string,
	withoutNextAction = false,
	filters: SalesDealFilters = {}
) => {
	if (typeof withoutNextAction !== 'boolean') throw invalidContractError()
	const result = parseSalesPage(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: '/crm/sales/deals',
			params: {
				workspaceId,
				page: String(page),
				pageSize: String(pageSize),
				search,
				...(pipelineId ? { pipelineId } : {}),
				...(status ? { status } : {}),
				...(withoutNextAction ? { withoutNextAction: 'true' } : {}),
				...(filters.stageId ? { stageId: filters.stageId } : {}),
				...(filters.assignedToSubject
					? { assignedToSubject: filters.assignedToSubject }
					: {}),
				...(filters.overdue ? { overdue: 'true' } : {}),
				...(filters.overdueBefore
					? { overdueBefore: filters.overdueBefore }
					: {}),
				...(filters.createdFrom
					? { createdFrom: filters.createdFrom }
					: {}),
				...(filters.createdTo ? { createdTo: filters.createdTo } : {}),
				...(filters.sort ? { sort: filters.sort } : {})
			}
		}),
		page,
		pageSize,
		row => {
			const deal = parseSalesDeal(row, workspaceId)
			if (
				withoutNextAction &&
				(deal?.status !== 'OPEN' ||
					deal.nextTask !== null ||
					(status && deal.status !== status))
			)
				return null
			if (
				deal &&
				((pipelineId && deal.pipelineId !== pipelineId) ||
					(status && deal.status !== status) ||
					(filters.stageId && deal.stageId !== filters.stageId) ||
					(filters.assignedToSubject &&
						deal.assignedToSubject !== filters.assignedToSubject) ||
					(filters.createdFrom && deal.createdAt < filters.createdFrom) ||
					(filters.createdTo && deal.createdAt >= filters.createdTo) ||
					(filters.overdue && deal.status !== 'OPEN'))
			)
				return null
			return deal?.archivedAt === null ? deal : null
		}
	)
	if (!result) throw invalidContractError()
	return result
}
export const getSalesDeal = async (
	accessToken: string,
	workspaceId: string,
	id: string
) => {
	const result = parseSalesDealResult(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: `/crm/sales/deals/${id}`,
			params: { workspaceId }
		}),
		workspaceId,
		id
	)
	if (!result || result.archivedAt !== null) throw invalidContractError()
	return result
}
export const listSalesTasks = async (
	accessToken: string,
	workspaceId: string,
	page: number,
	pageSize: number,
	search: string
) => {
	const result = parseSalesPage(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: '/crm/sales/tasks',
			params: {
				workspaceId,
				page: String(page),
				pageSize: String(pageSize),
				search
			}
		}),
		page,
		pageSize,
		row => {
			const task = parseSalesTask(row, workspaceId)
			return task?.status === 'OPEN' ? task : null
		}
	)
	if (!result) throw invalidContractError()
	return result
}
export const listSalesTimeline = async (
	accessToken: string,
	workspaceId: string,
	dealId: string,
	page: number
) => {
	const result = parseSalesPage(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: `/crm/sales/deals/${dealId}/timeline`,
			params: { workspaceId, page: String(page), pageSize: '10' }
		}),
		page,
		10,
		row => parseTimelineEntry(row, dealId)
	)
	if (!result) throw invalidContractError()
	return result
}
export interface SalesNextTask {
	title: string
	dueAt: string
}
export type SalesMutation =
	| {
			kind: 'create'
			title: string
			currency: 'RUB'
			amountMinor: number
			pipelineId: string
			stageId: string
			contactId: string
			nextTask: SalesNextTask
	  }
	| {
			kind: 'transition'
			id: string
			expectedVersion: number
			targetStageId: string
			outcome: string
			nextTask?: SalesNextTask
	  }
	| {
			kind: 'complete'
			id: string
			dealId: string
			expectedVersion: number
			outcome: string
			nextTask: SalesNextTask
	  }
	| { kind: 'archive'; id: string; expectedVersion: number }
export interface SalesCommand {
	workspaceId: string
	commandId: string
	mutation: SalesMutation
}
export const mutateSales = async (
	accessToken: string,
	command: SalesCommand
) => {
	const { mutation, commandId, workspaceId } = command
	const { kind, ...fields } = mutation
	const id = 'id' in mutation ? mutation.id : undefined
	const data: Record<string, unknown> = {
		schemaVersion: 1,
		workspaceId,
		commandId,
		...fields
	}
	delete data.id
	delete data.dealId
	const url =
		kind === 'create'
			? '/crm/sales/deals'
			: kind === 'complete'
				? `/crm/sales/tasks/${id}/complete`
				: `/crm/sales/deals/${id}/${kind}`
	const result = parseSalesDealResult(
		await authenticatedRequest({
			accessToken,
			method: 'POST',
			url,
			headers: { 'Idempotency-Key': commandId },
			data
		}),
		workspaceId,
		kind === 'complete' ? mutation.dealId : id
	)
	if (
		!result ||
		(kind === 'archive'
			? result.archivedAt === null
			: result.archivedAt !== null) ||
		(kind === 'create' &&
			(result.version !== 1 ||
				result.contactId !== mutation.contactId ||
				result.title !== mutation.title.trim() ||
				result.amountMinor !== mutation.amountMinor ||
				result.pipelineId !== mutation.pipelineId ||
				result.stageId !== mutation.stageId)) ||
		(kind === 'transition' &&
			(result.version !== mutation.expectedVersion + 1 ||
				result.stageId !== mutation.targetStageId)) ||
		(kind === 'archive' &&
			result.version !== mutation.expectedVersion + 1) ||
		(kind === 'complete' && result.nextTask?.id === mutation.id) ||
		('nextTask' in mutation && mutation.nextTask
			? result.nextTask?.title !== mutation.nextTask.title.trim() ||
				result.nextTask?.dueAt !== mutation.nextTask.dueAt
			: kind !== 'archive' && result.nextTask !== null)
	)
		throw invalidContractError()
	return result
}
