export type LoginOtpChannel = 'EMAIL' | 'SMS'
export interface LoginOtpCapabilities {
	available: boolean
	channels: LoginOtpChannel[]
	codeLength: 6
	expiresInSeconds: 300
	resendAfterSeconds: 60
}
export interface LoginOtpChallenge {
	challengeId: string
	browserToken: string
	expiresAt: string
	resendAvailableAt: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
	Object.keys(value).length === keys.length &&
	keys.every(key => Object.hasOwn(value, key))

const isCanonicalDate = (value: unknown): value is string =>
	typeof value === 'string' &&
	Number.isFinite(Date.parse(value)) &&
	new Date(value).toISOString() === value

export const parseLoginOtpCapabilities = (
	value: unknown
): LoginOtpCapabilities => {
	if (
		!isRecord(value) ||
		!exactKeys(value, [
			'available',
			'channels',
			'codeLength',
			'expiresInSeconds',
			'resendAfterSeconds'
		]) ||
		typeof value.available !== 'boolean' ||
		!Array.isArray(value.channels) ||
		value.channels.some(
			channel => channel !== 'EMAIL' && channel !== 'SMS'
		) ||
		new Set(value.channels).size !== value.channels.length ||
		value.available !== value.channels.length > 0 ||
		value.codeLength !== 6 ||
		value.expiresInSeconds !== 300 ||
		value.resendAfterSeconds !== 60
	) {
		throw new Error('Резервный вход временно недоступен')
	}
	return value as unknown as LoginOtpCapabilities
}

export const parseLoginOtpChallenge = (
	value: unknown
): LoginOtpChallenge => {
	if (
		!isRecord(value) ||
		!exactKeys(value, [
			'challengeId',
			'browserToken',
			'expiresAt',
			'resendAvailableAt'
		]) ||
		typeof value.challengeId !== 'string' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			value.challengeId
		) ||
		typeof value.browserToken !== 'string' ||
		!/^[A-Za-z0-9_-]{43}$/.test(value.browserToken) ||
		!isCanonicalDate(value.expiresAt) ||
		!isCanonicalDate(value.resendAvailableAt) ||
		Date.parse(value.expiresAt) <= Date.parse(value.resendAvailableAt)
	) {
		throw new Error('Не удалось подготовить вход по коду')
	}
	return value as unknown as LoginOtpChallenge
}
