import {
	hasExactKeys,
	isIsoDate,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'

export type CommerceKind = 'PRODUCT' | 'SERVICE'
export type CommerceDealState = 'OPEN' | 'WON' | 'LOST'
export type CommerceLineMode = 'MANUAL' | 'LINES'

export interface ManagedPipelineStage {
	id: string
	key: string
	name: string
	position: number
	state: CommerceDealState
}
export interface ManagedPipeline {
	id: string
	workspaceId: string
	name: string
	version: number
	templateKey: string
	templateVersion: number
	stages: ManagedPipelineStage[]
}
export interface CommerceCatalogItem {
	id: string
	workspaceId: string
	code: string
	kind: CommerceKind
	name: string
	unit: string
	basePriceMinor: number | null
	version: number
	archivedAt: string | null
	createdAt: string
	updatedAt: string
}
export interface CommerceCatalogPage {
	schemaVersion: 1
	workspaceId: string
	total: number
	page: number
	pageSize: number
	items: CommerceCatalogItem[]
}
export interface CommerceDealLine {
	id: string
	catalogItemId: string | null
	kind: CommerceKind
	name: string
	unit: string
	quantity: string
	unitPriceMinor: number
	discountMinor: number
	totalMinor: number
}
export interface DealCommerce {
	schemaVersion: 1
	dealId: string
	dealVersion: number
	mode: CommerceLineMode
	amountMinor: number
	items: CommerceDealLine[]
}
export type CommerceQuoteLine = Omit<CommerceDealLine, 'catalogItemId'>
export interface CommerceQuote {
	id: string
	dealId: string
	version: number
	snapshot: {
		schemaVersion: 1
		quoteVersion: number
		dealVersion: number
		dealId: string
		sellerName: string
		sellerDetails: string
		customerName: string
		customerDetails: string
		dealTitle: string
		currency: 'RUB'
		amountMinor: number
		lines: CommerceQuoteLine[]
	}
	createdBySubject: string
	createdAt: string
}
export type CommercePaymentKind =
	| 'RECEIPT'
	| 'REFUND'
	| 'VOID_RECEIPT'
	| 'VOID_REFUND'
export interface CommercePayment {
	id: string
	kind: CommercePaymentKind
	amountMinor: number
	occurredAt: string
	comment: string
	correctsPaymentId: string | null
	createdBySubject: string
	createdAt: string
}
export interface DealCommercePayments {
	schemaVersion: 1
	dealId: string
	dealVersion: number
	amountMinor: number
	netPaidMinor: number
	balanceMinor: number
	overpaidMinor: number
	items: CommercePayment[]
}
export interface CommerceAnalytics {
	schemaVersion: 1
	currency: 'RUB'
	from: string
	to: string
	pipelineId: string | null
	dealValueMinor: string
	receiptsMinor: string
	refundsMinor: string
	netPaidMinor: string
}
export interface CommerceHistoryEvent {
	id: string
	kind: string
	dealId: string | null
	actorSubject: string
	details: Record<string, unknown>
	createdAt: string
}
export interface CommerceImportInspection {
	schemaVersion: 1
	filename: string
	digest: string
	sheets: Array<{
		name: string
		headers: string[]
		rowCount: number
		sample: Array<Record<string, string>>
	}>
}
export interface CommerceImportRow {
	row: number
	code: string
	kind: string
	name: string
	unit: string
	basePriceMinor: number | null
	action: 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'ERROR'
	errors: string[]
	expectedVersion: number | null
}
export interface CommerceImportPreview {
	schemaVersion: 1
	previewId: string
	expiresAt: string
	rows: CommerceImportRow[]
	summary: {
		created: number
		updated: number
		unchanged: number
		errors: number
	}
}
export interface CommerceImportApplyResult {
	schemaVersion: 1
	previewId: string
	created: number
	updated: number
	unchanged: number
}

const MAX_MINOR = 2_147_483_647
const isSafeNumber = (value: unknown): value is number =>
	typeof value === 'number' && Number.isSafeInteger(value)
const isVersion = (value: unknown): value is number =>
	Number.isSafeInteger(value) &&
	Number(value) > 0 &&
	Number(value) <= MAX_MINOR
const isCounter = (value: unknown): value is number =>
	Number.isSafeInteger(value) &&
	Number(value) >= 0 &&
	Number(value) <= MAX_MINOR
const isMinor = (value: unknown): value is number => isCounter(value)
const isOptionalText = (value: unknown, max: number) =>
	typeof value === 'string' &&
	value.length <= max &&
	!/\x00|[\x01-\x1f\x7f]/.test(value)
const isNullableMinor = (value: unknown): value is number | null =>
	value === null || isMinor(value)
const isNullableDate = (value: unknown) =>
	value === null || isIsoDate(value)
const isState = (value: unknown): value is CommerceDealState =>
	value === 'OPEN' || value === 'WON' || value === 'LOST'
const isKind = (value: unknown): value is CommerceKind =>
	value === 'PRODUCT' || value === 'SERVICE'
const isQuantity = (value: unknown): value is string =>
	typeof value === 'string' &&
	/^(?:0|[1-9]\d{0,8})\.\d{3}$/.test(value) &&
	Number(value) > 0
const quantityMilli = (value: string) => {
	const [whole, fraction] = value.split('.')
	return BigInt(whole) * 1000n + BigInt(fraction)
}

const parseStage = (value: unknown): ManagedPipelineStage | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['id', 'key', 'name', 'position', 'state']) ||
		!isUuidV4(value.id) ||
		!isNonEmptyString(value.key, 64) ||
		!isNonEmptyString(value.name, 200) ||
		!isSafeNumber(value.position) ||
		Number(value.position) < 1 ||
		Number(value.position) > 100 ||
		!isState(value.state)
	)
		return null
	return {
		id: value.id,
		key: value.key,
		name: value.name,
		position: value.position,
		state: value.state
	}
}

