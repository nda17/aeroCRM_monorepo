import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	generateSourceCredential,
	sourceWebhookUrl,
	tildaSourceWebhookUrl
} from './source-credential'

vi.mock('@/shared/config/runtime', () => ({
	getRuntimeConfig: () => ({ apiBaseUrl: 'http://localhost:4100/api/v1' })
}))
afterEach(() => vi.restoreAllMocks())
describe('one-time source credentials', () => {
	it('uses Web Crypto for exactly 32 bytes and canonical unpadded base64url', () => {
		const random = vi.spyOn(crypto, 'getRandomValues')
		const token = generateSourceCredential()
		expect(random).toHaveBeenCalledOnce()
		expect(random.mock.calls[0][0]).toHaveLength(32)
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
		const bytes = Buffer.from(token, 'base64url')
		expect(bytes.length).toBe(32)
		expect(bytes.toString('base64url')).toBe(token)
	})
	it('only builds the configured API URL and never accepts path/token injection', () => {
		expect(sourceWebhookUrl('11111111-1111-4111-8111-111111111111')).toBe(
			'http://localhost:4100/api/v1/crm/intake/ingest/11111111-1111-4111-8111-111111111111'
		)
		for (const id of [
			'../../other',
			'https://outside.example',
			'?token=secret',
			'11111111-1111-4111-8111-111111111111#token'
		]) {
			expect(() => sourceWebhookUrl(id)).toThrow()
			expect(() => tildaSourceWebhookUrl(id)).toThrow()
		}
	})
	it('adds the Tilda adapter path without changing the ordinary API URL', () => {
		const id = '11111111-1111-4111-8111-111111111111'
		expect(tildaSourceWebhookUrl(id)).toBe(
			`http://localhost:4100/api/v1/crm/intake/ingest/${id}/tilda`
		)
		expect(sourceWebhookUrl(id)).toBe(
			`http://localhost:4100/api/v1/crm/intake/ingest/${id}`
		)
	})
})
