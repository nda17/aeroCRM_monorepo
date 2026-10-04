import {
	authenticatedRequest,
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import {
	parseSavedViewCommandResult,
	parseSavedViewsPage,
	validSavedViewBinding,
	validSavedViewCommand
} from '../model/saved-views.contract'
import type {
	SavedViewBinding,
	SavedViewCommand
} from '../model/saved-views.types'

const root = '/crm/access/saved-views'
export const listSavedViews = async (
	accessToken: string,
	binding: SavedViewBinding
) => {
	if (!validSavedViewBinding(binding))
		throw new AuthenticatedApiError(
			'validation',
			'Недоступное пространство представлений.'
		)
	const result = parseSavedViewsPage(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: root,
			params: { workspaceId: binding.workspaceId, scope: binding.scope }
		}),
		binding
	)
	if (!result) throw invalidContractError()
	return result
}
export const mutateSavedView = async (
	accessToken: string,
	command: SavedViewCommand
) => {
	if (!validSavedViewCommand(command))
		throw new AuthenticatedApiError(
			'validation',
			'Проверьте название и параметры представления.'
		)
	const { mutation } = command
	const common = {
		schemaVersion: 1,
		workspaceId: command.workspaceId,
		commandId: command.commandId
	}
	const body =
		mutation.kind === 'create'
			? {
					...common,
					scope: command.scope,
					name: mutation.name.trim(),
					parameters: mutation.parameters
				}
			: mutation.kind === 'import'
				? { ...common, scope: command.scope, views: mutation.views }
				: {
						...common,
						expectedVersion: mutation.expectedVersion,
						...(mutation.kind === 'rename'
							? { name: mutation.name.trim() }
							: {})
					}
	const path =
		mutation.kind === 'create'
			? ''
			: mutation.kind === 'import'
				? '/import'
				: `/${mutation.id}/${mutation.kind}`
	const result = parseSavedViewCommandResult(
		await authenticatedRequest({
			accessToken,
			method: 'POST',
			url: `${root}${path}`,
			headers: { 'Idempotency-Key': command.commandId },
			data: body
		}),
		command
	)
	if (!result) throw invalidContractError()
	return result
}
