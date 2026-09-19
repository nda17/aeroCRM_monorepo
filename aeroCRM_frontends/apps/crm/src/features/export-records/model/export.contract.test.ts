import { describe, expect, it } from 'vitest'
import {
	exportActorHash,
	companyExportV2Columns,
	contactExportV2Columns,
	exportColumns,
	parseExportHeaders,
	validateExportBody,
	type ExportEntity,
	type ExportMetadata
} from './export.contract'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const id = '22222222-2222-4222-8222-222222222222'
const date = '2026-09-05T00:00:00.000Z'
const actorHash = 'a'.repeat(64)
const base = {
	id,
	workspaceId,
	name: 'Имя',
	notes: null,
	createdBySubject: 'owner',
	teamId: null,
	version: 1,
	archivedAt: date,
	createdAt: date,
	updatedAt: date
}
const rows: Record<ExportEntity, Record<string, unknown>> = {
	contacts: {
		...base,
		phone: '+79001234567',
		email: null,
		companyId: null
	},
	companies: { ...base, inn: null, website: null },
	tasks: {
		id,
		workspaceId,
		dealId: id,
		version: 1,
		title: 'Действие',
		dueAt: date,
		status: 'CANCELLED',
		assignedToSubject: 'owner',
		completedAt: date,
		createdAt: date,
		updatedAt: date
	},
	deals: {
		id,
		workspaceId,
		version: 1,
		title: 'Сделка',
		currency: 'RUB',
		amountMinor: 123,
		pipelineId: id,
		stageId: id,
		status: 'OPEN',
		contactId: id,
		contactName: 'Клиент',
		assignedToSubject: 'owner',
		teamId: null,
		nextTaskId: null,
		archivedAt: date,
		createdAt: date,
		updatedAt: date,
		pipelineName: 'Продажи',
		templateKey: 'sales',
		templateVersion: 1,
		stageKey: 'new',
		stageName: 'Новая',
		stagePosition: 1
	},
	inbox: {
		id,
		workspaceId,
		title: 'Обращение',
		name: 'Имя',
		phone: null,
		email: null,
		message: null,
		origin: 'CSV',
		sourceId: null,
		status: 'NEW',
		createdBySubject: 'owner',
		teamId: null,
		version: 1,
		contactId: null,
		dealId: null,
		rejectionReason: null,
		receivedAt: date,
		updatedAt: date,
		acceptedAt: null,
		rejectedAt: null
	}
}
describe('contact v2 export', () => {
	it('keeps client timezone and call hours in exact JSON/CSV without weakening v1', () => {
		const row = {
			...rows.contacts,
			timeZone: 'Asia/Vladivostok',
			preferredCallStart: '09:00',
			preferredCallEnd: '18:00'
		}
		const json = jsonBytes('contacts', [row], { schemaVersion: 2 })
		expect(() =>
			validateExportBody(json, {
				...metadata('contacts', 'json', json.length),
				schemaVersion: 2
			})
		).not.toThrow()
		expect(() =>
			validateExportBody(json, metadata('contacts', 'json', json.length))
		).toThrow()
		const csv = new TextEncoder().encode(
			'\uFEFF' +
				[
					contactExportV2Columns,
					contactExportV2Columns.map(
						key => row[key as keyof typeof row] ?? ''
					)
				]
					.map(values => values.map(quote).join(','))
					.join('\r\n') +
				'\r\n'
		)
		expect(() =>
			validateExportBody(csv, {
				...metadata('contacts', 'csv', csv.length),
				schemaVersion: 2
			})
		).not.toThrow()
	})
})
const metadata = (
	entity: ExportEntity,
	format: 'json' | 'csv',
	bytes: number,
	rowCount = 1
): ExportMetadata => ({
	entity,
	format,
	workspaceId,
	bytes,
	rowCount,
	snapshotAt: date,
	filename: `wincrm-${entity}.${format}`,
	mediaType:
		format === 'json'
			? 'application/json; charset=utf-8'
			: 'text/csv; charset=utf-8'
})
const headers = () =>
	new Headers({
		'Content-Type': 'application/json; charset=utf-8',
		'Content-Disposition': 'attachment; filename="wincrm-contacts.json"',
		'Cache-Control': 'no-store',
		'X-Content-Type-Options': 'nosniff',
		'X-WinCRM-Export-Schema': '1',
		'X-WinCRM-Workspace-Id': workspaceId,
		'X-WinCRM-Export-Entity': 'contacts',
		'X-WinCRM-Export-Rows': '1',
		'X-WinCRM-Export-Bytes': '100',
		'X-WinCRM-Export-Snapshot-At': date,
		'X-WinCRM-Export-Actor-SHA256': actorHash
	})
const jsonBytes = (
	entity: ExportEntity,
	items: unknown[] = [rows[entity]],
	patch: object = {}
) =>
	new TextEncoder().encode(
		JSON.stringify({
			schemaVersion: 1,
			workspaceId,
			entity,
			snapshotAt: date,
			rowCount: items.length,
			items,
			...patch
		})
	)

