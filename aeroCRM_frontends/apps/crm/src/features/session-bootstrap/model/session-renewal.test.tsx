import {
	resetSessionStore,
	useSessionStore,
	type AuthenticatedSession
} from '@/entities/session'
import { resolveSessionTransport } from '@/shared/api/session-transport'
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	refreshSession,
	SessionBootstrapError
} from '../api/refresh-session'
import { installSessionRenewal } from './session-renewal'

vi.mock('../api/refresh-session', async original => ({
	...(await original<object>()),
	refreshSession: vi.fn()
}))

const now = new Date('2026-09-09T12:00:00Z').getTime()
const jwt = (
	expiresAt: number,
	subject = 'owner',
	sessionId = 'session-1'
) =>
	`header.${btoa(
		JSON.stringify({ sub: subject, sid: sessionId, exp: expiresAt / 1000 })
	)
		.replace(/=/g, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')}.signature`
const deferred = () => {
	let resolve!: (value: AuthenticatedSession) => void
	const promise = new Promise<AuthenticatedSession>(done => {
		resolve = done
	})
	return { promise, resolve }
}
let stop: (() => void) | undefined
let anchor: string
const start = () => {
	anchor = jwt(now + 60_000)
	useSessionStore.getState().setAuthenticated({
		accessToken: anchor,
		userId: 'owner'
	})
	stop = installSessionRenewal()
}
beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(now)
	vi.mocked(refreshSession).mockReset()
	resetSessionStore()
})
afterEach(() => {
	stop?.()
	stop = undefined
	cleanup()
	resetSessionStore()
	vi.useRealTimers()
})

