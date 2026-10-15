export const MARKETING_EMAIL_CONSENT_TEXT = 'Я согласен получать по электронной почте новости и предложения aeroCRM. Отписаться можно в любой момент.'
export const MARKETING_EMAIL_CONSENT_TEXT_VERSION = 'marketing-email-v1'

export interface MarketingEmailView {
	schemaVersion: 1
	version: number
	enabled: boolean
	email: string | null
	emailVerified: boolean
	emailBinding: string | null
	consentTextVersion: string
	consentedAt: string | null
	updatedAt: string | null
}

export interface MarketingEmailCommand {
	schemaVersion: 1
	commandId: string
	expectedVersion: number
	expectedEmailBinding: string | null
	enabled: boolean
	consentTextVersion: string
}

const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
const exact = (value: Record<string, unknown>, keys: string[]) =>
	Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const date = (value: unknown): value is string => {
	if (typeof value !== 'string' || value.length !== 24) return false
	const parsed = new Date(value)
	return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}

export function parseMarketingEmailView(value: unknown): MarketingEmailView {
	if (
		!record(value) ||
		!exact(value, ['schemaVersion', 'version', 'enabled', 'email', 'emailVerified', 'emailBinding', 'consentTextVersion', 'consentedAt', 'updatedAt']) ||
		value.schemaVersion !== 1 || !Number.isSafeInteger(value.version) ||
		Number(value.version) < 0 || Number(value.version) > 2_147_483_646 ||
		typeof value.enabled !== 'boolean' || typeof value.emailVerified !== 'boolean' ||
		!(value.email === null || (typeof value.email === 'string' && value.email.length <= 254 && value.email === value.email.trim().toLowerCase() && EMAIL.test(value.email))) ||
		!(value.emailBinding === null || (typeof value.emailBinding === 'string' && SHA256.test(value.emailBinding))) ||
		value.consentTextVersion !== MARKETING_EMAIL_CONSENT_TEXT_VERSION ||
		!(value.consentedAt === null || date(value.consentedAt)) ||
		!(value.updatedAt === null || date(value.updatedAt)) ||
		(value.enabled && (!value.emailVerified || value.email === null || value.emailBinding === null)) ||
		(value.emailVerified && (value.email === null || value.emailBinding === null))
	) throw new Error('Invalid marketing email profile')
	return value as unknown as MarketingEmailView
}

export function parseMarketingEmailCommand(value: unknown): MarketingEmailCommand {
	if (
		!record(value) ||
		!exact(value, ['schemaVersion', 'commandId', 'expectedVersion', 'expectedEmailBinding', 'enabled', 'consentTextVersion']) ||
		value.schemaVersion !== 1 || typeof value.commandId !== 'string' || !UUID4.test(value.commandId) ||
		!Number.isSafeInteger(value.expectedVersion) || Number(value.expectedVersion) < 0 || Number(value.expectedVersion) > 2_147_483_646 ||
		!(value.expectedEmailBinding === null || (typeof value.expectedEmailBinding === 'string' && SHA256.test(value.expectedEmailBinding))) ||
		typeof value.enabled !== 'boolean' || value.consentTextVersion !== MARKETING_EMAIL_CONSENT_TEXT_VERSION
	) throw new Error('Invalid marketing email command')
	return value as unknown as MarketingEmailCommand
}
