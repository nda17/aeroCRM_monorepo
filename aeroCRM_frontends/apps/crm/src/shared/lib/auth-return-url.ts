import {
	getRuntimeConfig,
	type RuntimeConfig
} from '@/shared/config/runtime'

const MAX_RETURN_URL_LENGTH = 2048

export const buildLoginUrl = (
	currentCrmUrl: string,
	config: RuntimeConfig = getRuntimeConfig()
) => {
	if (!currentCrmUrl || currentCrmUrl.length > MAX_RETURN_URL_LENGTH) {
		throw new Error('CRM return URL is invalid')
	}

	let returnUrl: URL

	try {
		returnUrl = new URL(currentCrmUrl)
	} catch {
		throw new Error('CRM return URL must be absolute')
	}

	if (
		returnUrl.origin !== config.appOrigin ||
		returnUrl.username ||
		returnUrl.password ||
		!['http:', 'https:'].includes(returnUrl.protocol)
	) {
		throw new Error('CRM return URL origin is not allowed')
	}

	returnUrl.hash = ''

	const loginUrl = new URL('/login', config.mainAppOrigin)
	loginUrl.searchParams.set('returnUrl', returnUrl.toString())

	return loginUrl.toString()
}
