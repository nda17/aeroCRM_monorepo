import {
	authenticatedRequest,
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import axios from 'axios'
import { hasExactKeys } from '@/shared/lib/contract'
import {
	isCommerceMoney,
	isCommerceQuantity,
	parseCommerceCatalogItemResult,
	parseCommerceCatalogPage,
	parseCommerceAnalytics,
	parseCommerceHistory,
	parseCommerceImportApplyResult,
	parseCommerceImportInspection,
	parseCommerceImportPreview,
	parseCommerceQuotes,
	parseDealCommercePayments,
	parseCommerceQuote,
	parseDealCommerce,
	parseManagedPipelineResult,
	parseManagedPipelines,
	parseSaveDealLineResult,
	type CommerceCatalogItem,
	type CommerceCatalogPage,
	type CommerceAnalytics,
	type CommerceHistoryEvent,
	type CommerceImportApplyResult,
	type CommerceImportInspection,
	type CommerceImportPreview,
	type CommerceKind,
	type CommercePaymentKind,
	type CommerceQuote,
	type DealCommercePayments,
	type DealCommerce,
	type ManagedPipeline
} from '../model/commerce.contract'

const MAX_MINOR = 2_147_483_647
const isUuid = (value: unknown): value is string =>
	typeof value === 'string' &&
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
		value
	)
const isPositiveVersion = (value: unknown) =>
	Number.isSafeInteger(value) &&
	Number(value) > 0 &&
	Number(value) <= MAX_MINOR
const isCanonicalDate = (value: unknown): value is string =>
	typeof value === 'string' &&
	Number.isFinite(Date.parse(value)) &&
	new Date(value).toISOString() === value
const isText = (value: unknown, max: number) =>
	typeof value === 'string' &&
	value.trim().length > 0 &&
	value.trim().length <= max &&
	!/[\x00-\x1f\x7f]/.test(value)
const isMultilineText = (value: unknown, max: number) =>
	typeof value === 'string' &&
	value.length <= max &&
	!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)
const normalizeMultiline = (value: string) =>
	value.replace(/\r\n?/g, '\n').trim()
const validPrice = (value: unknown) =>
	value === undefined || value === null || isCommerceMoney(value)
const validKind = (value: unknown): value is CommerceKind =>
	value === 'PRODUCT' || value === 'SERVICE'
const validMoney = (value: unknown) =>
	isCommerceMoney(value) && Number(value) <= MAX_MINOR
const validate: (condition: unknown) => asserts condition = condition => {
	if (!condition)
		throw new AuthenticatedApiError(
			'validation',
			'Проверьте введённые данные и повторите действие.'
		)
}
const validateResponse: (
	condition: unknown
) => asserts condition = condition => {
	if (!condition) throw invalidContractError()
}

