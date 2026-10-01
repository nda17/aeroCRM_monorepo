import {
	hasExactKeys,
	isIsoDate,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'

export type ImportEntity = 'companies' | 'contacts' | 'deals'
export type ImportDecision = {
	row: number
	action: 'SKIP' | 'LINK'
	existingId?: string
	expectedVersion?: number
}
export type ImportSheet = {
	name: string
	headers: string[]
	rowCount: number
	sample: Array<Record<string, string>>
}
export type ImportInspection = {
	schemaVersion: 1
	entity: ImportEntity
	fileDigest: string
	sheets: ImportSheet[]
}
export type ImportRow = {
	row: number
	sourceId: string | null
	action: 'CREATE' | 'LINK' | 'SKIP' | 'ERROR'
	targetId: string | null
	expectedVersion: number | null
	values: Record<string, string | null>
	errors: string[]
	warnings: string[]
	candidates: Array<{ id: string; name: string; version: number }>
}
export type ImportResult = {
	schemaVersion: 1
	previewId: string
	commandId: string
	entity: ImportEntity
	status: 'APPLIED'
	created: number
	linked: number
	skipped: number
	items: Array<{
		row: number
		sourceId: string | null
		entityId: string | null
		action: 'CREATE' | 'LINK' | 'SKIP'
	}>
}
export type ImportPreview = {
	schemaVersion: 1
	workspaceId: string
	previewId: string
	entity: ImportEntity
	sourceKey: string
	expiresAt: string
	rows: ImportRow[]
	summary: { create: number; link: number; skip: number; error: number }
	result: ImportResult | null
}
export type ImportFileInput = {
	schemaVersion: 1
	workspaceId: string
	entity: ImportEntity
	filename: string
	contentBase64: string
}
export type ImportPreviewInput = ImportFileInput & {
	sourceKey: string
	sheet: string
	mapping: Record<string, string>
	options?: {
		teamId?: string
		pipelineId?: string
		stageId?: string
		stageMapping?: Record<string, string>
	}
	decisions?: ImportDecision[]
}
export type ImportApplyInput = {
	schemaVersion: 1
	workspaceId: string
	previewId: string
	commandId: string
}

const isText = (value: unknown, max: number) =>
	typeof value === 'string' && value.length > 0 && value.length <= max
const isCounter = (value: unknown) =>
	Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 500
const isVersion = (value: unknown) =>
	Number.isSafeInteger(value) &&
	Number(value) > 0 &&
	Number(value) <= 2_147_483_646
const isEntity = (value: unknown): value is ImportEntity =>
	value === 'companies' || value === 'contacts' || value === 'deals'
const isNullableText = (value: unknown, max: number) =>
	value === null || isText(value, max)
const utf8Length = (value: string) =>
	new TextEncoder().encode(value).byteLength
const MAX_IMPORT_RESPONSE_BYTES = 16_000_000
const MAX_IMPORT_CELL_LENGTH = 4_000_000

export const parseImportInspection = (
	value: unknown
): ImportInspection | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'entity',
			'fileDigest',
			'sheets'
		]) ||
		value.schemaVersion !== 1 ||
		!isEntity(value.entity) ||
		typeof value.fileDigest !== 'string' ||
		!/^[0-9a-f]{64}$/.test(value.fileDigest) ||
		!Array.isArray(value.sheets) ||
		value.sheets.length < 1 ||
		value.sheets.length > 20
	)
		return null
	const sheets = value.sheets.map((sheet): ImportSheet | null => {
		if (
			!isRecord(sheet) ||
			!hasExactKeys(sheet, ['name', 'headers', 'rowCount', 'sample']) ||
			!isText(sheet.name, 200) ||
			!Array.isArray(sheet.headers) ||
			sheet.headers.length < 1 ||
			sheet.headers.length > 100 ||
			sheet.headers.some(header => !isText(header, 200)) ||
			new Set(sheet.headers).size !== sheet.headers.length ||
			!isCounter(sheet.rowCount) ||
			!Array.isArray(sheet.sample) ||
			sheet.sample.length > 5 ||
			sheet.sample.length > Number(sheet.rowCount)
		)
			return null
		const headers = sheet.headers as string[]
		const name = sheet.name as string
		const rowCount = sheet.rowCount as number
		const samples = sheet.sample.map(sample => {
			if (
				!isRecord(sample) ||
				Object.entries(sample).some(
					([key, cell]) =>
						!headers.includes(key) ||
						typeof cell !== 'string' ||
						cell.length > MAX_IMPORT_CELL_LENGTH
				)
			)
				return null
			return sample as Record<string, string>
		})
		if (samples.some(sample => !sample)) return null
		const sampleBytes = samples.reduce(
			(total, sample) =>
				total +
				Object.entries(sample || {}).reduce(
					(bytes, [key, cell]) =>
						bytes + utf8Length(key) + utf8Length(cell),
					0
				),
			0
		)
		if (sampleBytes > MAX_IMPORT_RESPONSE_BYTES) return null
		return {
			name,
			headers,
			rowCount,
			sample: samples as Array<Record<string, string>>
		}
	})
	if (
		sheets.some(sheet => !sheet) ||
		new Set(sheets.map(sheet => sheet?.name)).size !== sheets.length
	)
		return null
	const inspectionBytes = sheets.reduce(
		(total, sheet) =>
			total +
			(sheet?.sample.reduce(
				(sampleTotal, sample) =>
					sampleTotal +
					Object.entries(sample).reduce(
						(bytes, [key, cell]) =>
							bytes + utf8Length(key) + utf8Length(cell),
						0
					),
				0
			) || 0),
		0
	)
	if (inspectionBytes > MAX_IMPORT_RESPONSE_BYTES) return null
	return {
		schemaVersion: 1,
		entity: value.entity,
		fileDigest: value.fileDigest,
		sheets: sheets as ImportSheet[]
	}
}

