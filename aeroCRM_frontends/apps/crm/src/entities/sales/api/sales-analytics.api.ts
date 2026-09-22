import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import {
	parseSalesAnalytics,
	parseSalesAnalyticsOverview,
	validAnalyticsOverviewQuery,
	type SalesAnalyticsOverviewQuery
} from '../model/sales-analytics.contract'

export const getSalesAnalytics = async (
	accessToken: string,
	workspaceId: string
) => {
	const result = parseSalesAnalytics(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: '/crm/sales/analytics',
			params: { workspaceId }
		})
	)
	if (!result) throw invalidContractError()
	return result
}

export const getSalesAnalyticsOverview = async (
	accessToken: string,
	workspaceId: string,
	query: SalesAnalyticsOverviewQuery = {}
) => {
	if (!validAnalyticsOverviewQuery(query)) throw invalidContractError()
	const result = parseSalesAnalyticsOverview(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: '/crm/sales/analytics',
			params: {
				workspaceId,
				details: 'true',
				...(query.pipelineId ? { pipelineId: query.pipelineId } : {}),
				...(query.createdFrom
					? { createdFrom: query.createdFrom, createdTo: query.createdTo! }
					: {}),
				assigneePage: String(query.assigneePage || 1)
			}
		}),
		query
	)
	if (!result) throw invalidContractError()
	return result
}