const boundedServiceMessage = (data: unknown): string | undefined => {
	if (!data || typeof data !== 'object' || Array.isArray(data))
		return undefined
	const raw = (data as Record<string, unknown>).message
	const candidates = Array.isArray(raw) ? raw.slice(0, 3) : [raw]
	const messages = candidates.filter(
		(message): message is string =>
			typeof message === 'string' &&
			message.trim().length > 0 &&
			message.length <= 240 &&
			!/\x00|[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(message) &&
			!/(?:\bat\s+.+\(.+:\d+:\d+\)|\bError:|\bException:|\bstack\b|<\/?\w+>)/i.test(
				message
			)
	)
	if (!messages.length) return undefined
	return messages.join('; ').slice(0, 480)
}

const mapCommerceError = (error: unknown) => {
	if (!axios.isAxiosError(error)) return undefined
	const status = error.response?.status
	if (status !== 400 && status !== 409 && status !== 413) return undefined
	const fallback =
		status === 409
			? 'Данные изменились. Обновите страницу и повторите действие.'
			: status === 413
				? 'Размер файла или данных превышает допустимый предел.'
				: 'Проверьте данные и повторите действие.'
	return new AuthenticatedApiError(
		status === 409 ? 'conflict' : 'validation',
		boundedServiceMessage(error.response?.data) ?? fallback
	)
}

const commerceRequest = (
	request: Parameters<typeof authenticatedRequest>[0]
) => authenticatedRequest({ ...request, mapError: mapCommerceError })

const commandHeaders = (commandId: string) => {
	validate(isUuid(commandId))
	return { 'Idempotency-Key': commandId }
}
const commandData = (
	workspaceId: string,
	commandId: string,
	fields: Record<string, unknown>
) => ({ schemaVersion: 1, workspaceId, commandId, ...fields })

const post = async (
	accessToken: string,
	workspaceId: string,
	commandId: string,
	url: string,
	fields: Record<string, unknown>
) =>
	commerceRequest({
		accessToken,
		method: 'POST',
		url,
		headers: commandHeaders(commandId),
		data: commandData(workspaceId, commandId, fields)
	})

export interface CatalogListOptions {
	page?: number
	pageSize?: number
	search?: string
	includeArchived?: boolean
}
export interface SaveCatalogItemInput {
	workspaceId?: string
	schemaVersion?: 1
	commandId: string
	code?: string
	kind: CommerceKind
	name: string
	unit: string
	basePriceMinor?: number | null
}
export interface UpdateCatalogItemInput {
	workspaceId?: string
	schemaVersion?: 1
	commandId: string
	expectedVersion: number
	kind?: CommerceKind
	name: string
	unit: string
	basePriceMinor?: number | null
}
export interface ManagedPipelineCommand {
	commandId: string
	mutation:
		| {
				kind: 'create'
				name: string
				templateKey?: string
				templateVersion?: number
		  }
		| { kind: 'rename'; id: string; expectedVersion: number; name: string }
		| {
				kind: 'addStage'
				id: string
				expectedVersion: number
				name: string
				state: 'OPEN' | 'WON' | 'LOST'
		  }
		| {
				kind: 'renameStage'
				id: string
				stageId: string
				expectedVersion: number
				name: string
		  }
		| {
				kind: 'reorder'
				id: string
				expectedVersion: number
				stageIds: string[]
		  }
}
export interface ReplaceDealLineInput {
	id?: string
	catalogItemId?: string | null
	kind: CommerceKind
	name: string
	unit: string
	quantity: string
	unitPriceMinor: number
	discountMinor: number
}
export interface ReplaceDealLinesInput {
	commandId: string
	expectedVersion: number
	lines: ReplaceDealLineInput[]
	manualAmountMinor?: number
}

export const listManagedPipelines = async (
	accessToken: string,
	workspaceId: string
): Promise<{
	schemaVersion: 1
	workspaceId: string
	items: ManagedPipeline[]
}> => {
	validate(isUuid(workspaceId))
	const result = parseManagedPipelines(
		await commerceRequest({
			accessToken,
			method: 'GET',
			url: '/crm/sales/commerce/pipelines',
			params: { workspaceId }
		}),
		workspaceId
	)
	if (!result) throw invalidContractError()
	return { schemaVersion: 1, workspaceId, items: result }
}

export const listAnalyticsPipelines = async (
	accessToken: string,
	workspaceId: string
): Promise<{
	schemaVersion: 1
	workspaceId: string
	items: ManagedPipeline[]
}> => {
	validate(isUuid(workspaceId))
	const result = parseManagedPipelines(
		await commerceRequest({
			accessToken,
			method: 'GET',
			url: '/crm/sales/commerce/analytics/pipelines',
			params: { workspaceId }
		}),
		workspaceId
	)
	if (!result) throw invalidContractError()
	return { schemaVersion: 1, workspaceId, items: result }
}

type CreateManagedPipelineInput = {
	commandId: string
	name: string
	templateKey?: string
	templateVersion?: number
	workspaceId?: string
	schemaVersion?: 1
}
export function createManagedPipeline(
	accessToken: string,
	workspaceId: string,
	command: CreateManagedPipelineInput
): Promise<ManagedPipeline>
export function createManagedPipeline(
	accessToken: string,
	command: CreateManagedPipelineInput & { workspaceId: string }
): Promise<ManagedPipeline>
export async function createManagedPipeline(
	accessToken: string,
	workspaceIdOrCommand:
		| string
		| (CreateManagedPipelineInput & { workspaceId: string }),
	commandArgument?: CreateManagedPipelineInput
): Promise<ManagedPipeline> {
	const workspaceId =
		typeof workspaceIdOrCommand === 'string'
			? workspaceIdOrCommand
			: workspaceIdOrCommand.workspaceId
	const command =
		typeof workspaceIdOrCommand === 'string'
			? commandArgument!
			: workspaceIdOrCommand
	validate(
		isUuid(workspaceId) &&
			(command.workspaceId === undefined ||
				command.workspaceId === workspaceId) &&
			(command.schemaVersion === undefined ||
				command.schemaVersion === 1) &&
			isUuid(command.commandId) &&
			isText(command.name, 200) &&
			(command.templateKey === undefined ||
				isText(command.templateKey, 64)) &&
			(command.templateVersion === undefined ||
				isPositiveVersion(command.templateVersion))
	)
	const fields = {
		name: command.name.trim(),
		...(command.templateKey !== undefined
			? { templateKey: command.templateKey.trim() }
			: {}),
		...(command.templateVersion !== undefined
			? { templateVersion: command.templateVersion }
			: {})
	}
	const result = parseManagedPipelineResult(
		await post(
			accessToken,
			workspaceId,
			command.commandId,
			'/crm/sales/commerce/pipelines',
			fields
		),
		workspaceId
	)
	if (
		!result ||
		result.name !== fields.name ||
		result.templateKey !== (command.templateKey?.trim() ?? 'custom') ||
		result.templateVersion !== (command.templateVersion ?? 1)
	)
		throw invalidContractError()
	return result
}

export const updateManagedPipeline = async (
	accessToken: string,
	workspaceId: string,
	command: ManagedPipelineCommand
): Promise<ManagedPipeline> => {
	validate(isUuid(workspaceId) && isUuid(command.commandId))
	const mutation = command.mutation
	let url: string
	let fields: Record<string, unknown>
	if (mutation.kind === 'create') {
		return createManagedPipeline(accessToken, workspaceId, {
			commandId: command.commandId,
			...mutation
		})
	}
	validate(
		isUuid(mutation.id) && isPositiveVersion(mutation.expectedVersion)
	)
	const targetId = mutation.id
	if (mutation.kind === 'rename') {
		validate(isText(mutation.name, 200))
		url = `/crm/sales/commerce/pipelines/${mutation.id}/rename`
		fields = {
			expectedVersion: mutation.expectedVersion,
			name: mutation.name.trim()
		}
	} else if (mutation.kind === 'addStage') {
		validate(
			isText(mutation.name, 200) &&
				['OPEN', 'WON', 'LOST'].includes(mutation.state)
		)
		url = `/crm/sales/commerce/pipelines/${mutation.id}/stages`
		fields = {
			expectedVersion: mutation.expectedVersion,
			name: mutation.name.trim(),
			state: mutation.state
		}
	} else if (mutation.kind === 'renameStage') {
		validate(isUuid(mutation.stageId) && isText(mutation.name, 200))
		url = `/crm/sales/commerce/pipelines/${mutation.id}/stages/${mutation.stageId}/rename`
		fields = {
			expectedVersion: mutation.expectedVersion,
			name: mutation.name.trim()
		}
	} else {
		validate(
			Array.isArray(mutation.stageIds) &&
				mutation.stageIds.length >= 3 &&
				mutation.stageIds.length <= 100 &&
				mutation.stageIds.every(isUuid) &&
				new Set(mutation.stageIds).size === mutation.stageIds.length
		)
		url = `/crm/sales/commerce/pipelines/${mutation.id}/reorder`
		fields = {
			expectedVersion: mutation.expectedVersion,
			stageIds: [...mutation.stageIds]
		}
	}
	const result = parseManagedPipelineResult(
		await post(accessToken, workspaceId, command.commandId, url, fields),
		workspaceId,
		targetId
	)
	if (!result || result.version !== mutation.expectedVersion + 1)
		throw invalidContractError()
	if (mutation.kind === 'rename' && result.name !== mutation.name.trim())
		throw invalidContractError()
	if (
		mutation.kind === 'addStage' &&
		!result.stages.some(
			stage =>
				stage.name === mutation.name.trim() &&
				stage.state === mutation.state
		)
	)
		throw invalidContractError()
	if (
		mutation.kind === 'renameStage' &&
		result.stages.find(stage => stage.id === mutation.stageId)?.name !==
			mutation.name.trim()
	)
		throw invalidContractError()
	if (
		mutation.kind === 'reorder' &&
		result.stages.some(
			(stage, index) => stage.id !== mutation.stageIds[index]
		)
	)
		throw invalidContractError()
	return result
}

type PipelineHelperCommand = {
	workspaceId: string
	commandId: string
	schemaVersion?: 1
	expectedVersion: number
}
export const renameManagedPipeline = (
	accessToken: string,
	id: string,
	command: PipelineHelperCommand & { name: string }
) => {
	validate(
		command.schemaVersion === undefined || command.schemaVersion === 1
	)
	return updateManagedPipeline(accessToken, command.workspaceId, {
		commandId: command.commandId,
		mutation: {
			kind: 'rename',
			id,
			expectedVersion: command.expectedVersion,
			name: command.name
		}
	})
}
export const addManagedPipelineStage = (
	accessToken: string,
	id: string,
	command: PipelineHelperCommand & {
		name: string
		state: 'OPEN' | 'WON' | 'LOST'
	}
) => {
	validate(
		command.schemaVersion === undefined || command.schemaVersion === 1
	)
	return updateManagedPipeline(accessToken, command.workspaceId, {
		commandId: command.commandId,
		mutation: {
			kind: 'addStage',
			id,
			expectedVersion: command.expectedVersion,
			name: command.name,
			state: command.state
		}
	})
}
export const renameManagedPipelineStage = (
	accessToken: string,
	id: string,
	stageId: string,
	command: PipelineHelperCommand & { name: string }
) => {
	validate(
		command.schemaVersion === undefined || command.schemaVersion === 1
	)
	return updateManagedPipeline(accessToken, command.workspaceId, {
		commandId: command.commandId,
		mutation: {
			kind: 'renameStage',
			id,
			stageId,
			expectedVersion: command.expectedVersion,
			name: command.name
		}
	})
}
export const reorderManagedPipelineStages = (
	accessToken: string,
	id: string,
	command: PipelineHelperCommand & { stageIds: string[] }
) => {
	validate(
		command.schemaVersion === undefined || command.schemaVersion === 1
	)
	return updateManagedPipeline(accessToken, command.workspaceId, {
		commandId: command.commandId,
		mutation: {
			kind: 'reorder',
			id,
			expectedVersion: command.expectedVersion,
			stageIds: command.stageIds
		}
	})
}

export const listCatalogItems = async (
	accessToken: string,
	workspaceId: string,
	options: CatalogListOptions = {}
): Promise<CommerceCatalogPage> => {
	const page = options.page ?? 1
	const pageSize = options.pageSize ?? 50
	validate(
		isUuid(workspaceId) &&
			Number.isSafeInteger(page) &&
			page > 0 &&
			Number.isSafeInteger(pageSize) &&
			pageSize > 0 &&
			pageSize <= 100 &&
			(options.search === undefined ||
				(typeof options.search === 'string' &&
					options.search.length <= 100)) &&
			(options.includeArchived === undefined ||
				typeof options.includeArchived === 'boolean')
	)
	const result = parseCommerceCatalogPage(
		await commerceRequest({
			accessToken,
			method: 'GET',
			url: '/crm/sales/commerce/catalog',
			params: {
				workspaceId,
				page: String(page),
				pageSize: String(pageSize),
				...(options.search?.trim()
					? { search: options.search.trim() }
					: {}),
				...(options.includeArchived ? { includeArchived: 'true' } : {})
			}
		}),
		workspaceId,
		page,
		pageSize
	)
	if (!result) throw invalidContractError()
	return result
}

export function saveCatalogItem(
	accessToken: string,
	workspaceId: string,
	input: SaveCatalogItemInput
): Promise<CommerceCatalogItem>
export function saveCatalogItem(
	accessToken: string,
	input: SaveCatalogItemInput & { workspaceId: string }
): Promise<CommerceCatalogItem>
export async function saveCatalogItem(
	accessToken: string,
	workspaceIdOrInput:
		| string
		| (SaveCatalogItemInput & { workspaceId: string }),
	inputArgument?: SaveCatalogItemInput
): Promise<CommerceCatalogItem> {
	const workspaceId =
		typeof workspaceIdOrInput === 'string'
			? workspaceIdOrInput
			: workspaceIdOrInput.workspaceId
	const input =
		typeof workspaceIdOrInput === 'string'
			? inputArgument!
			: workspaceIdOrInput
	validate(
		isUuid(workspaceId) &&
			(input.workspaceId === undefined ||
				input.workspaceId === workspaceId) &&
			(input.schemaVersion === undefined || input.schemaVersion === 1) &&
			isUuid(input.commandId) &&
			validKind(input.kind) &&
			isText(input.name, 200) &&
			isText(input.unit, 32) &&
			validPrice(input.basePriceMinor) &&
			(input.code === undefined || isText(input.code, 100))
	)
	const fields = {
		...(input.code !== undefined ? { code: input.code.trim() } : {}),
		kind: input.kind,
		name: input.name.trim(),
		unit: input.unit.trim(),
		...(input.basePriceMinor !== undefined
			? { basePriceMinor: input.basePriceMinor }
			: {})
	}
	const result = parseCommerceCatalogItemResult(
		await post(
			accessToken,
			workspaceId,
			input.commandId,
			'/crm/sales/commerce/catalog',
			fields
		),
		workspaceId
	)
	if (
		!result ||
		result.kind !== input.kind ||
		result.name !== fields.name ||
		result.unit !== fields.unit ||
		(input.code !== undefined && result.code !== input.code.trim()) ||
		result.basePriceMinor !== (input.basePriceMinor ?? null)
	)
		throw invalidContractError()
	return result
}

export function updateCatalogItem(
	accessToken: string,
	workspaceId: string,
	id: string,
	input: UpdateCatalogItemInput
): Promise<CommerceCatalogItem>
export function updateCatalogItem(
	accessToken: string,
	id: string,
	input: UpdateCatalogItemInput & { workspaceId: string }
): Promise<CommerceCatalogItem>
export async function updateCatalogItem(
	accessToken: string,
	workspaceIdOrId: string,
	idOrInput: string | (UpdateCatalogItemInput & { workspaceId: string }),
	inputArgument?: UpdateCatalogItemInput
): Promise<CommerceCatalogItem> {
	const workspaceId =
		typeof idOrInput === 'string' ? workspaceIdOrId : idOrInput.workspaceId
	const id = typeof idOrInput === 'string' ? idOrInput : workspaceIdOrId
	const input = typeof idOrInput === 'string' ? inputArgument! : idOrInput
	validate(
		isUuid(workspaceId) &&
			(input.workspaceId === undefined ||
				input.workspaceId === workspaceId) &&
			(input.schemaVersion === undefined || input.schemaVersion === 1) &&
			isUuid(id) &&
			isUuid(input.commandId) &&
			isPositiveVersion(input.expectedVersion) &&
			(input.kind === undefined || validKind(input.kind)) &&
			isText(input.name, 200) &&
			isText(input.unit, 32) &&
			validPrice(input.basePriceMinor)
	)
	const result = parseCommerceCatalogItemResult(
		await post(
			accessToken,
			workspaceId,
			input.commandId,
			`/crm/sales/commerce/catalog/${id}/update`,
			{
				expectedVersion: input.expectedVersion,
				...(input.kind !== undefined ? { kind: input.kind } : {}),
				name: input.name.trim(),
				unit: input.unit.trim(),
				...(input.basePriceMinor !== undefined
					? { basePriceMinor: input.basePriceMinor }
					: {})
			}
		),
		workspaceId,
		id
	)
	if (
		!result ||
		result.version !== input.expectedVersion + 1 ||
		(input.kind !== undefined && result.kind !== input.kind) ||
		result.name !== input.name.trim() ||
		result.unit !== input.unit.trim() ||
		result.basePriceMinor !== (input.basePriceMinor ?? null)
	)
		throw invalidContractError()
	return result
}

export function archiveCatalogItem(
	accessToken: string,
	workspaceId: string,
	id: string,
	commandId: string,
	expectedVersion: number
): Promise<CommerceCatalogItem>
export function archiveCatalogItem(
	accessToken: string,
	id: string,
	input: {
		workspaceId: string
		commandId: string
		expectedVersion: number
		schemaVersion?: 1
	}
): Promise<CommerceCatalogItem>
export async function archiveCatalogItem(
	accessToken: string,
	workspaceIdOrId: string,
	idOrInput:
		| string
		| {
				workspaceId: string
				commandId: string
				expectedVersion: number
				schemaVersion?: 1
		  },
	commandIdArgument?: string,
	expectedVersionArgument?: number
): Promise<CommerceCatalogItem> {
	const inputForm = typeof idOrInput !== 'string'
	const workspaceId = inputForm ? idOrInput.workspaceId : workspaceIdOrId
	const id = inputForm ? workspaceIdOrId : idOrInput
	const commandId = inputForm ? idOrInput.commandId : commandIdArgument!
	const expectedVersion = inputForm
		? idOrInput.expectedVersion
		: expectedVersionArgument!
	validate(
		isUuid(workspaceId) &&
			isUuid(id) &&
			isUuid(commandId) &&
			isPositiveVersion(expectedVersion) &&
			(!inputForm ||
				idOrInput.schemaVersion === undefined ||
				idOrInput.schemaVersion === 1)
	)
	const result = parseCommerceCatalogItemResult(
		await post(
			accessToken,
			workspaceId,
			commandId,
			`/crm/sales/commerce/catalog/${id}/archive`,
			{ expectedVersion }
		),
		workspaceId,
		id
	)
	if (
		!result ||
		result.version !== expectedVersion + 1 ||
		result.archivedAt === null
	)
		throw invalidContractError()
	return result
}

export const getDealCommerce = async (
	accessToken: string,
	workspaceId: string,
	dealId: string
): Promise<DealCommerce> => {
	validate(isUuid(workspaceId) && isUuid(dealId))
	const result = parseDealCommerce(
		await commerceRequest({
			accessToken,
			method: 'GET',
			url: `/crm/sales/commerce/deals/${dealId}/lines`,
			params: { workspaceId }
		}),
		dealId
	)
	if (!result) throw invalidContractError()
	return result
}

export const replaceDealLines = async (
	accessToken: string,
	workspaceId: string,
	dealId: string,
	input: ReplaceDealLinesInput
): Promise<DealCommerce> => {
	validate(
		isUuid(workspaceId) &&
			isUuid(dealId) &&
			isUuid(input.commandId) &&
			isPositiveVersion(input.expectedVersion) &&
			Array.isArray(input.lines) &&
			input.lines.length <= 100 &&
			validPrice(input.manualAmountMinor) &&
			input.lines.every(
				line =>
					(line.id === undefined || isUuid(line.id)) &&
					(line.catalogItemId === undefined ||
						line.catalogItemId === null ||
						isUuid(line.catalogItemId)) &&
					validKind(line.kind) &&
					isText(line.name, 200) &&
					isText(line.unit, 32) &&
					isCommerceQuantity(line.quantity) &&
					validMoney(line.unitPriceMinor) &&
					validMoney(line.discountMinor)
			)
	)
	const lines = input.lines.map(line => ({
		...(line.id !== undefined ? { id: line.id } : {}),
		...(line.catalogItemId !== undefined
			? { catalogItemId: line.catalogItemId }
			: {}),
		kind: line.kind,
		name: line.name.trim(),
		unit: line.unit.trim(),
		quantity: line.quantity,
		unitPriceMinor: line.unitPriceMinor,
		discountMinor: line.discountMinor
	}))
	const result = parseDealCommerce(
		await post(
			accessToken,
			workspaceId,
			input.commandId,
			`/crm/sales/commerce/deals/${dealId}/lines/replace`,
			{
				expectedVersion: input.expectedVersion,
				lines,
				...(input.manualAmountMinor !== undefined
					? { manualAmountMinor: input.manualAmountMinor }
					: {})
			}
		),
		dealId
	)
	if (
		!result ||
		result.dealVersion !== input.expectedVersion + 1 ||
		result.items.length !== lines.length ||
		result.items.some((item, index) => {
			const submitted = lines[index]
			return (
				(submitted.id !== undefined && item.id !== submitted.id) ||
				item.catalogItemId !== (submitted.catalogItemId ?? null) ||
				item.kind !== submitted.kind ||
				item.name !== submitted.name ||
				item.unit !== submitted.unit ||
				item.quantity !== submitted.quantity ||
				item.unitPriceMinor !== submitted.unitPriceMinor ||
				item.discountMinor !== submitted.discountMinor
			)
		}) ||
		(lines.length === 0 &&
			(result.mode !== 'MANUAL' ||
				result.amountMinor !== (input.manualAmountMinor ?? 0)))
	)
		throw invalidContractError()
	return result
}

export const saveDealLineToCatalog = async (
	accessToken: string,
	workspaceId: string,
	dealId: string,
	lineId: string,
	input: { commandId: string; expectedVersion: number; code?: string }
): Promise<{ item: CommerceCatalogItem; lineId: string }> => {
	validate(
		isUuid(workspaceId) &&
			isUuid(dealId) &&
			isUuid(lineId) &&
			isUuid(input.commandId) &&
			isPositiveVersion(input.expectedVersion) &&
			(input.code === undefined || isText(input.code, 100))
	)
	const result = parseSaveDealLineResult(
		await post(
			accessToken,
			workspaceId,
			input.commandId,
			`/crm/sales/commerce/deals/${dealId}/lines/${lineId}/save-to-catalog`,
			{
				expectedVersion: input.expectedVersion,
				...(input.code !== undefined ? { code: input.code.trim() } : {})
			}
		),
		workspaceId,
		lineId
	)
	if (!result) throw invalidContractError()
	return { item: result, lineId }
}

export const listDealQuotes = async (
	accessToken: string,
	workspaceId: string,
	dealId: string
): Promise<CommerceQuote[]> => {
	validate(isUuid(workspaceId) && isUuid(dealId))
	const result = parseCommerceQuotes(
		await commerceRequest({
			accessToken,
			method: 'GET',
			url: `/crm/sales/commerce/deals/${dealId}/quotes`,
			params: { workspaceId }
		}),
		dealId
	)
	if (!result) throw invalidContractError()
	return result
}

export const createDealQuote = async (
	accessToken: string,
	workspaceId: string,
	dealId: string,
	command: {
		commandId: string
		sellerName: string
		sellerDetails?: string
		customerDetails?: string
	}
): Promise<CommerceQuote> => {
	validate(
		isUuid(workspaceId) &&
			isUuid(dealId) &&
			isUuid(command.commandId) &&
			isText(command.sellerName, 200) &&
			(command.sellerDetails === undefined ||
				isMultilineText(command.sellerDetails, 1000)) &&
			(command.customerDetails === undefined ||
				isMultilineText(command.customerDetails, 1000))
	)
	const response = await post(
		accessToken,
		workspaceId,
		command.commandId,
		`/crm/sales/commerce/deals/${dealId}/quotes`,
		{
			sellerName: command.sellerName.trim(),
			...(command.sellerDetails !== undefined
				? { sellerDetails: normalizeMultiline(command.sellerDetails) }
				: {}),
			...(command.customerDetails !== undefined
				? { customerDetails: normalizeMultiline(command.customerDetails) }
				: {})
		}
	)
	const result =
		isRecord(response) &&
		hasExactKeys(response, ['schemaVersion', 'quote']) &&
		response.schemaVersion === 1
			? parseCommerceQuote(response.quote, dealId)
			: null
	if (
		!result ||
		result.snapshot.sellerName !== command.sellerName.trim() ||
		result.snapshot.sellerDetails !==
			(command.sellerDetails === undefined
				? ''
				: normalizeMultiline(command.sellerDetails)) ||
		result.snapshot.customerDetails !==
			(command.customerDetails === undefined
				? ''
				: normalizeMultiline(command.customerDetails))
	)
		throw invalidContractError()
	return result
}

export const downloadDealQuote = async (
	accessToken: string,
	workspaceId: string,
	dealId: string,
	quoteId: string
): Promise<void> => {
	validate(isUuid(workspaceId) && isUuid(dealId) && isUuid(quoteId))
	const html = await commerceRequest({
		accessToken,
		method: 'GET',
		url: `/crm/sales/commerce/deals/${dealId}/quotes/${quoteId}/download`,
		params: { workspaceId }
	})
	if (
		typeof html !== 'string' ||
		html.length < 20 ||
		html.length > 2_000_000 ||
		!/^<!doctype html>/i.test(html)
	)
		throw invalidContractError()
	const url = URL.createObjectURL(
		new Blob([html], { type: 'text/html;charset=utf-8' })
	)
	try {
		const anchor = document.createElement('a')
		anchor.href = url
		anchor.download = `aerocrm-quote-${quoteId}.html`
		anchor.hidden = true
		document.body.append(anchor)
		anchor.click()
		anchor.remove()
	} finally {
		URL.revokeObjectURL(url)
	}
}

export const getDealPayments = async (
	accessToken: string,
	workspaceId: string,
	dealId: string
): Promise<DealCommercePayments> => {
	validate(isUuid(workspaceId) && isUuid(dealId))
	const result = parseDealCommercePayments(
		await commerceRequest({
			accessToken,
			method: 'GET',
			url: `/crm/sales/commerce/deals/${dealId}/payments`,
			params: { workspaceId }
		}),
		dealId
	)
	if (!result) throw invalidContractError()
	return result
}

export interface CreateDealPaymentInput {
	commandId: string
	kind: 'RECEIPT' | 'REFUND'
	amountMinor: number
	occurredAt: string
	comment?: string
}
export interface CorrectDealPaymentInput {
	commandId: string
	replacement: Omit<CreateDealPaymentInput, 'commandId'>
}
const validPaymentInput = (
	input: Omit<CreateDealPaymentInput, 'commandId'>
) =>
	(input.kind === 'RECEIPT' || input.kind === 'REFUND') &&
	Number.isSafeInteger(input.amountMinor) &&
	input.amountMinor > 0 &&
	input.amountMinor <= MAX_MINOR &&
	typeof input.occurredAt === 'string' &&
	Number.isFinite(Date.parse(input.occurredAt)) &&
	new Date(input.occurredAt).toISOString() === input.occurredAt &&
	(input.comment === undefined ||
		(typeof input.comment === 'string' && input.comment.length <= 1000))
const paymentFields = (
	input: Omit<CreateDealPaymentInput, 'commandId'>
) => ({
	kind: input.kind,
	amountMinor: input.amountMinor,
	occurredAt: input.occurredAt,
	...(input.comment !== undefined ? { comment: input.comment } : {})
})

export const createDealPayment = async (
	accessToken: string,
	workspaceId: string,
	dealId: string,
	input: CreateDealPaymentInput
): Promise<DealCommercePayments> => {
	validate(
		isUuid(workspaceId) &&
			isUuid(dealId) &&
			isUuid(input.commandId) &&
			validPaymentInput(input)
	)
	const result = parseDealCommercePayments(
		await post(
			accessToken,
			workspaceId,
			input.commandId,
			`/crm/sales/commerce/deals/${dealId}/payments`,
			paymentFields(input)
		),
		dealId
	)
	if (!result) throw invalidContractError()
	return result
}

export const correctDealPayment = async (
	accessToken: string,
	workspaceId: string,
	dealId: string,
	paymentId: string,
	input: CorrectDealPaymentInput
): Promise<DealCommercePayments> => {
	validate(
		isUuid(workspaceId) &&
			isUuid(dealId) &&
			isUuid(paymentId) &&
			isUuid(input.commandId) &&
			validPaymentInput(input.replacement)
	)
	const result = parseDealCommercePayments(
		await post(
			accessToken,
			workspaceId,
			input.commandId,
			`/crm/sales/commerce/deals/${dealId}/payments/${paymentId}/correct`,
			{
				replacement: paymentFields(input.replacement)
			}
		),
		dealId
	)
	if (!result) throw invalidContractError()
	return result
}

export const getCommerceAnalytics = async (
	accessToken: string,
	workspaceId: string,
	filters: { from: string; to: string; pipelineId?: string }
): Promise<CommerceAnalytics> => {
	validate(
		isUuid(workspaceId) &&
			isCanonicalDate(filters.from) &&
			isCanonicalDate(filters.to) &&
			Date.parse(filters.from) < Date.parse(filters.to) &&
			Date.parse(filters.to) - Date.parse(filters.from) <=
				366 * 86_400_000 &&
			(filters.pipelineId === undefined || isUuid(filters.pipelineId))
	)
	const result = parseCommerceAnalytics(
		await commerceRequest({
			accessToken,
			method: 'GET',
			url: '/crm/sales/commerce/analytics',
			params: {
				workspaceId,
				from: filters.from,
				to: filters.to,
				...(filters.pipelineId ? { pipelineId: filters.pipelineId } : {})
			}
		})
	)
	if (
		!result ||
		result.pipelineId !== (filters.pipelineId ?? null) ||
		result.from !== filters.from ||
		result.to !== filters.to
	)
		throw invalidContractError()
	return result
}

export const listCommerceHistory = async (
	accessToken: string,
	workspaceId: string,
	dealId?: string
): Promise<CommerceHistoryEvent[]> => {
	validate(isUuid(workspaceId) && (dealId === undefined || isUuid(dealId)))
	const result = parseCommerceHistory(
		await commerceRequest({
			accessToken,
			method: 'GET',
			url: '/crm/sales/commerce/history',
			params: { workspaceId, ...(dealId ? { dealId } : {}) }
		}),
		dealId
	)
	if (!result) throw invalidContractError()
	return result
}

const MAX_COMMERCE_EXPORT_BYTES = 16 * 1024 * 1024
const isRecord = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value)

