import {
	canOpenCrmWorkspace,
	getCrmPermissions,
	parseCrmAccessBootstrap
} from '@/entities/crm-access'
import {
	authenticatedRequest,
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { isUuidV4 } from '@/shared/lib/contract'

export const checkInvitationCrmAccess = async (
	token: string,
	workspaceId: string,
	userId: string
) => {
	if (!isUuidV4(workspaceId)) throw invalidContractError()
	const access = parseCrmAccessBootstrap(
		await authenticatedRequest({
			accessToken: token,
			method: 'GET',
			url: '/crm/access/bootstrap',
			params: { workspaceId }
		}),
		workspaceId
	)
	if (
		!access ||
		access.state === 'WORKSPACE_SELECTION_REQUIRED' ||
		access.selectedWorkspaceId !== workspaceId
	)
		throw invalidContractError()
	if (!canOpenCrmWorkspace(access))
		throw new AuthenticatedApiError(
			'forbidden',
			'Рабочее пространство ещё не готово или доступ ограничен. Обратитесь к владельцу.'
		)
	// Identity membership and a workspace subscription do not prove seat admission.
	const permissions = await getCrmPermissions(token, workspaceId)
	if (permissions.subject !== userId) throw invalidContractError()
	return {
		workspaceId,
		state: permissions.state,
		destination: `${permissions.role === 'ANALYST' ? '/analytics' : '/inbox'}?workspaceId=${workspaceId}`
	}
}
