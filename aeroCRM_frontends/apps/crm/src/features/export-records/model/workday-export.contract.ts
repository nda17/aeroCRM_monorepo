import { isWorkdaySubject, parseWorkdayTask } from '@/entities/crm-workday'
import type { DownloadFormat } from '@/shared/api/authenticated-download'
import { invalidContractError } from '@/shared/api/authenticated-http-client'
import {
	hasExactKeys,
	isIsoDate,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'

export const WORKDAY_EXPORT_MAX_BYTES = 16 * 1024 * 1024
export const WORKDAY_EXPORT_MAX_ROWS = 10000
export const workdayExportColumns = [
	'id',
	'workspaceId',
	'dealId',
	'version',
	'title',
	'dueAt',
	'status',
	'assignedToSubject',
	'assignedToMembershipId',
	'teamId',
	'completedAt',
	'createdAt',
	'updatedAt'
] as const
export interface WorkdayExportMetadata {
	schemaVersion: 2
	entity: 'tasks'
	format: DownloadFormat
	workspaceId: string
	filename: string
	mediaType: string
	snapshotAt: string
	rowCount: number
	bytes: number
}
const decimal = (value: string | null, max: number) =>
	value !== null &&
	/^(?:0|[1-9][0-9]*)$/.test(value) &&
	Number.isSafeInteger(Number(value)) &&
	Number(value) <= max
export const parseWorkdayExportHeaders = (
	headers: Headers,
	format: DownloadFormat,
	workspaceId: string,
	actorHash: string
): WorkdayExportMetadata => {
	const rows = headers.get('X-WinCRM-Export-Rows')
	const bytes = headers.get('X-WinCRM-Export-Bytes')
	const snapshotAt = headers.get('X-WinCRM-Export-Snapshot-At')
	const filename = `wincrm-tasks-v2.${format}`
	const mediaType =
		format === 'csv'
			? 'text/csv; charset=utf-8'
			: 'application/json; charset=utf-8'
	if (
		!['json', 'csv'].includes(format) ||
		!isUuidV4(workspaceId) ||
		!decimal(rows, WORKDAY_EXPORT_MAX_ROWS) ||
		!decimal(bytes, WORKDAY_EXPORT_MAX_BYTES) ||
		Number(bytes) < 1 ||
		!isIsoDate(snapshotAt) ||
		!/^[a-f0-9]{64}$/.test(actorHash) ||
		headers.get('X-WinCRM-Export-Actor-SHA256') !== actorHash ||
		headers.get('X-WinCRM-Workspace-Id') !== workspaceId ||
		headers.get('X-WinCRM-Export-Entity') !== 'tasks' ||
		headers.get('X-WinCRM-Export-Schema') !== '2' ||
		headers.get('Content-Type')?.toLowerCase() !== mediaType ||
		headers.get('Content-Disposition') !==
			`attachment; filename="${filename}"` ||
		headers.get('Cache-Control')?.toLowerCase() !== 'no-store' ||
		headers.get('X-Content-Type-Options')?.toLowerCase() !== 'nosniff'
	)
		throw invalidContractError()
	return {
		schemaVersion: 2,
		entity: 'tasks',
		format,
		workspaceId,
		filename,
		mediaType,
		snapshotAt,
		rowCount: Number(rows),
		bytes: Number(bytes)
	}
}

const checkJson = (text: string, metadata: WorkdayExportMetadata) => {
	let value: unknown
	try {
		value = JSON.parse(text)
	} catch {
		throw invalidContractError()
	}
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'entity',
			'snapshotAt',
			'rowCount',
			'items'
		]) ||
		value.schemaVersion !== 2 ||
		value.workspaceId !== metadata.workspaceId ||
		value.entity !== 'tasks' ||
		value.snapshotAt !== metadata.snapshotAt ||
		value.rowCount !== metadata.rowCount ||
		!Array.isArray(value.items) ||
		value.items.length !== metadata.rowCount
	)
		throw invalidContractError()
	const ids = new Set<string>()
	for (const item of value.items) {
		const task = parseWorkdayTask(item, metadata.workspaceId)
		if (!task || ids.has(task.id.toLowerCase()))
			throw invalidContractError()
		ids.add(task.id.toLowerCase())
	}
}
const formula = (text: string) =>
	/^[\s\x00-\x1f\x7f]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text)
const nullableColumns: ReadonlySet<string> = new Set([
	'dealId',
	'assignedToMembershipId',
	'teamId',
	'completedAt'
])
const checkCsvRecord = (
	fields: string[],
	workspaceId: string,
	ids: Set<string>
) => {
	if (fields.some(formula)) throw invalidContractError()
	// Validate logical values only. Keep the original escaped bytes untouched:
	// CSV is a spreadsheet representation, not an automatic round-trip import.
	const values = fields.map(value =>
		value.startsWith("'") && formula(value.slice(1))
			? value.slice(1)
			: value
	)
	const row: Record<string, unknown> = {}
	workdayExportColumns.forEach((column, index) => {
		const value = values[index]
		row[column] =
			nullableColumns.has(column) && value === ''
				? null
				: column === 'version' && /^[1-9][0-9]*$/.test(value)
					? Number(value)
					: value
	})
	const task = parseWorkdayTask(row, workspaceId)
	if (!task || ids.has(task.id.toLowerCase())) throw invalidContractError()
	ids.add(task.id.toLowerCase())
}
const checkCsv = (text: string, metadata: WorkdayExportMetadata) => {
	if (!text.startsWith('\uFEFF')) throw invalidContractError()
	let offset = 1,
		record = 0
	const ids = new Set<string>()
	while (offset < text.length) {
		const fields: string[] = []
		while (true) {
			if (text[offset++] !== '"') throw invalidContractError()
			let value = '',
				closed = false
			while (offset < text.length) {
				const char = text[offset++]
				if (char !== '"') value += char
				else if (text[offset] === '"') {
					value += '"'
					offset++
				} else {
					closed = true
					break
				}
			}
			if (!closed || fields.length >= workdayExportColumns.length)
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
		if (fields.length !== workdayExportColumns.length)
			throw invalidContractError()
		if (record === 0) {
			if (
				fields.some(
					(value, index) => value !== workdayExportColumns[index]
				)
			)
				throw invalidContractError()
		} else {
			if (record > metadata.rowCount) throw invalidContractError()
			checkCsvRecord(fields, metadata.workspaceId, ids)
		}
		record++
	}
	if (record !== metadata.rowCount + 1) throw invalidContractError()
}
export const validateWorkdayExportBody = (
	bytes: Uint8Array,
	metadata: WorkdayExportMetadata
) => {
	if (
		metadata.schemaVersion !== 2 ||
		metadata.entity !== 'tasks' ||
		!['json', 'csv'].includes(metadata.format) ||
		!isUuidV4(metadata.workspaceId) ||
		!Number.isSafeInteger(metadata.rowCount) ||
		metadata.rowCount < 0 ||
		metadata.rowCount > WORKDAY_EXPORT_MAX_ROWS ||
		bytes.byteLength !== metadata.bytes ||
		bytes.byteLength < 1 ||
		bytes.byteLength > WORKDAY_EXPORT_MAX_BYTES
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
export const validWorkdayExportTarget = (
	workspaceId: string,
	subject: string,
	format: DownloadFormat
) =>
	isUuidV4(workspaceId) &&
	isWorkdaySubject(subject) &&
	['json', 'csv'].includes(format)
