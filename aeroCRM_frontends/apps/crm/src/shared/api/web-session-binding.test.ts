import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import axios, {
	AxiosError,
	type AxiosResponse,
	type InternalAxiosRequestConfig
} from 'axios'
import Cookies from 'js-cookie'
import {
	axiosClassicRequest,
	axiosInterceptorsRequest,
	refreshAccessToken
} from '../../../../../packages/web/src/shared/api/browser-client'
import {
	getAccessToken,
	getSessionRevision,
	removeFromStorage,
	saveTokenStorage
} from '../../../../../packages/web/src/shared/api/token-storage'
import { EnumTokens } from '../../../../../packages/web/src/shared/api/token-names'
import { clearBrowserSession } from '../../../../../packages/web/src/shared/api/clear-session'

const clearSessionMock = vi.hoisted(() => ({ clear: vi.fn() }))
vi.mock(
	'../../../../../packages/web/src/shared/api/clear-session',
	() => ({
		clearBrowserSession: clearSessionMock.clear
	})
)

const token = (sessionId: string, expiresAt = Date.now() + 3_600_000) => {
	const payload = btoa(
		JSON.stringify({
			sub: 'owner',
			sid: sessionId,
			exp: Math.floor(expiresAt / 1_000)
		})
	)
		.replace(/=/g, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
	return `header.${payload}.signature`
}

const refreshResponse = (accessToken: string) =>
	({
		data: { accessToken },
		status: 200,
		statusText: 'OK',
		headers: {},
		config: {}
	}) as AxiosResponse<{ accessToken: string }>

const deferred = <T>() => {
	let resolve!: (value: T) => void
	const promise = new Promise<T>(done => {
		resolve = done
	})
	return { promise, resolve }
}

beforeEach(() => {
	removeFromStorage()
})

afterEach(() => {
	removeFromStorage()
	delete axiosInterceptorsRequest.defaults.adapter
	vi.restoreAllMocks()
})

describe('shared browser session binding', () => {
	it('keeps a renewal in the same sid revision and advances revision for a new sid', () => {
		const initial = token('session-1')
		saveTokenStorage(initial)
		const revision = getSessionRevision()

		const renewed = token('session-1', Date.now() + 7_200_000)
		saveTokenStorage(renewed)
		expect(getSessionRevision()).toBe(revision)
		expect(getAccessToken()).toBe(renewed)

		const replacement = token('session-2')
		saveTokenStorage(replacement)
		expect(getSessionRevision()).toBe(revision + 1)
		expect(getAccessToken()).toBe(replacement)
	})

	it('does not refresh or clear the new login for a late 401 from the previous sid', async () => {
		const oldToken = token('session-1')
		saveTokenStorage(oldToken)
		const requestStarted = deferred<InternalAxiosRequestConfig>()
		let rejectRequest!: (error: AxiosError) => void
		axiosInterceptorsRequest.defaults.adapter = config => {
			requestStarted.resolve(config)
			return new Promise((_, reject) => {
				rejectRequest = reject
			})
		}
		const refresh = vi.spyOn(axiosClassicRequest, 'post')
		const pendingRequest = axiosInterceptorsRequest
			.get('/protected')
			.catch(error => error)
		const config = await requestStarted.promise
		const replacement = token('session-2')
		saveTokenStorage(replacement)
		const error = new AxiosError(
			'Unauthorized',
			'ERR_BAD_REQUEST',
			config,
			undefined,
			{
				data: {},
				status: 401,
				statusText: 'Unauthorized',
				headers: {},
				config
			}
		)
		rejectRequest(error)
		expect(await pendingRequest).toBe(error)
		expect(axios.isAxiosError(error)).toBe(true)
		expect(refresh).not.toHaveBeenCalled()
		expect(clearBrowserSession).not.toHaveBeenCalled()
		expect(getAccessToken()).toBe(replacement)
	})

	it('discards a refresh response that completes after the browser switched sid', async () => {
		const oldToken = token('session-1')
		saveTokenStorage(oldToken)
		const pending = deferred<AxiosResponse<{ accessToken: string }>>()
		const refresh = vi
			.spyOn(axiosClassicRequest, 'post')
			.mockReturnValue(
				pending.promise as ReturnType<typeof axiosClassicRequest.post>
			)
		const result = refreshAccessToken()
		const replacement = token('session-2')
		saveTokenStorage(replacement)
		pending.resolve(
			refreshResponse(token('session-2', Date.now() + 7_200_000))
		)

		await expect(result).rejects.toThrow('Session changed during renewal')
		expect(refresh).toHaveBeenCalledOnce()
		expect(getAccessToken()).toBe(replacement)
	})

	it('keeps a newer cross-tab cookie when an old-session refresh resolves without a local revision change', async () => {
		const oldToken = token('session-1')
		saveTokenStorage(oldToken)
		const revision = getSessionRevision()
		const pending = deferred<AxiosResponse<{ accessToken: string }>>()
		vi.spyOn(axiosClassicRequest, 'post').mockReturnValue(
			pending.promise as ReturnType<typeof axiosClassicRequest.post>
		)
		const result = refreshAccessToken()
		const replacement = token('session-2')
		Cookies.set(EnumTokens.ACCESS_TOKEN, replacement, { path: '/' })
		pending.resolve(
			refreshResponse(token('session-1', Date.now() + 7_200_000))
		)

		await expect(result).rejects.toThrow('Session changed during renewal')
		expect(getSessionRevision()).toBe(revision)
		expect(getAccessToken()).toBe(replacement)
	})
})
