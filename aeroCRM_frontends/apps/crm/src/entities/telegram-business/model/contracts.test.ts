import { describe, expect, it } from 'vitest'
import {
	parseTelegramChannels,
	parseTelegramConversations,
	type TelegramBusinessBinding
} from './contracts'

const binding: TelegramBusinessBinding = {
	workspaceId: '22222222-2222-4222-8222-222222222222',
	subject: 'employee-subject'
}
const conversationId = '33333333-3333-4333-8333-333333333333'
const channelId = '44444444-4444-4444-8444-444444444444'

describe('Telegram Business response contracts', () => {
	it('accepts workspace messenger previews with server-resolved author labels', () => {
		const response = {
			schemaVersion: 3,
			...binding,
			page: 1,
			pageSize: 50,
			total: 1,
			unreadCount: 2,
			items: [
				{
					id: conversationId,
					kind: 'WORKSPACE',
					title: 'ООО Пример',
					peer: null,
					lastSequence: 12,
					readThroughSequence: 10,
					peerReadThroughSequence: null,
					unreadCount: 2,
					lastMessageAt: '2026-10-12T10:00:00.000Z',
					lastMessage: {
						id: '55555555-5555-4555-8555-555555555555',
						sequence: 12,
						senderName: 'Анна',
						senderSubject: null,
						text: 'Добрый день',
						createdAt: '2026-10-12T10:00:00.000Z'
					},
					canSend: true
				}
			]
		}
		expect(
			parseTelegramConversations(response, binding, 1, 50)
		).not.toBeNull()
		expect(
			parseTelegramConversations(
				{
					...response,
					items: [
						{
							...response.items[0],
							lastMessage: {
								...response.items[0]!.lastMessage!,
								senderSubject: 'employee@example.test'
							}
						}
					]
				},
				binding,
				1,
				50
			)
		).not.toBeNull()
		expect(
			parseTelegramConversations(
				{ ...response, subject: 'other-employee' },
				binding,
				1,
				50
			)
		).toBeNull()
		expect(
			parseTelegramConversations(
				{ ...response, canary: true },
				binding,
				1,
				50
			)
		).toBeNull()
	})

	it('requires the complete channel envelope and rejects cross-workspace responses', () => {
		const response = {
			schemaVersion: 1,
			...binding,
			configured: true,
			botUsername: 'crm_connect_bot',
			canManage: true,
			items: [
				{
					id: channelId,
					version: 3,
					status: 'ACTIVE',
					account: {
						id: 'telegram-account-123',
						displayName: 'Аэроклиент',
						username: 'aeroclient'
					},
					canReply: true,
					lastInboundAt: '2026-10-12T08:00:00.000Z',
					lastOutboundAt: null,
					connectedAt: '2026-10-12T09:00:00.000Z',
					disconnectedAt: null,
					lastErrorCode: null
				}
			]
		}
		expect(parseTelegramChannels(response, binding)).not.toBeNull()
		expect(
			parseTelegramChannels(
				{
					...response,
					workspaceId: '66666666-6666-4666-8666-666666666666'
				},
				binding
			)
		).toBeNull()
		expect(
			parseTelegramChannels({ ...response, configured: 'true' }, binding)
		).toBeNull()
	})
})
