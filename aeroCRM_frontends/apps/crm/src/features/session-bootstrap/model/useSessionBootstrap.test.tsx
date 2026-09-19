import {
	resetSessionStore,
	useSessionStore,
	type AuthenticatedSession
} from '@/entities/session'
import {
	refreshSession,
	SessionBootstrapError
} from '@/features/session-bootstrap/api/refresh-session'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { StrictMode, type PropsWithChildren } from 'react'
import {
	QueryClient,
	QueryClientProvider,
	QueryObserver
} from '@tanstack/react-query'
import {
	authenticatedRequest,
	isSessionRecoveryReadError
} from '@/shared/api/authenticated-http-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSessionBootstrap } from './useSessionBootstrap'

vi.mock('@/features/session-bootstrap/api/refresh-session', async () => {
	const actual = await vi.importActual<
		typeof import('@/features/session-bootstrap/api/refresh-session')
	>('@/features/session-bootstrap/api/refresh-session')

	return {
		...actual,
		refreshSession: vi.fn()
	}
})

const mockedRefreshSession = vi.mocked(refreshSession)
const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@/shared/api/http-client', () => ({
	getPublicHttpClient: () => ({ request: send })
}))
let queryClient: QueryClient
const QueryWrapper = ({ children }: PropsWithChildren) => (
	<QueryClientProvider client={queryClient}>
		{children}
	</QueryClientProvider>
)
const bootstrap = () =>
	renderHook(() => useSessionBootstrap(), { wrapper: QueryWrapper })

const StrictModeWrapper = ({ children }: PropsWithChildren) => (
	<StrictMode>
		<QueryWrapper>{children}</QueryWrapper>
	</StrictMode>
)

