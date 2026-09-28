import { describe, expect, it } from 'vitest'
import {
	parseMailLinkResult,
	parseMailMailboxPage,
	parseMailMailboxResult,
	parseMailMessageResult,
	parseMailRichMessageResult
} from './mail.contract'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const mailboxId = '22222222-2222-4222-8222-222222222222'
const mailbox = {
	id: mailboxId,
	kind: 'PERSONAL',
	address: 'mailbox@example.org',
	displayName: 'Рабочая почта',
	state: 'ACTIVE',
	version: 2,
	permissions: ['read', 'send', 'manage'],
	syncStatus: 'IDLE',
	lastSyncAt: null,
	safeErrorCode: null
}
const message = {
	id: '33333333-3333-4333-8333-333333333333',
	mailboxId,
	direction: 'INBOUND',
	subject: 'Вопрос по предложению',
	from: [{ email: 'customer@example.org', name: null }],
	to: [{ email: 'mailbox@example.org', name: null }],
	cc: [],
	sentAt: null,
	receivedAt: '2026-09-28T10:00:00.000Z',
	attachmentCount: 0,
	sourceKind: 'IMAP',
	state: null,
	createdAt: '2026-09-28T10:00:00.000Z',
	text: '',
	bodyStatus: 'COMPLETE',
	bcc: [],
	attachments: [],
	links: [],
	provenance: {
		folderPath: 'INBOX',
		uidValidity: '1',
		uid: '1',
		messageId: '<mail@example.org>',
		inReplyTo: null,
		references: []
	}
}
const link = {
	schemaVersion: 1,
	workspaceId,
	item: {
		externalEmail: 'customer@example.org',
		contactId: '22222222-2222-4222-8222-222222222222',
		state: 'LINKED',
		version: 2
	}
}

describe('mail contact link response contract', () => {
	it('accepts an exact workspace scoped link item', () => {
		expect(parseMailLinkResult(link, workspaceId)).toEqual(link)
	})

	it.each([
		{ ...link, workspaceId: '33333333-3333-4333-8333-333333333333' },
		{ ...link, extra: 'ignored fields are forbidden' },
		{
			...link,
			item: { ...link.item, state: 'LINKED', contactId: null }
		},
		{
			...link,
			item: {
				...link.item,
				state: 'UNMATCHED',
				contactId: link.item.contactId
			}
		}
	])('rejects malformed or out-of-scope link response %#', value => {
		expect(parseMailLinkResult(value, workspaceId)).toBeNull()
	})
})

describe('mailbox sync status contract', () => {
	it.each([
		'NOT_CONFIGURED',
		'IDLE',
		'SYNCING',
		'BACKFILL',
		'CURRENT',
		'ERROR',
		'DISCONNECTED'
	])('accepts %s in mailbox pages and command results', syncStatus => {
		const item = { ...mailbox, syncStatus }
		expect(
			parseMailMailboxPage(
				{ schemaVersion: 1, workspaceId, items: [item], nextCursor: null },
				workspaceId
			)?.items
		).toEqual([item])
		expect(
			parseMailMailboxResult(
				{ schemaVersion: 1, workspaceId, item },
				workspaceId
			)?.item
		).toEqual(item)
	})

	it('rejects unknown sync statuses in mailbox pages and command results', () => {
		const item = { ...mailbox, syncStatus: 'UNKNOWN_SYNC_STATE' }
		expect(
			parseMailMailboxPage(
				{ schemaVersion: 1, workspaceId, items: [item], nextCursor: null },
				workspaceId
			)
		).toBeNull()
		expect(
			parseMailMailboxResult(
				{ schemaVersion: 1, workspaceId, item },
				workspaceId
			)
		).toBeNull()
	})
})

describe('mail message body contract', () => {
	it.each(['', '  \n\t'])(
		'accepts an empty or whitespace-only body %j',
		text => {
			const item = { ...message, text }
			expect(
				parseMailMessageResult(
					{ schemaVersion: 1, workspaceId, item },
					workspaceId
				)?.item.text
			).toBe(text)
		}
	)

	it.each(['x'.repeat(262_145), 42, { text: 'invalid' }])(
		'rejects an oversized or non-string body %#',
		text => {
			expect(
				parseMailMessageResult(
					{ schemaVersion: 1, workspaceId, item: { ...message, text } },
					workspaceId
				)
			).toBeNull()
		}
	)
})

describe('mail detail HTML opt-in compatibility', () => {
	it('keeps legacy exact keys and requires html on the new contract', () => {
		const plain = { schemaVersion: 1, workspaceId, item: message }
		expect(parseMailMessageResult(plain, workspaceId)).not.toBeNull()
		expect(parseMailRichMessageResult(plain, workspaceId)).toBeNull()
		for (const html of [null, '<p>Hello</p>']) {
			const rich = { ...plain, item: { ...message, html } }
			expect(parseMailMessageResult(rich, workspaceId)).toBeNull()
			expect(parseMailRichMessageResult(rich, workspaceId)).not.toBeNull()
		}
		expect(
			parseMailRichMessageResult(
				{ ...plain, item: { ...message, html: 3 } },
				workspaceId
			)
		).toBeNull()
	})
})
