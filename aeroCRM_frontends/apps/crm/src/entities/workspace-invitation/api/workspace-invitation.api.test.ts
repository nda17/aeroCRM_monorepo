import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedRequest } from '@/shared/api/authenticated-http-client'
import {
	acceptWorkspaceInvitation,
	getWorkspaceInvitation
} from './workspace-invitation.api'

vi.mock(
	'@/shared/api/authenticated-http-client',
	async importOriginal => ({
		...(await importOriginal<
			typeof import('@/shared/api/authenticated-http-client')
		>()),
		authenticatedRequest: vi.fn()
	})
)
const id = '11111111-1111-4111-8111-111111111111'
const workspaceId = '22222222-2222-4222-8222-222222222222'
const command = {
	schemaVersion: 1 as const,
	commandId: '33333333-3333-4333-8333-333333333333',
	expectedVersion: 1
}
const acceptance = {
	id: '44444444-4444-4444-8444-444444444444',
	invitationId: id,
	invitationVersion: 2,
	workspaceId,
	productCode: 'WINCRM',
	subject: 'user-1',
	membershipId: '55555555-5555-4555-8555-555555555555',
	acceptedAt: '2026-09-05T00:00:00.000Z',
	emailVerifiedAt: '2026-09-04T00:00:00.000Z'
}

describe('workspace invitation API', () => {
	beforeEach(() => vi.clearAllMocks())
	it('sends only the frozen acceptance DTO and matching idempotency header', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			acceptance
		})
		await expect(
			acceptWorkspaceInvitation(
				'test-token',
				id,
				workspaceId,
				'user-1',
				command
			)
		).resolves.toEqual(acceptance)
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'test-token',
			method: 'POST',
			url: `/workspace-invitations/${id}/accept`,
			data: command,
			headers: { 'Idempotency-Key': command.commandId }
		})
	})
	it('rejects unsafe route/command before any request', async () => {
		await expect(
			getWorkspaceInvitation('test-token', '../foreign')
		).rejects.toThrow()
		await expect(
			acceptWorkspaceInvitation('test-token', id, workspaceId, 'user-1', {
				...command,
				expectedVersion: 0
			})
		).rejects.toThrow()
		expect(authenticatedRequest).not.toHaveBeenCalled()
	})
	it('rejects cross-session acceptance response', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			acceptance: { ...acceptance, subject: 'other' }
		})
		await expect(
			acceptWorkspaceInvitation(
				'test-token',
				id,
				workspaceId,
				'user-1',
				command
			)
		).rejects.toThrow()
	})
})
