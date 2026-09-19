import {
	type ITokenInside,
	UserRole,
	type TUserDataState,
	transformUserToState
} from '@/entities/user/server'
import { EnumTokens } from '@/shared/api/token-names'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { NextRequest, NextResponse } from 'next/server'

const ACCESS_TOKEN_TYPE = 'at+jwt'
const ACCESS_TOKEN_USE = 'access'
const ALLOWED_CLOCK_TOLERANCE_SECONDS = 60
const MIN_ACCESS_TOKEN_LIFETIME_SECONDS = 60
const MAX_ACCESS_TOKEN_LIFETIME_SECONDS = 1800
const JWKS_CACHE_MAX_AGE_MS = 5 * 60 * 1000
const JWKS_COOLDOWN_MS = 5 * 1000
const JWKS_TIMEOUT_MS = 3 * 1000
const CLAIM_ID_PATTERN = /^[^\s\x00-\x1f\x7f]{1,256}$/
const KID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SET_COOKIE_SEPARATOR = /,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/
const USER_ROLES = new Set<string>(Object.values(UserRole))

let remoteJwks:
	| {
			url: string
			resolver: ReturnType<typeof createRemoteJWKSet>
	  }
	| undefined

const getApiUrl = () => {
	const productionApiHost = process.env.NEXT_PUBLIC_PRODUCTION_HOST

	return (
		process.env.NEXT_PUBLIC_API_URL ||
		(process.env.NEXT_PUBLIC_MODE === 'production' && productionApiHost
			? `${productionApiHost}/api/v1`
			: 'http://localhost:4100/api/v1')
	)
}

const getJwtVerificationConfig = () => {
	const jwksUrl = process.env.JWT_JWKS_URL?.trim()
	const issuer = process.env.JWT_ISSUER?.trim()
	const audience = process.env.JWT_AUDIENCE?.trim()
	const clockToleranceValue =
		process.env.JWT_CLOCK_TOLERANCE_SECONDS?.trim()
	const clockTolerance = Number(clockToleranceValue)
	const maxTokenLifetimeValue =
		process.env.JWT_MAX_TOKEN_LIFETIME_SECONDS?.trim()
	const maxTokenLifetime = Number(maxTokenLifetimeValue)

	if (!jwksUrl) {
		throw new Error('JWT_JWKS_URL is not configured')
	}

	if (!issuer) {
		throw new Error('JWT_ISSUER is not configured')
	}

	if (!audience) {
		throw new Error('JWT_AUDIENCE is not configured')
	}

	if (
		!clockToleranceValue ||
		!Number.isInteger(clockTolerance) ||
		clockTolerance < 0 ||
		clockTolerance > ALLOWED_CLOCK_TOLERANCE_SECONDS
	) {
		throw new Error(
			`JWT_CLOCK_TOLERANCE_SECONDS must be an integer from 0 to ${ALLOWED_CLOCK_TOLERANCE_SECONDS}`
		)
	}

	if (
		!maxTokenLifetimeValue ||
		!Number.isInteger(maxTokenLifetime) ||
		maxTokenLifetime < MIN_ACCESS_TOKEN_LIFETIME_SECONDS ||
		maxTokenLifetime > MAX_ACCESS_TOKEN_LIFETIME_SECONDS
	) {
		throw new Error(
			`JWT_MAX_TOKEN_LIFETIME_SECONDS must be an integer from ${MIN_ACCESS_TOKEN_LIFETIME_SECONDS} to ${MAX_ACCESS_TOKEN_LIFETIME_SECONDS}`
		)
	}

	const parsedJwksUrl = new URL(jwksUrl)

	if (
		!['http:', 'https:'].includes(parsedJwksUrl.protocol) ||
		parsedJwksUrl.username ||
		parsedJwksUrl.password ||
		parsedJwksUrl.hash ||
		(process.env.NODE_ENV === 'production' &&
			parsedJwksUrl.protocol !== 'https:')
	) {
		throw new Error('JWT_JWKS_URL is unsafe')
	}

	return {
		jwksUrl: parsedJwksUrl,
		issuer,
		audience,
		clockTolerance,
		maxTokenLifetime
	}
}

const getRemoteJwks = (url: URL) => {
	const serializedUrl = url.toString()

	if (!remoteJwks || remoteJwks.url !== serializedUrl) {
		remoteJwks = {
			url: serializedUrl,
			resolver: createRemoteJWKSet(url, {
				cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
				cooldownDuration: JWKS_COOLDOWN_MS,
				timeoutDuration: JWKS_TIMEOUT_MS
			})
		}
	}

	return remoteJwks.resolver
}

const parseAccessTokenPayload = (payload: JWTPayload): ITokenInside => {
	const roles = payload.roles

	if (
		typeof payload.sub !== 'string' ||
		!CLAIM_ID_PATTERN.test(payload.sub) ||
		typeof payload.sid !== 'string' ||
		!UUID_PATTERN.test(payload.sid) ||
		!Array.isArray(roles) ||
		roles.length === 0 ||
		!roles.every(
			role => typeof role === 'string' && USER_ROLES.has(role)
		) ||
		new Set(roles).size !== roles.length ||
		payload.token_use !== ACCESS_TOKEN_USE ||
		typeof payload.iss !== 'string' ||
		typeof payload.aud !== 'string' ||
		typeof payload.jti !== 'string' ||
		!UUID_PATTERN.test(payload.jti) ||
		!Number.isInteger(payload.iat) ||
		!Number.isInteger(payload.nbf) ||
		!Number.isInteger(payload.exp) ||
		payload.nbf !== payload.iat ||
		payload.iat >= payload.exp
	) {
		throw new Error('Access token claims are invalid')
	}

	return {
		sub: payload.sub,
		sid: payload.sid,
		roles: roles as UserRole[],
		token_use: ACCESS_TOKEN_USE,
		iss: payload.iss,
		aud: payload.aud,
		jti: payload.jti,
		iat: payload.iat,
		nbf: payload.nbf,
		exp: payload.exp
	}
}

