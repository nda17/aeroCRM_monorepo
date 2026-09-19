import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	AuthenticatedApiError,
	authenticatedRequest
} from '@/shared/api/authenticated-http-client'
import { getCrmCommercialPolicy } from './crm-commercial-policy.api'

vi.mock('@/shared/api/authenticated-http-client', async original => ({
	...(await original<
		typeof import('@/shared/api/authenticated-http-client')
	>()),
	authenticatedRequest: vi.fn()
}))
const policy = {
	schemaVersion: 1,
	productCode: 'WINCRM',
	version: 2,
	currency: 'RUB',
	monthlyPriceMinor: 129_900,
	yearlyPriceMinor: 1_200_000,
	additionalSeatMonthlyPriceMinor: 20_000,
	additionalSeatYearlyPriceMinor: 200_000,
	includedSeats: 2,
	trialSeatLimit: 5,
	trialDays: 5,
	graceDays: 3,
	createdAt: '2026-09-05T12:00:00.000Z'
}
describe('commercial policy read API', () => {
	beforeEach(() => vi.resetAllMocks())
	it('uses the authenticated read route with no workspace, payment or activation parameters', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue(policy)
		await expect(
			getCrmCommercialPolicy('synthetic-token')
		).resolves.toEqual(policy)
		expect(authenticatedRequest).toHaveBeenCalledExactlyOnceWith({
			accessToken: 'synthetic-token',
			method: 'GET',
			url: '/billing-settings/crm'
		})
	})
	it('rejects old or payment response shapes', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			...policy,
			paymentUrl: 'https://invalid.test'
		})
		await expect(
			getCrmCommercialPolicy('synthetic-token')
		).rejects.toThrow('некорректный ответ')
	})
	it.each(['unauthorized', 'forbidden', 'temporary'] as const)(
		'propagates %s without fallback prices',
		async kind => {
			const failure = new AuthenticatedApiError(kind, 'Unavailable')
			vi.mocked(authenticatedRequest).mockRejectedValue(failure)
			await expect(getCrmCommercialPolicy('synthetic-token')).rejects.toBe(
				failure
			)
		}
	)
})
