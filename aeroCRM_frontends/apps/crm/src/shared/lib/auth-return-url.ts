import {
	getRuntimeConfig,
	type RuntimeConfig
} from '@/shared/config/runtime'

const MAX_RETURN_PATH_LENGTH = 2048
const WORKSPACE_PATH =
	/^\/(?:inbox|deals|contacts|tasks|planner|analytics|settings|billing)(?:\/|$)/
const INVITATION_PATH =
	/^\/invitations\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\/)?$/i

export const parseWorkspaceReturnPath = (
	value: string | null | undefined
) => {
	if (value === null || value === undefined) return '/inbox'
	if (
		value.length < 1 ||
		value.length > MAX_RETURN_PATH_LENGTH ||
		!value.startsWith('/') ||
		value.startsWith('//') ||
		/[\\#\u0000-\u001f\u007f]/.test(value) ||
		/%(?:2f|5c|23|0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)
	) {
		return null
	}
	const url = new URL(value, 'https://workspace.invalid')
	if (
		url.origin !== 'https://workspace.invalid' ||
		url.hash ||
		!(
			WORKSPACE_PATH.test(url.pathname) ||
			INVITATION_PATH.test(url.pathname)
		)
	) {
		return null
	}
	return `${url.pathname}${url.search}`
}

export const buildLoginUrl = (
	currentCrmUrl: string,
	config: RuntimeConfig = getRuntimeConfig()
) => {
	let current: URL
	try {
		current = new URL(currentCrmUrl)
	} catch {
		throw new Error('CRM return URL must be absolute')
	}
	if (
		current.origin !== config.appOrigin ||
		current.username ||
		current.password ||
		!['http:', 'https:'].includes(current.protocol)
	) {
		throw new Error('CRM return URL origin is not allowed')
	}
	const returnPath = parseWorkspaceReturnPath(
		`${current.pathname}${current.search}`
	)
	if (!returnPath) throw new Error('CRM return URL is invalid')
	const loginUrl = new URL('/login', config.appOrigin)
	loginUrl.searchParams.set('returnPath', returnPath)
	return loginUrl.toString()
}