describe('mounted session renewal lease', () => {
	it('renews the private bearer before expiry without resetting the session owner or an open draft', async () => {
		start()
		const initial = useSessionStore.getState()
		const renewed = jwt(now + 600_000)
		vi.mocked(refreshSession).mockResolvedValue({
			accessToken: renewed,
			userId: 'owner'
		})
		const Draft = () => {
			const { session, sessionRevision } = useSessionStore()
			return (
				<input
					key={`${session?.userId}:${sessionRevision}`}
					aria-label="Черновик компании"
					defaultValue=""
				/>
			)
		}
		render(<Draft />)
		fireEvent.change(screen.getByRole('textbox'), {
			target: { value: 'Несохранённые реквизиты' }
		})
		const before = await resolveSessionTransport(anchor)
		await act(() => vi.advanceTimersByTimeAsync(30_000))
		const after = await resolveSessionTransport(anchor)
		expect(before.accessToken).toBe(anchor)
		expect(after.accessToken).toBe(renewed)
		expect(before.isCurrent()).toBe(true)
		expect(useSessionStore.getState().session).toBe(initial.session)
		expect(useSessionStore.getState().sessionRevision).toBe(
			initial.sessionRevision
		)
		expect(useSessionStore.getState().status).toBe('authenticated')
		expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
			'Несохранённые реквизиты'
		)
		expect(refreshSession).toHaveBeenCalledOnce()
	})
	it('shares an expired-session refresh and does not rotate again for a late 401 from an older lease', async () => {
		start()
		const old = await resolveSessionTransport(anchor)
		const pending = deferred()
		vi.mocked(refreshSession).mockReturnValue(pending.promise)
		vi.setSystemTime(now + 70_000)
		const first = resolveSessionTransport(anchor)
		const second = resolveSessionTransport(anchor)
		expect(refreshSession).toHaveBeenCalledOnce()
		const renewed = jwt(now + 600_000)
		pending.resolve({ accessToken: renewed, userId: 'owner' })
		expect((await first).accessToken).toBe(renewed)
		expect((await second).accessToken).toBe(renewed)
		expect((await old.refresh!()).accessToken).toBe(renewed)
		expect(refreshSession).toHaveBeenCalledOnce()
	})
	it.each(['focus', 'pageshow', 'online'])(
		'catches up after a suspended tab on %s',
		async event => {
			start()
			vi.mocked(refreshSession).mockResolvedValue({
				accessToken: jwt(now + 600_000),
				userId: 'owner'
			})
			vi.setSystemTime(now + 70_000)
			window.dispatchEvent(new Event(event))
			await resolveSessionTransport(anchor)
			expect(refreshSession).toHaveBeenCalledOnce()
		}
	)
	it('binds an initial bootstrap result synchronously before the first authenticated request', async () => {
		stop = installSessionRenewal()
		anchor = jwt(now + 600_000)
		useSessionStore.getState().setAuthenticated({
			accessToken: anchor,
			userId: 'owner'
		})
		expect((await resolveSessionTransport(anchor)).accessToken).toBe(
			anchor
		)
		await expect(
			resolveSessionTransport('foreign-binding')
		).rejects.toMatchObject({
			kind: 'unauthorized'
		})
		expect(refreshSession).not.toHaveBeenCalled()
	})
	it('preserves the draft owner on temporary failure and backs off repeated requests', async () => {
		start()
		const initial = useSessionStore.getState()
		vi.mocked(refreshSession).mockRejectedValue(
			new SessionBootstrapError('temporary', 'Недоступно')
		)
		vi.setSystemTime(now + 70_000)
		await expect(resolveSessionTransport(anchor)).rejects.toMatchObject({
			kind: 'temporary'
		})
		await expect(resolveSessionTransport(anchor)).rejects.toMatchObject({
			kind: 'temporary'
		})
		expect(refreshSession).toHaveBeenCalledOnce()
		expect(useSessionStore.getState().session).toBe(initial.session)
		expect(useSessionStore.getState().status).toBe('authenticated')
		vi.mocked(refreshSession).mockResolvedValue({
			accessToken: jwt(now + 600_000),
			userId: 'owner'
		})
		await vi.advanceTimersByTimeAsync(5_000)
		expect((await resolveSessionTransport(anchor)).accessToken).not.toBe(
			anchor
		)
		expect(refreshSession).toHaveBeenCalledTimes(2)
	})
	it.each(['subject', 'session', '401'])(
		'invalidates the lease after refresh %s mismatch without adopting another session',
		async mismatch => {
			start()
			const lease = await resolveSessionTransport(anchor)
			if (mismatch === '401')
				vi.mocked(refreshSession).mockRejectedValue(
					new SessionBootstrapError('anonymous', 'Требуется вход')
				)
			else
				vi.mocked(refreshSession).mockResolvedValue({
					accessToken: jwt(
						now + 600_000,
						mismatch === 'subject' ? 'another-user' : 'owner',
						mismatch === 'session' ? 'session-2' : 'session-1'
					),
					userId: mismatch === 'subject' ? 'another-user' : 'owner'
				})
			await expect(lease.refresh!()).rejects.toMatchObject({
				kind: 'unauthorized'
			})
			expect(lease.isCurrent()).toBe(false)
			expect(useSessionStore.getState().status).toBe('anonymous')
			expect(useSessionStore.getState().session).toBeNull()
		}
	)
	it('discards a late refresh after the session owner changes', async () => {
		start()
		const lease = await resolveSessionTransport(anchor)
		const pending = deferred()
		vi.mocked(refreshSession).mockReturnValue(pending.promise)
		const result = expect(lease.refresh!()).rejects.toMatchObject({
			kind: 'unauthorized'
		})
		const replacement = {
			accessToken: 'other-opaque-token',
			userId: 'other'
		}
		useSessionStore.getState().setAuthenticated(replacement)
		pending.resolve({ accessToken: jwt(now + 600_000), userId: 'owner' })
		await result
		expect(useSessionStore.getState().session).toBe(replacement)
		expect(lease.isCurrent()).toBe(false)
	})
	it('releases timers and rejects a late refresh on unmount', async () => {
		start()
		const lease = await resolveSessionTransport(anchor)
		const pending = deferred()
		vi.mocked(refreshSession).mockReturnValue(pending.promise)
		const result = expect(lease.refresh!()).rejects.toMatchObject({
			kind: 'unauthorized'
		})
		stop?.()
		stop = undefined
		pending.resolve({ accessToken: jwt(now + 600_000), userId: 'owner' })
		await result
		expect(lease.isCurrent()).toBe(false)
		expect(vi.getTimerCount()).toBe(0)
	})
	it('retains opaque legacy credentials without a timer loop but can explicitly renew them', async () => {
		anchor = 'opaque-original'
		useSessionStore
			.getState()
			.setAuthenticated({ accessToken: anchor, userId: 'owner' })
		stop = installSessionRenewal()
		const lease = await resolveSessionTransport(anchor)
		await vi.advanceTimersByTimeAsync(600_000)
		expect(refreshSession).not.toHaveBeenCalled()
		vi.mocked(refreshSession).mockResolvedValue({
			accessToken: 'opaque-renewed',
			userId: 'owner'
		})
		expect((await lease.refresh!()).accessToken).toBe('opaque-renewed')
		expect(useSessionStore.getState().session?.accessToken).toBe(anchor)
	})
	it.each(['jwt', 'opaque'])(
		'automatically retries a failed forced renewal before expiry for %s credentials',
		async kind => {
			anchor = kind === 'jwt' ? jwt(now + 600_000) : 'opaque-original'
			useSessionStore
				.getState()
				.setAuthenticated({ accessToken: anchor, userId: 'owner' })
			const recovered = vi.fn()
			stop = installSessionRenewal(recovered)
			const lease = await resolveSessionTransport(anchor)
			vi.mocked(refreshSession).mockRejectedValueOnce(
				new SessionBootstrapError('temporary', 'Недоступно')
			)
			await expect(lease.refresh!()).rejects.toMatchObject({
				kind: 'temporary'
			})
			expect(recovered).not.toHaveBeenCalled()
			const bearer = kind === 'jwt' ? jwt(now + 900_000) : 'opaque-renewed'
			vi.mocked(refreshSession).mockResolvedValueOnce({
				accessToken: bearer,
				userId: 'owner'
			})
			await vi.advanceTimersByTimeAsync(5_000)
			expect(refreshSession).toHaveBeenCalledTimes(2)
			expect(recovered).toHaveBeenCalledOnce()
			expect((await resolveSessionTransport(anchor)).accessToken).toBe(
				bearer
			)
		}
	)
})
