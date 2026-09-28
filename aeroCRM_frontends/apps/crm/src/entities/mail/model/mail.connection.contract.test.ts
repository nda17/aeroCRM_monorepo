import { describe, expect, it } from 'vitest'
import { parseMailConnectionResult } from './mail.contract'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const settings = {
	schemaVersion: 1,
	workspaceId,
	item: {
		imap: {
			host: 'imap.example.org',
			port: 993,
			security: 'TLS',
			username: 'mailbox@example.org'
		},
		smtp: {
			host: 'smtp.example.org',
			port: 587,
			security: 'STARTTLS',
			username: 'sender@example.org'
		}
	}
}

describe('mail connection settings response contract', () => {
	it('accepts only the public connection transport settings without secrets', () => {
		expect(parseMailConnectionResult(settings, workspaceId)).toEqual(
			settings
		)
	})

	it.each([
		{ ...settings, workspaceId: '22222222-2222-4222-8222-222222222222' },
		{ ...settings, secret: 'must never be returned' },
		{
			...settings,
			item: { ...settings.item, password: 'must never be returned' }
		},
		{
			...settings,
			item: {
				...settings.item,
				smtp: { ...settings.item.smtp, host: '127.0.0.1' }
			}
		},
		{
			...settings,
			item: {
				...settings.item,
				imap: { ...settings.item.imap, port: 143, security: 'TLS' }
			}
		}
	])(
		'rejects foreign workspace, secrets, and unsafe/invalid transport settings %#',
		value => {
			expect(parseMailConnectionResult(value, workspaceId)).toBeNull()
		}
	)
})
