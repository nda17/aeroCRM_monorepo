import {
	copySetCookieHeaders,
	getAuthWithRefresh
} from '@/features/auth/server/refresh-middleware-token'
import { NextRequest, NextResponse } from 'next/server'
import { getSafeAuthReturnUrl } from '@/shared/lib/auth-return-url'

export const adminMiddleware = async (request: NextRequest) => {
	const next = NextResponse.next()
	const { user, response } = await getAuthWithRefresh(request, next)
	const landingOrigin = process.env.NODE_ENV === 'development'
		? 'http://localhost:3000'
		: 'https://aerocrm.space'

	const isSupport = request.nextUrl.pathname === '/admin/support'
	const isAdmin =
		user?.isLoggedIn && (user?.isAdmin || (isSupport && user?.isDev))

	if (isAdmin) {
		return response ?? next
	}

	if (user?.isLoggedIn) {
		const redirect = NextResponse.redirect(
			new URL('/', landingOrigin)
		)

		if (response) {
			copySetCookieHeaders(response, redirect)
		}

		return redirect
	}

	const loginUrl = new URL('/login', landingOrigin)
	const returnUrl = getSafeAuthReturnUrl(request.url)
	if (returnUrl) loginUrl.searchParams.set('returnUrl', returnUrl)
	const redirect = NextResponse.redirect(loginUrl)

	if (response) {
		copySetCookieHeaders(response, redirect)
	}

	return redirect
}