export const parseManagedPipeline = (
	value: unknown,
	workspaceId: string
): ManagedPipeline | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'id',
			'workspaceId',
			'name',
			'version',
			'templateKey',
			'templateVersion',
			'stages'
		]) ||
		!isUuidV4(value.id) ||
		!isUuidV4(value.workspaceId) ||
		value.workspaceId !== workspaceId ||
		!isNonEmptyString(value.name, 200) ||
		!isVersion(value.version) ||
		!isNonEmptyString(value.templateKey, 64) ||
		!isVersion(value.templateVersion) ||
		!Array.isArray(value.stages) ||
		value.stages.length < 3 ||
		value.stages.length > 100
	)
		return null
	const stages = value.stages.map(parseStage)
	if (
		stages.some(stage => !stage) ||
		new Set(stages.map(stage => stage?.id)).size !== stages.length ||
		new Set(stages.map(stage => stage?.key)).size !== stages.length ||
		new Set(stages.map(stage => stage?.position)).size !== stages.length ||
		[...stages]
			.sort((left, right) => left!.position - right!.position)
			.some((stage, index) => stage!.position !== index + 1)
	)
		return null
	return {
		id: value.id,
		workspaceId: value.workspaceId,
		name: value.name,
		version: value.version,
		templateKey: value.templateKey,
		templateVersion: value.templateVersion,
		stages: stages as ManagedPipelineStage[]
	}
}

export const parseManagedPipelines = (
	value: unknown,
	workspaceId: string
): ManagedPipeline[] | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'workspaceId', 'items']) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		!Array.isArray(value.items) ||
		value.items.length > 1000
	)
		return null
	const items = value.items.map(item =>
		parseManagedPipeline(item, workspaceId)
	)
	if (
		items.some(item => !item) ||
		new Set(items.map(item => item?.id)).size !== items.length
	)
		return null
	return items as ManagedPipeline[]
}

export const parseManagedPipelineResult = (
	value: unknown,
	workspaceId: string,
	id?: string
): ManagedPipeline | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'pipeline']) ||
		value.schemaVersion !== 1
	)
		return null
	const pipeline = parseManagedPipeline(value.pipeline, workspaceId)
	return pipeline && (!id || pipeline.id === id) ? pipeline : null
}

