import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedRequest } from '@/shared/api/authenticated-http-client'
import { getCsvImport, importInboxCsv } from './csv-import.api'
import type { CsvImportCommand } from '../model/csv-import.contract'

vi.mock(
	'@/shared/api/authenticated-http-client',
	async importOriginal => ({
		...(await importOriginal<
			typeof import('@/shared/api/authenticated-http-client')
		>()),
		authenticatedRequest: vi.fn()
	})
)
const workspaceId = '11111111-1111-4111-8111-111111111111'
const commandId = '22222222-2222-4222-8222-222222222222'
const command: CsvImportCommand = {
	workspaceId,
	commandId,
	label: 'Импорт CSV',
	teamId: null,
	rows: [
		{ title: 'Тема', name: 'Имя', phone: null, email: null, message: null }
	]
}
const summary = {
	id: commandId,
	workspaceId,
	createdBySubject: 'owner',
	teamId: null,
	label: 'Импорт CSV',
	rowCount: 1,
	createdAt: '2026-09-05T00:00:00.000Z'
}
beforeEach(() => vi.resetAllMocks())
describe('CSV import HTTP contract', () => {
	it('sends exact bounded JSON and matching UUID header; returns metadata only', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			import: summary
		})
		expect(await importInboxCsv('token', command, 'owner')).toEqual(
			summary
		)
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'token',
			method: 'POST',
			url: '/crm/intake/imports/csv',
			headers: { 'Idempotency-Key': commandId },
			data: { schemaVersion: 1, ...command },
			mapError: expect.any(Function)
		})
	})
	it.each([
		{ rowCount: 2 },
		{ createdBySubject: 'other' },
		{ teamId: commandId },
		{ label: 'other' },
		{ id: workspaceId },
		{ workspaceId: commandId },
		{ rows: command.rows }
	])('rejects wrong or payload-bearing receipts %j', async patch => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			import: { ...summary, ...patch }
		})
		await expect(
			importInboxCsv('token', command, 'owner')
		).rejects.toMatchObject({ kind: 'temporary' })
	})
	it.each([
		{ label: '../private.csv' },
		{ label: '..' },
		{ rawFile: 'private' },
		{ rows: [] },
		{ rows: [{ ...command.rows[0], phone: undefined }] },
		{ rows: [{ ...command.rows[0], name: ' ' }] },
		{ rows: [{ ...command.rows[0], actor: 'other' }] },
		{ teamId: undefined }
	])('rejects malformed input before sending %j', async patch => {
		await expect(
			importInboxCsv(
				'token',
				{ ...command, ...patch } as CsvImportCommand,
				'owner'
			)
		).rejects.toMatchObject({ kind: 'validation' })
		expect(authenticatedRequest).not.toHaveBeenCalled()
	})
	it('rejects JSON byte overflow even for valid field and row counts', async () => {
		const rows = Array.from({ length: 250 }, () => ({
			...command.rows[0],
			message: 'Я'.repeat(3000)
		}))
		await expect(
			importInboxCsv('token', { ...command, rows }, 'owner')
		).rejects.toMatchObject({
			kind: 'validation',
			message: expect.stringContaining('1 МБ')
		})
		expect(authenticatedRequest).not.toHaveBeenCalled()
	})
	it('maps explicit 413 to safe validation without exposing server details', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			import: summary
		})
		await importInboxCsv('token', command, 'owner')
		const mapper = vi.mocked(authenticatedRequest).mock.calls[0][0]
			.mapError!
		expect(
			mapper({
				isAxiosError: true,
				response: { status: 413, data: { secret: 'private-filename' } }
			})
		).toMatchObject({ kind: 'validation' })
		expect(
			mapper({ isAxiosError: true, response: { status: 503 } })
		).toBeUndefined()
	})
	it('reads only an exact workspace-scoped metadata receipt, no content query', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			import: summary
		})
		expect(await getCsvImport('token', workspaceId, commandId)).toEqual(
			summary
		)
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'token',
			method: 'GET',
			url: `/crm/intake/imports/${commandId}`,
			params: { workspaceId }
		})
		vi.mocked(authenticatedRequest).mockClear()
		await expect(
			getCsvImport('token', workspaceId, '../other')
		).rejects.toThrow()
		expect(authenticatedRequest).not.toHaveBeenCalled()
	})
})
