import {
	useSessionStore,
	type AuthenticatedSession
} from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import {
	registerSessionTransport,
	type SessionTransportLease
} from '@/shared/api/session-transport'
import {
	refreshSession,
	SessionBootstrapError
} from '../api/refresh-session'

const RENEW_EARLY_MS = 30_000
const MIN_TIMER_MS = 1_000
const MAX_TIMER_MS = 2_147_483_647
const RETRY_BASE_MS = 5_000
const RETRY_MAX_MS = 60_000

interface TokenMetadata {
	subject: string
	sessionId: string
	expiresAt: number
}

// Unverified JWT metadata controls scheduling and same-session binding only.
// It never grants authority; Identity and domain services verify every request.
const tokenMetadata = (token: string): TokenMetadata | null => {
	const parts = token.split('.')
	// Opaque legacy/test credentials have no client-side expiry schedule.
	if (parts.length !== 3) return null
	if (token.length > 16_384 || !/^[A-Za-z0-9_-]+$/.test(parts[1]))
		throw new Error('Invalid session metadata')
	const payload: unknown = JSON.parse(
		new TextDecoder().decode(
			Uint8Array.from(
				atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')),
				character => character.charCodeAt(0)
			)
		)
	)
	if (!payload || typeof payload !== 'object' || Array.isArray(payload))
		throw new Error('Invalid session metadata')
	const { sub, sid, exp } = payload as Record<string, unknown>
	if (
		typeof sub !== 'string' ||
		!sub ||
		sub.length > 256 ||
		typeof sid !== 'string' ||
		!sid ||
		sid.length > 256 ||
		!Number.isSafeInteger(exp) ||
		Number(exp) <= 0 ||
		!Number.isSafeInteger(Number(exp) * 1_000)
	)
		throw new Error('Invalid session metadata')
	return { subject: sub, sessionId: sid, expiresAt: Number(exp) * 1_000 }
}

const unauthorized = () =>
	new AuthenticatedApiError('unauthorized', 'Сессия больше не действует.')
const temporary = () =>
	new AuthenticatedApiError(
		'temporary',
		'Не удалось обновить сессию. Черновик сохранён на странице; повторите действие через несколько секунд.'
	)

interface Binding {
	anchor: string
	subject: string
	revision: number
	bearer: string
	metadata: TokenMetadata | null
	pending: Promise<void> | null
	failures: number
	retryAt: number
}