describe('useSessionBootstrap', () => {
	beforeEach(() => {
		resetSessionStore()
		mockedRefreshSession.mockReset()
		send.mockReset().mockResolvedValue({ data: { allowed: true } })
		queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false, gcTime: Infinity } }
		})
	})

	afterEach(() => {
		cleanup()
		queryClient.clear()
		vi.useRealTimers()
	})

	it('deduplicates the refresh request under Strict Mode', async () => {
		mockedRefreshSession.mockResolvedValue({
			accessToken: 'access-token',
			userId: 'user-1'
		})

		const { result } = renderHook(() => useSessionBootstrap(), {
			wrapper: StrictModeWrapper
		})

		await waitFor(() => {
			expect(result.current.status).toBe('authenticated')
		})
		expect(mockedRefreshSession).toHaveBeenCalledTimes(1)
	})

	it('marks HTTP 401 as anonymous', async () => {
		mockedRefreshSession.mockRejectedValue(
			new SessionBootstrapError('anonymous', 'Требуется вход')
		)

		const { result } = bootstrap()

		await waitFor(() => {
			expect(result.current.status).toBe('anonymous')
		})
	})
	it('does not replace a newer login with a late initial bootstrap response', async () => {
		let complete!: (session: AuthenticatedSession) => void
		mockedRefreshSession.mockReturnValueOnce(
			new Promise(resolve => {
				complete = resolve
			})
		)
		bootstrap()
		const replacement = {
			accessToken: 'newer-session',
			userId: 'other-user'
		}
		await act(async () => {
			useSessionStore.getState().setAuthenticated(replacement)
			complete({ accessToken: 'old-bootstrap', userId: 'user-1' })
		})
		expect(useSessionStore.getState().session).toBe(replacement)
	})

	it('keeps temporary failures on a retryable error state', async () => {
		mockedRefreshSession.mockRejectedValue(
			new SessionBootstrapError('temporary', 'Временная ошибка')
		)

		const { result } = bootstrap()

		await waitFor(() => {
			expect(result.current).toMatchObject({
				status: 'error',
				errorMessage: 'Временная ошибка'
			})
		})
	})
	it('automatically retries a temporary bootstrap outage after bounded backoff', async () => {
		vi.useFakeTimers()
		mockedRefreshSession
			.mockRejectedValueOnce(
				new SessionBootstrapError('temporary', 'Недоступно')
			)
			.mockResolvedValueOnce({
				accessToken: 'recovered-session',
				userId: 'user-1'
			})
		const { result } = bootstrap()
		await act(async () => undefined)
		expect(result.current.status).toBe('error')
		await act(() => vi.advanceTimersByTimeAsync(4_999))
		expect(mockedRefreshSession).toHaveBeenCalledTimes(1)
		await act(() => vi.advanceTimersByTimeAsync(1))
		expect(result.current.status).toBe('authenticated')
		expect(mockedRefreshSession).toHaveBeenCalledTimes(2)
	})
	it('does not retry an explicit unsafe-login redirect failure', async () => {
		vi.useFakeTimers()
		mockedRefreshSession.mockRejectedValueOnce(
			new SessionBootstrapError('temporary', 'Недоступно')
		)
		const { result } = bootstrap()
		await act(async () => undefined)
		act(() => result.current.fail('Небезопасный адрес входа'))
		await act(() => vi.advanceTimersByTimeAsync(60_000))
		expect(result.current.status).toBe('error')
		expect(result.current.errorMessage).toBe('Небезопасный адрес входа')
		expect(mockedRefreshSession).toHaveBeenCalledTimes(1)
	})
	it('automatically recovers only active reads that failed during session renewal', async () => {
		vi.useFakeTimers()
		const now = new Date('2026-09-09T12:00:00Z').getTime()
		vi.setSystemTime(now)
		const token = (expiry: number) =>
			`header.${btoa(
				JSON.stringify({
					sub: 'user-1',
					sid: 'session-1',
					exp: expiry / 1000
				})
			)
				.replace(/=/g, '')
				.replace(/\+/g, '-')
				.replace(/\//g, '_')}.signature`
		const anchor = token(now + 60_000)
		useSessionStore
			.getState()
			.setAuthenticated({ accessToken: anchor, userId: 'user-1' })
		bootstrap()
		mockedRefreshSession.mockRejectedValueOnce(
			new SessionBootstrapError('temporary', 'Недоступно')
		)
		vi.setSystemTime(now + 70_000)
		const failedRead = vi.fn(() =>
			authenticatedRequest({
				accessToken: anchor,
				method: 'GET',
				url: '/crm/permissions'
			})
		)
		const unrelatedFailure = vi.fn(async () => {
			throw new Error('Ordinary network outage')
		})
		const healthyRead = vi.fn(async () => 'healthy')
		const permissionObserver = new QueryObserver(queryClient, {
			queryKey: ['recovery-permissions'],
			queryFn: failedRead
		})
		const unrelatedObserver = new QueryObserver(queryClient, {
			queryKey: ['unrelated'],
			queryFn: unrelatedFailure
		})
		const healthyObserver = new QueryObserver(queryClient, {
			queryKey: ['healthy'],
			queryFn: healthyRead,
			staleTime: Infinity
		})
		const releases = [
			permissionObserver,
			unrelatedObserver,
			healthyObserver
		].map(observer => observer.subscribe(() => undefined))
		try {
			await act(async () => undefined)
			expect(
				isSessionRecoveryReadError(
					queryClient.getQueryState(['recovery-permissions'])?.error
				)
			).toBe(true)
			expect(queryClient.getQueryState(['unrelated'])?.status).toBe(
				'error'
			)
			expect(healthyRead).toHaveBeenCalledTimes(1)
			mockedRefreshSession.mockResolvedValueOnce({
				accessToken: token(now + 600_000),
				userId: 'user-1'
			})
			await act(() => vi.advanceTimersByTimeAsync(5_000))
			expect(
				queryClient.getQueryState(['recovery-permissions'])?.status
			).toBe('success')
			expect(failedRead).toHaveBeenCalledTimes(2)
			expect(unrelatedFailure).toHaveBeenCalledTimes(1)
			expect(healthyRead).toHaveBeenCalledTimes(1)
			expect(send).toHaveBeenCalledTimes(1)
		} finally {
			releases.forEach(release => release())
		}
	})

	it('recovers from a temporary outage on explicit retry without classifying it as logout', async () => {
		mockedRefreshSession
			.mockRejectedValueOnce(
				new SessionBootstrapError('temporary', 'Временная ошибка')
			)
			.mockResolvedValueOnce({
				accessToken: 'synthetic-access-token',
				userId: 'user-1'
			})
		const { result } = bootstrap()
		await waitFor(() => expect(result.current.status).toBe('error'))
		expect(mockedRefreshSession).toHaveBeenCalledTimes(1)
		act(() => result.current.retry())
		await waitFor(() =>
			expect(result.current.status).toBe('authenticated')
		)
		expect(mockedRefreshSession).toHaveBeenCalledTimes(2)
		expect(result.current.errorMessage).toBeNull()
	})
})
