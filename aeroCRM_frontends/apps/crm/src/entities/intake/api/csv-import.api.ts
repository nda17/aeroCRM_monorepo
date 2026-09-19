import {
	authenticatedRequest,
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { isNonEmptyString, isUuidV4 } from '@/shared/lib/contract'
import axios from 'axios'
import {
	csvImportCommandError,
	parseCsvImport,
	type CsvImportCommand
} from '../model/csv-import.contract'

export const importInboxCsv = async (
	accessToken: string,
	command: CsvImportCommand,
	subject: string
) => {
	const error = csvImportCommandError(command)
	if (error) throw new AuthenticatedApiError('validation', error)
	if (!isNonEmptyString(subject, 256)) throw invalidContractError()
	const result = parseCsvImport(
		await authenticatedRequest({
			accessToken,
			method: 'POST',
			url: '/crm/intake/imports/csv',
			mapError: error =>
				axios.isAxiosError(error) && error.response?.status === 413
					? new AuthenticatedApiError(
							'validation',
							'Команда превышает допустимый размер. Уменьшите число обращений в файле.'
						)
					: undefined,
			headers: { 'Idempotency-Key': command.commandId },
			data: {
				schemaVersion: 1,
				workspaceId: command.workspaceId,
				commandId: command.commandId,
				label: command.label,
				teamId: command.teamId,
				rows: command.rows.map(row => ({
					title: row.title,
					name: row.name,
					phone: row.phone,
					email: row.email,
					message: row.message
				}))
			}
		}),
		command.workspaceId,
		command.commandId
	)
	if (
		!result ||
		result.rowCount !== command.rows.length ||
		result.createdBySubject !== subject ||
		result.teamId !== command.teamId ||
		result.label !== command.label
	)
		throw invalidContractError()
	return result
}

export const getCsvImport = async (
	accessToken: string,
	workspaceId: string,
	id: string
) => {
	if (!isUuidV4(workspaceId) || !isUuidV4(id)) throw invalidContractError()
	const result = parseCsvImport(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: `/crm/intake/imports/${id}`,
			params: { workspaceId }
		}),
		workspaceId,
		id
	)
	if (!result) throw invalidContractError()
	return result
}