export const parseCommerceCatalogItem = (
	value: unknown,
	workspaceId: string,
	id?: string
): CommerceCatalogItem | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'id',
			'workspaceId',
			'code',
			'kind',
			'name',
			'unit',
			'basePriceMinor',
			'version',
			'archivedAt',
			'createdAt',
			'updatedAt'
		]) ||
		!isUuidV4(value.id) ||
		(id !== undefined && value.id !== id) ||
		!isUuidV4(value.workspaceId) ||
		value.workspaceId !== workspaceId ||
		!isNonEmptyString(value.code, 100) ||
		!isKind(value.kind) ||
		!isNonEmptyString(value.name, 200) ||
		!isNonEmptyString(value.unit, 32) ||
		!isNullableMinor(value.basePriceMinor) ||
		!isVersion(value.version) ||
		!isNullableDate(value.archivedAt) ||
		!isIsoDate(value.createdAt) ||
		!isIsoDate(value.updatedAt)
	)
		return null
	return value as unknown as CommerceCatalogItem
}

export const parseCommerceCatalogPage = (
	value: unknown,
	workspaceId: string,
	page: number,
	pageSize: number
): CommerceCatalogPage | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'total',
			'page',
			'pageSize',
			'items'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		value.page !== page ||
		value.pageSize !== pageSize ||
		!isCounter(value.total) ||
		!Array.isArray(value.items) ||
		value.items.length > pageSize ||
		value.items.length > Number(value.total)
	)
		return null
	const items = value.items.map(item =>
		parseCommerceCatalogItem(item, workspaceId)
	)
	if (
		items.some(item => !item) ||
		new Set(items.map(item => item?.id)).size !== items.length
	)
		return null
	return {
		schemaVersion: 1,
		workspaceId,
		total: value.total,
		page,
		pageSize,
		items: items as CommerceCatalogItem[]
	}
}

export const parseCommerceCatalogItemResult = (
	value: unknown,
	workspaceId: string,
	id?: string
): CommerceCatalogItem | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'item']) ||
		value.schemaVersion !== 1
	)
		return null
	return parseCommerceCatalogItem(value.item, workspaceId, id)
}

const parseDealLine = (value: unknown): CommerceDealLine | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'id',
			'catalogItemId',
			'kind',
			'name',
			'unit',
			'quantity',
			'unitPriceMinor',
			'discountMinor',
			'totalMinor'
		]) ||
		!isUuidV4(value.id) ||
		!(value.catalogItemId === null || isUuidV4(value.catalogItemId)) ||
		!isKind(value.kind) ||
		!isNonEmptyString(value.name, 200) ||
		!isNonEmptyString(value.unit, 32) ||
		!isQuantity(value.quantity) ||
		!isMinor(value.unitPriceMinor) ||
		Number(value.unitPriceMinor) < 0 ||
		!isMinor(value.discountMinor) ||
		!isMinor(value.totalMinor)
	)
		return null
	const gross =
		(quantityMilli(value.quantity) * BigInt(value.unitPriceMinor) + 500n) /
		1000n
	if (
		gross > BigInt(MAX_MINOR) ||
		BigInt(value.discountMinor) > gross ||
		BigInt(value.totalMinor) !== gross - BigInt(value.discountMinor)
	)
		return null
	return value as unknown as CommerceDealLine
}

