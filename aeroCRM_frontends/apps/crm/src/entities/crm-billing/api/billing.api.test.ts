import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	AuthenticatedApiError,
	authenticatedRequest
} from '@/shared/api/authenticated-http-client'
import { getRuntimeConfig } from '@/shared/config/runtime'
import {
	getBillingContext,
	getBillingHistory,
	getBillingOperation,
	getBillingOrder,
	getBillingQuote,
	mutateBilling,
	recoverBillingOperation
} from './billing.api'

vi.mock('@/shared/api/authenticated-http-client', async original => ({
	...(await original<object>()),
	authenticatedRequest: vi.fn()
}))
vi.mock('@/shared/config/runtime', () => ({ getRuntimeConfig: vi.fn() }))
const workspaceId = 'b531b13e-3624-4ec5-b66d-f24373b0b374'
const commandId = 'b1c1d3d9-dc5a-4a50-98ba-c79b3895db62'
const operation = {
	schemaVersion: 1,
	workspaceId,
	commandId,
	state: 'PENDING',
	requestHash: 'a'.repeat(64),
	billing: null
}
const checkout = {
	schemaVersion: 1 as const,
	workspaceId,
	commandId,
	expectedBillingVersion: '0',
	expectedPolicyVersion: 2,
	cycle: 'MONTHLY' as const,
	totalSeats: 2,
	autoRenew: true,
	consentVersion: 'wincrm-v1'
}
beforeEach(() => {
	vi.resetAllMocks()
	vi.mocked(getRuntimeConfig).mockReturnValue({
		wincrmBillingEnabled: true
	} as never)
})

describe('Access BFF-only Billing API', () => {
	it('sends zero Billing BFF requests while the frontend release gate is off', async () => {
		vi.mocked(getRuntimeConfig).mockReturnValue({
			wincrmBillingEnabled: false
		} as never)
		for (const request of [
			() => getBillingContext('token', workspaceId, 'owner'),
			() =>
				getBillingQuote('token', {
					schemaVersion: 1,
					workspaceId,
					intent: 'CHECKOUT',
					cycle: 'MONTHLY',
					totalSeats: 2
				}),
			() => mutateBilling('token', { action: 'checkout', body: checkout }),
			() => getBillingOrder('token', workspaceId, commandId),
			() => getBillingHistory('token', workspaceId, 1),
			() => getBillingOperation('token', workspaceId, commandId),
			() => recoverBillingOperation('token', workspaceId, commandId)
		])
			await expect(request()).rejects.toThrow(
				'Оплата WinCRM скоро будет доступна'
			)
		expect(authenticatedRequest).not.toHaveBeenCalled()
	})
	it('sends an exact stable checkout body/header without actor, price, provider or Widgets fields', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue(operation)
		await expect(
			mutateBilling('synthetic-token', {
				action: 'checkout',
				body: checkout
			})
		).resolves.toEqual(operation)
		expect(authenticatedRequest).toHaveBeenCalledExactlyOnceWith({
			accessToken: 'synthetic-token',
			method: 'POST',
			url: '/crm/access/billing/checkout',
			data: checkout,
			headers: { 'Idempotency-Key': commandId }
		})
	})
	it.each([
		'temporary',
		'unauthorized',
		'forbidden',
		'conflict',
		'notFound'
	] as const)(
		'propagates %s without a new command or logout side effect',
		async kind => {
			const failure = new AuthenticatedApiError(kind, 'Synthetic failure')
			vi.mocked(authenticatedRequest).mockRejectedValue(failure)
			await expect(
				mutateBilling('token', { action: 'checkout', body: checkout })
			).rejects.toBe(failure)
			expect(authenticatedRequest).toHaveBeenCalledTimes(1)
		}
	)
	it('uses explicit recovery with the same path UUID, never sends the old command body', async () => {
		const closed = {
			...operation,
			state: 'NOT_STARTED',
			requestHash: null
		}
		vi.mocked(authenticatedRequest).mockResolvedValue(closed)
		await expect(
			recoverBillingOperation('token', workspaceId, commandId)
		).resolves.toEqual(closed)
		expect(authenticatedRequest).toHaveBeenCalledExactlyOnceWith({
			accessToken: 'token',
			method: 'POST',
			url: `/crm/access/billing/operations/${commandId}/recover`,
			data: { schemaVersion: 1, workspaceId }
		})
	})
	it('does not reinterpret a GET404 as a NOT_STARTED tombstone or invoke recovery automatically', async () => {
		vi.mocked(authenticatedRequest).mockRejectedValue(
			new AuthenticatedApiError('notFound', 'Not found')
		)
		await expect(
			getBillingOperation('token', workspaceId, commandId)
		).rejects.toMatchObject({ kind: 'notFound' })
		expect(authenticatedRequest).toHaveBeenCalledExactlyOnceWith({
			accessToken: 'token',
			method: 'GET',
			url: `/crm/access/billing/operations/${commandId}`,
			params: { workspaceId }
		})
	})
	it('binds the returned operation to the exact workspace and command UUID', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			...operation,
			commandId: workspaceId
		})
		await expect(
			mutateBilling('token', { action: 'checkout', body: checkout })
		).rejects.toThrow('некорректный ответ')
	})
	it('requires safe identifiers and exact quote/command fields before HTTP', async () => {
		await expect(
			getBillingContext('token', 'foreign', 'owner')
		).rejects.toThrow()
		await expect(
			getBillingOrder('token', workspaceId, '../order')
		).rejects.toThrow()
		await expect(
			getBillingHistory('token', workspaceId, 0)
		).rejects.toThrow()
		await expect(
			getBillingQuote('token', {
				schemaVersion: 1,
				workspaceId,
				intent: 'CHECKOUT',
				cycle: 'MONTHLY',
				totalSeats: 1
			})
		).rejects.toThrow()
		await expect(
			mutateBilling('token', {
				action: 'checkout',
				body: { ...checkout, amountMinor: '1' }
			} as never)
		).rejects.toThrow()
		expect(authenticatedRequest).not.toHaveBeenCalled()
	})
	it('uses the server-paginated history route and rejects a foreign response', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			workspaceId,
			page: 2,
			pageSize: 20,
			total: 0,
			items: []
		})
		await getBillingHistory('token', workspaceId, 2)
		expect(authenticatedRequest).toHaveBeenCalledExactlyOnceWith({
			accessToken: 'token',
			method: 'GET',
			url: '/crm/access/billing/history',
			params: { workspaceId, page: '2', pageSize: '20' }
		})
	})
	it('verifies only an existing local order reference through a stable owner command', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue(operation)
		const body = {
			schemaVersion: 1 as const,
			workspaceId,
			commandId,
			expectedBillingVersion: '2',
			orderId: workspaceId,
			expectedOrderVersion: 1
		}
		await mutateBilling('token', { action: 'orders/verify', body })
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'token',
			method: 'POST',
			url: '/crm/access/billing/orders/verify',
			data: body,
			headers: { 'Idempotency-Key': commandId }
		})
	})
})
