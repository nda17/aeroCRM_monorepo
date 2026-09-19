import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedDownload } from '@/shared/api/authenticated-download'
import { exportActorHash } from '../model/export.contract'
import {
	csvExport,
	headers,
	jsonExport,
	metadata,
	otherId,
	workspaceId
} from '../model/workday-export.test-fixtures'
import { prepareWorkdayExport } from './workday-export.api'

vi.mock('@/shared/api/authenticated-download', () => ({
	authenticatedDownload: vi.fn()
}))
beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(authenticatedDownload).mockImplementation(async request => {
		const format = request.params.format as 'json' | 'csv'
		const text = format === 'json' ? jsonExport() : csvExport()
		request.inspectHeaders(
			headers(metadata(text, format), await exportActorHash('owner'))
		)
		return new TextEncoder().encode(text)
	})
})
describe('Isolated Workday v2 export API', () => {
	it.each(['json', 'csv'] as const)(
		'requests exact %s v2 route without list filters or mutations',
		async format => {
			const signal = new AbortController().signal
			const result = await prepareWorkdayExport(
				'captured',
				workspaceId,
				'owner',
				format,
				signal
			)
			expect(authenticatedDownload).toHaveBeenCalledExactlyOnceWith({
				accessToken: 'captured',
				path: '/crm/sales/exports/v2/tasks',
				params: { workspaceId, format },
				signal,
				maxBytes: 16777216,
				inspectHeaders: expect.any(Function)
			})
			expect(result.metadata).toMatchObject({
				schemaVersion: 2,
				entity: 'tasks',
				filename: `wincrm-tasks-v2.${format}`,
				rowCount: 1
			})
		}
	)
	it.each(['actor', 'workspace', 'schema'] as const)(
		'rejects mismatched %s at headers before accepting bytes',
		async field => {
			vi.mocked(authenticatedDownload).mockImplementation(
				async request => {
					const selected = headers(
						metadata(jsonExport(), 'json'),
						await exportActorHash('owner')
					)
					selected.set(
						field === 'actor'
							? 'X-WinCRM-Export-Actor-SHA256'
							: field === 'workspace'
								? 'X-WinCRM-Workspace-Id'
								: 'X-WinCRM-Export-Schema',
						field === 'schema' ? '1' : otherId
					)
					request.inspectHeaders(selected)
					throw new Error('Body must not be read')
				}
			)
			await expect(
				prepareWorkdayExport(
					'captured',
					workspaceId,
					'owner',
					'json',
					new AbortController().signal
				)
			).rejects.toMatchObject({ kind: 'temporary' })
		}
	)
	it('rejects a downloader that skips header validation', async () => {
		vi.mocked(authenticatedDownload).mockResolvedValue(
			new TextEncoder().encode(jsonExport())
		)
		await expect(
			prepareWorkdayExport(
				'captured',
				workspaceId,
				'owner',
				'json',
				new AbortController().signal
			)
		).rejects.toMatchObject({ kind: 'temporary' })
	})
	it('does not return unvalidated or truncated body bytes', async () => {
		vi.mocked(authenticatedDownload).mockImplementation(async request => {
			const text = jsonExport()
			request.inspectHeaders(
				headers(metadata(text, 'json'), await exportActorHash('owner'))
			)
			return new TextEncoder().encode(text.slice(0, -1))
		})
		await expect(
			prepareWorkdayExport(
				'captured',
				workspaceId,
				'owner',
				'json',
				new AbortController().signal
			)
		).rejects.toMatchObject({ kind: 'temporary' })
	})
	it('stops before GET on abort or invalid target', async () => {
		const controller = new AbortController()
		controller.abort()
		await expect(
			prepareWorkdayExport(
				'captured',
				workspaceId,
				'owner',
				'json',
				controller.signal
			)
		).rejects.toThrow()
		await expect(
			prepareWorkdayExport(
				'captured',
				'bad',
				'owner',
				'json',
				new AbortController().signal
			)
		).rejects.toThrow()
		expect(authenticatedDownload).not.toHaveBeenCalled()
	})
	it('ignores bytes delivered after cancellation', async () => {
		const controller = new AbortController()
		vi.mocked(authenticatedDownload).mockImplementation(async request => {
			const text = jsonExport()
			request.inspectHeaders(
				headers(metadata(text, 'json'), await exportActorHash('owner'))
			)
			controller.abort()
			return new TextEncoder().encode(text)
		})
		await expect(
			prepareWorkdayExport(
				'captured',
				workspaceId,
				'owner',
				'json',
				controller.signal
			)
		).rejects.toThrow()
	})
})
