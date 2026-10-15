import axios from 'axios'
import {
	authenticatedRequest,
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { isUuidV4 } from '@/shared/lib/contract'
import {
	parseActivityTextTemplates,
	parseSavedActivityTextTemplates,
	validSaveActivityTextTemplatesCommand,
	type SaveActivityTextTemplatesCommand
} from '../model/activity-text-templates.contract'

const url = '/crm/sales/activity-text-templates'

const conflictError = (error: unknown) => {
	if (!axios.isAxiosError(error) || error.response?.status !== 409) return
	const code: unknown = error.response.data?.code
	const message =
		code === 'crm_activity_text_templates_conflict'
			? 'Шаблоны изменились. Загрузите актуальную версию перед сохранением.'
			: code === 'crm_activity_text_template_command_conflict'
				? 'Команда сохранения уже использована с другими данными. Обновите настройки.'
				: undefined
	return message
		? new AuthenticatedApiError('conflict', message)
		: undefined
}

export const getActivityTextTemplates = async (
	accessToken: string,
	workspaceId: string
) => {
	if (!isUuidV4(workspaceId)) throw invalidContractError()
	const result = parseActivityTextTemplates(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url,
			params: { workspaceId }
		}),
		workspaceId
	)
	if (!result) throw invalidContractError()
	return result
}

export const saveActivityTextTemplates = async (
	accessToken: string,
	command: SaveActivityTextTemplatesCommand
) => {
	if (!validSaveActivityTextTemplatesCommand(command))
		throw new AuthenticatedApiError(
			'validation',
			'Проверьте названия и содержимое шаблонов.'
		)
	const result = parseSavedActivityTextTemplates(
		await authenticatedRequest({
			accessToken,
			method: 'POST',
			url,
			headers: { 'Idempotency-Key': command.commandId },
			data: command,
			mapError: conflictError
		}),
		command
	)
	if (!result) throw invalidContractError()
	return result
}
