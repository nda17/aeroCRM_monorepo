import { describe, expect, it } from 'vitest'
import { billingHref, parseBillingRoute } from './billing-route'

const workspaceId = 'b531b13e-3624-4ec5-b66d-f24373b0b374'
const referenceId = 'b1c1d3d9-dc5a-4a50-98ba-c79b3895db62'

describe('billing route references', () => {
	it('accepts an exact workspace and an optional opaque order reference', () => {
		expect(
			parseBillingRoute(new URLSearchParams({ workspaceId }))
		).toEqual({
			workspaceId,
			orderId: null,
			commandId: null
		})
		expect(
			parseBillingRoute(
				new URLSearchParams({ workspaceId, orderId: referenceId }),
				true
			)
		).toEqual({ workspaceId, orderId: referenceId, commandId: null })
	})

	it('keeps an unresolved command as a reference, not a persisted payload', () => {
		const href = billingHref(workspaceId, { commandId: referenceId })!
		expect(href).toBe(
			`/billing?workspaceId=${workspaceId}&commandId=${referenceId}`
		)
		expect(
			parseBillingRoute(new URLSearchParams(href.split('?')[1]))
		).toEqual({
			workspaceId,
			orderId: null,
			commandId: referenceId
		})
	})

	it.each([
		'',
		'workspaceId=foreign',
		`workspaceId=${workspaceId}&workspaceId=${workspaceId}`,
		`workspaceId=${workspaceId}&orderId=${referenceId}&orderId=${referenceId}`,
		`workspaceId=${workspaceId}&commandId=${referenceId}&commandId=${referenceId}`,
		`workspaceId=${workspaceId}&orderId=${referenceId}&commandId=${referenceId}`,
		`workspaceId=${workspaceId}&orderId=`,
		`workspaceId=${workspaceId}&token=synthetic`,
		`workspaceId=${workspaceId}&totalSeats=2`,
		`workspaceId=${workspaceId}&returnUrl=https://untrusted.invalid`,
		`workspaceId=${workspaceId}&commandId=${referenceId}%0A`
	])(
		'rejects ambiguous or untrusted references without a workspace fallback',
		query => {
			expect(parseBillingRoute(new URLSearchParams(query))).toBeNull()
		}
	)

	it('requires an order on provider return, never treats returning as paid', () => {
		expect(
			parseBillingRoute(new URLSearchParams({ workspaceId }), true)
		).toBeNull()
		expect(
			parseBillingRoute(
				new URLSearchParams({ workspaceId, commandId: referenceId }),
				true
			)
		).toBeNull()
	})

	it('does not build links for invalid identifiers', () => {
		expect(billingHref('foreign')).toBeNull()
		expect(billingHref(workspaceId, { orderId: 'invalid' })).toBeNull()
	})
})
