import {
	copySetCookieHeaders,
	getAuthWithRefresh
} from '@/features/auth/server/refresh-middleware-token'
import { NextRequest, NextResponse } from 'next/server'
import { getSafeAuthReturnUrl } from '@/shared/lib/auth-return-url'

export const adminMiddleware = async (request: NextRequest) => {
	const next = NextResponse.next()
	const { user, response } = await getAuthWithRefresh(request, next)

	const isSupport = request.nextUrl.pathname === '/admin/support'
	const isAdmin =
		user?.isLoggedIn && (user?.isAdmin || (isSupport && user?.isDev))

	if (isAdmin) {
		return response ?? next
	}

	if (user?.isLoggedIn) {
		const redirect = NextResponse.redirect(
			new URL('/cabinet', request.url)
		)

		if (response) {
			copySetCookieHeaders(response, redirect)
		}

		return redirect
	}

	const loginUrl = new URL('/login', request.url)
	const supportReturn = isSupport
		? getSafeAuthReturnUrl(request.url)
		: null
	if (supportReturn) loginUrl.searchParams.set('returnUrl', supportReturn)
	const redirect = NextResponse.redirect(loginUrl)

	if (response) {
		copySetCookieHeaders(response, redirect)
	}

	return redirect
}
