import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedRequest } from '@/shared/api/authenticated-http-client'
import { getMailProcessing } from './mail.api'

vi.mock('@/shared/api/authenticated-http-client', () => ({
	authenticatedRequest: vi.fn(),
	invalidContractError: () => new Error('invalid contract')
}))
vi.mock('@/shared/api/authenticated-download', () => ({
	authenticatedDownload: vi.fn()
}))

const workspaceId = '11111111-1111-4111-8111-111111111111'
const messageId = '22222222-2222-4222-8222-222222222222'
const sendId = '33333333-3333-4333-8333-333333333333'
const date = '2026-10-12T10:00:00.000Z'

beforeEach(() => vi.clearAllMocks())

describe('mail reply processing API', () => {
	it('reads the exact workspace and message processing resource', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			workspaceId,
			messageId,
			replies: [
				{
					sendId,
					actorSubject: 'staff-4',
					membershipId: null,
					state: 'ACCEPTED',
					createdAt: date,
					submittedAt: date,
					settledAt: date,
					safeErrorCode: null
				}
			],
			hasMore: false
		})
		await expect(
			getMailProcessing('session', workspaceId, messageId)
		).resolves.toMatchObject({ messageId, replies: [{ sendId }] })
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'session',
			method: 'GET',
			url: `/crm/customers/mail/messages/${messageId}/processing`,
			params: { workspaceId }
		})
	})
	it('rejects unsafe identifiers before network access', async () => {
		await expect(
			getMailProcessing('session', workspaceId, '../other')
		).rejects.toThrow('invalid contract')
		expect(authenticatedRequest).not.toHaveBeenCalled()
	})
})