export const downloadCommerceExport = async (
	accessToken: string,
	workspaceId: string,
	format: 'json' | 'csv'
): Promise<void> => {
	validate(isUuid(workspaceId) && (format === 'json' || format === 'csv'))
	const response = await commerceRequest({
		accessToken,
		method: 'GET',
		url: '/crm/sales/commerce/export',
		params: { workspaceId, format }
	})
	let contents: string
	if (format === 'json') {
		validateResponse(
			isRecord(response) &&
				Object.keys(response).sort().join(',') ===
					'catalog,createdAt,deals,lines,payments,schemaVersion,workspaceId' &&
				response.schemaVersion === 1 &&
				response.workspaceId === workspaceId &&
				isCanonicalDate(response.createdAt) &&
				Array.isArray(response.catalog) &&
				response.catalog.length <= 10_000 &&
				Array.isArray(response.deals) &&
				response.deals.length <= 10_000 &&
				Array.isArray(response.lines) &&
				Array.isArray(response.payments) &&
				response.lines.length + response.payments.length <= 50_000
		)
		contents = JSON.stringify(response)
	} else {
		validateResponse(
			typeof response === 'string' &&
				response.startsWith('\uFEFF"kind","dealId"')
		)
		contents = response
	}
	validateResponse(
		new TextEncoder().encode(contents).byteLength <=
			MAX_COMMERCE_EXPORT_BYTES
	)
	const mimeType =
		format === 'json'
			? 'application/json;charset=utf-8'
			: 'text/csv;charset=utf-8'
	const url = URL.createObjectURL(new Blob([contents], { type: mimeType }))
	try {
		const anchor = document.createElement('a')
		anchor.href = url
		anchor.download = `aerocrm-commerce.${format}`
		anchor.hidden = true
		document.body.append(anchor)
		anchor.click()
		anchor.remove()
	} finally {
		URL.revokeObjectURL(url)
	}
}

