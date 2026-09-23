import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { isNonEmptyString, isRecord } from '@/shared/lib/contract'

export interface CurrentAccount {
	email: string | null
	name: string | null
}

const isSafeEmail = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.length <= 254 &&
	value === value.trim() &&
	/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

const isSafeDisplayName = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.length > 0 &&
	value.length <= 255 &&
	value.trim().length > 0 &&
	!/[\p{Cc}\p{Cs}\uFFFD]/u.test(value)

const isSessionSubject = (value: unknown): value is string =>
	isNonEmptyString(value, 256) &&
	/^[^\s\x00-\x1f\x7f\uD800-\uDFFF\uFFFD]+$/u.test(value)

export const getCurrentAccount = async (
	accessToken: string,
	expectedUserId: string
): Promise<CurrentAccount> => {
	if (!isSessionSubject(expectedUserId)) throw invalidContractError()
	const response = await authenticatedRequest({
		accessToken,
		method: 'GET',
		url: '/users/profile'
	})
	if (
		!isRecord(response) ||
		response.id !== expectedUserId ||
		!(response.email === null || isSafeEmail(response.email)) ||
		!(response.name === null || isSafeDisplayName(response.name))
	) {
		throw invalidContractError()
	}
	return { email: response.email, name: response.name }
}
