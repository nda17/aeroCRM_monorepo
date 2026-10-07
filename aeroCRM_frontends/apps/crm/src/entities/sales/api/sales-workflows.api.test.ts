import { describe, expect, it, vi } from 'vitest'
import { authenticatedRequest } from '@/shared/api/authenticated-http-client'
import { getSalesDealContext } from './sales-workflows.api'

vi.mock('@/shared/api/authenticated-http-client', () => ({
	authenticatedRequest: vi.fn(),
	invalidContractError: () => new Error('invalid contract')
}))

const workspaceId = '11111111-1111-4111-8111-111111111111'
const dealId = '22222222-2222-4222-8222-222222222222'
const contactId = '33333333-3333-4333-8333-333333333333'
const stamp = '2026-10-01T12:00:00.000Z'
const deal = {
	id: dealId,
	workspaceId,
	version: 2,
	title: 'Заказ',
	currency: 'RUB',
	amountMinor: 10000,
	pipelineId: '44444444-4444-4444-8444-444444444444',
	stageId: '55555555-5555-4555-8555-555555555555',
	status: 'OPEN',
	contactId,
	contactName: 'Клиент',
	assignedToSubject: 'actor',
	teamId: null,
	archivedAt: stamp,
	createdAt: stamp,
	updatedAt: stamp,
	nextTask: null
}

describe('sales deal context contract', () => {
	it('requests company context and strictly binds archived deal context to workspace and contact', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			deal,
			companyContext: [{ contactId, company: null }]
		})
		await expect(
			getSalesDealContext('token', workspaceId, dealId, 'ARCHIVED')
		).resolves.toEqual({ deal, company: null })
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'token',
			method: 'GET',
			url: `/crm/sales/deals/${dealId}`,
			params: { workspaceId, archive: 'ARCHIVED', context: 'company' }
		})
	})

	it.each([
		{
			schemaVersion: 1,
			deal,
			companyContext: [{ contactId, company: null }],
			extra: true
		},
		{
			schemaVersion: 1,
			deal,
			companyContext: [{ contactId: workspaceId, company: null }]
		},
		{
			schemaVersion: 1,
			deal: { ...deal, archivedAt: null },
			companyContext: [{ contactId, company: null }]
		},
		{
			schemaVersion: 1,
			deal,
			companyContext: [
				{
					contactId,
					company: {
						id: workspaceId,
						name: 'Компания',
						inn: '1234567890',
						extra: true
					}
				}
			]
		}
	])('rejects malformed or mismatched context envelope', async value => {
		vi.mocked(authenticatedRequest).mockResolvedValue(value)
		await expect(
			getSalesDealContext('token', workspaceId, dealId, 'ARCHIVED')
		).rejects.toThrow('invalid contract')
	})
})