type ImportFile = { filename: string; contentBase64: string }
const isValidImportContent = (
	contentBase64: unknown
): contentBase64 is string => {
	if (
		typeof contentBase64 !== 'string' ||
		contentBase64.length === 0 ||
		contentBase64.length > 1_333_344 ||
		contentBase64.length % 4 === 1 ||
		!/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)
	)
		return false
	const padding = contentBase64.endsWith('==')
		? 2
		: contentBase64.endsWith('=')
			? 1
			: 0
	return Math.floor((contentBase64.length * 3) / 4) - padding <= 1_000_000
}

export function inspectCatalogImport(
	accessToken: string,
	workspaceId: string,
	file: ImportFile
): Promise<CommerceImportInspection>
export function inspectCatalogImport(
	accessToken: string,
	file: ImportFile & { workspaceId: string }
): Promise<CommerceImportInspection>
export async function inspectCatalogImport(
	accessToken: string,
	workspaceIdOrFile: string | (ImportFile & { workspaceId: string }),
	fileArgument?: ImportFile
): Promise<CommerceImportInspection> {
	const workspaceId =
		typeof workspaceIdOrFile === 'string'
			? workspaceIdOrFile
			: workspaceIdOrFile.workspaceId
	const file =
		typeof workspaceIdOrFile === 'string'
			? fileArgument!
			: workspaceIdOrFile
	validate(
		isUuid(workspaceId) &&
			isText(file.filename, 200) &&
			isValidImportContent(file.contentBase64)
	)
	const result = parseCommerceImportInspection(
		await commerceRequest({
			accessToken,
			method: 'POST',
			url: '/crm/sales/commerce/import/inspect',
			data: {
				workspaceId,
				filename: file.filename.trim(),
				contentBase64: file.contentBase64
			}
		})
	)
	if (!result || result.filename !== file.filename.trim())
		throw invalidContractError()
	return result
}

