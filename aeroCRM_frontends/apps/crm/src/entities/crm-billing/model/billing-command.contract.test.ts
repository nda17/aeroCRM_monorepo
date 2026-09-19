import { describe, expect, it } from 'vitest'
import { validBillingMutation } from './billing-command.contract'

const base = {
	schemaVersion: 1,
	workspaceId: 'b531b13e-3624-4ec5-b66d-f24373b0b374',
	commandId: 'b1c1d3d9-dc5a-4a50-98ba-c79b3895db62',
	expectedBillingVersion: '0'
}
const checkout = {
	...base,
	expectedPolicyVersion: 2,
	cycle: 'MONTHLY',
	totalSeats: 2,
	autoRenew: false,
	consentVersion: null
}

describe('strict WinCRM billing command inputs', () => {
	it('requires an exact explicit consent version only when auto-renew is selected', () => {
		expect(
			validBillingMutation({ action: 'checkout', body: checkout })
		).toBe(true)
		expect(
			validBillingMutation({
				action: 'checkout',
				body: { ...checkout, autoRenew: true, consentVersion: 'wincrm-v1' }
			})
		).toBe(true)
		for (const patch of [
			{ autoRenew: true },
			{ consentVersion: 'wincrm-v1' },
			{ autoRenew: true, consentVersion: '' },
			{ autoRenew: 'true' }
		])
			expect(
				validBillingMutation({
					action: 'checkout',
					body: { ...checkout, ...patch }
				})
			).toBe(false)
	})
	it.each([
		'actorSubject',
		'ownerSubject',
		'amountMinor',
		'price',
		'capacityFence',
		'paymentMethodId',
		'returnUrl'
	])('rejects client-supplied authority or provider material', key => {
		expect(
			validBillingMutation({
				action: 'checkout',
				body: { ...checkout, [key]: 'not-allowed' }
			})
		).toBe(false)
	})
	it.each([
		{ totalSeats: 1 },
		{ totalSeats: 2.5 },
		{ totalSeats: 10001 },
		{ expectedBillingVersion: 0 },
		{ expectedPolicyVersion: 0 },
		{ commandId: 'unknown' },
		{ cycle: 'EASY' }
	])('validates immutable version and seat bounds', patch => {
		expect(
			validBillingMutation({
				action: 'checkout',
				body: { ...checkout, ...patch }
			})
		).toBe(false)
	})
	it('accepts an exact seat conversion without money fields or consent', () => {
		const body = {
			...base,
			expectedPeriodId: base.commandId,
			expectedPeriodVersion: 1,
			newTotalSeats: 4
		}
		expect(validBillingMutation({ action: 'seats', body })).toBe(true)
		expect(
			validBillingMutation({
				action: 'seats',
				body: { ...body, chargeMinor: '100' }
			})
		).toBe(false)
	})
	it('keeps disabling and accepting a new price separate versioned commands', () => {
		const body = { ...base, expectedRenewalVersion: 1 }
		expect(validBillingMutation({ action: 'renewal/disable', body })).toBe(
			true
		)
		expect(
			validBillingMutation({ action: 'renewal/confirm-price', body })
		).toBe(false)
		expect(
			validBillingMutation({
				action: 'renewal/confirm-price',
				body: {
					...body,
					expectedPolicyVersion: 3,
					consentVersion: 'wincrm-v2'
				}
			})
		).toBe(true)
		expect(
			validBillingMutation({
				action: 'renewal/disable',
				body: { ...body, consentVersion: 'wincrm-v2' }
			})
		).toBe(false)
	})
})
