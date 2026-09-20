const PRODUCTION_APP_ORIGIN = 'https://workspace.aerocrm.space'
const PRODUCTION_MAIN_APP_ORIGIN = 'https://aerocrm.space'
const PRODUCTION_API_BASE_URL = 'https://api.aerocrm.space/api/v1'

const DEVELOPMENT_APP_ORIGIN = 'http://localhost:3001'
const DEVELOPMENT_MAIN_APP_ORIGIN = 'http://localhost:3000'
const DEVELOPMENT_API_BASE_URL = 'http://localhost:4100/api/v1'

export type RuntimeMode = 'development' | 'production'

export interface PublicRuntimeEnvironment {
	NEXT_PUBLIC_MODE?: string
	NEXT_PUBLIC_APP_URL?: string
	NEXT_PUBLIC_MAIN_APP_URL?: string
	NEXT_PUBLIC_API_URL?: string
	NEXT_PUBLIC_CRM_BILLING_ENABLED?: string
	NODE_ENV?: string
}

export interface RuntimeConfig {
	mode: RuntimeMode
	appOrigin: string
	mainAppOrigin: string
	apiBaseUrl: string
	crmEnabled: boolean
	crmBillingEnabled: boolean
}

const parseMode = (environment: PublicRuntimeEnvironment): RuntimeMode => {
	const value =
		environment.NEXT_PUBLIC_MODE?.trim() ||
		(environment.NODE_ENV === 'production' ? 'production' : 'development')

	if (value !== 'development' && value !== 'production') {
		throw new Error('NEXT_PUBLIC_MODE must be development or production')
	}

	return value
}

const readValue = (value: string | undefined, fallback: string) =>
	value?.trim() || fallback

const parseHttpUrl = (name: string, value: string) => {
	let parsed: URL

	try {
		parsed = new URL(value)
	} catch {
		throw new Error(`${name} must be an absolute URL`)
	}

	if (
		!['http:', 'https:'].includes(parsed.protocol) ||
		parsed.username ||
		parsed.password ||
		parsed.search ||
		parsed.hash
	) {
		throw new Error(`${name} must be a safe HTTP URL`)
	}

	return parsed
}

const parseOrigin = (name: string, value: string) => {
	const parsed = parseHttpUrl(name, value)

	if (parsed.pathname !== '/') {
		throw new Error(`${name} must contain only an origin`)
	}

	return parsed.origin
}

const parseApiBaseUrl = (value: string) => {
	const parsed = parseHttpUrl('NEXT_PUBLIC_API_URL', value)
	const normalizedPath = parsed.pathname.replace(/\/+$/, '')

	if (normalizedPath !== '/api/v1') {
		throw new Error('NEXT_PUBLIC_API_URL must use the /api/v1 prefix')
	}

	parsed.pathname = normalizedPath
	return parsed.toString().replace(/\/$/, '')
}

export const resolveRuntimeConfig = (
	environment: PublicRuntimeEnvironment
): RuntimeConfig => {
	const billingFlag = environment.NEXT_PUBLIC_CRM_BILLING_ENABLED
	if (
		billingFlag !== undefined &&
		billingFlag !== 'true' &&
		billingFlag !== 'false'
	) {
		throw new Error(
			'NEXT_PUBLIC_CRM_BILLING_ENABLED must be true or false'
		)
	}
	const mode = parseMode(environment)
	const appOrigin = parseOrigin(
		'NEXT_PUBLIC_APP_URL',
		readValue(environment.NEXT_PUBLIC_APP_URL, DEVELOPMENT_APP_ORIGIN)
	)
	const mainAppOrigin = parseOrigin(
		'NEXT_PUBLIC_MAIN_APP_URL',
		readValue(
			environment.NEXT_PUBLIC_MAIN_APP_URL,
			DEVELOPMENT_MAIN_APP_ORIGIN
		)
	)
	const apiBaseUrl = parseApiBaseUrl(
		readValue(environment.NEXT_PUBLIC_API_URL, DEVELOPMENT_API_BASE_URL)
	)

	if (
		mode === 'production' &&
		(appOrigin !== PRODUCTION_APP_ORIGIN ||
			mainAppOrigin !== PRODUCTION_MAIN_APP_ORIGIN ||
			apiBaseUrl !== PRODUCTION_API_BASE_URL)
	) {
		throw new Error(
			'Production public URLs do not match canonical origins'
		)
	}

	return {
		mode,
		appOrigin,
		mainAppOrigin,
		apiBaseUrl,
		crmEnabled: true,
		crmBillingEnabled: billingFlag !== 'false'
	}
}

let cachedRuntimeConfig: RuntimeConfig | undefined

export const getRuntimeConfig = () => {
	if (!cachedRuntimeConfig) {
		cachedRuntimeConfig = resolveRuntimeConfig({
			NEXT_PUBLIC_MODE: process.env.NEXT_PUBLIC_MODE,
			NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
			NEXT_PUBLIC_MAIN_APP_URL: process.env.NEXT_PUBLIC_MAIN_APP_URL,
			NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
			NEXT_PUBLIC_CRM_BILLING_ENABLED:
				process.env.NEXT_PUBLIC_CRM_BILLING_ENABLED,
			NODE_ENV: process.env.NODE_ENV
		})
	}

	return cachedRuntimeConfig
}
