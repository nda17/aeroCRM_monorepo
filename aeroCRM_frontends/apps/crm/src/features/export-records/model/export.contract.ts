import {
	parseCompanyV2,
	parseContactV2,
	parseCustomer
} from '@/entities/customer'
import { parseInboxEntry } from '@/entities/intake'
import {
	isSalesExportDeal,
	parseSalesTask,
	salesExportDealColumns
} from '@/entities/sales'
import type { DownloadFormat } from '@/shared/api/authenticated-download'
import { invalidContractError } from '@/shared/api/authenticated-http-client'
import {
	hasExactKeys,
	isIsoDate,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'

export type ExportEntity =
	| 'contacts'
	| 'companies'
	| 'deals'
	| 'tasks'
	| 'inbox'
export const exportNames: Record<ExportEntity, string> = {
	contacts: 'контактов',
	companies: 'компаний',
	deals: 'сделок',
	tasks: 'задач',
	inbox: 'входящих обращений'
}
const customerBase = [
	'id',
	'workspaceId',
	'name',
	'notes',
	'createdBySubject',
	'teamId',
	'version',
	'archivedAt',
	'createdAt',
	'updatedAt'
]
export const exportColumns: Record<ExportEntity, readonly string[]> = {
	contacts: [...customerBase, 'phone', 'email', 'companyId'],
	companies: [...customerBase, 'inn', 'website'],
	deals: salesExportDealColumns,
	tasks: [
		'id',
		'workspaceId',
		'dealId',
		'version',
		'title',
		'dueAt',
		'status',
		'assignedToSubject',
		'completedAt',
		'createdAt',
		'updatedAt'
	],
	inbox: [
		'id',
		'workspaceId',
		'title',
		'name',
		'phone',
		'email',
		'message',
		'origin',
		'sourceId',
		'status',
		'createdBySubject',
		'teamId',
		'version',
		'contactId',
		'dealId',
		'rejectionReason',
		'receivedAt',
		'updatedAt',
		'acceptedAt',
		'rejectedAt'
	]
}
export interface ExportMetadata {
	schemaVersion?: 1 | 2
	entity: ExportEntity
	format: DownloadFormat
	workspaceId: string
	filename: string
	mediaType: string
	snapshotAt: string
	rowCount: number
	bytes: number
}
export const companyExportV2Columns = [
	...exportColumns.companies,
	'legalName',
	'kpp',
	'ogrn',
	'legalAddress',
	'entityType'
] as const
export const contactExportV2Columns = [
	...exportColumns.contacts,
	'timeZone',
	'preferredCallStart',
	'preferredCallEnd'
] as const
const decimal = (value: string | null, max: number) =>
	value !== null &&
	/^(?:0|[1-9][0-9]*)$/.test(value) &&
	Number.isSafeInteger(Number(value)) &&
	Number(value) <= max
export const exportActorHash = async (subject: string) => {
	if (!isNonEmptyString(subject, 256)) throw invalidContractError()
	const hash = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(subject)
	)
	return [...new Uint8Array(hash)]
		.map(byte => byte.toString(16).padStart(2, '0'))
		.join('')
}
export const parseExportHeaders = (
	headers: Headers,
	entity: ExportEntity,
	format: DownloadFormat,
	workspaceId: string,
	actorHash: string,
	schemaVersion: 1 | 2 = 1
): ExportMetadata => {
	const rowCount = headers.get('X-WinCRM-Export-Rows')
	const bytes = headers.get('X-WinCRM-Export-Bytes')
	const snapshotAt = headers.get('X-WinCRM-Export-Snapshot-At')
	const filename = `wincrm-${entity}.${format}`
	const mediaType =
		format === 'csv'
			? 'text/csv; charset=utf-8'
			: 'application/json; charset=utf-8'
	if (
		!Object.hasOwn(exportColumns, entity) ||
		![1, 2].includes(schemaVersion) ||
		(schemaVersion === 2 &&
			entity !== 'companies' &&
			entity !== 'contacts') ||
		!['json', 'csv'].includes(format) ||
		!isUuidV4(workspaceId) ||
		!decimal(rowCount, 10000) ||
		!decimal(bytes, 16 * 1024 * 1024) ||
		Number(bytes) < 1 ||
		!isIsoDate(snapshotAt) ||
		!/^[a-f0-9]{64}$/.test(actorHash) ||
		headers.get('X-WinCRM-Export-Actor-SHA256') !== actorHash ||
		headers.get('X-WinCRM-Workspace-Id') !== workspaceId ||
		headers.get('X-WinCRM-Export-Entity') !== entity ||
		headers.get('X-WinCRM-Export-Schema') !== String(schemaVersion) ||
		headers.get('Content-Type')?.toLowerCase() !== mediaType ||
		headers.get('Content-Disposition') !==
			`attachment; filename="${filename}"` ||
		headers.get('Cache-Control')?.toLowerCase() !== 'no-store' ||
		headers.get('X-Content-Type-Options')?.toLowerCase() !== 'nosniff'
	)
		throw invalidContractError()
	return {
		...(schemaVersion === 2 ? { schemaVersion } : {}),
		entity,
		format,
		workspaceId,
		filename,
		mediaType,
		snapshotAt,
		rowCount: Number(rowCount),
		bytes: Number(bytes)
	}
}
const validItem = (
	value: unknown,
	entity: ExportEntity,
	workspaceId: string,
	schemaVersion: 1 | 2 = 1
) => {
	if (schemaVersion === 2)
		return entity === 'contacts'
			? parseContactV2(value, workspaceId) !== null
			: entity === 'companies' &&
					parseCompanyV2(value, workspaceId) !== null
	switch (entity) {
		case 'contacts':
		case 'companies':
			return parseCustomer(value, entity, workspaceId) !== null
		case 'tasks':
			return parseSalesTask(value, workspaceId) !== null
		case 'deals':
			return isSalesExportDeal(value, workspaceId)
		case 'inbox':
			return parseInboxEntry(value, workspaceId) !== null
	}
}
const checkJson = (text: string, metadata: ExportMetadata) => {
	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch {
		throw invalidContractError()
	}
	if (
		!isRecord(parsed) ||
		!hasExactKeys(parsed, [
			'schemaVersion',
			'workspaceId',
			'entity',
			'snapshotAt',
			'rowCount',
			'items'
		]) ||
		parsed.schemaVersion !== (metadata.schemaVersion ?? 1) ||
		parsed.workspaceId !== metadata.workspaceId ||
		parsed.entity !== metadata.entity ||
		parsed.snapshotAt !== metadata.snapshotAt ||
		parsed.rowCount !== metadata.rowCount ||
		!Array.isArray(parsed.items) ||
		parsed.items.length !== metadata.rowCount
	)
		throw invalidContractError()
	const ids = new Set<string>()
	for (const row of parsed.items) {
		if (
			!validItem(
				row,
				metadata.entity,
				metadata.workspaceId,
				metadata.schemaVersion
			) ||
			!isRecord(row) ||
			!isUuidV4(row.id) ||
			ids.has(row.id)
		)
			throw invalidContractError()
		ids.add(row.id)
	}
}
// Fixed quoted RFC4180 records, not split('\n'): string fields may contain
// embedded CR/LF and doubled quotes. Values never enter diagnostics or caches.
const checkCsv = (text: string, metadata: ExportMetadata) => {
	if (!text.startsWith('\uFEFF')) throw invalidContractError()
	const columns =
		metadata.schemaVersion === 2
			? metadata.entity === 'contacts'
				? contactExportV2Columns
				: companyExportV2Columns
			: exportColumns[metadata.entity]
	let offset = 1
	let record = 0
	const ids = new Set<string>()
	while (offset < text.length) {
		const fields: string[] = []
		while (true) {
			if (text[offset++] !== '"') throw invalidContractError()
			let value = ''
			let closed = false
			while (offset < text.length) {
				const char = text[offset++]
				if (char === '"') {
					if (text[offset] === '"') {
						value += '"'
						offset++
					} else {
						closed = true
						break
					}
				} else value += char
			}
			if (!closed || fields.length >= columns.length)
				throw invalidContractError()
			fields.push(value)
			if (text[offset] === ',') {
				offset++
				continue
			}
			if (text.slice(offset, offset + 2) !== '\r\n')
				throw invalidContractError()
			offset += 2
			break
		}
		if (fields.length !== columns.length) throw invalidContractError()
		if (record === 0) {
			if (fields.some((value, index) => value !== columns[index]))
				throw invalidContractError()
		} else {
			if (
				record > metadata.rowCount ||
				!isUuidV4(fields[0]) ||
				ids.has(fields[0]) ||
				fields[1] !== metadata.workspaceId ||
				fields.some(
					value =>
						/^[\s\x00-\x1f\x7f]*[=+\-@]/u.test(value) ||
						/^[\t\r\n]/.test(value)
				)
			)
				throw invalidContractError()
			ids.add(fields[0])
		}
		record++
	}
	if (record !== metadata.rowCount + 1) throw invalidContractError()
}
export const validateExportBody = (
	bytes: Uint8Array,
	metadata: ExportMetadata
) => {
	if (
		(metadata.schemaVersion !== undefined &&
			![1, 2].includes(metadata.schemaVersion)) ||
		(metadata.schemaVersion === 2 &&
			metadata.entity !== 'companies' &&
			metadata.entity !== 'contacts') ||
		bytes.byteLength !== metadata.bytes ||
		bytes.byteLength > 16 * 1024 * 1024
	)
		throw invalidContractError()
	let text: string
	try {
		text = new TextDecoder('utf-8', {
			fatal: true,
			ignoreBOM: true
		}).decode(bytes)
	} catch {
		throw invalidContractError()
	}
	if (metadata.format === 'json') checkJson(text, metadata)
	else checkCsv(text, metadata)
}
