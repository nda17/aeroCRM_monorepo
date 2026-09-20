import type { RuntimeConfig } from '@/shared/config/runtime'
import { describe, expect, it } from 'vitest'

import { buildLoginUrl, parseWorkspaceReturnPath } from './auth-return-url'

const config: RuntimeConfig = {
	mode: 'production',
	appOrigin: 'https://workspace.aerocrm.space',
	mainAppOrigin: 'https://aerocrm.space',
	apiBaseUrl: 'https://api.aerocrm.space/api/v1',
	crmEnabled: true,
	crmBillingEnabled: false
}

describe('workspace auth return path', () => {
	it('redirects to the local login page with a bounded workspace path', () => {
		const loginUrl = new URL(
			buildLoginUrl(
				'https://workspace.aerocrm.space/deals?stage=new&owner=me#card',
				config
			)
		)

		expect(loginUrl.origin).toBe(config.appOrigin)
		expect(loginUrl.pathname).toBe('/login')
		expect(loginUrl.searchParams.get('returnPath')).toBe(
			'/deals?stage=new&owner=me'
		)
	})

	it.each([
		'https://workspace.aerocrm.space.evil.example/inbox',
		'https://workspace.aerocrm.space:444/inbox',
		'https://user@workspace.aerocrm.space/inbox',
		'javascript:alert(1)',
		'/inbox',
		'https://workspace.aerocrm.space/login'
	])('rejects an unsafe source URL %s', value => {
		expect(() => buildLoginUrl(value, config)).toThrow()
	})

	it.each([
		'//evil.example',
		'https://evil.example',
		'/login',
		'/inbox/../login',
		'/inbox\\evil',
		'/inbox#fragment',
		'/inbox/%2f%2fevil',
		'/inbox?x=1\n',
		'x'.repeat(2049)
	])('rejects unsafe return path %s', value => {
		expect(parseWorkspaceReturnPath(value)).toBeNull()
	})

	it('accepts an invitation UUID and defaults to inbox', () => {
		expect(parseWorkspaceReturnPath(null)).toBe('/inbox')
		expect(
			parseWorkspaceReturnPath(
				'/invitations/123e4567-e89b-42d3-a456-426614174000'
			)
		).toBe('/invitations/123e4567-e89b-42d3-a456-426614174000')
	})
})
