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
		if (isLogoutPath) {
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

		try {
			await authService.getNewTokens()

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
		} catch {
			clearBrowserSession({
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
