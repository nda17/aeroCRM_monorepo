export const AUTH_RETURN_URL_PARAM = 'returnUrl'
export const AUTH_RETURN_INTENT_STORAGE_KEY =
	'aerocrm:auth-return-intent'

const WINCRM_ORIGIN = 'https://workspace.aerocrm.space'
const LOCAL_WINCRM_ORIGIN = 'http://localhost:3001'
const ADMIN_ORIGIN = 'https://admin.aerocrm.space'
const LOCAL_ADMIN_ORIGIN = 'http://localhost:3003'
const ADMIN_RETURN_PATHS = new Set([
	'/admin', '/admin/alerts', '/admin/content', '/admin/crm',
	'/admin/databases', '/admin/event-log', '/admin/mailings',
	'/admin/messaging', '/admin/settings', '/admin/support',
	'/admin/system', '/admin/telegram-bot', '/admin/user-list'
])
const AUTH_RETURN_URL_MAX_LENGTH = 2048
const AUTH_RETURN_INTENT_TTL_MS = 15 * 60 * 1000
const UNSAFE_URL_CHARACTERS = /[\\\u0000-\u001f\u007f]/

type AuthReturnUrlValue = string | string[] | null | undefined

interface AuthReturnUrlOptions {
	allowLocalhost?: boolean
}

interface AuthReturnIntent {
	url: string
	createdAt: number
}

type AuthReturnStorage = Pick<
	Storage,
	'getItem' | 'setItem' | 'removeItem'
>

const isLocalhostAllowed = (options: AuthReturnUrlOptions) =>
	options.allowLocalhost ?? process.env.NODE_ENV !== 'production'

export const getSafeAuthReturnUrl = (
	value: AuthReturnUrlValue,
	options: AuthReturnUrlOptions = {}
) => {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > AUTH_RETURN_URL_MAX_LENGTH ||
		value !== value.trim() ||
		UNSAFE_URL_CHARACTERS.test(value)
	) {
		return null
	}

	let url: URL

	try {
		url = new URL(value)
	} catch {
		return null
	}

	if (url.username || url.password) {
		return null
	}

	const allowedOrigins = new Set([WINCRM_ORIGIN])

	if (isLocalhostAllowed(options)) {
		allowedOrigins.add(LOCAL_WINCRM_ORIGIN)
	}

	if (allowedOrigins.has(url.origin)) return url.toString()
	// Admin returns are limited to known routes on the separate admin origin.
	const adminOrigins = new Set([ADMIN_ORIGIN])
	if (isLocalhostAllowed(options))
		adminOrigins.add(LOCAL_ADMIN_ORIGIN)
	const allowedPath = ADMIN_RETURN_PATHS.has(url.pathname) ||
		/^\/admin\/user\/edit\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(url.pathname)
	const conversations = url.searchParams.getAll('conversationId')
	return adminOrigins.has(url.origin) &&
		allowedPath &&
		!url.hash &&
		(url.pathname !== '/admin/support'
			? !url.search
			: Array.from(url.searchParams.keys()).every(key => key === 'conversationId') &&
				(conversations.length === 0 ||
					(conversations.length === 1 &&
						/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversations[0]))))
		? url.toString()
		: null
}

export const parseAuthReturnUrlParam = (
	value: AuthReturnUrlValue,
	options: AuthReturnUrlOptions = {}
): string | null | undefined => {
	if (value === undefined) {
		return undefined
	}

	return getSafeAuthReturnUrl(value, options)
}

export const getAuthReturnUrlFromSearchParams = (
	searchParams: Pick<URLSearchParams, 'getAll'>,
	options: AuthReturnUrlOptions = {}
): string | null | undefined => {
	const values = searchParams.getAll(AUTH_RETURN_URL_PARAM)

	if (values.length === 0) {
		return undefined
	}

	return values.length === 1
		? getSafeAuthReturnUrl(values[0], options)
		: null
}

export const withAuthReturnUrl = (
	path: string,
	returnUrl: AuthReturnUrlValue,
	options: AuthReturnUrlOptions = {}
) => {
	const safeReturnUrl = getSafeAuthReturnUrl(returnUrl, options)

	if (!safeReturnUrl) {
		return path
	}

	return `${path}?${new URLSearchParams({
		[AUTH_RETURN_URL_PARAM]: safeReturnUrl
	})}`
}

export const saveAuthReturnIntent = (
	storage: AuthReturnStorage,
	returnUrl: AuthReturnUrlValue,
	now = Date.now(),
	options: AuthReturnUrlOptions = {}
) => {
	const safeReturnUrl = getSafeAuthReturnUrl(returnUrl, options)

	if (!safeReturnUrl) {
		clearAuthReturnIntent(storage)
		return null
	}

	try {
		storage.setItem(
			AUTH_RETURN_INTENT_STORAGE_KEY,
			JSON.stringify({ url: safeReturnUrl, createdAt: now })
		)
	} catch {
		clearAuthReturnIntent(storage)
		return null
	}

	return safeReturnUrl
}

export const readAuthReturnIntent = (
	storage: AuthReturnStorage,
	now = Date.now(),
	options: AuthReturnUrlOptions = {}
) => {
	let rawValue: string | null

	try {
		rawValue = storage.getItem(AUTH_RETURN_INTENT_STORAGE_KEY)
	} catch {
		return null
	}

	if (!rawValue) {
		return null
	}

	try {
		const value = JSON.parse(rawValue) as Partial<AuthReturnIntent>
		const isFresh =
			Number.isSafeInteger(value.createdAt) &&
			(value.createdAt as number) <= now &&
			now - (value.createdAt as number) <= AUTH_RETURN_INTENT_TTL_MS
		const safeReturnUrl = isFresh
			? getSafeAuthReturnUrl(value.url, options)
			: null

		if (safeReturnUrl) {
			return safeReturnUrl
		}
	} catch {
		// Invalid or expired intent is removed below.
	}

	clearAuthReturnIntent(storage)
	return null
}

export const clearAuthReturnIntent = (storage: AuthReturnStorage) => {
	try {
		storage.removeItem(AUTH_RETURN_INTENT_STORAGE_KEY)
	} catch {
		// Auth navigation must keep working when browser storage is unavailable.
	}
}
