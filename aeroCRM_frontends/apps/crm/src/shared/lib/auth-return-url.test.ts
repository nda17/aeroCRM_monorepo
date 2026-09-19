import type { RuntimeConfig } from '@/shared/config/runtime'
import { describe, expect, it } from 'vitest'

import { buildLoginUrl } from './auth-return-url'

const config: RuntimeConfig = {
	mode: 'production',
	appOrigin: 'https://workspace.aerocrm.space',
	mainAppOrigin: 'https://aerocrm.space',
	apiBaseUrl: 'https://api.aerocrm.space/api/v1',
	wincrmEnabled: true,
	wincrmBillingEnabled: false
}

describe('buildLoginUrl', () => {
	it('preserves the CRM path and query in an encoded returnUrl', () => {
		const value = buildLoginUrl(
			'https://workspace.aerocrm.space/deals?stage=new&owner=me',
			config
		)
		const loginUrl = new URL(value)

		expect(loginUrl.origin).toBe('https://aerocrm.space')
		expect(loginUrl.pathname).toBe('/login')
		expect(loginUrl.searchParams.get('returnUrl')).toBe(
			'https://workspace.aerocrm.space/deals?stage=new&owner=me'
		)
	})

	it('drops fragments from the return target', () => {
		const loginUrl = new URL(
			buildLoginUrl('https://workspace.aerocrm.space/inbox#message-1', config)
		)

		expect(loginUrl.searchParams.get('returnUrl')).toBe(
			'https://workspace.aerocrm.space/inbox'
		)
	})

	it.each([
		'https://workspace.aerocrm.space.evil.example/inbox',
		'https://workspace.aerocrm.space:444/inbox',
		'https://user@workspace.aerocrm.space/inbox',
		'javascript:alert(1)',
		'/inbox'
	])('rejects unsafe return target %s', value => {
		expect(() => buildLoginUrl(value, config)).toThrow()
	})

	it('rejects an excessively long return target', () => {
		const prefix = 'https://workspace.aerocrm.space/inbox?query='
		const maximumLengthUrl = `${prefix}${'x'.repeat(2048 - prefix.length)}`

		expect(() => buildLoginUrl(maximumLengthUrl, config)).not.toThrow()
		expect(() => buildLoginUrl(`${maximumLengthUrl}x`, config)).toThrow(
			'CRM return URL is invalid'
		)
	})
})
