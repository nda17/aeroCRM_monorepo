import { describe, expect, it } from 'vitest'
import {
	billingMinor,
	billingVersion,
	parseBillingPeriod,
	parseBillingPriceSnapshot,
	parseBillingQuote,
	validBillingQuoteRequest,
	type BillingQuote,
	type BillingQuoteRequest
} from './billing-values.contract'

const workspaceId = 'b531b13e-3624-4ec5-b66d-f24373b0b374'
const periodId = 'b1c1d3d9-dc5a-4a50-98ba-c79b3895db62'
const snapshot = {
	policyVersion: 2,
	monthlyPriceMinor: 129900,
	yearlyPriceMinor: 1200000,
	additionalSeatMonthlyPriceMinor: 20000,
	additionalSeatYearlyPriceMinor: 200000,
	includedSeats: 2,
	graceDays: 3
}
const request: BillingQuoteRequest = {
	schemaVersion: 1,
	workspaceId,
	intent: 'CHECKOUT',
	cycle: 'MONTHLY',
	totalSeats: 2
}
const quote: BillingQuote = {
	...request,
	billingVersion: '0',
	serverTime: '2026-09-05T12:00:00.000Z',
	validUntil: '2026-09-05T12:05:00.000Z',
	amountMinor: '129900',
	currency: 'RUB',
	priceSnapshot: snapshot,
	startsAt: '2026-09-10T12:00:00.000Z',
	expiresAt: '2026-10-10T12:00:00.000Z',
	period: null,
	consent: { version: 'wincrm-v1', text: 'Synthetic consent text' }
}

describe('strict Billing commerce values', () => {
	it('accepts an unstarted billing version and a server quote starting after Trial', () => {
		expect(parseBillingQuote(quote, request)).toEqual(quote)
		expect(billingVersion('0')).toBe(true)
		expect(billingVersion('9223372036854775807')).toBe(true)
		expect(billingMinor('1000000000000')).toBe(true)
	})
	it.each(['-1', '01', '1e3', '1.1', ' 1', '9223372036854775808'])(
		'rejects noncanonical or overflowing versions',
		value => {
			expect(billingVersion(value)).toBe(false)
		}
	)
	it.each(['0', '-1', '01', '1e3', '1.1', '1000000000001'])(
		'rejects invalid minor units',
		value => {
			expect(billingMinor(value)).toBe(false)
		}
	)
	it.each([
		{ workspaceId: periodId },
		{ schemaVersion: 2 },
		{ intent: 'SEAT_CHANGE' },
		{ cycle: 'YEARLY' },
		{ totalSeats: 3 },
		{ amountMinor: 129900 },
		{ currency: 'USD' },
		{ billingVersion: '01' },
		{ rawPaymentMethod: 'not-public' },
		{ validUntil: quote.serverTime },
		{ expiresAt: quote.startsAt },
		{ priceSnapshot: { ...snapshot, includedSeats: 1 } },
		{ consent: { version: 'v1', text: '' } },
		{ consent: { version: 'v1', text: 'x'.repeat(10001) } },
		{
			consent: { version: 'v1', text: 'valid', html: '<b>not allowed</b>' }
		},
		{ period: {} }
	])('rejects foreign, stale, extra or malformed quote fields', patch => {
		expect(parseBillingQuote({ ...quote, ...patch }, request)).toBeNull()
	})
	it('does not put prices, subject, consent or command UUID in a read-only quote request', () => {
		expect(validBillingQuoteRequest(request)).toBe(true)
		for (const key of [
			'actorSubject',
			'ownerSubject',
			'amountMinor',
			'commandId',
			'autoRenew'
		])
			expect(
				validBillingQuoteRequest({ ...request, [key]: 'extra' })
			).toBe(false)
	})
	it('distinguishes seat conversion from a charge and preserves the period snapshot', () => {
		const conversionRequest = {
			...request,
			intent: 'SEAT_CHANGE' as const,
			totalSeats: 4
		}
		const conversion = {
			...quote,
			...conversionRequest,
			amountMinor: '169900',
			period: {
				id: periodId,
				version: 1,
				oldTotalSeats: 2,
				oldExpiresAt: quote.expiresAt,
				oldPeriodPriceMinor: '129900',
				newPeriodPriceMinor: '169900'
			}
		}
		expect(parseBillingQuote(conversion, conversionRequest)).toEqual(
			conversion
		)
		expect(
			parseBillingQuote({ ...conversion, period: null }, conversionRequest)
		).toBeNull()
		expect(
			parseBillingQuote(
				{ ...conversion, amountMinor: '0' },
				conversionRequest
			)
		).toBeNull()
		expect(
			parseBillingQuote(
				{ ...conversion, amountMinor: '40000' },
				conversionRequest
			)
		).toBeNull()
	})
	it('requires exact immutable policy fields and allows an explicitly free extra seat snapshot', () => {
		expect(
			parseBillingPriceSnapshot({
				...snapshot,
				additionalSeatMonthlyPriceMinor: 0
			})
		).not.toBeNull()
		for (const patch of [
			{ monthlyPriceMinor: 0 },
			{ monthlyPriceMinor: 100000001 },
			{ additionalSeatMonthlyPriceMinor: -1 },
			{ policyVersion: 0 },
			{ graceDays: 5 },
			{ currentPolicy: true }
		])
			expect(
				parseBillingPriceSnapshot({ ...snapshot, ...patch })
			).toBeNull()
	})
	it('validates period chronology, complete keys and exact supported state', () => {
		const period = {
			id: periodId,
			orderId: workspaceId,
			version: 1,
			cycle: 'MONTHLY',
			totalSeats: 2,
			priceSnapshot: snapshot,
			startsAt: quote.startsAt,
			expiresAt: quote.expiresAt,
			graceUntil: '2026-10-13T12:00:00.000Z',
			state: 'SCHEDULED'
		}
		expect(parseBillingPeriod(period)).toEqual(period)
		for (const patch of [
			{ id: 'foreign' },
			{ version: 0 },
			{ totalSeats: 1 },
			{ state: 'PAID' },
			{ startsAt: period.expiresAt },
			{ graceUntil: period.startsAt },
			{ providerId: 'not-public' }
		])
			expect(parseBillingPeriod({ ...period, ...patch })).toBeNull()
	})
})
