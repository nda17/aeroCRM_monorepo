import { describe, expect, it } from 'vitest'
import { isBillingConfirmationUrl } from './billing-redirect'
import {
	parseBillingContext,
	parseBillingHistory,
	parseBillingOperation,
	parseBillingOrder,
	parseBillingOrderResponse,
	parseBillingRenewal
} from './billing-response.contract'

const workspaceId = 'b531b13e-3624-4ec5-b66d-f24373b0b374'
const id = 'b1c1d3d9-dc5a-4a50-98ba-c79b3895db62'
const now = '2026-09-05T12:00:00.000Z'
const price = {
	policyVersion: 2,
	monthlyPriceMinor: 129900,
	yearlyPriceMinor: 1200000,
	additionalSeatMonthlyPriceMinor: 20000,
	additionalSeatYearlyPriceMinor: 200000,
	includedSeats: 2,
	graceDays: 3
}
const renewal = {
	version: 0,
	state: 'NONE',
	canDisable: false,
	dispatchPending: false,
	nextChargeAt: null,
	nextRetryAt: null,
	retryAttempt: 0,
	methodLast4: null,
	methodTitle: null
}
const order = {
	id,
	workspaceId,
	version: 1,
	kind: 'ONE_TIME',
	state: 'PENDING',
	cycle: 'MONTHLY',
	totalSeats: 2,
	amountMinor: '129900',
	currency: 'RUB',
	policyVersion: 2,
	confirmationUrl: null,
	canVerify: false,
	checkoutExpiresAt: now,
	createdAt: now,
	succeededAt: null,
	fulfillment: 'NONE',
	periodId: null,
	startsAt: null,
	expiresAt: null
}
const summary = {
	schemaVersion: 1,
	workspaceId,
	billingVersion: '0',
	serverTime: now,
	policy: price,
	trial: null,
	period: null,
	pendingOrder: null,
	renewal
}
const context = {
	schemaVersion: 1,
	workspaceId,
	actorSubject: 'owner',
	billing: summary,
	capacity: {
		usedSeats: 1,
		admissionCeiling: null,
		pendingOperationId: null
	},
	capabilities: {
		quote: true,
		checkout: true,
		changeSeats: false,
		disableAutoRenew: false,
		confirmRenewalPrice: false
	}
}
const hash = 'a'.repeat(64)
const proof = {
	schemaVersion: 1,
	workspaceId,
	commandId: id,
	requestHash: hash,
	status: 'COMMITTED',
	billingVersion: '1',
	releaseFence: false,
	holdUntil: null,
	order,
	period: null
}