type ImportMapping = {
	code: string
	kind: string
	name: string
	unit: string
	basePriceMinor?: string
}
type PreviewImportOptions = {
	sheet?: string
	mapping: ImportMapping
}
export function previewCatalogImport(
	accessToken: string,
	workspaceId: string,
	file: ImportFile,
	options: PreviewImportOptions
): Promise<CommerceImportPreview>
export function previewCatalogImport(
	accessToken: string,
	input: ImportFile & { workspaceId: string } & PreviewImportOptions
): Promise<CommerceImportPreview>
export async function previewCatalogImport(
	accessToken: string,
	workspaceIdOrInput:
		| string
		| (ImportFile & { workspaceId: string } & PreviewImportOptions),
	fileArgument?: ImportFile,
	optionsArgument?: PreviewImportOptions
): Promise<CommerceImportPreview> {
	const compatInput =
		typeof workspaceIdOrInput !== 'string' ? workspaceIdOrInput : undefined
	const workspaceId =
		compatInput?.workspaceId ?? (workspaceIdOrInput as string)
	const file = compatInput ?? fileArgument!
	const options = compatInput ?? optionsArgument!
	const mapping = options.mapping
	validate(
		isUuid(workspaceId) &&
			isText(file.filename, 200) &&
			isValidImportContent(file.contentBase64) &&
			(options.sheet === undefined || isText(options.sheet, 200)) &&
			isText(mapping.code, 200) &&
			isText(mapping.kind, 200) &&
			isText(mapping.name, 200) &&
			isText(mapping.unit, 200) &&
			(mapping.basePriceMinor === undefined ||
				isText(mapping.basePriceMinor, 200))
	)
	const result = parseCommerceImportPreview(
		await commerceRequest({
			accessToken,
			method: 'POST',
			url: '/crm/sales/commerce/import/preview',
			data: {
				workspaceId,
				filename: file.filename.trim(),
				contentBase64: file.contentBase64,
				...(options.sheet ? { sheet: options.sheet.trim() } : {}),
				mapping: {
					code: mapping.code.trim(),
					kind: mapping.kind.trim(),
					name: mapping.name.trim(),
					unit: mapping.unit.trim(),
					...(mapping.basePriceMinor !== undefined
						? { basePriceMinor: mapping.basePriceMinor.trim() }
						: {})
				}
			}
		})
	)
	if (!result) throw invalidContractError()
	return result
}

