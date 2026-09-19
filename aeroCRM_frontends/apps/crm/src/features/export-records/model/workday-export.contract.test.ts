import { describe, expect, it } from 'vitest'
import { parseExportHeaders } from './export.contract'
import {
	parseWorkdayExportHeaders,
	validateWorkdayExportBody,
	WORKDAY_EXPORT_MAX_BYTES,
	WORKDAY_EXPORT_MAX_ROWS,
	workdayExportColumns
} from './workday-export.contract'
import {
	actorHash,
	csvExport,
	date,
	headers,
	jsonExport,
	metadata,
	otherId,
	task,
	workspaceId
} from './workday-export.test-fixtures'

const validate = (text: string, format: 'json' | 'csv', rows = 1) =>
	validateWorkdayExportBody(
		new TextEncoder().encode(text),
		metadata(text, format, rows)
	)
describe('Workday export v2 metadata security', () => {
	it.each(['json', 'csv'] as const)(
		'accepts bound %s metadata and keeps v1 schema rejection',
		format => {
			const text = format === 'json' ? jsonExport() : csvExport()
			const meta = metadata(text, format)
			expect(
				parseWorkdayExportHeaders(
					headers(meta),
					format,
					workspaceId,
					actorHash
				)
			).toEqual(meta)
			expect(() =>
				parseExportHeaders(
					headers(meta),
					'tasks',
					format,
					workspaceId,
					actorHash
				)
			).toThrow()
		}
	)
	it.each([
		['X-WinCRM-Export-Schema', '1'],
		['X-WinCRM-Export-Schema', '3'],
		['X-WinCRM-Export-Actor-SHA256', 'b'.repeat(64)],
		['X-WinCRM-Workspace-Id', otherId],
		['X-WinCRM-Export-Entity', 'deals'],
		['X-WinCRM-Export-Rows', '10001'],
		['X-WinCRM-Export-Rows', '-1'],
		['X-WinCRM-Export-Rows', '01'],
		['X-WinCRM-Export-Bytes', String(WORKDAY_EXPORT_MAX_BYTES + 1)],
		['X-WinCRM-Export-Bytes', '0'],
		['X-WinCRM-Export-Snapshot-At', '2026-02-30T00:00:00.000Z'],
		['Content-Disposition', 'attachment; filename="wincrm-tasks.json"'],
		['Content-Disposition', 'inline'],
		['Content-Type', 'text/html'],
		['Cache-Control', 'public'],
		['X-Content-Type-Options', '']
	])('rejects %s=%s before reading body', (key, value) => {
		const selected = headers(metadata(jsonExport(), 'json'))
		selected.set(key, value)
		expect(() =>
			parseWorkdayExportHeaders(selected, 'json', workspaceId, actorHash)
		).toThrow()
	})
	it('requires every security header and a validated expected actor hash', () => {
		const original = headers(metadata(jsonExport(), 'json'))
		for (const key of original.keys()) {
			const selected = new Headers(original)
			selected.delete(key)
			expect(() =>
				parseWorkdayExportHeaders(selected, 'json', workspaceId, actorHash)
			).toThrow()
		}
		expect(() =>
			parseWorkdayExportHeaders(
				original,
				'json',
				workspaceId,
				'not-a-hash'
			)
		).toThrow()
	})
	it('uses the logical byte header even if wire Content-Length is compressed', () => {
		const selected = headers(metadata(jsonExport(), 'json'))
		selected.set('Content-Length', '50')
		expect(
			parseWorkdayExportHeaders(selected, 'json', workspaceId, actorHash)
				.bytes
		).toBeGreaterThan(50)
	})
})
describe('Workday JSON complete snapshot', () => {
	it('accepts standalone/linked/legacy membership and every status', () => {
		for (const status of [
			'OPEN',
			'IN_PROGRESS',
			'COMPLETED',
			'CANCELLED'
		]) {
			const row = {
				...task,
				status,
				completedAt:
					status === 'OPEN' || status === 'IN_PROGRESS' ? null : date
			}
			expect(() => validate(jsonExport([row]), 'json')).not.toThrow()
			expect(() =>
				validate(
					jsonExport([
						{
							...row,
							dealId: otherId,
							assignedToMembershipId: otherId,
							teamId: otherId
						}
					]),
					'json'
				)
			).not.toThrow()
		}
	})
	it.each([
		{ schemaVersion: 1 },
		{ workspaceId: otherId },
		{ entity: 'deals' },
		{ snapshotAt: '2026-09-08T10:00:00.000Z' },
		{ rowCount: 0 },
		{ items: [] },
		{ extra: true }
	])('rejects altered envelope %#', override =>
		expect(() => validate(jsonExport([task], override), 'json')).toThrow()
	)
	it.each([
		{ workspaceId: otherId },
		{ assignedToMembershipId: 'bad' },
		{ teamId: 'bad' },
		{ dealId: 'bad' },
		{ status: 'DONE' },
		{ status: 'COMPLETED' },
		{ version: 0 },
		{ assignedToSubject: '' },
		{ extra: true }
	])('rejects invalid or foreign row %#', override =>
		expect(() =>
			validate(jsonExport([{ ...task, ...override }]), 'json')
		).toThrow()
	)
	it('rejects duplicate IDs and accepts a complete empty snapshot', () => {
		expect(() => validate(jsonExport([task, task]), 'json', 2)).toThrow()
		expect(() => validate(jsonExport([]), 'json', 0)).not.toThrow()
	})
})
describe('Workday CSV safe typed records', () => {
	it('requires exact 13 columns, supports null relationships and quoted multiline titles', () => {
		expect(workdayExportColumns).toHaveLength(13)
		expect(() => validate(csvExport(), 'csv')).not.toThrow()
		expect(() =>
			validate(
				csvExport([{ ...task, title: 'Обсудить, "заказ"\r\nи сроки' }]),
				'csv'
			)
		).not.toThrow()
		expect(() =>
			validate(csvExport([], workdayExportColumns), 'csv', 0)
		).not.toThrow()
	})
	it.each([
		'=SUM(1,2)',
		'+cmd',
		'-cmd',
		'@cmd',
		' \t=1',
		'\ttext',
		'\rtext',
		'\ntext'
	])(
		'rejects unescaped spreadsheet payload %# but accepts the server apostrophe escape',
		title => {
			expect(() =>
				validate(csvExport([{ ...task, title }]), 'csv')
			).toThrow()
			expect(() =>
				validate(csvExport([{ ...task, title: "'" + title }]), 'csv')
			).not.toThrow()
		}
	)
	it('accepts escaped logical title at the 200-character limit without rewriting the bytes', () => {
		const text = csvExport([{ ...task, title: "'=" + 'x'.repeat(199) }])
		const bytes = new TextEncoder().encode(text)
		validateWorkdayExportBody(bytes, metadata(text, 'csv'))
		expect(new TextDecoder().decode(bytes)).toContain(
			"'=" + 'x'.repeat(199)
		)
	})
	it.each([
		{ workspaceId: otherId },
		{ assignedToMembershipId: 'bad' },
		{ teamId: 'bad' },
		{ status: 'DONE' },
		{ version: '01' },
		{ version: 2147483648 },
		{ dueAt: 'yesterday' },
		{ completedAt: date }
	])('validates typed CSV row %#, not only IDs', override =>
		expect(() =>
			validate(csvExport([{ ...task, ...override }]), 'csv')
		).toThrow()
	)
	it('rejects v1/misordered headers, malformed quoting, BOM loss, truncation and wrong row counts', () => {
		for (const text of [
			csvExport().slice(1),
			csvExport().slice(0, -1),
			csvExport().replace('"id"', 'id'),
			csvExport([task], [...workdayExportColumns].reverse()),
			csvExport([task], workdayExportColumns.slice(0, -2))
		])
			expect(() => validate(text, 'csv')).toThrow()
		expect(() => validate(csvExport([task, task]), 'csv', 2)).toThrow()
		expect(() => validate(csvExport(), 'csv', 0)).toThrow()
	})
})
describe('Workday export byte and row bounds', () => {
	it('rejects wrong size, malformed UTF-8, excessive bytes and row counts', () => {
		const text = jsonExport()
		const bytes = new TextEncoder().encode(text)
		expect(() =>
			validateWorkdayExportBody(bytes, {
				...metadata(text, 'json'),
				bytes: bytes.byteLength + 1
			})
		).toThrow()
		expect(() =>
			validateWorkdayExportBody(new Uint8Array([0xff]), {
				...metadata(text, 'json'),
				bytes: 1
			})
		).toThrow()
		expect(() =>
			validateWorkdayExportBody(bytes, {
				...metadata(text, 'json'),
				rowCount: WORKDAY_EXPORT_MAX_ROWS + 1
			})
		).toThrow()
		expect(() =>
			validateWorkdayExportBody(
				new Uint8Array(WORKDAY_EXPORT_MAX_BYTES + 1),
				{ ...metadata(text, 'json'), bytes: WORKDAY_EXPORT_MAX_BYTES + 1 }
			)
		).toThrow()
	})
})
