import { decodeJwt } from 'jose'
import Cookies from 'js-cookie'
import { EnumTokens } from './token-names'

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

	Cookies.set(EnumTokens.ACCESS_TOKEN, accessToken, {
		...accessTokenCookieOptions,
		expires: new Date(expiresAt)
	})
}

export const removeFromStorage = () => {
	Cookies.remove(EnumTokens.ACCESS_TOKEN, {
		path: accessTokenCookieOptions.path
	})
}
