import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { isNonEmptyString } from '@/shared/lib/contract'
import { parseWorkspaceDisplaySummaries } from '../model/workspace-display-summary.contract'

export const getWorkspaceDisplaySummaries = async (
	accessToken: string,
	expectedSubject: string
) => {
	if (!isNonEmptyString(expectedSubject, 256)) throw invalidContractError()
	const parsed = parseWorkspaceDisplaySummaries(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: '/crm/access/workspaces/display-summaries'
		}),
		expectedSubject
	)
	if (!parsed) throw invalidContractError()
	return parsed
}
