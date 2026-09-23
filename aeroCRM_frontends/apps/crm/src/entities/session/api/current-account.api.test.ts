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
const cuidUserId = 'cmfabc1230000abcdefghij12'
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
	it('accepts the real extensible Identity profile and returns name and email', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue(profile)

		expect(await getCurrentAccount('token', userId)).toEqual({
			email: profile.email,
			name: profile.name
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
			email: null,
			name: profile.name
		})
	})

	it('accepts a profile without a display name', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			...profile,
			name: null
		})
		expect(await getCurrentAccount('token', userId)).toEqual({
			email: profile.email,
			name: null
		})
	})

	it('accepts an OAuth display name with emoji and more than 120 characters', async () => {
		const name = `${'Ж'.repeat(121)} 🚀`
		vi.mocked(authenticatedRequest).mockResolvedValue({ ...profile, name })

		expect(await getCurrentAccount('token', userId)).toEqual({
			email: profile.email,
			name
		})
	})

	it('accepts and binds an Identity CUID subject while returning the validated profile fields', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			...profile,
			id: cuidUserId
		})

		expect(await getCurrentAccount('token', cuidUserId)).toEqual({
			email: profile.email,
			name: profile.name
		})
		expect(authenticatedRequest).toHaveBeenCalledExactlyOnceWith({
			accessToken: 'token',
			method: 'GET',
			url: '/users/profile'
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

	it('rejects a different profile subject when the session subject is a CUID', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			...profile,
			id: 'cmfabc1230000abcdefghij99'
		})

		await expect(getCurrentAccount('token', cuidUserId)).rejects.toThrow(
			invalidContractError()
		)
	})

	it.each(['', 'unsafe\nsubject', ` ${cuidUserId}`])(
		'rejects invalid expected session subject %s before requesting profile',
		async expectedUserId => {
			await expect(
				getCurrentAccount('token', expectedUserId)
			).rejects.toThrow(invalidContractError())
			expect(authenticatedRequest).not.toHaveBeenCalled()
		}
	)

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

	it.each([
		'',
		'   ',
		'unsafe\nname',
		'unsafe\u0085name',
		'\uFFFD',
		`A${String.fromCharCode(0xd800)}B`,
		'A'.repeat(256),
		123,
		{ name: 'Person' }
	])('rejects unsafe display name %s', async name => {
		vi.mocked(authenticatedRequest).mockResolvedValue({ ...profile, name })

		await expect(getCurrentAccount('token', userId)).rejects.toThrow(
			invalidContractError()
		)
	})

	it('rejects a profile that omits the nullable name field', async () => {
		const profileWithoutName: Record<string, unknown> = { ...profile }
		delete profileWithoutName.name
		vi.mocked(authenticatedRequest).mockResolvedValue(profileWithoutName)

		await expect(getCurrentAccount('token', userId)).rejects.toThrow(
			invalidContractError()
		)
	})
})