const verifyAccessToken = async (accessToken: string) => {
	const { jwksUrl, issuer, audience, clockTolerance, maxTokenLifetime } =
		getJwtVerificationConfig()
	const { payload, protectedHeader } = await jwtVerify(
		accessToken,
		getRemoteJwks(jwksUrl),
		{
			algorithms: ['RS256'],
			issuer,
			audience,
			clockTolerance,
			typ: ACCESS_TOKEN_TYPE,
			requiredClaims: [
				'sub',
				'sid',
				'roles',
				'token_use',
				'jti',
				'iat',
				'nbf',
				'exp'
			]
		}
	)

	if (
		protectedHeader.alg !== 'RS256' ||
		protectedHeader.typ !== ACCESS_TOKEN_TYPE ||
		typeof protectedHeader.kid !== 'string' ||
		!KID_PATTERN.test(protectedHeader.kid)
	) {
		throw new Error('Access token header is invalid')
	}

	const parsedPayload = parseAccessTokenPayload(payload)

	if (parsedPayload.exp - parsedPayload.iat > maxTokenLifetime) {
		throw new Error('Access token lifetime exceeds the configured maximum')
	}

	return parsedPayload
}

const getSetCookieHeaders = (headers: Headers) => {
	const headersWithSetCookie = headers as Headers & {
		getSetCookie?: () => string[]
	}
	const setCookieHeaders = headersWithSetCookie.getSetCookie?.() ?? []

	if (setCookieHeaders.length > 0) {
		return setCookieHeaders
	}

	const combinedSetCookie = headers.get('set-cookie')

	return combinedSetCookie
		? combinedSetCookie.split(SET_COOKIE_SEPARATOR)
		: []
}

export const copySetCookieHeaders = (
	source: Pick<Response, 'headers'>,
	target: NextResponse
) => {
	getSetCookieHeaders(source.headers).forEach(cookie => {
		target.headers.append('Set-Cookie', cookie.trim())
	})
}

const clearAuthCookies = (response: NextResponse) => {
	const secure = process.env.NODE_ENV === 'production'

	response.cookies.set(EnumTokens.ACCESS_TOKEN, '', {
		httpOnly: false,
		sameSite: 'strict',
		secure,
		expires: new Date(0),
		maxAge: 0,
		path: '/'
	})
	response.cookies.set(EnumTokens.REFRESH_TOKEN, '', {
		httpOnly: true,
		sameSite: secure ? 'none' : 'lax',
		secure,
		expires: new Date(0),
		maxAge: 0,
		path: '/'
	})
}

const getAccessTokenMaxAge = (payload: ITokenInside) => {
	const remainingMilliseconds = payload.exp * 1000 - Date.now()

	if (remainingMilliseconds <= 0) {
		throw new Error('Access token is expired')
	}

	return Math.ceil(remainingMilliseconds / 1000)
}

interface IRefreshResult {
	user: TUserDataState | null
	response: NextResponse | null
}

export const getAuthWithRefresh = async (
	request: NextRequest,
	baseResponse: NextResponse
): Promise<IRefreshResult> => {
	const accessToken = request.cookies.get(EnumTokens.ACCESS_TOKEN)?.value
	const refreshToken = request.cookies.get(EnumTokens.REFRESH_TOKEN)?.value
	let successfulRefreshResponse: Response | null = null

	if (accessToken) {
		try {
			const payload = await verifyAccessToken(accessToken)

			return { user: transformUserToState(payload), response: null }
		} catch {
			// access token invalid/expired — try refresh below
		}
	}

	if (!refreshToken) {
		if (accessToken) {
			clearAuthCookies(baseResponse)
			return { user: null, response: baseResponse }
		}

		return { user: null, response: null }
	}

	try {
		const res = await fetch(`${getApiUrl()}/auth/refresh`, {
			method: 'POST',
			headers: { Cookie: `${EnumTokens.REFRESH_TOKEN}=${refreshToken}` },
			cache: 'no-store'
		})

		if (!res.ok) {
			clearAuthCookies(baseResponse)
			copySetCookieHeaders(res, baseResponse)
			return { user: null, response: baseResponse }
		}

		successfulRefreshResponse = res
		const data = await res.json()
		const newAccessToken: string | undefined = data?.accessToken

		if (!newAccessToken) {
			clearAuthCookies(baseResponse)
			copySetCookieHeaders(res, baseResponse)
			return { user: null, response: baseResponse }
		}

		const payload = await verifyAccessToken(newAccessToken)
		const maxAge = getAccessTokenMaxAge(payload)

		baseResponse.cookies.set(EnumTokens.ACCESS_TOKEN, newAccessToken, {
			httpOnly: false,
			sameSite: 'strict',
			secure: process.env.NODE_ENV === 'production',
			expires: new Date(payload.exp * 1000),
			maxAge,
			path: '/'
		})
		copySetCookieHeaders(res, baseResponse)

		return { user: transformUserToState(payload), response: baseResponse }
	} catch {
		clearAuthCookies(baseResponse)
		if (successfulRefreshResponse) {
			copySetCookieHeaders(successfulRefreshResponse, baseResponse)
		}
		return { user: null, response: baseResponse }
	}
}