describe('company export v2 requisites', () => {
	const company = {
		...rows.companies,
		legalName: 'Полное название',
		kpp: '773601001',
		ogrn: '1027700132195',
		legalAddress: 'Тестовый адрес',
		entityType: 'LEGAL'
	}
	it('accepts saved requisites and archived companies in v2 JSON', () => {
		const bytes = jsonBytes('companies', [company], { schemaVersion: 2 })
		expect(() =>
			validateExportBody(bytes, {
				...metadata('companies', 'json', bytes.length),
				schemaVersion: 2
			})
		).not.toThrow()
	})
	it.each([
		{ legalAddress: undefined },
		{ kpp: '123' },
		{ entityType: 'PERSON' },
		{ legalName: 'a'.repeat(2001) },
		{ rawProviderResponse: {} },
		{ workspaceId: id }
	])('rejects incomplete or foreign requisites %j', change => {
		const bytes = jsonBytes('companies', [{ ...company, ...change }], {
			schemaVersion: 2
		})
		expect(() =>
			validateExportBody(bytes, {
				...metadata('companies', 'json', bytes.length),
				schemaVersion: 2
			})
		).toThrow()
	})
	it('never accepts v1 JSON as a v2 export', () => {
		const bytes = jsonBytes('companies')
		expect(() =>
			validateExportBody(bytes, {
				...metadata('companies', 'json', bytes.length),
				schemaVersion: 2
			})
		).toThrow()
	})
	it('keeps all five requisite columns in the v2 CSV header', () => {
		const bytes = new TextEncoder().encode(
			'\uFEFF' +
				companyExportV2Columns.map(key => `"${key}"`).join(',') +
				'\r\n'
		)
		expect(() =>
			validateExportBody(bytes, {
				...metadata('companies', 'csv', bytes.length, 0),
				schemaVersion: 2
			})
		).not.toThrow()
		expect(() =>
			validateExportBody(
				bytes,
				metadata('companies', 'csv', bytes.length, 0)
			)
		).toThrow()
	})
})
const quote = (value: unknown) => {
	let text = value === null ? '' : String(value)
	if (/^[\s\x00-\x1f\x7f]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text))
		text = `'${text}`
	return `"${text.replaceAll('"', '""')}"`
}
const csvText = (
	entity: ExportEntity,
	items: Record<string, unknown>[] = [rows[entity]]
) =>
	'\uFEFF' +
	[
		exportColumns[entity].map(quote).join(','),
		...items.map(row =>
			exportColumns[entity].map(key => quote(row[key])).join(',')
		)
	].join('\r\n') +
	'\r\n'