describe('strict workspace/actor commerce response boundary', () => {
	it('reads a fresh owner context before any subscription activation', () => {
		expect(parseBillingContext(context, workspaceId, 'owner')).toEqual(
			context
		)
	})
	it.each([
		{ actorSubject: 'foreign' },
		{ workspaceId: id },
		{ schemaVersion: 2 },
		{ secret: 'not-public' },
		{ billing: { ...summary, workspaceId: id } },
		{ capacity: { ...context.capacity, pendingOperationId: 'foreign' } },
		{ capacity: { ...context.capacity, admissionCeiling: 1 } },
		{ capabilities: { ...context.capabilities, checkout: 'true' } },
		{ capabilities: { checkout: true } }
	])('rejects a foreign or malformed context', patch => {
		expect(
			parseBillingContext({ ...context, ...patch }, workspaceId, 'owner')
		).toBeNull()
	})
	it('does not reject a legacy used-seat count above the newly purchased limit', () => {
		expect(
			parseBillingContext(
				{
					...context,
					capacity: {
						usedSeats: 12,
						admissionCeiling: 2,
						pendingOperationId: null
					}
				},
				workspaceId,
				'owner'
			)
		).not.toBeNull()
	})
	it('requires exact trusted redirect validation, not an arbitrary HTTPS URL', () => {
		const safe = {
			...order,
			confirmationUrl:
				'https://yoomoney.ru/checkout/payments/v2/contract?orderId=provider:1'
		}
		expect(parseBillingOrder(safe, workspaceId)).toBeNull()
		expect(
			parseBillingOrder(safe, workspaceId, isBillingConfirmationUrl)
		).toEqual(safe)
		expect(
			parseBillingOrder(
				{ ...safe, confirmationUrl: 'https://evil.invalid/' },
				workspaceId,
				isBillingConfirmationUrl
			)
		).toBeNull()
	})
	it.each([
		{ workspaceId: id },
		{ state: 'PAID' },
		{ amountMinor: 129900 },
		{ version: 0 },
		{ canVerify: 'true' },
		{ canVerify: undefined },
		{ providerPaymentId: 'not-public' },
		{ state: 'SUCCEEDED' },
		{ fulfillment: 'ACTIVE' },
		{ periodId: id }
	])('rejects malformed orders and unsafe public material', patch => {
		expect(
			parseBillingOrder({ ...order, ...patch }, workspaceId)
		).toBeNull()
	})
	it('allows confirmed payment scheduled after Trial without claiming active fulfillment', () => {
		const scheduled = {
			...order,
			state: 'SUCCEEDED',
			succeededAt: now,
			fulfillment: 'SCHEDULED',
			periodId: id,
			startsAt: '2026-09-10T12:00:00.000Z',
			expiresAt: '2026-10-10T12:00:00.000Z'
		}
		expect(parseBillingOrder(scheduled, workspaceId)).toEqual(scheduled)
	})
	it.each([
		{ version: 1 },
		{ state: 'ACTIVE' },
		{ retryAttempt: -1 },
		{ methodLast4: '12345' },
		{ methodTitle: 'x'.repeat(257) },
		{ paymentMethodId: 'not-public' }
	])(
		'does not accept malformed renewal states or provider secrets',
		patch => {
			expect(parseBillingRenewal({ ...renewal, ...patch })).toBeNull()
		}
	)
	it('accepts only exact terminal recovery evidence and never manufactures a success from a missing proof', () => {
		const committed = {
			schemaVersion: 1,
			workspaceId,
			commandId: id,
			state: 'COMMITTED',
			requestHash: hash,
			billing: proof
		}
		expect(parseBillingOperation(committed, workspaceId, id)).toEqual(
			committed
		)
		expect(
			parseBillingOperation(
				{ ...committed, billing: null },
				workspaceId,
				id
			)
		).toBeNull()
		expect(
			parseBillingOperation(
				{
					...committed,
					billing: { ...proof, requestHash: 'b'.repeat(64) }
				},
				workspaceId,
				id
			)
		).toBeNull()
		expect(
			parseBillingOperation(
				{ ...committed, billing: { ...proof, commandId: workspaceId } },
				workspaceId,
				id
			)
		).toBeNull()
		expect(
			parseBillingOperation(
				{ ...committed, state: 'CANCELLED' },
				workspaceId,
				id
			)
		).toBeNull()
		const notStarted = {
			...committed,
			state: 'NOT_STARTED',
			requestHash: null,
			billing: null
		}
		expect(parseBillingOperation(notStarted, workspaceId, id)).toEqual(
			notStarted
		)
		expect(
			parseBillingOperation(
				{ ...notStarted, billing: proof },
				workspaceId,
				id
			)
		).toBeNull()
		expect(
			parseBillingOperation(
				{ ...notStarted, requestHash: hash },
				workspaceId,
				id
			)
		).toBeNull()
	})
	it('keeps a durable pending prepare distinct from a committed command', () => {
		const pending = {
			schemaVersion: 1,
			workspaceId,
			commandId: id,
			state: 'PENDING',
			requestHash: hash,
			billing: null
		}
		expect(parseBillingOperation(pending, workspaceId, id)).toEqual(
			pending
		)
		expect(
			parseBillingOperation(
				{ ...pending, requestHash: null },
				workspaceId,
				id
			)
		).toBeNull()
	})
	it('binds order reads and server history pagination without accepting duplicates', () => {
		const response = {
			schemaVersion: 1,
			workspaceId,
			serverTime: now,
			order
		}
		expect(parseBillingOrderResponse(response, workspaceId, id)).toEqual(
			response
		)
		expect(
			parseBillingOrderResponse(response, workspaceId, workspaceId)
		).toBeNull()
		const history = {
			schemaVersion: 1,
			workspaceId,
			page: 2,
			pageSize: 20,
			total: 21,
			items: [order]
		}
		expect(parseBillingHistory(history, workspaceId, 2, 20)).toEqual(
			history
		)
		expect(parseBillingHistory(history, workspaceId, 1, 20)).toBeNull()
		expect(
			parseBillingHistory(
				{ ...history, items: [order, order] },
				workspaceId,
				2,
				20
			)
		).toBeNull()
	})
})
