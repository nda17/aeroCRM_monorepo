import type { DownloadFormat } from '@/shared/api/authenticated-download'
import {
	workdayExportColumns,
	type WorkdayExportMetadata
} from './workday-export.contract'

export const workspaceId = '11111111-1111-4111-8111-111111111111'
export const taskId = '22222222-2222-4222-8222-222222222222'
export const otherId = '33333333-3333-4333-8333-333333333333'
export const date = '2026-09-07T10:00:00.000Z'
export const actorHash = 'a'.repeat(64)
export const task = {
	id: taskId,
	workspaceId,
	dealId: null,
	version: 1,
	title: 'Позвонить',
	dueAt: date,
	status: 'IN_PROGRESS',
	assignedToSubject: 'owner',
	assignedToMembershipId: null,
	teamId: null,
	completedAt: null,
	createdAt: date,
	updatedAt: date
}
export const jsonExport = (items: unknown[] = [task], override = {}) =>
	JSON.stringify({
		schemaVersion: 2,
		workspaceId,
		entity: 'tasks',
		snapshotAt: date,
		rowCount: items.length,
		items,
		...override
	})
const cell = (value: unknown) =>
	'"' + (value === null ? '' : String(value)).replace(/"/g, '""') + '"'
export const csvExport = (
	items: Record<string, unknown>[] = [task],
	columns: readonly string[] = workdayExportColumns
) =>
	'\uFEFF' +
	columns.map(cell).join(',') +
	'\r\n' +
	items
		.map(
			row => columns.map(column => cell(row[column])).join(',') + '\r\n'
		)
		.join('')
export const metadata = (
	text: string,
	format: DownloadFormat,
	rows = 1
): WorkdayExportMetadata => ({
	schemaVersion: 2,
	entity: 'tasks',
	format,
	workspaceId,
	filename: `wincrm-tasks-v2.${format}`,
	mediaType:
		format === 'json'
			? 'application/json; charset=utf-8'
			: 'text/csv; charset=utf-8',
	rowCount: rows,
	snapshotAt: date,
	bytes: new TextEncoder().encode(text).byteLength
})
export const headers = (meta: WorkdayExportMetadata, hash = actorHash) =>
	new Headers({
		'Content-Type': meta.mediaType,
		'Content-Disposition': `attachment; filename="${meta.filename}"`,
		'Cache-Control': 'no-store',
		'X-Content-Type-Options': 'nosniff',
		'X-WinCRM-Export-Schema': '2',
		'X-WinCRM-Workspace-Id': meta.workspaceId,
		'X-WinCRM-Export-Entity': 'tasks',
		'X-WinCRM-Export-Rows': String(meta.rowCount),
		'X-WinCRM-Export-Bytes': String(meta.bytes),
		'X-WinCRM-Export-Snapshot-At': meta.snapshotAt,
		'X-WinCRM-Export-Actor-SHA256': hash
	})
