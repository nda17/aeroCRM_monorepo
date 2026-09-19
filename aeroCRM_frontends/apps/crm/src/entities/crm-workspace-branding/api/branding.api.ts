import {
	authenticatedRequest,
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import {
	normalizeCompanyName,
	parseWorkspaceBranding,
	type BrandingCommand,
	type BrandingRequest
} from '../model/branding.contract'

const url = '/crm/access/workspace/branding'

export const getWorkspaceBranding = async (
	accessToken: string,
	request: BrandingRequest
) => {
	const result = parseWorkspaceBranding(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url,
			params: { workspaceId: request.workspaceId }
		}),
		request
	)
	if (!result) throw invalidContractError()
	return result
}

export const updateWorkspaceBranding = async (
	accessToken: string,
	command: BrandingCommand
) => {
	const displayName = normalizeCompanyName(command.displayName)
	if (displayName === undefined)
		throw new AuthenticatedApiError(
			'validation',
			'Проверьте название компании.'
		)
	const result = parseWorkspaceBranding(
		await authenticatedRequest({
			accessToken,
			method: 'POST',
			url,
			headers: { 'Idempotency-Key': command.commandId },
			data: {
				schemaVersion: 1,
				commandId: command.commandId,
				workspaceId: command.workspaceId,
				expectedActorSubject: command.subject,
				expectedVersion: command.expectedVersion,
				displayName
			}
		}),
		command
	)
	if (
		!result ||
		result.branding.version !== command.expectedVersion + 1 ||
		result.branding.displayName !== displayName
	)
		throw invalidContractError()
	return result
}