describe('Export metadata and body validation', () => {
	it('exports an OPEN deal without a next action and an in-progress linked task', () => {
		for (const [entity, row] of [
			['deals', { ...rows.deals, archivedAt: null, nextTaskId: null }],
			[
				'tasks',
				{ ...rows.tasks, status: 'IN_PROGRESS', completedAt: null }
			]
		] as const) {
			const bytes = jsonBytes(entity, [row])
			expect(() =>
				validateExportBody(bytes, metadata(entity, 'json', bytes.length))
			).not.toThrow()
		}
	})
	it('does not export a closed deal with a next action', () => {
		const bytes = jsonBytes('deals', [
			{ ...rows.deals, status: 'WON', archivedAt: null, nextTaskId: id }
		])
		expect(() =>
			validateExportBody(bytes, metadata('deals', 'json', bytes.length))
		).toThrow()
	})
	it('exports native sourceId and null name through the original 20-column schema without a payload', () => {
		const row = {
			...rows.inbox,
			origin: 'WIDGET',
			sourceId: id,
			name: null
		}
		const json = jsonBytes('inbox', [row])
		expect(() =>
			validateExportBody(json, metadata('inbox', 'json', json.length))
		).not.toThrow()
		const csv = new TextEncoder().encode(csvText('inbox', [row]))
		expect(() =>
			validateExportBody(csv, metadata('inbox', 'csv', csv.length))
		).not.toThrow()
		expect(exportColumns.inbox).toHaveLength(20)
		expect(exportColumns.inbox).not.toContain('payload')
		for (const invalid of [
			{ ...row, payload: {} },
			{ ...row, origin: 'API' }
		]) {
			const bytes = jsonBytes('inbox', [invalid])
			expect(() =>
				validateExportBody(bytes, metadata('inbox', 'json', bytes.length))
			).toThrow()
		}
	})
	it('binds metadata before reading to the exact subject digest, workspace, entity and filename', () => {
		expect(
			parseExportHeaders(
				headers(),
				'contacts',
				'json',
				workspaceId,
				actorHash
			)
		).toEqual(metadata('contacts', 'json', 100))
	})
	it.each([
		'X-WinCRM-Export-Schema',
		'X-WinCRM-Workspace-Id',
		'X-WinCRM-Export-Entity',
		'X-WinCRM-Export-Rows',
		'X-WinCRM-Export-Bytes',
		'X-WinCRM-Export-Snapshot-At',
		'X-WinCRM-Export-Actor-SHA256',
		'Content-Disposition',
		'Content-Type',
		'Cache-Control',
		'X-Content-Type-Options'
	])('rejects missing/invalid metadata %s', name => {
		const value = headers()
		value.delete(name)
		expect(() =>
			parseExportHeaders(value, 'contacts', 'json', workspaceId, actorHash)
		).toThrow()
		value.set(name, 'unexpected')
		expect(() =>
			parseExportHeaders(value, 'contacts', 'json', workspaceId, actorHash)
		).toThrow()
	})
	it('rejects excessive row and logical byte counts', () => {
		for (const [name, value] of [
			['X-WinCRM-Export-Rows', '10001'],
			['X-WinCRM-Export-Bytes', '16777217'],
			['X-WinCRM-Export-Rows', '01']
		]) {
			const h = headers()
			h.set(name, value)
			expect(() =>
				parseExportHeaders(h, 'contacts', 'json', workspaceId, actorHash)
			).toThrow()
		}
	})
	it('hashes the exact UTF-8 subject without sending it as file metadata', async () => {
		expect(await exportActorHash('owner')).toMatch(/^[a-f0-9]{64}$/)
		expect(await exportActorHash('owner')).not.toBe(
			await exportActorHash('owner ')
		)
	})
	it.each(['contacts', 'companies', 'deals', 'tasks', 'inbox'] as const)(
		'accepts exact JSON and safe quoted CSV %s including archived/completed records',
		entity => {
			const json = jsonBytes(entity)
			expect(() =>
				validateExportBody(json, metadata(entity, 'json', json.length))
			).not.toThrow()
			const csv = new TextEncoder().encode(csvText(entity))
			expect(() =>
				validateExportBody(csv, metadata(entity, 'csv', csv.length))
			).not.toThrow()
		}
	)
	it.each(['contacts', 'companies', 'deals', 'tasks', 'inbox'] as const)(
		'rejects a foreign JSON/CSV workspace row for %s',
		entity => {
			const foreign = { ...rows[entity], workspaceId: id }
			for (const [format, bytes] of [
				['json', jsonBytes(entity, [foreign])],
				['csv', new TextEncoder().encode(csvText(entity, [foreign]))]
			] as const)
				expect(() =>
					validateExportBody(bytes, metadata(entity, format, bytes.length))
				).toThrow()
		}
	)
	it('rejects foreign/extra/truncated/duplicate JSON without retaining a partial result', () => {
		for (const bytes of [
			jsonBytes('contacts', [rows.contacts], { workspaceId: id }),
			jsonBytes('contacts', [rows.contacts], { unexpected: 'PII' }),
			jsonBytes('contacts', [rows.contacts, rows.contacts]),
			jsonBytes('contacts', [{ ...rows.contacts, rawFile: 'private' }])
		])
			expect(() =>
				validateExportBody(
					bytes,
					metadata('contacts', 'json', bytes.length)
				)
			).toThrow()
	})
	it('supports quoted CSV multiline values and rejects malformed quotes, counts or unsafe formulas', () => {
		const text = csvText('contacts', [
			{ ...rows.contacts, notes: 'Первая\r\n"Вторая",строка' }
		])
		const bytes = new TextEncoder().encode(text)
		expect(() =>
			validateExportBody(bytes, metadata('contacts', 'csv', bytes.length))
		).not.toThrow()
		for (const malformed of [
			text.slice(1),
			text.slice(0, -2),
			text.replace('"id"', 'id'),
			text.replace('"workspaceId"', '"tenant"'),
			text.replace('"Имя"', '"=1+1"')
		]) {
			const value = new TextEncoder().encode(malformed)
			expect(() =>
				validateExportBody(
					value,
					metadata('contacts', 'csv', value.length)
				)
			).toThrow()
		}
	})
	it('accepts empty exports but not malformed UTF8 or a length mismatch', () => {
		for (const format of ['json', 'csv'] as const) {
			const bytes =
				format === 'json'
					? jsonBytes('contacts', [])
					: new TextEncoder().encode(csvText('contacts', []))
			expect(() =>
				validateExportBody(
					bytes,
					metadata('contacts', format, bytes.length, 0)
				)
			).not.toThrow()
		}
		expect(() =>
			validateExportBody(
				new Uint8Array([0xc3, 0x28]),
				metadata('contacts', 'json', 2)
			)
		).toThrow()
		expect(() =>
			validateExportBody(
				new Uint8Array([1]),
				metadata('contacts', 'json', 2)
			)
		).toThrow()
	})
})
