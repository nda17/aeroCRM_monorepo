import {
	authenticatedRequest,
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import axios from 'axios'
import {
	parseImportInspection,
	parseImportPreview,
	parseImportResult,
	type ImportApplyInput,
	type ImportEntity,
	type ImportFileInput,
	type ImportInspection,
	type ImportPreview,
	type ImportPreviewInput,
	type ImportResult
} from '../model/import.contract'

const UUID_V4 =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const invalidInput = () =>
	new AuthenticatedApiError(
		'validation',
		'Проверьте файл и параметры импорта.'
	)
const validate: (condition: unknown) => asserts condition = condition => {
	if (!condition) throw invalidInput()
}

const mapImportError = (error: unknown) => {
	if (!axios.isAxiosError(error)) return undefined
	const status = error.response?.status
	if (status !== 400 && status !== 409 && status !== 413) return undefined
	return new AuthenticatedApiError(
		status === 409 ? 'conflict' : 'validation',
		status === 409
			? 'Данные импорта изменились. Загрузите актуальный предпросмотр.'
			: status === 413
				? 'Размер файла превышает допустимый предел.'
				: 'Проверьте файл и параметры импорта.'
	)
}
const importRequest = (
	request: Parameters<typeof authenticatedRequest>[0]
) => authenticatedRequest({ ...request, mapError: mapImportError })
const basePath = (entity: ImportEntity) =>
	entity === 'deals' ? '/crm/sales/imports' : '/crm/customers/imports'
const validFileInput = (input: ImportFileInput) =>
	input.schemaVersion === 1 &&
	UUID_V4.test(input.workspaceId) &&
	(input.entity === 'companies' ||
		input.entity === 'contacts' ||
		input.entity === 'deals') &&
	typeof input.filename === 'string' &&
	input.filename.trim().length > 0 &&
	input.filename.length <= 200 &&
	/\.(csv|xlsx)$/i.test(input.filename) &&
	typeof input.contentBase64 === 'string' &&
	input.contentBase64.length > 0 &&
	input.contentBase64.length <= 1_333_344 &&
	/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
		input.contentBase64
	)

export const inspectCrmImport = async (
	accessToken: string,
	input: ImportFileInput
): Promise<ImportInspection> => {
	validate(validFileInput(input))
	const result = parseImportInspection(
		await importRequest({
			accessToken,
			method: 'POST',
			url: `${basePath(input.entity)}/inspect`,
			data: input
		})
	)
	if (!result || result.entity !== input.entity)
		throw invalidContractError()
	return result
}

export const previewCrmImport = async (
	accessToken: string,
	input: ImportPreviewInput
): Promise<ImportPreview> => {
	validate(
		validFileInput(input) &&
			typeof input.sourceKey === 'string' &&
			input.sourceKey.trim().length > 0 &&
			input.sourceKey.length <= 100 &&
			typeof input.sheet === 'string' &&
			input.sheet.trim().length > 0 &&
			input.sheet.length <= 200 &&
			!!input.mapping &&
			Object.keys(input.mapping).length <= 30 &&
			Object.entries(input.mapping).every(
				([key, header]) =>
					/^[A-Za-z][A-Za-z0-9]*$/.test(key) &&
					typeof header === 'string' &&
					header.trim().length > 0 &&
					header.length <= 200
			) &&
			(input.decisions === undefined || input.decisions.length <= 500)
	)
	const result = parseImportPreview(
		await importRequest({
			accessToken,
			method: 'POST',
			url: `${basePath(input.entity)}/preview`,
			data: input
		})
	)
	if (
		!result ||
		result.workspaceId !== input.workspaceId ||
		result.entity !== input.entity ||
		result.sourceKey !== input.sourceKey
	)
		throw invalidContractError()
	return result
}

export const applyCrmImport = async (
	accessToken: string,
	entity: ImportEntity,
	input: ImportApplyInput
): Promise<ImportResult> => {
	validate(
		(entity === 'companies' ||
			entity === 'contacts' ||
			entity === 'deals') &&
			input.schemaVersion === 1 &&
			UUID_V4.test(input.workspaceId) &&
			UUID_V4.test(input.previewId) &&
			UUID_V4.test(input.commandId)
	)
	const result = parseImportResult(
		await importRequest({
			accessToken,
			method: 'POST',
			url: `${basePath(entity)}/apply`,
			data: input,
			headers: { 'Idempotency-Key': input.commandId }
		})
	)
	if (
		!result ||
		result.previewId !== input.previewId ||
		result.commandId !== input.commandId ||
		result.entity !== entity
	)
		throw invalidContractError()
	return result
}

export const getCrmImport = async (
	accessToken: string,
	entity: ImportEntity,
	workspaceId: string,
	previewId: string
): Promise<ImportPreview> => {
	validate(
		(entity === 'companies' ||
			entity === 'contacts' ||
			entity === 'deals') &&
			UUID_V4.test(workspaceId) &&
			UUID_V4.test(previewId)
	)
	const result = parseImportPreview(
		await importRequest({
			accessToken,
			method: 'GET',
			url: `${basePath(entity)}/${previewId}`,
			params: { workspaceId }
		})
	)
	if (
		!result ||
		result.previewId !== previewId ||
		result.workspaceId !== workspaceId ||
		result.entity !== entity
	)
		throw invalidContractError()
	return result
}
