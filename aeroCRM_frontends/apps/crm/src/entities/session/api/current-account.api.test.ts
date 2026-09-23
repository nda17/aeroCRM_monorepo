import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { getCurrentAccount } from './current-account.api'

vi.mock(
	'@/shared/api/authenticated-http-client',
	async importOriginal => ({
		...(await importOriginal<
			typeof import('@/shared/api/authenticated-http-client')
		>()),
		authenticatedRequest: vi.fn()
	})
)

const userId = '11111111-1111-4111-8111-111111111111'
const profile = {
	id: userId,
	email: 'person@example.com',
	name: 'Person',
	status: 'ACTIVE',
	rights: ['USER'],
	loginMethods: ['EMAIL'],
	createdAt: '2026-01-01T00:00:00.000Z'
}

beforeEach(() => vi.resetAllMocks())

describe('getCurrentAccount', () => {
	it('accepts the real extensible Identity profile and returns only email', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue(profile)

		expect(await getCurrentAccount('token', userId)).toEqual({
			email: profile.email
		})
		expect(authenticatedRequest).toHaveBeenCalledExactlyOnceWith({
			accessToken: 'token',
			method: 'GET',
			url: '/users/profile'
		})
	})

	it('accepts a missing email', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			...profile,
			email: null
		})
		expect(await getCurrentAccount('token', userId)).toEqual({
			email: null
		})
	})

	it('rejects a foreign profile id', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			...profile,
			id: '22222222-2222-4222-8222-222222222222'
		})

		await expect(getCurrentAccount('token', userId)).rejects.toThrow(
			invalidContractError()
		)
	})

	it.each([
		'person@',
		' person@example.com',
		'person@example.com ',
		'a'.repeat(250)
	])('rejects unsafe email %s', async email => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			...profile,
			email
		})

		await expect(getCurrentAccount('token', userId)).rejects.toThrow(
			invalidContractError()
		)
	})
})
