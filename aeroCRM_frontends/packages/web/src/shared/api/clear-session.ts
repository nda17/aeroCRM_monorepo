import {
	isSessionProtectedPath,
	PUBLIC_PAGES
} from '../config/pages/public.config'
import { removeFromStorage } from './token-storage'
import { resolveFrontendHref } from '../lib/navigation/frontend-zones'
import { withAuthReturnUrl } from '../lib/auth-return-url'

export const SESSION_CLEARED_EVENT = 'aerocrm:session-cleared'

interface ClearBrowserSessionOptions {
	redirectToLogin?: boolean
	reason?: 'revoked'
}

export const clearBrowserSession = ({
	redirectToLogin,
	reason
}: ClearBrowserSessionOptions = {}) => {
	removeFromStorage()

	if (typeof window === 'undefined') {
		return
	}

	window.dispatchEvent(new Event(SESSION_CLEARED_EVENT))

	const shouldRedirect =
		redirectToLogin ?? isSessionProtectedPath(window.location.pathname)
	if (shouldRedirect && window.location.pathname !== PUBLIC_PAGES.LOGIN) {
		const loginUrl = new URL(
			withAuthReturnUrl(
				resolveFrontendHref(PUBLIC_PAGES.LOGIN),
				window.location.href
			),
			window.location.origin
		)
		if (reason === 'revoked')
			loginUrl.searchParams.set('session', 'revoked')
		window.location.replace(loginUrl.toString())
	}
}
