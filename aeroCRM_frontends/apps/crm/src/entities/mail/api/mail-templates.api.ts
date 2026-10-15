import axios from 'axios'
import {
	authenticatedRequest,
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { isUuidV4 } from '@/shared/lib/contract'
import {
	parseMailTemplatesSnapshot,
	parseSavedMailTemplates,
	validSaveMailTemplatesCommand,
	type SaveMailTemplatesCommand
} from '../model/mail-templates.contract'

const url = '/crm/customers/mail/templates'
const conflictError = (error: unknown) => {
	if (!axios.isAxiosError(error) || error.response?.status !== 409) return
	const code: unknown = error.response.data?.code
	const message =
		code === 'crm_mail_templates_conflict'
			? 'Шаблоны писем изменились. Загрузите актуальную версию.'
			: code === 'crm_mail_template_command_conflict'
				? 'Команда сохранения уже использована. Обновите шаблоны.'
				: undefined
	return message
		? new AuthenticatedApiError('conflict', message)
		: undefined
}

export const getMailTemplates = async (
	token: string,
	workspaceId: string
) => {
	if (!isUuidV4(workspaceId)) throw invalidContractError()
	const result = parseMailTemplatesSnapshot(
		await authenticatedRequest({
			accessToken: token,
			method: 'GET',
			url,
			params: { workspaceId }
		}),
		workspaceId
	)
	if (!result) throw invalidContractError()
	return result
}

export const saveMailTemplates = async (
	token: string,
	command: SaveMailTemplatesCommand
) => {
	if (!validSaveMailTemplatesCommand(command))
		throw new AuthenticatedApiError(
			'validation',
			'Проверьте шаблоны писем.'
		)
	const result = parseSavedMailTemplates(
		await authenticatedRequest({
			accessToken: token,
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
