'use client'
import { isSessionProtectedPath } from '@/shared/config/pages/public.config'
import {
	clearBrowserSession,
	getAccessToken,
	isAccessTokenValid,
	SESSION_CLEARED_EVENT
} from '@/shared/api'
import authService from '@/features/auth/api/auth.api'
import { useAuthStore } from '@/entities/user'
import { useQueryClient } from '@tanstack/react-query'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef } from 'react'

import {
	getTokenBinding,
	getCurrentSessionBinding,
	getSessionRevision,
	SESSION_UPDATED_EVENT
} from '@/shared/api/token-storage'
import { startSessionEvents } from '@/shared/api/session-events'
import { API_URL } from '@/shared/config/api.config'
import toast from 'react-hot-toast'
import axios from 'axios'

const ACCESS_TOKEN_REFRESH_THRESHOLD_MS = 60 * 1000

interface SessionProviderProps {
	children: React.ReactNode
	hasSessionHint: boolean
}

const SessionProvider = ({
	children,
	hasSessionHint
}: SessionProviderProps) => {
	const setAuth = useAuthStore(state => state.setAuth)
	const setAuthResolved = useAuthStore(state => state.setAuthResolved)
	const queryClient = useQueryClient()
	const pathname = usePathname()
	const pathnameRef = useRef(pathname)
	pathnameRef.current = pathname
	const isMountedRef = useRef(true)
	const hasSessionHintRef = useRef(hasSessionHint)
	const isSessionValidatedRef = useRef(false)
	const isLogoutPath = pathname === '/logout'
	const isProtectedPath = isSessionProtectedPath(pathname)

	const syncSession = useCallback(async () => {
		if (isLogoutPath) return
		if (
			window.location.pathname === '/login' &&
			new URLSearchParams(window.location.search).get('session') ===
				'revoked'
		) {
			setAuth(false)
			setAuthResolved(true)
			return
		}

		const accessToken = getAccessToken()

		if (accessToken) {
			hasSessionHintRef.current = true
		}

		if (
			isSessionValidatedRef.current &&
			isAccessTokenValid(accessToken, ACCESS_TOKEN_REFRESH_THRESHOLD_MS)
		) {
			if (isMountedRef.current) {
				setAuth(true)
				setAuthResolved(true)
			}

			return
		}

		if (!isProtectedPath && !hasSessionHintRef.current) {
			if (isMountedRef.current) {
				setAuth(false)
				setAuthResolved(true)
				queryClient.removeQueries({ queryKey: ['get-profile'] })
			}

			return
		}

		if (isMountedRef.current) {
			setAuthResolved(false)
		}

		const revision = getSessionRevision()
		try {
			await authService.getNewTokens()
			if (getSessionRevision() !== revision && accessToken) return

			if (pathnameRef.current === '/logout') {
				clearBrowserSession({ redirectToLogin: false })
				return
			}

			hasSessionHintRef.current = true
			isSessionValidatedRef.current = true

			if (isMountedRef.current) {
				setAuth(true)
				setAuthResolved(true)
				queryClient.invalidateQueries({ queryKey: ['get-profile'] })
			}
		} catch (error) {
			if (getSessionRevision() !== revision) return
			if (!axios.isAxiosError(error) || error.response?.status !== 401) {
				if (isMountedRef.current) setAuthResolved(true)
				return
			}
			clearBrowserSession({
				reason:
					axios.isAxiosError(error) &&
					error.response?.data?.code === 'session_revoked'
						? 'revoked'
						: undefined,
				redirectToLogin: isSessionProtectedPath(pathnameRef.current)
			})
		}
	}, [
		isLogoutPath,
		isProtectedPath,
		queryClient,
		setAuth,
		setAuthResolved
	])

	useEffect(() => {
		if (isLogoutPath) return
		let alive = true
		let stop: (() => void) | undefined
		let captured: ReturnType<typeof getTokenBinding> = null
		let revision = -1
		const current = () => {
			const active = getCurrentSessionBinding()
			return (
				alive &&
				getSessionRevision() === revision &&
				!!captured &&
				!!active &&
				captured.subject === active.subject &&
				captured.sessionId === active.sessionId
			)
		}
		const bind = () => {
			if (current()) return
			stop?.()
			stop = undefined
			captured = getCurrentSessionBinding()
			revision = getSessionRevision()
			if (!captured) return
			// Capture this binding in its own closure so a late old signal cannot clear a new login.
			const expected = captured
			const expectedRevision = revision
			const same = () =>
				current() && captured === expected && revision === expectedRevision
			stop = startSessionEvents({
				url: API_URL + '/auth/session/events',
				isCurrent: same,
				token: async () => {
					if (!same()) throw new Error('Session changed')
					if (
						!isAccessTokenValid(
							getAccessToken(),
							ACCESS_TOKEN_REFRESH_THRESHOLD_MS
						)
					)
						try {
							await authService.getNewTokens()
						} catch (error) {
							if (
								same() &&
								axios.isAxiosError(error) &&
								error.response?.status === 401
							)
								clearBrowserSession({
									reason:
										error.response.data?.code === 'session_revoked'
											? 'revoked'
											: undefined
								})
							throw error
						}
					if (!same()) throw new Error('Session changed')
					return getAccessToken()!
				},
				onRevoked: () => {
					if (!same()) return
					toast.error('Выполнен вход на другом устройстве')
					void queryClient.cancelQueries()
					queryClient.clear()
					clearBrowserSession({ reason: 'revoked' })
				},
				onUnauthorized: async () => {
					if (!same()) return
					try {
						await authService.getNewTokens()
					} catch (error) {
						if (
							same() &&
							axios.isAxiosError(error) &&
							error.response?.status === 401
						)
							clearBrowserSession({
								reason:
									error.response?.data?.code === 'session_revoked'
										? 'revoked'
										: undefined
							})
					}
				}
			})
		}
		window.addEventListener('focus', bind)
		window.addEventListener(SESSION_UPDATED_EVENT, bind)
		window.addEventListener(SESSION_CLEARED_EVENT, bind)
		bind()
		return () => {
			alive = false
			stop?.()
			window.removeEventListener('focus', bind)
			window.removeEventListener(SESSION_UPDATED_EVENT, bind)
			window.removeEventListener(SESSION_CLEARED_EVENT, bind)
		}
	}, [isLogoutPath, queryClient])

	useEffect(() => {
		hasSessionHintRef.current = hasSessionHint
	}, [hasSessionHint])

	useEffect(() => {
		const handleSessionCleared = () => {
			hasSessionHintRef.current = false
			isSessionValidatedRef.current = false
			queryClient.clear()
			setAuth(false)
			setAuthResolved(true)
		}

		window.addEventListener(SESSION_CLEARED_EVENT, handleSessionCleared)

		return () => {
			window.removeEventListener(
				SESSION_CLEARED_EVENT,
				handleSessionCleared
			)
		}
	}, [queryClient, setAuth, setAuthResolved])

	useEffect(() => {
		isMountedRef.current = true

		if (!isLogoutPath) {
			void syncSession()
		}

		return () => {
			isMountedRef.current = false
		}
	}, [isLogoutPath, syncSession])

	useEffect(() => {
		if (isLogoutPath) {
			return
		}

		const handleVisibilityChange = () => {
			if (document.visibilityState !== 'visible') {
				return
			}

			void syncSession()
		}

		window.addEventListener('focus', handleVisibilityChange)
		window.addEventListener('pageshow', handleVisibilityChange)
		document.addEventListener('visibilitychange', handleVisibilityChange)

		return () => {
			window.removeEventListener('focus', handleVisibilityChange)
			window.removeEventListener('pageshow', handleVisibilityChange)
			document.removeEventListener(
				'visibilitychange',
				handleVisibilityChange
			)
		}
	}, [isLogoutPath, syncSession])

	return <>{children}</>
}

export default SessionProvider
