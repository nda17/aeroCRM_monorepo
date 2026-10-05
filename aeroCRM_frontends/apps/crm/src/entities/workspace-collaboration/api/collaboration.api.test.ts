import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedRequest } from '@/shared/api/authenticated-http-client'
import { listDirectory, sendChatMessage } from './collaboration.api'

vi.mock('@/shared/api/authenticated-http-client', () => ({
	authenticatedRequest: vi.fn(),
	invalidContractError: () => new Error('Invalid API contract')
}))
const workspaceId = '11111111-1111-4111-8111-111111111111'
const subject = 'actor-a'
beforeEach(() => vi.clearAllMocks())

describe('collaboration API boundary', () => {
	it('sends exact directory pagination binding and rejects an identity-swapped response', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			workspaceId,
			subject: 'intruder',
			page: 1,
			pageSize: 50,
			total: 0,
			items: []
		})
		await expect(
			listDirectory('token', { workspaceId, subject })
		).rejects.toThrow('Invalid API contract')
		expect(authenticatedRequest).toHaveBeenCalledExactlyOnceWith({
			accessToken: 'token',
			method: 'GET',
			url: '/crm/access/directory',
			params: {
				workspaceId,
				page: '1',
				pageSize: '50',
				includeArchived: 'false',
				activeOnly: 'false'
			}
		})
	})
	it('sends idempotency key while keeping conversationId only in the endpoint path', async () => {
		const conversationId = '33333333-3333-4333-8333-333333333333'
		const item = {
			id: '66666666-6666-4666-8666-666666666666',
			conversationId,
			sequence: 1,
			senderSubject: subject,
			senderMembershipId: null,
			senderName: 'Owner',
			text: 'Hello',
			createdAt: '2026-10-05T10:00:00.000Z'
		}
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			workspaceId,
			subject,
			item
		})
		await sendChatMessage('token', {
			workspaceId,
			subject,
			conversationId,
			commandId: '22222222-2222-4222-8222-222222222222',
			text: 'Hello'
		})
		expect(authenticatedRequest).toHaveBeenCalledExactlyOnceWith({
			accessToken: 'token',
			method: 'POST',
			url: `/crm/access/chat/conversations/${conversationId}/messages`,
			headers: {
				'Idempotency-Key': '22222222-2222-4222-8222-222222222222'
			},
			data: {
				schemaVersion: 1,
				workspaceId,
				commandId: '22222222-2222-4222-8222-222222222222',
				text: 'Hello'
			}
		})
	})
})
