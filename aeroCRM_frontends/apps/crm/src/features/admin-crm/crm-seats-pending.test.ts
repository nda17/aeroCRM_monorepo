import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authStore = vi.hoisted(() => ({
	getState: vi.fn(() => ({ auth: true, isAuthResolved: true })),
	subscribe: vi.fn()
}))
vi.mock('@/entities/user/model/auth-store', () => ({
	useAuthStore: authStore
}))

import {
	bindCrmAdminSeatsActor,
	clearResolvedCrmAdminSeats,
	readPendingCrmAdminSeats,
	retainPendingCrmAdminSeats
} from '../../../../../packages/web/src/features/admin-crm/model/crm-seats-pending'
import type { CrmAdminSeatsCommand } from '../../../../../packages/web/src/features/admin-crm/model/crm-subscription-seats.contract'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const actor = 'admin@example'
const commandId = '22222222-2222-4222-8222-222222222222'
const command: CrmAdminSeatsCommand = {
	schemaVersion: 1,
	commandId,
	expectedActorSubject: actor,
	expectedEntitlementVersion: '7',
	expectedBillingVersion: '12',
	expectedPeriodId: null,
	expectedPeriodVersion: null,
	totalSeats: 8,
	reason: 'Increase paid seats'
}

beforeEach(() => {
	window.sessionStorage.clear()
})
afterEach(() => {
	bindCrmAdminSeatsActor(actor)
	try {
		clearResolvedCrmAdminSeats(actor, commandId)
	} catch {
		// The malformed-pointer case intentionally leaves an invalid marker.
	}
	window.sessionStorage.clear()
})

describe('CRM admin seats pending recovery pointer', () => {
	it('persists only workspace and command pointer, retaining command body in memory', () => {
		bindCrmAdminSeatsActor(actor)
		const pending = retainPendingCrmAdminSeats(actor, workspaceId, command)

		expect(
			window.sessionStorage.getItem(`aerocrm-admin-seats-v1:${actor}`)
		).toBe(JSON.stringify({ schemaVersion: 1, workspaceId, commandId }))
		expect(pending.command).toEqual(command)
		expect(readPendingCrmAdminSeats(actor)).toBe(pending)
	})

	it('keeps recovery pointers isolated by actor and rejects authentication drift', () => {
		bindCrmAdminSeatsActor(actor)
		retainPendingCrmAdminSeats(actor, workspaceId, command)

		const otherActor = 'other-admin@example'
		bindCrmAdminSeatsActor(otherActor)
		expect(readPendingCrmAdminSeats(otherActor)).toBeNull()
		expect(() =>
			retainPendingCrmAdminSeats(otherActor, workspaceId, {
				...command,
				commandId: '33333333-3333-4333-8333-333333333333',
				expectedActorSubject: actor
			})
		).toThrow('CRM seats authentication changed')
	})

	it('reuses only the identical unresolved command and blocks a different command', () => {
		bindCrmAdminSeatsActor(actor)
		const first = retainPendingCrmAdminSeats(actor, workspaceId, command)
		expect(
			retainPendingCrmAdminSeats(actor, workspaceId, first.command!)
		).toBe(first)
		expect(() =>
			retainPendingCrmAdminSeats(actor, workspaceId, {
				...command,
				totalSeats: 9
			})
		).toThrow('CRM seats command is unresolved')
	})

	it('requires the exact pending command before clearing the persisted pointer', () => {
		bindCrmAdminSeatsActor(actor)
		retainPendingCrmAdminSeats(actor, workspaceId, command)
		expect(() =>
			clearResolvedCrmAdminSeats(
				actor,
				'33333333-3333-4333-8333-333333333333'
			)
		).toThrow('CRM seats recovery pointer changed')
		expect(readPendingCrmAdminSeats(actor)).not.toBeNull()
		clearResolvedCrmAdminSeats(actor, commandId)
		expect(readPendingCrmAdminSeats(actor)).toBeNull()
		expect(window.sessionStorage.length).toBe(0)
	})

	it('rejects malformed persisted pointers instead of treating them as recoverable commands', () => {
		window.sessionStorage.setItem(
			`aerocrm-admin-seats-v1:${actor}`,
			JSON.stringify({ schemaVersion: 1, workspaceId, commandId, command })
		)
		bindCrmAdminSeatsActor(actor)
		expect(() => readPendingCrmAdminSeats(actor)).toThrow(
			'Invalid CRM seats recovery pointer'
		)
	})
})
