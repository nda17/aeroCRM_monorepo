import { describe, expect, it } from 'vitest'
import { parseCrmCommercialPolicy } from './crm-commercial-policy.contract'

const policy = {
	schemaVersion: 1,
	productCode: 'WINCRM',
	version: 1,
	currency: 'RUB',
	monthlyPriceMinor: 129_901,
	yearlyPriceMinor: 1_234_599,
	additionalSeatMonthlyPriceMinor: 25_007,
	additionalSeatYearlyPriceMinor: 250_005,
	includedSeats: 2,
	trialSeatLimit: 5,
	trialDays: 5,
	graceDays: 3,
	createdAt: '2026-09-05T12:00:00.000Z'
}
describe('published WinCRM commercial policy', () => {
	it('accepts only the complete product policy, keeping periods and seats independent', () => {
		expect(parseCrmCommercialPolicy(policy)).toEqual(policy)
		expect(
			parseCrmCommercialPolicy({
				...policy,
				includedSeats: 10_000,
				trialSeatLimit: 2,
				monthlyPriceMinor: 1,
				yearlyPriceMinor: 100_000_000
			})
		).not.toBeNull()
	})
	it.each([
		{ schemaVersion: 2 },
		{ productCode: 'EASY' },
		{ currency: 'USD' },
		{ version: 0 },
		{ version: 1.5 },
		{ version: Number.MAX_SAFE_INTEGER + 1 },
		{ monthlyPriceMinor: 0 },
		{ yearlyPriceMinor: 100_000_001 },
		{ additionalSeatMonthlyPriceMinor: '25000' },
		{ additionalSeatYearlyPriceMinor: 1.1 },
		{ includedSeats: 1 },
		{ includedSeats: 10_001 },
		{ trialSeatLimit: 1 },
		{ trialSeatLimit: 2.5 },
		{ trialDays: 7 },
		{ graceDays: 5 },
		{ createdAt: '2026-09-05' },
		{ workspaceId: 'foreign-workspace' },
		{ quoteId: 'not-a-quote' }
	])('rejects incompatible or foreign fields %j', patch => {
		expect(parseCrmCommercialPolicy({ ...policy, ...patch })).toBeNull()
	})
	it('rejects partial, nested, null and array responses without filling defaults', () => {
		for (const key of Object.keys(policy)) {
			const partial: Record<string, unknown> = { ...policy }
			delete partial[key]
			expect(parseCrmCommercialPolicy(partial)).toBeNull()
		}
		for (const value of [null, [], { policy }, 'WINCRM'])
			expect(parseCrmCommercialPolicy(value)).toBeNull()
	})
})
