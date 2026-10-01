import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedRequest } from '@/shared/api/authenticated-http-client'
import {
	applyCrmImport,
	getCrmImport,
	inspectCrmImport,
	previewCrmImport
} from './import.api'

vi.mock('@/shared/api/authenticated-http-client', async original => ({
	...(await original<object>()),
	authenticatedRequest: vi.fn()
}))

const workspaceId = '11111111-1111-4111-8111-111111111111'
const previewId = '22222222-2222-4222-8222-222222222222'
const commandId = '33333333-3333-4333-8333-333333333333'
const file = {
	schemaVersion: 1 as const,
	workspaceId,
	entity: 'deals' as const,
	filename: 'deals.csv',
	contentBase64: 'YQ=='
}
const preview = {
	schemaVersion: 1,
	workspaceId,
	previewId,
	entity: 'deals',
	sourceKey: 'bitrix-main',
	expiresAt: '2026-10-02T10:00:00.000Z',
	rows: [],
	summary: { create: 0, link: 0, skip: 0, error: 0 },
	result: null
}
const applied = {
	schemaVersion: 1,
	previewId,
	commandId,
	entity: 'deals',
	status: 'APPLIED',
	created: 0,
	linked: 0,
	skipped: 0,
	items: []
}

beforeEach(() => vi.resetAllMocks())

describe('CRM import API', () => {
	it('routes inspection and preview to the selected service with explicit v1 input', async () => {
		vi.mocked(authenticatedRequest)
			.mockResolvedValueOnce({
				schemaVersion: 1,
				entity: 'deals',
				fileDigest: 'a'.repeat(64),
				sheets: [
					{ name: 'Deals', headers: ['ID'], rowCount: 0, sample: [] }
				]
			})
			.mockResolvedValueOnce(preview)
		await inspectCrmImport('token', file)
		await previewCrmImport('token', {
			...file,
			sourceKey: 'bitrix-main',
			sheet: 'Deals',
			mapping: { externalId: 'ID' }
		})
		expect(
			vi.mocked(authenticatedRequest).mock.calls.map(call => call[0])
		).toMatchObject([
			{ method: 'POST', url: '/crm/sales/imports/inspect', data: file },
			{
				method: 'POST',
				url: '/crm/sales/imports/preview',
				data: {
					...file,
					sourceKey: 'bitrix-main',
					sheet: 'Deals',
					mapping: { externalId: 'ID' }
				}
			}
		])
	})

	it('uses the same command ID as idempotency key and reads the durable preview receipt', async () => {
		vi.mocked(authenticatedRequest)
			.mockResolvedValueOnce(applied)
			.mockResolvedValueOnce({ ...preview, result: applied })
		await applyCrmImport('token', 'deals', {
			schemaVersion: 1,
			workspaceId,
			previewId,
			commandId
		})
		await getCrmImport('token', 'deals', workspaceId, previewId)
		expect(
			vi.mocked(authenticatedRequest).mock.calls.map(call => call[0])
		).toMatchObject([
			{
				method: 'POST',
				url: '/crm/sales/imports/apply',
				data: { schemaVersion: 1, workspaceId, previewId, commandId },
				headers: { 'Idempotency-Key': commandId }
			},
			{
				method: 'GET',
				url: `/crm/sales/imports/${previewId}`,
				params: { workspaceId }
			}
		])
	})

	it('rejects a mismatched response instead of handing it to the wizard', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			...preview,
			entity: 'contacts'
		})
		await expect(
			previewCrmImport('token', {
				...file,
				sourceKey: 'bitrix-main',
				sheet: 'Deals',
				mapping: { externalId: 'ID' }
			})
		).rejects.toThrow()
	})
})