type ApplyImportCommand = {
	commandId: string
	previewId: string
	workspaceId?: string
	schemaVersion?: 1
}
export function applyCatalogImport(
	accessToken: string,
	workspaceId: string,
	command: ApplyImportCommand
): Promise<CommerceImportApplyResult>
export function applyCatalogImport(
	accessToken: string,
	command: ApplyImportCommand & { workspaceId: string }
): Promise<CommerceImportApplyResult>
export async function applyCatalogImport(
	accessToken: string,
	workspaceIdOrCommand:
		| string
		| (ApplyImportCommand & { workspaceId: string }),
	commandArgument?: ApplyImportCommand
): Promise<CommerceImportApplyResult> {
	const workspaceId =
		typeof workspaceIdOrCommand === 'string'
			? workspaceIdOrCommand
			: workspaceIdOrCommand.workspaceId
	const command =
		typeof workspaceIdOrCommand === 'string'
			? commandArgument!
			: workspaceIdOrCommand
	validate(
		isUuid(workspaceId) &&
			(command.workspaceId === undefined ||
				command.workspaceId === workspaceId) &&
			(command.schemaVersion === undefined ||
				command.schemaVersion === 1) &&
			isUuid(command.commandId) &&
			isUuid(command.previewId)
	)
	const result = parseCommerceImportApplyResult(
		await commerceRequest({
			accessToken,
			method: 'POST',
			url: '/crm/sales/commerce/import/apply',
			headers: commandHeaders(command.commandId),
			data: commandData(workspaceId, command.commandId, {
				previewId: command.previewId
			})
		}),
		command.previewId
	)
	if (!result) throw invalidContractError()
	return result
}

export type { CommercePaymentKind }