export const parseDealCommerce = (
	value: unknown,
	dealId: string
): DealCommerce | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'dealId',
			'dealVersion',
			'mode',
			'amountMinor',
			'items'
		]) ||
		value.schemaVersion !== 1 ||
		value.dealId !== dealId ||
		!isUuidV4(value.dealId) ||
		!isVersion(value.dealVersion) ||
		(value.mode !== 'MANUAL' && value.mode !== 'LINES') ||
		!isMinor(value.amountMinor) ||
		!Array.isArray(value.items) ||
		value.items.length > 100 ||
		(value.mode === 'MANUAL' && value.items.length !== 0) ||
		(value.mode === 'LINES' && value.items.length === 0)
	)
		return null
	const items = value.items.map(parseDealLine)
	const total = items.reduce(
		(sum, item) => sum + BigInt(item?.totalMinor ?? 0),
		0n
	)
	if (
		items.some(item => !item) ||
		new Set(items.map(item => item?.id)).size !== items.length ||
		total > BigInt(MAX_MINOR) ||
		(value.mode === 'LINES' && total !== BigInt(value.amountMinor))
	)
		return null
	return { ...value, items: items as CommerceDealLine[] } as DealCommerce
}

export const parseSaveDealLineResult = (
	value: unknown,
	workspaceId: string,
	lineId: string
): CommerceCatalogItem | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'item', 'lineId']) ||
		value.schemaVersion !== 1 ||
		value.lineId !== lineId
	)
		return null
	return parseCommerceCatalogItem(value.item, workspaceId)
}

const parseQuoteLine = (value: unknown): CommerceQuoteLine | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'id',
			'kind',
			'name',
			'unit',
			'quantity',
			'unitPriceMinor',
			'discountMinor',
			'totalMinor'
		]) ||
		!isUuidV4(value.id) ||
		!isKind(value.kind) ||
		!isNonEmptyString(value.name, 200) ||
		!isNonEmptyString(value.unit, 32) ||
		!isQuantity(value.quantity) ||
		!isMinor(value.unitPriceMinor) ||
		Number(value.unitPriceMinor) < 0 ||
		!isMinor(value.discountMinor) ||
		!isMinor(value.totalMinor)
	)
		return null
	const gross =
		(quantityMilli(value.quantity) * BigInt(value.unitPriceMinor) + 500n) /
		1000n
	if (
		gross > BigInt(MAX_MINOR) ||
		BigInt(value.discountMinor) > gross ||
		BigInt(value.totalMinor) !== gross - BigInt(value.discountMinor)
	)
		return null
	return value as unknown as CommerceQuoteLine
}

export const parseCommerceQuote = (
	value: unknown,
	dealId: string
): CommerceQuote | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'id',
			'dealId',
			'version',
			'snapshot',
			'createdBySubject',
			'createdAt'
		]) ||
		!isUuidV4(value.id) ||
		value.dealId !== dealId ||
		!isVersion(value.version) ||
		!isRecord(value.snapshot) ||
		!hasExactKeys(value.snapshot, [
			'schemaVersion',
			'quoteVersion',
			'dealVersion',
			'dealId',
			'sellerName',
			'sellerDetails',
			'customerName',
			'customerDetails',
			'dealTitle',
			'currency',
			'amountMinor',
			'lines'
		]) ||
		value.snapshot.schemaVersion !== 1 ||
		value.snapshot.quoteVersion !== value.version ||
		!isVersion(value.snapshot.dealVersion) ||
		value.snapshot.dealId !== dealId ||
		!isNonEmptyString(value.snapshot.sellerName, 200) ||
		!isOptionalText(value.snapshot.sellerDetails, 1000) ||
		!isNonEmptyString(value.snapshot.customerName, 200) ||
		!isOptionalText(value.snapshot.customerDetails, 1000) ||
		!isNonEmptyString(value.snapshot.dealTitle, 200) ||
		value.snapshot.currency !== 'RUB' ||
		!isMinor(value.snapshot.amountMinor) ||
		!Array.isArray(value.snapshot.lines) ||
		value.snapshot.lines.length < 1 ||
		value.snapshot.lines.length > 100 ||
		!isNonEmptyString(value.createdBySubject, 256) ||
		!isIsoDate(value.createdAt)
	)
		return null
	const lines = value.snapshot.lines.map(parseQuoteLine)
	const sum = lines.reduce(
		(total, line) => total + BigInt(line?.totalMinor ?? 0),
		0n
	)
	if (
		lines.some(line => !line) ||
		new Set(lines.map(line => line?.id)).size !== lines.length ||
		sum > BigInt(MAX_MINOR) ||
		sum !== BigInt(value.snapshot.amountMinor)
	)
		return null
	return {
		...value,
		snapshot: { ...value.snapshot, lines: lines as CommerceQuoteLine[] }
	} as unknown as CommerceQuote
}

