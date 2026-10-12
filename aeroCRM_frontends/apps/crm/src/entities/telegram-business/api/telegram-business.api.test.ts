import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedRequest } from '@/shared/api/authenticated-http-client'
import {
	createTelegramConnectSession,
	getTelegramMessengerFeed,
	markTelegramConversationRead,
	replyToTelegramMessage
} from './telegram-business.api'

vi.mock('@/shared/api/authenticated-http-client', () => ({
	authenticatedRequest: vi.fn(),
	invalidContractError: () => new Error('Invalid API contract')
}))

const workspaceId = '11111111-1111-4111-8111-111111111111'
const conversationId = '22222222-2222-4222-8222-222222222222'
const commandId = '33333333-3333-4333-8333-333333333333'
const subject = 'employee-a'
beforeEach(() => vi.clearAllMocks())

describe('Telegram Business API boundary', () => {
	it('accepts a monotonic v3 read cursor and validates the real response envelope', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 3,
			workspaceId,
			subject,
			conversationId,
			throughSequence: 18,
			unreadCount: 0
		})
		await expect(
			markTelegramConversationRead('token', {
				workspaceId,
				subject,
				conversationId,
				commandId,
				throughSequence: 17
			})
		).resolves.toMatchObject({ throughSequence: 18, unreadCount: 0 })
		expect(authenticatedRequest).toHaveBeenCalledExactlyOnceWith({
			accessToken: 'token',
			method: 'PUT',
			url: `/crm/access/chat/conversations/${conversationId}/read-v3`,
			headers: { 'Idempotency-Key': commandId },
			data: {
				schemaVersion: 3,
				workspaceId,
				commandId,
				throughSequence: 17
			}
		})
	})

	it('uses the v3 feed route and rejects a response bound to another actor', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 3,
			workspaceId,
			subject: 'employee-b',
			conversationId,
			items: [],
			nextBeforeSequence: null,
			lastSequence: 0,
			readThroughSequence: 0,
			unreadCount: 0,
			canSend: false
		})
		await expect(
			getTelegramMessengerFeed('token', {
				workspaceId,
				subject,
				conversationId
			})
		).rejects.toThrow('Invalid API contract')
		expect(authenticatedRequest).toHaveBeenCalledExactlyOnceWith({
			accessToken: 'token',
			method: 'GET',
			url: `/crm/access/chat/conversations/${conversationId}/messages-v3`,
			params: { workspaceId, limit: '50' }
		})
	})

	it('binds connect-session creation to the command receipt key and exact request envelope', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			workspaceId,
			subject,
			item: {
				id: conversationId,
				version: 1,
				state: 'WAITING_TELEGRAM',
				expiresAt: '2026-10-12T12:00:00.000Z',
				deepLink: 'https://t.me/aerocrm_tech_bot?start=synthetic',
				owner: null,
				channelId: null,
				errorCode: null
			}
		})
		await createTelegramConnectSession('token', {
			workspaceId,
			subject,
			commandId
		})
		expect(authenticatedRequest).toHaveBeenCalledExactlyOnceWith({
			accessToken: 'token',
			method: 'POST',
			url: '/crm/access/telegram/connect-sessions',
			headers: { 'Idempotency-Key': commandId },
			data: { schemaVersion: 1, workspaceId, commandId }
		})
	})

	it('keeps source message identity and command identity distinct for replies', async () => {
		const sourceMessageId = '44444444-4444-4444-8444-444444444444'
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			workspaceId,
			subject,
			commandId,
			messageId: 'crm-message-91',
			deliveryStatus: 'QUEUED'
		})
		await replyToTelegramMessage('token', {
			workspaceId,
			subject,
			commandId,
			sourceMessageId,
			text: 'Здравствуйте'
		})
		expect(authenticatedRequest).toHaveBeenCalledExactlyOnceWith({
			accessToken: 'token',
			method: 'POST',
			url: `/crm/access/telegram/messages/${encodeURIComponent(sourceMessageId)}/replies`,
			headers: { 'Idempotency-Key': commandId },
			data: {
				schemaVersion: 1,
				workspaceId,
				commandId,
				text: 'Здравствуйте'
			}
		})
	})
})
