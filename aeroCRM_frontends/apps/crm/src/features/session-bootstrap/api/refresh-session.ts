import type { AuthenticatedSession } from '@/entities/session'
import { getPublicHttpClient } from '@/shared/api/http-client'
import axios from 'axios'

const MAX_ACCESS_TOKEN_LENGTH = 16_384
const MAX_USER_ID_LENGTH = 256

export type SessionBootstrapErrorKind = 'anonymous' | 'temporary'

export class SessionBootstrapError extends Error {
	constructor(
		readonly kind: SessionBootstrapErrorKind,
		message: string
	) {
		super(message)
		this.name = 'SessionBootstrapError'
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const parseRefreshResponse = (value: unknown): AuthenticatedSession => {
	if (!isRecord(value) || !isRecord(value.user)) {
		throw new SessionBootstrapError(
			'temporary',
			'Сервис авторизации вернул некорректный ответ.'
		)
	}

	const accessToken = value.accessToken
	const userId = value.user.id

	if (
		typeof accessToken !== 'string' ||
		accessToken.length === 0 ||
		accessToken.length > MAX_ACCESS_TOKEN_LENGTH ||
		typeof userId !== 'string' ||
		userId.length === 0 ||
		userId.length > MAX_USER_ID_LENGTH
	) {
		throw new SessionBootstrapError(
			'temporary',
			'Сервис авторизации вернул некорректный ответ.'
		)
	}

	return { accessToken, userId }
}

export const refreshSession = async (): Promise<AuthenticatedSession> => {
	try {
		// Identity briefly rejects a concurrent cookie rotation. One retry after
		// its five-second grace window is bounded; 401 and other errors never loop.
		for (let attempt = 0; attempt < 2; attempt += 1) {
			try {
				const response =
					await getPublicHttpClient().post<unknown>('/auth/refresh')
				return parseRefreshResponse(response.data)
			} catch (error) {
				if (
					attempt === 0 &&
					axios.isAxiosError(error) &&
					error.response?.status === 409 &&
					isRecord(error.response.data) &&
					error.response.data.code === 'refresh_rotation_in_progress'
				) {
					await new Promise(resolve => setTimeout(resolve, 5_250))
					continue
				}
				throw error
			}
		}
		throw new SessionBootstrapError(
			'temporary',
			'Не удалось обновить сессию.'
		)
	} catch (error) {
		if (error instanceof SessionBootstrapError) {
			throw error
		}

		if (axios.isAxiosError(error) && error.response?.status === 401) {
			throw new SessionBootstrapError(
				'anonymous',
				'Требуется вход в аккаунт.'
			)
		}

		throw new SessionBootstrapError(
			'temporary',
			'Не удалось проверить сессию. Проверьте подключение и повторите попытку.'
		)
	}
}
