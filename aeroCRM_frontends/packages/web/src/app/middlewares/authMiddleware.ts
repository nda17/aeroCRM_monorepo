import {
	copySetCookieHeaders,
	getAuthWithRefresh
} from '@/features/auth/server/refresh-middleware-token'
import { getAuthReturnUrlFromSearchParams } from '@/shared/lib/auth-return-url'
import { NextRequest, NextResponse } from 'next/server'

export const authMiddleware = async (request: NextRequest) => {
	const next = NextResponse.next()
	const { user, response } = await getAuthWithRefresh(request, next)

	if (user?.isLoggedIn) {
		const authReturnUrl = getAuthReturnUrlFromSearchParams(
			request.nextUrl.searchParams
		)
		const redirect = NextResponse.redirect(
			authReturnUrl || new URL('/', request.url)
		)

		if (response) {
			copySetCookieHeaders(response, redirect)
		}

		return redirect
	}

	return response ?? next
}