export const parseCommerceQuotes = (
	value: unknown,
	dealId: string
): CommerceQuote[] | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'dealId', 'items']) ||
		value.schemaVersion !== 1 ||
		value.dealId !== dealId ||
		!Array.isArray(value.items) ||
		value.items.length > 1000
	)
		return null
	const items = value.items.map(item => parseCommerceQuote(item, dealId))
	if (
		items.some(item => !item) ||
		new Set(items.map(item => item?.id)).size !== items.length ||
		new Set(items.map(item => item?.version)).size !== items.length
	)
		return null
	return items as CommerceQuote[]
}

export const parseCommerceHistory = (
	value: unknown,
	dealId?: string
): CommerceHistoryEvent[] | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'items']) ||
		value.schemaVersion !== 1 ||
		!Array.isArray(value.items) ||
		value.items.length > 100
	)
		return null
	const items = value.items
	if (
		items.some(
			item =>
				!isRecord(item) ||
				!hasExactKeys(item, [
					'id',
					'kind',
					'dealId',
					'actorSubject',
					'details',
					'createdAt'
				]) ||
				!isUuidV4(item.id) ||
				!isNonEmptyString(item.kind, 40) ||
				!(item.dealId === null || isUuidV4(item.dealId)) ||
				(dealId !== undefined ? item.dealId !== dealId : item.dealId !== null) ||
				!isNonEmptyString(item.actorSubject, 256) ||
				!isRecord(item.details) ||
				!isIsoDate(item.createdAt)
		)
	)
		return null
	const ids = items.map(item => (item as Record<string, unknown>).id)
	if (new Set(ids).size !== ids.length) return null
	return items as unknown as CommerceHistoryEvent[]
}

const parsePayment = (value: unknown): CommercePayment | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'id',
			'kind',
			'amountMinor',
			'occurredAt',
			'comment',
			'correctsPaymentId',
			'createdBySubject',
			'createdAt'
		]) ||
		!isUuidV4(value.id) ||
		!['RECEIPT', 'REFUND', 'VOID_RECEIPT', 'VOID_REFUND'].includes(
			String(value.kind)
		) ||
		!isVersion(value.amountMinor) ||
		!isIsoDate(value.occurredAt) ||
		typeof value.comment !== 'string' ||
		value.comment.length > 1000 ||
		!(
			value.correctsPaymentId === null || isUuidV4(value.correctsPaymentId)
		) ||
		!isNonEmptyString(value.createdBySubject, 256) ||
		!isIsoDate(value.createdAt) ||
		(value.kind === 'RECEIPT' || value.kind === 'REFUND'
			? value.correctsPaymentId !== null
			: value.correctsPaymentId === null)
	)
		return null
	return value as unknown as CommercePayment
}

