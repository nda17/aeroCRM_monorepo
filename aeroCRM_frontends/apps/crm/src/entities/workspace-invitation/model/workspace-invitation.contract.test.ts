import { describe, expect, it } from 'vitest'
import {
	parseInvitationAcceptance,
	parseWorkspaceInvitation
} from './workspace-invitation.contract'

const id = '11111111-1111-4111-8111-111111111111'
const workspaceId = '22222222-2222-4222-8222-222222222222'
const invitation = {
	id,
	workspaceId,
	productCode: 'WINCRM',
	version: 1,
	status: 'PENDING',
	expiresAt: '2099-01-01T00:00:00.000Z',
	acceptedAt: null
}
const acceptance = {
	id: '33333333-3333-4333-8333-333333333333',
	invitationId: id,
	invitationVersion: 2,
	workspaceId,
	productCode: 'WINCRM',
	subject: 'user-1',
	membershipId: '44444444-4444-4444-8444-444444444444',
	acceptedAt: '2026-09-05T00:00:00.000Z',
	emailVerifiedAt: '2026-09-04T00:00:00.000Z'
}

describe('workspace invitation contracts', () => {
	it('accepts the exact preview and acceptance contracts', () => {
		expect(
			parseWorkspaceInvitation({ schemaVersion: 1, invitation }, id)
		).toEqual(invitation)
		expect(
			parseInvitationAcceptance(
				{ schemaVersion: 1, acceptance },
				id,
				workspaceId,
				'user-1'
			)
		).toEqual(acceptance)
	})
	it.each([
		{ id: workspaceId },
		{ workspaceId: 'not-uuid' },
		{ productCode: 'WIDGETS' },
		{ status: 'ACTIVE' },
		{ version: 0 },
		{ version: 2147483648 },
		{ acceptedAt: '2026-09-05T00:00:00.000Z' },
		{ expiresAt: '2099-01-01' },
		{ email: 'private@example.test' }
	])('rejects invalid or expanded preview %#', patch => {
		expect(
			parseWorkspaceInvitation(
				{ schemaVersion: 1, invitation: { ...invitation, ...patch } },
				id
			)
		).toBeNull()
	})
	it('preserves revocation after acceptance without claiming active access', () => {
		expect(
			parseWorkspaceInvitation(
				{
					schemaVersion: 1,
					invitation: {
						...invitation,
						status: 'REVOKED',
						acceptedAt: acceptance.acceptedAt
					}
				},
				id
			)?.status
		).toBe('REVOKED')
	})
	it.each([
		{ invitationId: workspaceId },
		{ workspaceId: id },
		{ subject: 'another-user' },
		{ id: 'bad' },
		{ membershipId: 'bad' },
		{ invitationVersion: 0 },
		{ emailVerifiedAt: '2027-09-04T00:00:00.000Z' },
		{ active: true }
	])('rejects foreign or fabricated acceptance %#', patch => {
		expect(
			parseInvitationAcceptance(
				{ schemaVersion: 1, acceptance: { ...acceptance, ...patch } },
				id,
				workspaceId,
				'user-1'
			)
		).toBeNull()
	})
})
