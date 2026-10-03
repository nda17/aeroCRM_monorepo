import { decodeJwt } from 'jose'
import Cookies from 'js-cookie'
import { EnumTokens } from './token-names'

export const SESSION_UPDATED_EVENT = 'aerocrm:session-updated'
let sessionRevision = 0
let lastSessionBinding: { subject: string; sessionId: string } | null =
	null
export const getSessionRevision = () => sessionRevision
export const getTokenBinding = (token: string | null) => {
	if (!token) return null
	try {
		const value = decodeJwt(token)
		return typeof value.sub === 'string' && typeof value.sid === 'string'
			? { subject: value.sub, sessionId: value.sid }
			: null
	} catch {
		return null
	}
}
export const getCurrentSessionBinding = () => {
	const current = getTokenBinding(getAccessToken())
	if (current) lastSessionBinding = current
	return current ?? lastSessionBinding
}
const accessTokenCookieOptions = {
	sameSite: 'strict' as const,
	secure: process.env.NODE_ENV === 'production',
	path: '/'
}

export const getAccessToken = () => {
	const accessToken = Cookies.get(EnumTokens.ACCESS_TOKEN)
	return accessToken || null
}

export const getAccessTokenExpiresAt = (accessToken: string) => {
	try {
		const { exp } = decodeJwt(accessToken)

		return typeof exp === 'number' ? exp * 1000 : null
	} catch {
		return null
	}
}

export const isAccessTokenValid = (
	accessToken: string | null,
	refreshThresholdMs = 0
) => {
	if (!accessToken) {
		return false
	}

	const expiresAt = getAccessTokenExpiresAt(accessToken)

	if (!expiresAt) {
		return false
	}

	return expiresAt - refreshThresholdMs > Date.now()
}

export const saveTokenStorage = (accessToken: string) => {
	const expiresAt = getAccessTokenExpiresAt(accessToken)

	if (!expiresAt || expiresAt <= Date.now()) {
		removeFromStorage()
		return
	}

	const previous = getCurrentSessionBinding()
	const next = getTokenBinding(accessToken)
	if (
		!previous ||
		!next ||
		previous.subject !== next.subject ||
		previous.sessionId !== next.sessionId
	)
		sessionRevision += 1
	lastSessionBinding = next
	Cookies.set(EnumTokens.ACCESS_TOKEN, accessToken, {
		...accessTokenCookieOptions,
		expires: new Date(expiresAt)
	})
	if (typeof window !== 'undefined')
		window.dispatchEvent(new Event(SESSION_UPDATED_EVENT))
}

export const removeFromStorage = () => {
	sessionRevision += 1
	lastSessionBinding = null
	Cookies.remove(EnumTokens.ACCESS_TOKEN, {
		path: accessTokenCookieOptions.path
	})
}