export const parseDealCommercePayments = (
	value: unknown,
	dealId: string
): DealCommercePayments | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'dealId',
			'dealVersion',
			'amountMinor',
			'netPaidMinor',
			'balanceMinor',
			'overpaidMinor',
			'items'
		]) ||
		value.schemaVersion !== 1 ||
		value.dealId !== dealId ||
		!isVersion(value.dealVersion) ||
		!isMinor(value.amountMinor) ||
		!isMinor(value.netPaidMinor) ||
		!isMinor(value.balanceMinor) ||
		!isMinor(value.overpaidMinor) ||
		!Array.isArray(value.items) ||
		value.items.length > 10000
	)
		return null
	const items = value.items.map(parsePayment)
	if (
		items.some(item => !item) ||
		new Set(items.map(item => item?.id)).size !== items.length
	)
		return null
	const paymentsById = new Map(items.map(item => [item!.id, item!]))
	const corrected = items.filter(item => item?.correctsPaymentId !== null)
	if (
		corrected.some(item => {
			const original = paymentsById.get(item!.correctsPaymentId!)
			return (
				!original ||
				(item!.kind === 'VOID_RECEIPT' && original.kind !== 'RECEIPT') ||
				(item!.kind === 'VOID_REFUND' && original.kind !== 'REFUND')
			)
		}) ||
		new Set(corrected.map(item => item?.correctsPaymentId)).size !==
			corrected.length
	)
		return null
	const net = items.reduce(
		(sum, item) =>
			sum +
			(item?.kind === 'RECEIPT' || item?.kind === 'VOID_REFUND'
				? Number(item.amountMinor)
				: -Number(item?.amountMinor ?? 0)),
		0
	)
	if (
		net !== value.netPaidMinor ||
		Math.max(Number(value.amountMinor) - net, 0) !== value.balanceMinor ||
		Math.max(net - Number(value.amountMinor), 0) !== value.overpaidMinor
	)
		return null
	return {
		...value,
		items: items as CommercePayment[]
	} as DealCommercePayments
}

export const parseCommerceAnalytics = (
	value: unknown
): CommerceAnalytics | null => {
	const isBigMoney = (candidate: unknown): candidate is string =>
		typeof candidate === 'string' &&
		/^(?:0|[1-9]\d{0,30})$/.test(candidate)
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'currency',
			'from',
			'to',
			'pipelineId',
			'dealValueMinor',
			'receiptsMinor',
			'refundsMinor',
			'netPaidMinor'
		]) ||
		value.schemaVersion !== 1 ||
		value.currency !== 'RUB' ||
		!isIsoDate(value.from) ||
		!isIsoDate(value.to) ||
		Date.parse(value.from) >= Date.parse(value.to) ||
		!(value.pipelineId === null || isUuidV4(value.pipelineId)) ||
		!isBigMoney(value.dealValueMinor) ||
		!isBigMoney(value.receiptsMinor) ||
		!isBigMoney(value.refundsMinor) ||
		!isBigMoney(value.netPaidMinor) ||
		BigInt(value.receiptsMinor) - BigInt(value.refundsMinor) !==
			BigInt(value.netPaidMinor)
	)
		return null
	return value as unknown as CommerceAnalytics
}

export const parseCommerceImportInspection = (
	value: unknown
): CommerceImportInspection | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'filename',
			'digest',
			'sheets'
		]) ||
		value.schemaVersion !== 1 ||
		!isNonEmptyString(value.filename, 200) ||
		typeof value.digest !== 'string' ||
		!/^[0-9a-f]{64}$/.test(value.digest) ||
		!Array.isArray(value.sheets) ||
		value.sheets.length < 1 ||
		value.sheets.length > 20
	)
		return null
	const sheets = value.sheets.map(
		(sheet): CommerceImportInspection['sheets'][number] | null => {
			if (
				!isRecord(sheet) ||
				!hasExactKeys(sheet, ['name', 'headers', 'rowCount', 'sample']) ||
				!isNonEmptyString(sheet.name, 200) ||
				!Array.isArray(sheet.headers) ||
				sheet.headers.length > 100 ||
				sheet.headers.some(header => !isNonEmptyString(header, 200)) ||
				new Set(sheet.headers).size !== sheet.headers.length ||
				!isCounter(sheet.rowCount) ||
				!Array.isArray(sheet.sample) ||
				sheet.sample.length > 5 ||
				sheet.sample.length > Number(sheet.rowCount)
			)
				return null
			const headers = sheet.headers as unknown[]
			const sample = sheet.sample.map(row => {
				if (
					!isRecord(row) ||
					Object.keys(row).length > 100 ||
					Object.entries(row).some(
						([key, item]) =>
							!headers.includes(key) || typeof item !== 'string'
					)
				)
					return null
				return row as Record<string, string>
			})
			return sample.some(row => !row)
				? null
				: {
						name: sheet.name as string,
						headers: sheet.headers as string[],
						rowCount: sheet.rowCount as number,
						sample: sample as Array<Record<string, string>>
					}
		}
	)
	if (
		sheets.some(sheet => !sheet) ||
		new Set(sheets.map(sheet => sheet?.name)).size !== sheets.length
	)
		return null
	return {
		...value,
		sheets: sheets as CommerceImportInspection['sheets']
	} as CommerceImportInspection
}

