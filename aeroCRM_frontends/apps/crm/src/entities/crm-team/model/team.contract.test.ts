import { describe, expect, it } from 'vitest'
import {
	parseCrmDelivery,
	parseCrmInvitation,
	parseCrmMember,
	parseTeamPage
} from './team.contract'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const id = '22222222-2222-4222-8222-222222222222'
const now = '2026-09-05T12:00:00.000Z'
const member = {
	id,
	workspaceId,
	subject: 'member',
	membershipId: '33333333-3333-4333-8333-333333333333',
	role: 'MANAGER',
	teamIds: [],
	disabledAt: null,
	version: 1,
	createdAt: now,
	updatedAt: now
}
const page = () => ({
	schemaVersion: 1,
	workspaceId,
	ownerSubject: 'owner',
	quota: { seatLimit: 5, usedSeats: 2, waitingCount: 1 },
	page: 1,
	pageSize: 20,
	total: 1,
	items: [
		{
			...member,
			displayName: 'Анна',
			verifiedEmail: 'verified@example.test'
		}
	]
})
describe('CRM team exact trust boundary', () => {
	it('preserves the owner-inclusive quota and nullable verified directory fields', () => {
		expect(
			parseTeamPage(page(), workspaceId, 'members', 1, 20)
		).toMatchObject({
			quota: { seatLimit: 5, usedSeats: 2 },
			items: [{ kind: 'member', displayName: 'Анна' }]
		})
		expect(
			parseCrmMember(
				{ ...member, displayName: null, verifiedEmail: null },
				workspaceId,
				true
			)
		).toMatchObject({ displayName: null, verifiedEmail: null })
	})
	it.each([
		{ role: 'OWNER' },
		{ workspaceId: id },
		{ version: 0 },
		{ teamIds: [id, id] },
		{ createdAt: '2026-09-05' },
		{ phone: '+79999999999' }
	])(
		'rejects foreign, privileged, duplicate or extra member fields %j',
		patch => {
			expect(
				parseCrmMember({ ...member, ...patch }, workspaceId)
			).toBeNull()
		}
	)
	it.each([
		{ page: 2 },
		{ pageSize: 100 },
		{ total: 0 },
		{ ownerSubject: 'member' },
		{ quota: { seatLimit: 1, usedSeats: 1, waitingCount: 0 } },
		{ items: [page().items[0], page().items[0]] }
	])('rejects mismatched page/quota metadata %j', patch => {
		expect(
			parseTeamPage({ ...page(), ...patch }, workspaceId, 'members', 1, 20)
		).toBeNull()
	})
	it('does not accept unnormalized email or arbitrary identity profiles', () => {
		expect(
			parseCrmMember(
				{
					...member,
					displayName: 'Name',
					verifiedEmail: 'CAPS@EXAMPLE.TEST'
				},
				workspaceId,
				true
			)
		).toBeNull()
		expect(
			parseCrmMember(
				{
					...member,
					displayName: 'Name',
					verifiedEmail: null,
					oauthId: 'private'
				},
				workspaceId,
				true
			)
		).toBeNull()
	})
	it('validates canonical invitations without interpreting email acceptance as active CRM access', () => {
		const value = {
			id,
			workspaceId,
			email: 'verified@example.test',
			role: 'MANAGER',
			teamIds: [],
			status: 'ACCEPTED',
			version: 3,
			expiresAt: now,
			createdAt: now,
			updatedAt: now
		}
		expect(parseCrmInvitation(value, workspaceId)?.status).toBe('ACCEPTED')
		expect(
			parseCrmInvitation({ ...value, status: 'ACTIVE' }, workspaceId)
		).toBeNull()
	})
	it('does not accept poisoned or cross-workspace delivery rows', () => {
		const value = {
			id,
			workspaceId,
			eventId: id,
			consumer: 'admission',
			status: 'DEAD_LETTERED',
			version: 2,
			retryAttempt: 3,
			manualRetryCycle: 0,
			lastError: 'TEAM_OPERATION_FAILED',
			createdAt: now,
			updatedAt: now
		}
		expect(parseCrmDelivery(value, workspaceId)).toEqual(value)
		expect(
			parseCrmDelivery({ ...value, workspaceId: null }, workspaceId)
		).toBeNull()
		expect(
			parseCrmDelivery(
				{ ...value, payload: { secret: 'hidden' } },
				workspaceId
			)
		).toBeNull()
	})
})
