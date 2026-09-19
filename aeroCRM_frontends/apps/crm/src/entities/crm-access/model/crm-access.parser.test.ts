import { describe, expect, it } from 'vitest'

import { parseCrmAccessBootstrap } from './crm-access.parser'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const membershipId = '22222222-2222-4222-8222-222222222222'
const response = {
	schemaVersion: 1,
	state: 'ACTIVE',
	selectedWorkspaceId: workspaceId,
	membership: { membershipId, role: 'OWNER' },
	workspaces: [{ workspaceId, membershipId, role: 'OWNER' }],
	entitlementStatus: 'ACTIVE',
	entitlement: {
		id: '33333333-3333-4333-8333-333333333333',
		workspaceId,
		planCode: 'TRIAL',
		seatLimit: 5,
		policyVersion: 1,
		graceUntil: '2026-09-12T00:00:00.000Z',
		trialStartedAt: '2026-09-04T00:00:00.000Z',
		effectiveFrom: '2026-09-04T00:00:00.000Z',
		effectiveUntil: '2026-09-09T00:00:00.000Z',
		aggregateVersion: '1',
		sourceSequence: '1'
	},
	access: { lifecycle: 'ACTIVE' }
}

describe('CRM entitlement policy contract', () => {
	it('accepts a frozen Trial policy and canonical grace boundary', () => {
		expect(parseCrmAccessBootstrap(response)).toEqual(response)
	})

	it('preserves legacy entitlements without silently assigning a new policy', () => {
		const legacy = {
			...response,
			entitlement: {
				...response.entitlement,
				policyVersion: null,
				graceUntil: null,
				seatLimit: 1
			}
		}
		expect(parseCrmAccessBootstrap(legacy)).toEqual(legacy)
	})

	it.each([
		{ policyVersion: null },
		{ policyVersion: 0 },
		{ policyVersion: -1 },
		{ policyVersion: 1.5 },
		{ policyVersion: '1' },
		{ policyVersion: Number.MAX_SAFE_INTEGER + 1 },
		{ graceUntil: null },
		{ graceUntil: 'invalid' },
		{ graceUntil: '2026-09-12' },
		{ graceUntil: '2026-09-09T00:00:00.000Z' },
		{ graceUntil: '2026-09-08T23:59:59.999Z' },
		{ seatLimit: 1 },
		{ seatLimit: null },
		{ seatLimit: 2.5 },
		{ effectiveFrom: '2026-09-10T00:00:00.000Z' },
		{ trialStartedAt: '2026-09-10T00:00:00.000Z' }
	])('rejects a malformed or inconsistent policy: %j', override => {
		expect(
			parseCrmAccessBootstrap({
				...response,
				entitlement: { ...response.entitlement, ...override }
			})
		).toBeNull()
	})

	it.each(['policyVersion', 'graceUntil'])(
		'rejects an old wire response missing required %s',
		key => {
			const entitlement: Record<string, unknown> = {
				...response.entitlement
			}
			delete entitlement[key]
			expect(
				parseCrmAccessBootstrap({ ...response, entitlement })
			).toBeNull()
		}
	)

	it('rejects unknown entitlement fields and workspace mismatch', () => {
		expect(
			parseCrmAccessBootstrap({
				...response,
				entitlement: { ...response.entitlement, price: 999 }
			})
		).toBeNull()
		expect(
			parseCrmAccessBootstrap({
				...response,
				entitlement: { ...response.entitlement, workspaceId: membershipId }
			})
		).toBeNull()
	})
})

describe('CRM lifecycle and entitlement correlation', () => {
	it.each([
		['GRACE', 'GRACE', { lifecycle: 'ACTIVE' }],
		['ONBOARDING', 'GRACE', null],
		['ONBOARDING', 'GRACE', { lifecycle: 'ONBOARDING' }],
		['READ_ONLY', 'GRACE', { lifecycle: 'READ_ONLY' }],
		['SUSPENDED', 'GRACE', { lifecycle: 'SUSPENDED' }],
		['READ_ONLY', 'READ_ONLY', { lifecycle: 'ACTIVE' }],
		['READ_ONLY', 'READ_ONLY', { lifecycle: 'ONBOARDING' }],
		['SUSPENDED', 'READ_ONLY', { lifecycle: 'SUSPENDED' }]
	])(
		'accepts %s with entitlement %s and access %j',
		(state, entitlementStatus, access) => {
			const value = { ...response, state, entitlementStatus, access }
			expect(parseCrmAccessBootstrap(value)).toEqual(value)
		}
	)

	it.each([
		['GRACE', 'GRACE', null],
		['GRACE', 'GRACE', { lifecycle: 'ONBOARDING' }],
		['GRACE', 'GRACE', { lifecycle: 'READ_ONLY' }],
		['GRACE', 'GRACE', { lifecycle: 'SUSPENDED' }],
		['READ_ONLY', 'READ_ONLY', { lifecycle: 'SUSPENDED' }],
		['ACTIVE', 'GRACE', { lifecycle: 'ACTIVE' }],
		['ONBOARDING', 'READ_ONLY', null]
	])(
		'rejects %s with entitlement %s and access %j',
		(state, entitlementStatus, access) => {
			expect(
				parseCrmAccessBootstrap({
					...response,
					state,
					entitlementStatus,
					access
				})
			).toBeNull()
		}
	)
})
