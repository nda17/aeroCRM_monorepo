import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { isRecord, isUuidV4 } from '@/shared/lib/contract'

export interface CurrentAccount {
	email: string | null
}

const isSafeEmail = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.length <= 254 &&
	value === value.trim() &&
	/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

export const getCurrentAccount = async (
	accessToken: string,
	expectedUserId: string
): Promise<CurrentAccount> => {
	if (!isUuidV4(expectedUserId)) throw invalidContractError()
	const response = await authenticatedRequest({
		accessToken,
		method: 'GET',
		url: '/users/profile'
	})
	if (
		!isRecord(response) ||
		response.id !== expectedUserId ||
		!(response.email === null || isSafeEmail(response.email))
	) {
		throw invalidContractError()
	}
	return { email: response.email }
}
