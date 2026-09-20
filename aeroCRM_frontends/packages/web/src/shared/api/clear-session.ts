import {
	isSessionProtectedPath,
	PUBLIC_PAGES
} from '@/shared/config/pages/public.config'
import { removeFromStorage } from './token-storage'
import { resolveFrontendHref } from '@/shared/lib/navigation/frontend-zones'
import { withAuthReturnUrl } from '@/shared/lib/auth-return-url'

export const SESSION_CLEARED_EVENT = 'aerocrm:session-cleared'

interface ClearBrowserSessionOptions {
	redirectToLogin?: boolean
}

export const clearBrowserSession = ({
	redirectToLogin
}: ClearBrowserSessionOptions = {}) => {
	removeFromStorage()

	if (typeof window === 'undefined') {
		return
	}

	window.dispatchEvent(new Event(SESSION_CLEARED_EVENT))

	const shouldRedirect =
		redirectToLogin ?? isSessionProtectedPath(window.location.pathname)
	if (shouldRedirect && window.location.pathname !== PUBLIC_PAGES.LOGIN) {
		window.location.replace(
			withAuthReturnUrl(
				resolveFrontendHref(PUBLIC_PAGES.LOGIN),
				window.location.href
			)
		)
	}
}
