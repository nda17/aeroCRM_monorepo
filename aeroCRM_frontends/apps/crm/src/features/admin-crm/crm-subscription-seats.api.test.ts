import { beforeEach, describe, expect, it, vi } from 'vitest'

const http = vi.hoisted(() => ({
	classic: { post: vi.fn() },
	interceptors: { get: vi.fn() },
	getAccessToken: vi.fn(() => 'admin-token'),
	isAccessTokenValid: vi.fn(() => true)
}))
vi.mock('@/shared/api', () => ({
	axiosClassicRequest: http.classic,
	axiosInterceptorsRequest: http.interceptors,
	getAccessToken: http.getAccessToken,
	isAccessTokenValid: http.isAccessTokenValid
}))
vi.mock('jose', () => ({
	decodeJwt: vi.fn(() => ({ sub: 'admin@example' }))
}))

import { adminCrmSubscriptionsService } from '../../../../../packages/web/src/features/admin-crm/api/admin-crm-subscriptions.api'
import type { CrmAdminSeatsCommand } from '../../../../../packages/web/src/features/admin-crm/model/crm-subscription-seats.contract'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const commandId = '22222222-2222-4222-8222-222222222222'
const actor = 'admin@example'
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
const subscription = {
	workspaceId,
	ownerSubject: 'owner@example',
	entitlementVersion: '8',
	billingVersion: '13',
	entitlement: {
		planCode: 'TRIAL',
		status: 'ACTIVE',
		seatLimit: 8,
		effectiveFrom: '2026-09-01T12:00:00.000Z',
		effectiveUntil: '2026-10-01T12:00:00.000Z',
		graceUntil: '2026-10-04T12:00:00.000Z'
	},
	period: null,
	renewal: null,
	extensionTarget: 'ENTITLEMENT' as const,
	blockedReason: null
}
const result = {
	schemaVersion: 1 as const,
	workspaceId,
	commandId,
	adjustment: {
		commandId,
		workspaceId,
		actorSubject: actor,
		actorRole: 'ADMIN' as const,
		reason: command.reason,
		target: 'ENTITLEMENT' as const,
		periodId: null,
		oldTotalSeats: 6,
		newTotalSeats: 8,
		effectiveUntil: '2026-10-01T12:00:00.000Z',
		createdAt: '2026-09-21T12:00:00.000Z'
	},
	subscription
}
const cancelled = {
	schemaVersion: 1 as const,
	workspaceId,
	commandId,
	actorSubject: actor,
	outcome: 'CANCELLED' as const,
	actorRole: 'ADMIN' as const,
	cancelledAt: '2026-09-21T12:00:00.000Z'
}

beforeEach(() => {
	vi.clearAllMocks()
	http.getAccessToken.mockReturnValue('admin-token')
	http.isAccessTokenValid.mockReturnValue(true)
})

describe('CRM admin seats API', () => {
	it('sends one actor-bound POST with exact path, idempotency key and command CAS', async () => {
		http.classic.post.mockResolvedValue({ data: result })

		await expect(
			adminCrmSubscriptionsService.setSeats(workspaceId, actor, command)
		).resolves.toMatchObject({
			commandId,
			adjustment: { newTotalSeats: 8 }
		})
		expect(http.classic.post).toHaveBeenCalledExactlyOnceWith(
			`/subscriptions/admin/crm/${workspaceId}/seats`,
			command,
			expect.objectContaining({
				headers: {
					Authorization: 'Bearer admin-token',
					'Idempotency-Key': commandId
				},
				timeout: 30_000
			})
		)
	})

	it('does not send when actor or access token no longer matches the command', async () => {
		await expect(
			adminCrmSubscriptionsService.setSeats(
				workspaceId,
				'other@example',
				command
			)
		).rejects.toThrow('CRM grant authentication changed')
		http.getAccessToken.mockReturnValue(null as never)
		await expect(
			adminCrmSubscriptionsService.setSeats(workspaceId, actor, command)
		).rejects.toThrow('CRM grant authentication changed')
		expect(http.classic.post).not.toHaveBeenCalled()
	})

	it('never retries an unsafe POST after an unknown transport result', async () => {
		http.classic.post.mockRejectedValue(new Error('network timeout'))

		await expect(
			adminCrmSubscriptionsService.setSeats(workspaceId, actor, command)
		).rejects.toThrow('network timeout')
		expect(http.classic.post).toHaveBeenCalledTimes(1)
	})

	it('keeps recovery 404 nonterminal and does not manufacture a tombstone', async () => {
		http.interceptors.get.mockRejectedValue(new Error('404'))

		await expect(
			adminCrmSubscriptionsService.seatsCommand(
				workspaceId,
				commandId,
				actor
			)
		).rejects.toThrow('404')
		expect(http.interceptors.get).toHaveBeenCalledExactlyOnceWith(
			`/subscriptions/admin/crm/${workspaceId}/seats/commands/${commandId}`,
			expect.objectContaining({ timeout: 15_000 })
		)
	})

	it('sends the exact cancellation body and preserves actor-bound terminal proof', async () => {
		http.classic.post.mockResolvedValue({ data: cancelled })

		await expect(
			adminCrmSubscriptionsService.cancelSeatsCommand(
				workspaceId,
				commandId,
				actor
			)
		).resolves.toEqual(cancelled)
		expect(http.classic.post).toHaveBeenCalledExactlyOnceWith(
			`/subscriptions/admin/crm/${workspaceId}/seats/commands/${commandId}/cancel`,
			{ schemaVersion: 1, expectedActorSubject: actor },
			expect.objectContaining({
				headers: {
					Authorization: 'Bearer admin-token',
					'Idempotency-Key': commandId
				}
			})
		)
	})

	it.each([
		() => adminCrmSubscriptionsService.seats('bad-workspace'),
		() =>
			adminCrmSubscriptionsService.seatsHistory('bad-workspace', 1, 20),
		() =>
			adminCrmSubscriptionsService.setSeats(
				'bad-workspace',
				actor,
				command
			),
		() =>
			adminCrmSubscriptionsService.seatsCommand(
				workspaceId,
				'bad-command',
				actor
			),
		() =>
			adminCrmSubscriptionsService.cancelSeatsCommand(
				workspaceId,
				'bad-command',
				actor
			)
	])(
		'rejects malformed workspace/command before making a request',
		async request => {
			await expect(request()).rejects.toThrow()
			expect(http.classic.post).not.toHaveBeenCalled()
			expect(http.interceptors.get).not.toHaveBeenCalled()
		}
	)

	it('rejects a response bound to another workspace rather than trusting the HTTP status', async () => {
		http.classic.post.mockResolvedValue({
			data: { ...result, workspaceId: commandId }
		})

		await expect(
			adminCrmSubscriptionsService.setSeats(workspaceId, actor, command)
		).rejects.toThrow('Invalid CRM admin seats result')
	})
})
