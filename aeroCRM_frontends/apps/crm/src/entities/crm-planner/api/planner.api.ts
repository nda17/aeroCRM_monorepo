import axios from 'axios'
import {
	authenticatedRequest,
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { isUuidV4 } from '@/shared/lib/contract'
import {
	parsePlannerSettings,
	parseSavedPlannerSettings,
	validSavePlannerSettingsCommand
} from '../model/planner.contract'
import type { SavePlannerSettingsCommand } from '../model/planner.types'

const root = '/crm/sales/planner/settings'
const checked = <T>(value: T | null): T => {
	if (value === null) throw invalidContractError()
	return value
}
const valid = (condition: boolean) => {
	if (!condition)
		throw new AuthenticatedApiError(
			'validation',
			'Проверьте настройки задач и повторите попытку.'
		)
}
const plannerCommandError = (error: unknown) => {
	if (!axios.isAxiosError(error) || error.response?.status !== 409) return
	const code: unknown = error.response.data?.code
	const message =
		code === 'crm_planner_settings_conflict'
			? 'Настройки задач изменились. Обновите данные и повторите попытку.'
			: code === 'crm_planner_column_unavailable'
				? 'Колонка доски недоступна. Обновите данные.'
				: undefined
	return message
		? new AuthenticatedApiError('conflict', message)
		: undefined
}

export const getPlannerSettings = async (
	accessToken: string,
	workspaceId: string
) => {
	valid(isUuidV4(workspaceId))
	return checked(
		parsePlannerSettings(
			await authenticatedRequest({
				accessToken,
				method: 'GET',
				url: root,
				params: { workspaceId }
			}),
			workspaceId
		)
	)
}

export const savePlannerSettings = async (
	accessToken: string,
	command: SavePlannerSettingsCommand
) => {
	valid(validSavePlannerSettingsCommand(command))
	return checked(
		parseSavedPlannerSettings(
			await authenticatedRequest({
				accessToken,
				method: 'POST',
				url: root,
				headers: { 'Idempotency-Key': command.commandId },
				data: command,
				mapError: plannerCommandError
			}),
			command
		)
	)
}
