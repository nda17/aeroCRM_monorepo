'use client'

import {
	type AuthenticatedSession,
	useSessionStore
} from '@/entities/session'
import {
	refreshSession,
	SessionBootstrapError
} from '@/features/session-bootstrap/api/refresh-session'
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { isSessionRecoveryReadError } from '@/shared/api/authenticated-http-client'
import { installSessionRenewal } from './session-renewal'

let pendingBootstrap: Promise<AuthenticatedSession> | null = null

const bootstrapSessionOnce = () => {
	if (!pendingBootstrap) {
		pendingBootstrap = refreshSession().then(
			session => {
				pendingBootstrap = null
				return session
			},
			error => {
				pendingBootstrap = null
				throw error
			}
		)
	}

	return pendingBootstrap
}

export const useSessionBootstrap = () => {
	const queryClient = useQueryClient()
	const status = useSessionStore(state => state.status)
	const errorMessage = useSessionStore(state => state.errorMessage)
	const setChecking = useSessionStore(state => state.setChecking)
	const setAuthenticated = useSessionStore(state => state.setAuthenticated)
	const setAnonymous = useSessionStore(state => state.setAnonymous)
	const setError = useSessionStore(state => state.setError)
	const failures = useRef(0)
	const retryAllowed = useRef(false)
	const [retryAt, setRetryAt] = useState<number | null>(null)
	// Install before child query effects; the subscription binds a bootstrap
	// result synchronously before the authenticated workspace can render.
	useLayoutEffect(
		() =>
			installSessionRenewal(() => {
				void queryClient
					.refetchQueries({
						type: 'active',
						predicate: query =>
							query.state.status === 'error' &&
							isSessionRecoveryReadError(query.state.error)
					})
					.catch(() => undefined)
			}),
		[queryClient]
	)

	useEffect(() => {
		if (status !== 'checking') {
			return
		}

		let isActive = true
		const revision = useSessionStore.getState().sessionRevision
		const current = () => {
			const state = useSessionStore.getState()
			return (
				isActive &&
				state.status === 'checking' &&
				state.sessionRevision === revision
			)
		}

		void bootstrapSessionOnce().then(
			session => {
				if (current()) {
					failures.current = 0
					retryAllowed.current = false
					setRetryAt(null)
					setAuthenticated(session)
				}
			},
			error => {
				if (!current()) {
					return
				}

				if (
					error instanceof SessionBootstrapError &&
					error.kind === 'anonymous'
				) {
					retryAllowed.current = false
					setRetryAt(null)
					setAnonymous()
					return
				}

				failures.current += 1
				retryAllowed.current = true
				setRetryAt(
					Date.now() +
						Math.min(
							60_000,
							5_000 * 2 ** Math.min(failures.current - 1, 4)
						)
				)
				setError(
					error instanceof SessionBootstrapError
						? error.message
						: 'Не удалось проверить сессию. Повторите попытку.'
				)
			}
		)

		return () => {
			isActive = false
		}
	}, [status, setAnonymous, setAuthenticated, setError])
	useEffect(() => {
		if (status !== 'error' || retryAt === null) return
		const resume = () => {
			if (
				retryAllowed.current &&
				Date.now() >= retryAt &&
				useSessionStore.getState().status === 'error'
			) {
				retryAllowed.current = false
				setChecking()
			}
		}
		const timer = setTimeout(resume, Math.max(0, retryAt - Date.now()))
		window.addEventListener('online', resume)
		window.addEventListener('focus', resume)
		return () => {
			clearTimeout(timer)
			window.removeEventListener('online', resume)
			window.removeEventListener('focus', resume)
		}
	}, [status, retryAt, setChecking])

	const retry = useCallback(() => {
		retryAllowed.current = false
		setRetryAt(null)
		setChecking()
	}, [setChecking])
	const fail = useCallback(
		(message: string) => {
			retryAllowed.current = false
			setRetryAt(null)
			setError(message)
		},
		[setError]
	)

	return { status, errorMessage, retry, fail }
}
