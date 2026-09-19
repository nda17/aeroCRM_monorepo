import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedDownload } from '@/shared/api/authenticated-download'
import { prepareRecordExport } from './export.api'
import {
	exportActorHash,
	companyExportV2Columns,
	contactExportV2Columns,
	exportColumns,
	type ExportEntity
} from '../model/export.contract'

vi.mock('@/shared/api/authenticated-download', () => ({
	authenticatedDownload: vi.fn()
}))
const workspaceId = '11111111-1111-4111-8111-111111111111'
const date = '2026-09-05T00:00:00.000Z'
const fields = async (
	entity: ExportEntity,
	format: string,
	workspace = workspaceId,
	schemaVersion: 1 | 2 = 1
) => {
	const text =
		format === 'json'
			? JSON.stringify({
					schemaVersion,
					workspaceId: workspace,
					entity,
					snapshotAt: date,
					rowCount: 0,
					items: []
				})
			: '\uFEFF' +
				(schemaVersion === 2
					? entity === 'contacts'
						? contactExportV2Columns
						: companyExportV2Columns
					: exportColumns[entity]
				)
					.map(name => `"${name}"`)
					.join(',') +
				'\r\n'
	const bytes = new TextEncoder().encode(text)
	return {
		bytes,
		headers: new Headers({
			'Content-Type':
				format === 'json'
					? 'application/json; charset=utf-8'
					: 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="wincrm-${entity}.${format}"`,
			'Cache-Control': 'no-store',
			'X-Content-Type-Options': 'nosniff',
			'X-WinCRM-Export-Schema': String(schemaVersion),
			'X-WinCRM-Workspace-Id': workspace,
			'X-WinCRM-Export-Entity': entity,
			'X-WinCRM-Export-Rows': '0',
			'X-WinCRM-Export-Bytes': String(bytes.length),
			'X-WinCRM-Export-Snapshot-At': date,
			'X-WinCRM-Export-Actor-SHA256': await exportActorHash('owner')
		})
	}
}
beforeEach(() => {
	vi.resetAllMocks()
	vi.mocked(authenticatedDownload).mockImplementation(async request => {
		const entity = request.path.split('/').at(-1) as ExportEntity
		const result = await fields(entity, request.params.format)
		request.inspectHeaders(result.headers)
		return result.bytes
	})
})
afterEach(() => vi.restoreAllMocks())
describe('Domain-owned export routes', () => {
	it.each([
		['companies', 'json'],
		['companies', 'csv'],
		['contacts', 'json'],
		['contacts', 'csv']
	] as const)(
		'uses the explicit v2 %s %s route without a legacy fallback',
		async (entity, format) => {
			vi.mocked(authenticatedDownload).mockImplementation(
				async request => {
					const result = await fields(entity, format, workspaceId, 2)
					request.inspectHeaders(result.headers)
					return result.bytes
				}
			)
			const result = await prepareRecordExport(
				'token',
				entity,
				workspaceId,
				'owner',
				format,
				new AbortController().signal,
				2
			)
			expect(result.metadata.schemaVersion).toBe(2)
			expect(authenticatedDownload).toHaveBeenCalledWith(
				expect.objectContaining({
					path: `/crm/customers/exports/v2/${entity}`
				})
			)
			expect(authenticatedDownload).toHaveBeenCalledTimes(1)
		}
	)
	it('rejects old headers for the explicit v2 company download', async () => {
		await expect(
			prepareRecordExport(
				'token',
				'companies',
				workspaceId,
				'owner',
				'json',
				new AbortController().signal,
				2
			)
		).rejects.toThrow()
		expect(authenticatedDownload).toHaveBeenCalledTimes(1)
	})
	it('rejects a nonexistent v2 tasks contract before the request', async () => {
		await expect(
			prepareRecordExport(
				'token',
				'tasks',
				workspaceId,
				'owner',
				'json',
				new AbortController().signal,
				2
			)
		).rejects.toThrow()
		expect(authenticatedDownload).not.toHaveBeenCalled()
	})
	it.each(
		(
			['contacts', 'companies', 'deals', 'tasks', 'inbox'] as const
		).flatMap(entity =>
			(['csv', 'json'] as const).map(format => ({ entity, format }))
		)
	)(
		'requests exact $entity/$format without filters or command mutation',
		async ({ entity, format }) => {
			const signal = new AbortController().signal
			const result = await prepareRecordExport(
				'memory-token',
				entity,
				workspaceId,
				'owner',
				format,
				signal
			)
			const service =
				entity === 'contacts' || entity === 'companies'
					? 'customers'
					: entity === 'inbox'
						? 'intake'
						: 'sales'
			expect(authenticatedDownload).toHaveBeenCalledWith({
				accessToken: 'memory-token',
				path: `/crm/${service}/exports/${entity}`,
				params: { workspaceId, format },
				signal,
				maxBytes: 16777216,
				inspectHeaders: expect.any(Function)
			})
			expect(result.metadata.filename).toBe(`wincrm-${entity}.${format}`)
			expect(result.metadata.rowCount).toBe(0)
		}
	)
	it.each(['X-WinCRM-Workspace-Id', 'X-WinCRM-Export-Actor-SHA256'])(
		'refuses a response for a foreign %s before receiving its bytes',
		async name => {
			vi.mocked(authenticatedDownload).mockImplementation(
				async request => {
					const result = await fields('contacts', 'json')
					result.headers.set(name, 'foreign')
					request.inspectHeaders(result.headers)
					throw new Error('must not read body')
				}
			)
			await expect(
				prepareRecordExport(
					'token',
					'contacts',
					workspaceId,
					'owner',
					'json',
					new AbortController().signal
				)
			).rejects.toMatchObject({ kind: 'temporary' })
		}
	)
	it('does not release a body that fails validation even after valid metadata', async () => {
		vi.mocked(authenticatedDownload).mockImplementation(async request => {
			const result = await fields('contacts', 'json')
			request.inspectHeaders(result.headers)
			return new Uint8Array(result.bytes.length)
		})
		await expect(
			prepareRecordExport(
				'token',
				'contacts',
				workspaceId,
				'owner',
				'json',
				new AbortController().signal
			)
		).rejects.toThrow()
	})
	it('rejects unknown entities and aborted requests before issuing an export', async () => {
		await expect(
			prepareRecordExport(
				'token',
				'unknown' as ExportEntity,
				workspaceId,
				'owner',
				'json',
				new AbortController().signal
			)
		).rejects.toThrow()
		const controller = new AbortController()
		controller.abort()
		await expect(
			prepareRecordExport(
				'token',
				'contacts',
				workspaceId,
				'owner',
				'json',
				controller.signal
			)
		).rejects.toThrow()
		expect(authenticatedDownload).not.toHaveBeenCalled()
	})
})
