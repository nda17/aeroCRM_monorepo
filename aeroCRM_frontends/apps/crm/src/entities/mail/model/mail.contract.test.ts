import { describe, expect, it } from 'vitest'
import {
	parseMailLinkResult,
	parseMailMailboxPage,
	parseMailMailboxResult
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
			parseMailMailboxResult({ schemaVersion: 1, workspaceId, item }, workspaceId)
			?.item
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
			parseMailMailboxResult({ schemaVersion: 1, workspaceId, item }, workspaceId)
		).toBeNull()
	})
})
