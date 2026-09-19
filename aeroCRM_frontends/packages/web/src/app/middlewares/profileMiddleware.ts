import {
	copySetCookieHeaders,
	getAuthWithRefresh
} from '@/features/auth/server/refresh-middleware-token'
import { NextRequest, NextResponse } from 'next/server'

export const profileMiddleware = async (request: NextRequest) => {
	const next = NextResponse.next()
	const { user, response } = await getAuthWithRefresh(request, next)

	if (!user?.isLoggedIn) {
		const redirect = NextResponse.redirect(new URL('/login', request.url))

		if (response) {
			copySetCookieHeaders(response, redirect)
		}

		return redirect
	}

	return response ?? next
}