const parseImportRow = (value: unknown): CommerceImportRow | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'row',
			'code',
			'kind',
			'name',
			'unit',
			'basePriceMinor',
			'action',
			'errors',
			'expectedVersion'
		]) ||
		!Number.isSafeInteger(value.row) ||
		Number(value.row) < 2 ||
		Number(value.row) > 501 ||
		typeof value.code !== 'string' ||
		value.code.length > 1000 ||
		typeof value.kind !== 'string' ||
		value.kind.length > 1000 ||
		typeof value.name !== 'string' ||
		value.name.length > 4000 ||
		typeof value.unit !== 'string' ||
		value.unit.length > 1000 ||
		!isNullableMinor(value.basePriceMinor) ||
		!['CREATE', 'UPDATE', 'UNCHANGED', 'ERROR'].includes(
			String(value.action)
		) ||
		!Array.isArray(value.errors) ||
		value.errors.length > 20 ||
		value.errors.some(
			error => typeof error !== 'string' || error.length > 300
		) ||
		!(value.expectedVersion === null || isVersion(value.expectedVersion))
	)
		return null
	if ((value.action === 'ERROR') !== value.errors.length > 0) return null
	if (
		value.action !== 'ERROR' &&
		(!['PRODUCT', 'SERVICE'].includes(value.kind) ||
			value.code.length < 1 ||
			value.code.length > 100 ||
			value.name.trim().length < 1 ||
			value.name.length > 200 ||
			value.unit.trim().length < 1 ||
			value.unit.length > 32)
	)
		return null
	return value as unknown as CommerceImportRow
}

export const parseCommerceImportPreview = (
	value: unknown
): CommerceImportPreview | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'previewId',
			'expiresAt',
			'rows',
			'summary'
		]) ||
		value.schemaVersion !== 1 ||
		!isUuidV4(value.previewId) ||
		!isIsoDate(value.expiresAt) ||
		!Array.isArray(value.rows) ||
		value.rows.length > 500 ||
		!isRecord(value.summary) ||
		!hasExactKeys(value.summary, [
			'created',
			'updated',
			'unchanged',
			'errors'
		]) ||
		!isCounter(value.summary.created) ||
		!isCounter(value.summary.updated) ||
		!isCounter(value.summary.unchanged) ||
		!isCounter(value.summary.errors)
	)
		return null
	const rows = value.rows.map(parseImportRow)
	if (
		rows.some(row => !row) ||
		new Set(rows.map(row => row?.row)).size !== rows.length ||
		rows.filter(row => row?.action === 'CREATE').length !==
			value.summary.created ||
		rows.filter(row => row?.action === 'UPDATE').length !==
			value.summary.updated ||
		rows.filter(row => row?.action === 'UNCHANGED').length !==
			value.summary.unchanged ||
		rows.filter(row => row?.action === 'ERROR').length !==
			value.summary.errors
	)
		return null
	return {
		...value,
		rows: rows as CommerceImportRow[]
	} as CommerceImportPreview
}

export const parseCommerceImportApplyResult = (
	value: unknown,
	previewId: string
): CommerceImportApplyResult | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'previewId',
			'created',
			'updated',
			'unchanged'
		]) ||
		value.schemaVersion !== 1 ||
		value.previewId !== previewId ||
		!isUuidV4(value.previewId) ||
		!isCounter(value.created) ||
		!isCounter(value.updated) ||
		!isCounter(value.unchanged)
	)
		return null
	return value as unknown as CommerceImportApplyResult
}

export const isCommerceMoney = (value: unknown): value is number =>
	isMinor(value)
export const isCommerceQuantity = (value: unknown): value is string =>
	isQuantity(value)