const parseResult = (value: unknown): ImportResult | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'previewId',
			'commandId',
			'entity',
			'status',
			'created',
			'linked',
			'skipped',
			'items'
		]) ||
		value.schemaVersion !== 1 ||
		!isUuidV4(value.previewId) ||
		!isUuidV4(value.commandId) ||
		!isEntity(value.entity) ||
		value.status !== 'APPLIED' ||
		!isCounter(value.created) ||
		!isCounter(value.linked) ||
		!isCounter(value.skipped) ||
		!Array.isArray(value.items) ||
		value.items.length > 500
	)
		return null
	const items = value.items.map(item => {
		if (
			!isRecord(item) ||
			!hasExactKeys(item, ['row', 'sourceId', 'entityId', 'action']) ||
			!Number.isSafeInteger(item.row) ||
			Number(item.row) < 2 ||
			Number(item.row) > 1_048_576 ||
			!isNullableText(item.sourceId, MAX_IMPORT_CELL_LENGTH) ||
			!isNullableText(item.entityId, 36) ||
			!['CREATE', 'LINK', 'SKIP'].includes(String(item.action)) ||
			(item.action === 'SKIP'
				? item.entityId !== null && !isUuidV4(item.entityId)
				: !isUuidV4(item.entityId))
		)
			return null
		return item
	})
	const resultBytes = items.reduce(
		(total, item) =>
			total +
			(typeof item?.sourceId === 'string' ? utf8Length(item.sourceId) : 0),
		0
	)
	if (
		items.some(item => !item) ||
		resultBytes > MAX_IMPORT_RESPONSE_BYTES ||
		new Set(items.map(item => item?.row)).size !== items.length ||
		items.filter(item => item?.action === 'CREATE').length !==
			value.created ||
		items.filter(item => item?.action === 'LINK').length !==
			value.linked ||
		items.filter(item => item?.action === 'SKIP').length !== value.skipped
	)
		return null
	return { ...value, items } as unknown as ImportResult
}

export const parseImportResult = (value: unknown): ImportResult | null =>
	parseResult(value)

