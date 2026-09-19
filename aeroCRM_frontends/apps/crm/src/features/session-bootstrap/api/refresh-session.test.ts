import { getPublicHttpClient } from '@/shared/api/http-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { refreshSession } from './refresh-session'

vi.mock('@/shared/api/http-client', () => ({
	getPublicHttpClient: vi.fn()
}))

const post = vi.fn()
const mockedGetPublicHttpClient = vi.mocked(getPublicHttpClient)

describe('refreshSession', () => {
	beforeEach(() => {
		post.mockReset()
		mockedGetPublicHttpClient.mockReturnValue({ post } as never)
	})
	afterEach(() => vi.useRealTimers())

	it('keeps only the minimal authenticated session fields', async () => {
		post.mockResolvedValue({
			data: {
				accessToken: 'access-token',
				user: {
					id: 'user-1',
					email: 'private@example.test'
				}
			}
		})

		await expect(refreshSession()).resolves.toEqual({
			accessToken: 'access-token',
			userId: 'user-1'
		})
		expect(post).toHaveBeenCalledWith('/auth/refresh')
	})

	it('classifies only HTTP 401 as an anonymous session', async () => {
		post.mockRejectedValue({
			isAxiosError: true,
			response: { status: 401 }
		})

		await expect(refreshSession()).rejects.toMatchObject({
			kind: 'anonymous'
		})
	})

	it.each([
		{ isAxiosError: true, response: { status: 409 } },
		{
			isAxiosError: true,
			response: { status: 409, data: { code: 'another_conflict' } }
		},
		{ isAxiosError: true, response: { status: 403 } },
		{ isAxiosError: true, response: { status: 500 } },
		{ isAxiosError: true, response: { status: 503 } },
		{ isAxiosError: true, code: 'ECONNABORTED' },
		{ isAxiosError: true }
	])('classifies non-401 failures as temporary', async error => {
		post.mockRejectedValue(error)

		await expect(refreshSession()).rejects.toMatchObject({
			kind: 'temporary'
		})
	})
	it('retries the documented concurrent rotation once after its grace window', async () => {
		vi.useFakeTimers()
		post
			.mockRejectedValueOnce({
				isAxiosError: true,
				response: {
					status: 409,
					data: { code: 'refresh_rotation_in_progress' }
				}
			})
			.mockResolvedValueOnce({
				data: { accessToken: 'rotated', user: { id: 'user-1' } }
			})
		const result = refreshSession()
		await vi.advanceTimersByTimeAsync(5_249)
		expect(post).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(1)
		await expect(result).resolves.toEqual({
			accessToken: 'rotated',
			userId: 'user-1'
		})
		expect(post).toHaveBeenCalledTimes(2)
	})
	it('stops after a second rotation conflict instead of retrying indefinitely', async () => {
		vi.useFakeTimers()
		post.mockRejectedValue({
			isAxiosError: true,
			response: {
				status: 409,
				data: { code: 'refresh_rotation_in_progress' }
			}
		})
		const result = expect(refreshSession()).rejects.toMatchObject({
			kind: 'temporary'
		})
		await vi.advanceTimersByTimeAsync(5_250)
		await result
		expect(post).toHaveBeenCalledTimes(2)
	})

	it('fails closed on an invalid response', async () => {
		post.mockResolvedValue({ data: { accessToken: 'access-token' } })

		await expect(refreshSession()).rejects.toMatchObject({
			kind: 'temporary'
		})
	})
})
