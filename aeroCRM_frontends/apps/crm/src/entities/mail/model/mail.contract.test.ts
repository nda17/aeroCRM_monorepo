import { describe, expect, it } from 'vitest'
import { parseMailLinkResult } from './mail.contract'

const workspaceId = '11111111-1111-4111-8111-111111111111'
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