/** A mounted bootstrap owns this in-memory lease; no bearer enters React/cache. */
export const installSessionRenewal = (onRenewed?: () => void) => {
	let mounted = true
	let binding: Binding | null = null
	let timer: ReturnType<typeof setTimeout> | undefined
	const stopTimer = () => {
		if (timer !== undefined) clearTimeout(timer)
		timer = undefined
	}
	const current = (expected: Binding) => {
		const state = useSessionStore.getState()
		return (
			mounted &&
			binding === expected &&
			state.status === 'authenticated' &&
			state.session?.accessToken === expected.anchor &&
			state.session.userId === expected.subject &&
			state.sessionRevision === expected.revision
		)
	}
	const invalidate = (expected: Binding) => {
		if (!current(expected)) return
		stopTimer()
		binding = null
		expected.bearer = ''
		useSessionStore.getState().setAnonymous()
	}
	const schedule = (expected: Binding) => {
		stopTimer()
		if (!current(expected) || (!expected.metadata && !expected.retryAt))
			return
		const due =
			expected.retryAt || expected.metadata!.expiresAt - RENEW_EARLY_MS
		timer = setTimeout(
			() => {
				timer = undefined
				if (current(expected)) void renew(expected).catch(() => undefined)
			},
			Math.min(MAX_TIMER_MS, Math.max(MIN_TIMER_MS, due - Date.now()))
		)
	}
	const accept = (expected: Binding, response: AuthenticatedSession) => {
		let metadata: TokenMetadata | null
		try {
			metadata = tokenMetadata(response.accessToken)
		} catch {
			invalidate(expected)
			throw unauthorized()
		}
		if (
			response.userId !== expected.subject ||
			(metadata && metadata.subject !== expected.subject) ||
			(expected.metadata &&
				(!metadata ||
					metadata.sessionId !== expected.metadata.sessionId)) ||
			(metadata && metadata.expiresAt <= Date.now() + MIN_TIMER_MS)
		) {
			invalidate(expected)
			throw unauthorized()
		}
		expected.bearer = response.accessToken
		expected.metadata = metadata
		expected.failures = 0
		expected.retryAt = 0
	}
	const renew = (expected: Binding): Promise<void> => {
		if (!current(expected)) return Promise.reject(unauthorized())
		if (expected.pending) return expected.pending
		if (Date.now() < expected.retryAt) return Promise.reject(temporary())
		stopTimer()
		let renewed = false
		const pending = refreshSession()
			.then(response => {
				if (!current(expected)) throw unauthorized()
				accept(expected, response)
				renewed = true
			})
			.catch(error => {
				if (!current(expected)) throw unauthorized()
				if (
					error instanceof SessionBootstrapError &&
					error.kind === 'anonymous'
				) {
					invalidate(expected)
					throw unauthorized()
				}
				expected.failures += 1
				expected.retryAt =
					Date.now() +
					Math.min(
						RETRY_MAX_MS,
						RETRY_BASE_MS * 2 ** Math.min(expected.failures - 1, 4)
					)
				throw temporary()
			})
			.finally(() => {
				expected.pending = null
				if (current(expected)) {
					schedule(expected)
					// Release single-flight before recovering failed reads, which resolve
					// this same binding again. Healthy queries and drafts stay untouched.
					if (renewed) onRenewed?.()
				}
			})
		expected.pending = pending
		return pending
	}
	const lease = (expected: Binding): SessionTransportLease => {
		if (!current(expected)) throw unauthorized()
		const bearer = expected.bearer
		return {
			accessToken: bearer,
			isCurrent: () => current(expected),
			refresh: async () => {
				if (!current(expected)) throw unauthorized()
				// A late 401 must not rotate again after another request renewed.
				if (expected.bearer === bearer) await renew(expected)
				if (!current(expected)) throw unauthorized()
				return lease(expected)
			}
		}
	}
	const unregister = registerSessionTransport(async anchor => {
		const expected = binding
		if (!expected || expected.anchor !== anchor || !current(expected))
			throw unauthorized()
		if (
			(expected.retryAt > 0 && expected.retryAt <= Date.now()) ||
			(expected.metadata &&
				expected.metadata.expiresAt - Date.now() <= RENEW_EARLY_MS)
		)
			await renew(expected)
		if (!current(expected)) throw unauthorized()
		return lease(expected)
	})
	const bind = () => {
		const state = useSessionStore.getState()
		if (binding && current(binding)) return
		stopTimer()
		if (binding) binding.bearer = ''
		binding = null
		if (!mounted || state.status !== 'authenticated' || !state.session)
			return
		let metadata: TokenMetadata | null
		try {
			metadata = tokenMetadata(state.session.accessToken)
			if (metadata && metadata.subject !== state.session.userId)
				throw new Error('Invalid session binding')
		} catch {
			state.setAnonymous()
			return
		}
		binding = {
			anchor: state.session.accessToken,
			subject: state.session.userId,
			revision: state.sessionRevision,
			bearer: state.session.accessToken,
			metadata,
			pending: null,
			failures: 0,
			retryAt: 0
		}
		schedule(binding)
	}
	const catchUp = () => {
		const expected = binding
		if (
			expected &&
			current(expected) &&
			((expected.retryAt > 0 && expected.retryAt <= Date.now()) ||
				(expected.metadata &&
					expected.metadata.expiresAt - Date.now() <= RENEW_EARLY_MS))
		)
			void renew(expected).catch(() => undefined)
	}
	const onVisible = () => {
		if (document.visibilityState === 'visible') catchUp()
	}
	const unsubscribe = useSessionStore.subscribe(bind)
	bind()
	window.addEventListener('focus', catchUp)
	window.addEventListener('pageshow', catchUp)
	window.addEventListener('online', catchUp)
	document.addEventListener('visibilitychange', onVisible)
	return () => {
		mounted = false
		stopTimer()
		unsubscribe()
		unregister()
		if (binding) binding.bearer = ''
		binding = null
		window.removeEventListener('focus', catchUp)
		window.removeEventListener('pageshow', catchUp)
		window.removeEventListener('online', catchUp)
		document.removeEventListener('visibilitychange', onVisible)
	}
}
