import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import {
	parseAssigneeOptions,
	validAssigneeOptionsRequest,
	type AssigneeOptionsRequest
} from '../model/assignee-options.contract'

export const listAssigneeOptions = async (
	accessToken: string,
	input: AssigneeOptionsRequest
) => {
	// Capture the exact request binding before awaiting transport; never send
	// caller authority, session revision or locally guessed membership IDs.
	const request = { ...input }
	if (!validAssigneeOptionsRequest(request)) throw invalidContractError()
	const result = parseAssigneeOptions(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: '/crm/access/team/assignees',
			params: {
				workspaceId: request.workspaceId,
				page: String(request.page),
				pageSize: String(request.pageSize),
				...(request.search ? { search: request.search } : {}),
				...(request.selectedSubject
					? { selectedSubject: request.selectedSubject }
					: {}),
				...(request.teamId ? { teamId: request.teamId } : {})
			}
		}),
		request
	)
	if (!result) throw invalidContractError()
	return result
}