export const parseImportPreview = (
	value: unknown
): ImportPreview | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'previewId',
			'entity',
			'sourceKey',
			'expiresAt',
			'rows',
			'summary',
			'result'
		]) ||
		value.schemaVersion !== 1 ||
		!isUuidV4(value.workspaceId) ||
		!isUuidV4(value.previewId) ||
		!isEntity(value.entity) ||
		!isText(value.sourceKey, 100) ||
		!isIsoDate(value.expiresAt) ||
		!Array.isArray(value.rows) ||
		value.rows.length > 500 ||
		!isRecord(value.summary) ||
		!hasExactKeys(value.summary, ['create', 'link', 'skip', 'error']) ||
		!isCounter(value.summary.create) ||
		!isCounter(value.summary.link) ||
		!isCounter(value.summary.skip) ||
		!isCounter(value.summary.error)
	)
		return null
	const rows = value.rows.map(row => {
		if (
			!isRecord(row) ||
			!hasExactKeys(row, [
				'row',
				'sourceId',
				'action',
				'targetId',
				'expectedVersion',
				'values',
				'errors',
				'warnings',
				'candidates'
			]) ||
			!Number.isSafeInteger(row.row) ||
			Number(row.row) < 2 ||
			Number(row.row) > 1_048_576 ||
			!isNullableText(row.sourceId, MAX_IMPORT_CELL_LENGTH) ||
			!['CREATE', 'LINK', 'SKIP', 'ERROR'].includes(String(row.action)) ||
			!isNullableText(row.targetId, 36) ||
			!(row.expectedVersion === null || isVersion(row.expectedVersion)) ||
			!isRecord(row.values) ||
			Object.keys(row.values).length > 100 ||
			Object.entries(row.values).some(
				([key, item]) =>
					!isText(key, 207) ||
					!isNullableText(item, MAX_IMPORT_CELL_LENGTH)
			) ||
			!Array.isArray(row.errors) ||
			row.errors.length > 20 ||
			row.errors.some(error => !isText(error, 300)) ||
			!Array.isArray(row.warnings) ||
			row.warnings.length > 20 ||
			row.warnings.some(warning => !isText(warning, 300)) ||
			!Array.isArray(row.candidates) ||
			row.candidates.length > 20
		)
			return null
		const candidates = row.candidates.map(candidate => {
			if (
				!isRecord(candidate) ||
				!hasExactKeys(candidate, ['id', 'name', 'version']) ||
				!isUuidV4(candidate.id) ||
				!isText(candidate.name, 200) ||
				!isVersion(candidate.version)
			)
				return null
			return candidate
		})
		if (candidates.some(candidate => !candidate)) return null
		if (
			row.action === 'LINK' &&
			(!isUuidV4(row.targetId) || !isVersion(row.expectedVersion))
		)
			return null
		if (
			row.action === 'SKIP' &&
			((row.targetId === null) !== (row.expectedVersion === null) ||
				(row.targetId !== null &&
					(!isUuidV4(row.targetId) || !isVersion(row.expectedVersion))))
		)
			return null
		if (
			row.action !== 'LINK' &&
			row.action !== 'SKIP' &&
			(row.targetId !== null || row.expectedVersion !== null)
		)
			return null
		if ((row.action === 'ERROR') !== row.errors.length > 0) return null
		const valueBytes =
			(typeof row.sourceId === 'string' ? utf8Length(row.sourceId) : 0) +
			Object.entries(row.values).reduce(
				(total, [key, cell]) =>
					total +
					utf8Length(key) +
					(typeof cell === 'string' ? utf8Length(cell) : 0),
				0
			)
		if (valueBytes > MAX_IMPORT_RESPONSE_BYTES) return null
		return {
			row: Number(row.row),
			sourceId: row.sourceId as string | null,
			action: row.action as ImportRow['action'],
			targetId: row.targetId as string | null,
			expectedVersion: row.expectedVersion as number | null,
			values: row.values as Record<string, string | null>,
			errors: row.errors as string[],
			warnings: row.warnings as string[],
			candidates: candidates as ImportRow['candidates']
		}
	})
	const rowsBytes = rows.reduce(
		(total, row) =>
			total +
			(typeof row?.sourceId === 'string' ? utf8Length(row.sourceId) : 0) +
			Object.entries(row?.values || {}).reduce(
				(bytes, [key, cell]) =>
					bytes +
					utf8Length(key) +
					(typeof cell === 'string' ? utf8Length(cell) : 0),
				0
			),
		0
	)
	if (
		rows.some(row => !row) ||
		rowsBytes > MAX_IMPORT_RESPONSE_BYTES ||
		new Set(rows.map(row => row?.row)).size !== rows.length ||
		rows.filter(row => row?.action === 'CREATE').length !==
			value.summary.create ||
		rows.filter(row => row?.action === 'LINK').length !==
			value.summary.link ||
		rows.filter(row => row?.action === 'SKIP').length !==
			value.summary.skip ||
		rows.filter(row => row?.action === 'ERROR').length !==
			value.summary.error
	)
		return null
	const result = value.result === null ? null : parseResult(value.result)
	if (
		value.result !== null &&
		(!result ||
			result.previewId !== value.previewId ||
			result.entity !== value.entity)
	)
		return null
	return { ...value, rows, result } as unknown as ImportPreview
}
