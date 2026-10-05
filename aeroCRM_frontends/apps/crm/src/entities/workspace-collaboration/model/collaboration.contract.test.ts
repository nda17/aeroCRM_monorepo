import { describe, expect, it } from 'vitest'
import {
	parseChatDirect,
	parseMessageList,
	parseDirectoryList,
	type CollaborationBinding
} from './collaboration.contract'

const binding: CollaborationBinding = {
	workspaceId: '11111111-1111-4111-8111-111111111111',
	subject: 'actor-a'
}
const entry = {
	id: '22222222-2222-4222-8222-222222222222',
	subject: null,
	membershipId: null,
	invitationId: null,
	status: 'INVITED',
	isOwner: false,
	displayName: 'Приглашение',
	fields: {
		firstName: null,
		lastName: null,
		middleName: null,
		phone: null,
		email: null,
		position: null,
		department: null,
		extension: null,
		telegram: null
	},
	version: 1,
	archivedAt: null,
	updatedAt: '2026-10-05T10:00:00.000Z',
	canEdit: false,
	canArchive: false,
	canMessage: false
}
const conversation = {
	id: '33333333-3333-4333-8333-333333333333',
	kind: 'DIRECT',
	title: 'Пользователь',
	peer: {
		subject: 'peer',
		membershipId: '44444444-4444-4444-8444-444444444444',
		displayName: 'Peer',
		active: true
	},
	lastSequence: 2,
	readThroughSequence: 0,
	peerReadThroughSequence: 1,
	unreadCount: 2,
	lastMessageAt: null,
	lastMessage: null,
	canSend: true
}
const envelope = (overrides: Record<string, unknown> = {}) => ({
	schemaVersion: 1,
	...binding,
	page: 1,
	pageSize: 50,
	total: 1,
	items: [entry],
	...overrides
})

describe('collaboration strict contracts', () => {
	it('accepts nullable invitation contacts and rejects foreign workspace or subject', () => {
		expect(
			parseDirectoryList(envelope(), binding, 1, 50)?.items[0]?.fields
				.phone
		).toBeNull()
		expect(
			parseDirectoryList(
				envelope({ workspaceId: '55555555-5555-4555-8555-555555555555' }),
				binding,
				1,
				50
			)
		).toBeNull()
		expect(
			parseDirectoryList(envelope({ subject: 'other' }), binding, 1, 50)
		).toBeNull()
	})
	it('rejects unknown keys, invalid identifiers, oversized numbers and mismatched pagination', () => {
		expect(
			parseDirectoryList(envelope({ unexpected: true }), binding, 1, 50)
		).toBeNull()
		expect(
			parseDirectoryList(envelope({ page: 2 }), binding, 1, 50)
		).toBeNull()
		expect(
			parseDirectoryList(
				envelope({ items: [{ ...entry, id: 'not-a-uuid' }] }),
				binding,
				1,
				50
			)
		).toBeNull()
		expect(
			parseDirectoryList(
				envelope({ total: Number.MAX_SAFE_INTEGER + 1 }),
				binding,
				1,
				50
			)
		).toBeNull()
	})
	it('binds message response to conversation and enforces ascending bounded sequence pagination', () => {
		const message = (sequence: number) => ({
			id: '66666666-6666-4666-8666-666666666666',
			conversationId: conversation.id,
			sequence,
			senderSubject: 'peer',
			senderMembershipId: null,
			senderName: 'Peer',
			text: 'Hi',
			createdAt: '2026-10-05T10:00:00.000Z'
		})
		const base = {
			schemaVersion: 1,
			...binding,
			conversation,
			items: [message(2), message(3)],
			nextBeforeSequence: null
		}
		expect(
			parseMessageList(base, binding, conversation.id, undefined, 50)
		).not.toBeNull()
		expect(
			parseMessageList(
				{ ...base, items: [message(3), message(2)] },
				binding,
				conversation.id,
				undefined,
				50
			)
		).toBeNull()
		expect(
			parseMessageList(
				base,
				binding,
				'77777777-7777-4777-8777-777777777777',
				undefined,
				50
			)
		).toBeNull()
		expect(
			parseMessageList(
				{ ...base, nextBeforeSequence: 2 },
				binding,
				conversation.id,
				undefined,
				50
			)
		).toBeNull()
	})
	it('requires participant-scoped read receipt only for direct conversations', () => {
		expect(parseDirectoryList(envelope(), binding, 1, 50)).not.toBeNull()
		const response = { schemaVersion: 1, ...binding, conversation }
		expect(parseChatDirect(response, binding)).not.toBeNull()
		expect(
			parseChatDirect(
				{
					...response,
					conversation: { ...conversation, peerReadThroughSequence: null }
				},
				binding
			)
		).toBeNull()
		expect(
			parseChatDirect(
				{
					...response,
					conversation: { ...conversation, peer: null, kind: 'WORKSPACE' }
				},
				binding
			)
		).toBeNull()
	})
})
