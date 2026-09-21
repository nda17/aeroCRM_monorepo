import { describe, expect, it } from 'vitest'
import {
	createCrmAdminSeatsCommand,
	parseCrmAdminSeatAdjustment,
	parseCrmAdminSeatsContext,
	parseCrmAdminSeatsHistory,
	parseCrmAdminSeatsRecovery,
	parseCrmAdminSeatsResult
} from '../../../../../packages/web/src/features/admin-crm/model/crm-subscription-seats.contract'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const commandId = '22222222-2222-4222-8222-222222222222'
const periodId = '33333333-3333-4333-8333-333333333333'
const actor = 'admin@example'
const createdAt = '2026-09-21T12:00:00.000Z'
const subscription = {
	workspaceId,
	ownerSubject: 'owner@example',
	entitlementVersion: '7',
	billingVersion: '12',
	entitlement: {
		planCode: 'MONTHLY',
		status: 'ACTIVE',
		seatLimit: 6,
		effectiveFrom: '2026-09-01T12:00:00.000Z',
		effectiveUntil: '2026-10-01T12:00:00.000Z',
		graceUntil: '2026-10-04T12:00:00.000Z'
	},
	period: {
		id: periodId,
		version: 4,
		startsAt: '2026-09-01T12:00:00.000Z',
		expiresAt: '2026-10-01T12:00:00.000Z',
		graceUntil: '2026-10-04T12:00:00.000Z',
		totalSeats: 6
	},
	renewal: { status: 'ACTIVE', nextChargeAt: '2026-10-01T12:00:00.000Z' },
	extensionTarget: 'PAID_PERIOD' as const,
	blockedReason: null
}
const context = {
	schemaVersion: 1 as const,
	subscription,
	capacity: {
		usedSeats: 2,
		minimumSeats: 2,
		maximumSeats: 10000 as const
	},
	canSetSeats: true,
	blockedReason: null
}
const command = {
	schemaVersion: 1 as const,
	commandId,
	expectedActorSubject: actor,
	expectedEntitlementVersion: '7',
	expectedBillingVersion: '12',
	expectedPeriodId: periodId,
	expectedPeriodVersion: 4,
	totalSeats: 8,
	reason: 'Increase paid seats'
}
const adjustment = {
	commandId,
	workspaceId,
	actorSubject: actor,
	actorRole: 'ADMIN' as const,
	reason: 'Increase paid seats',
	target: 'PAID_PERIOD' as const,
	periodId,
	oldTotalSeats: 6,
	newTotalSeats: 8,
	effectiveUntil: '2026-10-01T12:00:00.000Z',
	createdAt
}
const result = {
	schemaVersion: 1 as const,
	workspaceId,
	commandId,
	adjustment,
	subscription: {
		...subscription,
		entitlement: { ...subscription.entitlement, seatLimit: 8 },
		period: { ...subscription.period, totalSeats: 8 }
	}
}

describe('CRM admin seat contract', () => {
	it('builds a trimmed command bound to current actor, period and both CAS versions', () => {
		expect(
			createCrmAdminSeatsCommand(
				context,
				' 8 ',
				'  Increase paid seats  ',
				commandId,
				actor
			)
		).toEqual(command)
	})

	it.each([
		[
			'blocked context',
			{
				context: {
					...context,
					canSetSeats: false,
					blockedReason: 'pending',
					subscription: { ...subscription, blockedReason: 'pending' }
				}
			}
		],
		['same seat count', { seatsInput: '6' }],
		['below used floor', { seatsInput: '1' }],
		['fractional input', { seatsInput: '8.5' }],
		['short reason', { reasonInput: 'no' }]
	])('rejects %s before creating a command', (_name, patch) => {
		const candidate = 'context' in patch ? patch.context : context
		const seatsInput = 'seatsInput' in patch ? patch.seatsInput : '8'
		const reasonInput =
			'reasonInput' in patch ? patch.reasonInput : 'Increase paid seats'
		const actorSubject =
			'actorSubject' in patch ? String(patch.actorSubject) : actor
		expect(() =>
			createCrmAdminSeatsCommand(
				candidate,
				seatsInput,
				reasonInput,
				commandId,
				actorSubject
			)
		).toThrow()
	})

	it('rejects malformed context and cross-workspace responses strictly', () => {
		expect(() =>
			parseCrmAdminSeatsContext({ ...context, extra: true }, workspaceId)
		).toThrow('Invalid CRM admin seats context')
		expect(() => parseCrmAdminSeatsContext(context, periodId)).toThrow(
			'Unexpected CRM admin seats workspace'
		)
		expect(() =>
			parseCrmAdminSeatsResult(
				{ ...result, workspaceId: periodId },
				workspaceId,
				commandId,
				actor,
				command
			)
		).toThrow('Invalid CRM admin seats result')
	})

	it('binds adjustment target, period and new seat count to the returned subscription', () => {
		expect(
			parseCrmAdminSeatsResult(
				result,
				workspaceId,
				commandId,
				actor,
				command
			)
		).toMatchObject({ adjustment, subscription: { workspaceId } })
		expect(() =>
			parseCrmAdminSeatAdjustment({ ...adjustment, target: 'ENTITLEMENT' })
		).toThrow('Invalid CRM admin seat adjustment')
		expect(() =>
			parseCrmAdminSeatsResult(
				{
					...result,
					adjustment: { ...adjustment, newTotalSeats: 9 }
				},
				workspaceId,
				commandId,
				actor,
				command
			)
		).toThrow('Unexpected CRM admin seats result')
	})

	it('rejects history entries from another workspace or duplicate command IDs', () => {
		const page = {
			schemaVersion: 1 as const,
			page: 1,
			pageSize: 20,
			total: 1,
			items: [adjustment]
		}
		expect(
			parseCrmAdminSeatsHistory(page, workspaceId, 1, 20)
		).toMatchObject(page)
		expect(() =>
			parseCrmAdminSeatsHistory(
				{ ...page, items: [{ ...adjustment, workspaceId: periodId }] },
				workspaceId,
				1,
				20
			)
		).toThrow()
		expect(() =>
			parseCrmAdminSeatsHistory(
				{ ...page, total: 2, items: [adjustment, adjustment] },
				workspaceId,
				1,
				20
			)
		).toThrow('Unexpected CRM admin seats history')
	})

	it('accepts only actor-bound terminal recovery proofs, never a 404/nonterminal body', () => {
		const cancelled = {
			schemaVersion: 1 as const,
			workspaceId,
			commandId,
			actorSubject: actor,
			outcome: 'CANCELLED' as const,
			actorRole: 'ADMIN' as const,
			cancelledAt: createdAt
		}
		expect(
			parseCrmAdminSeatsRecovery(cancelled, workspaceId, commandId, actor)
		).toEqual(cancelled)
		for (const value of [
			{ status: 404 },
			{ ...cancelled, outcome: 'PENDING' },
			{ ...cancelled, actorSubject: 'other@example' },
			{ ...cancelled, extra: true }
		])
			expect(() =>
				parseCrmAdminSeatsRecovery(value, workspaceId, commandId, actor)
			).toThrow()
	})
})
