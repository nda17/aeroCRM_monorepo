import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import {
	parseAssigneeLabels,
	validAssigneeLabelsRequest,
	type AssigneeLabelsRequest
} from '../model/assignee-labels.contract'

// This POST is a bounded read, not a command: no idempotency key, persistence or
// assignment mutation. Actor/dataScope are response guards, never wire authority.
export const getAssigneeLabels = async (
	accessToken: string,
	input: AssigneeLabelsRequest,
	signal?: AbortSignal
) => {
	if (signal?.aborted || !validAssigneeLabelsRequest(input))
		throw invalidContractError()
	const request = {
		...input,
		bindings: input.bindings.map(binding => ({ ...binding }))
	}
	const result = parseAssigneeLabels(
		await authenticatedRequest({
			accessToken,
			method: 'POST',
			url: '/crm/access/team/assignee-labels',
			data: {
				schemaVersion: 1,
				workspaceId: request.workspaceId,
				bindings: request.bindings
			}
		}),
		request
	)
	if (signal?.aborted || !result) throw invalidContractError()
	return result
}
