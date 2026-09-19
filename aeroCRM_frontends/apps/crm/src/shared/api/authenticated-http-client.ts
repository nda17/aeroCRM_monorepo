import { getPublicHttpClient } from '@/shared/api/http-client'
import {
	resolveSessionTransport,
	type SessionTransportLease
} from './session-transport'
import axios from 'axios'

const ACCESS_TOKEN_PATTERN = /^[^\s,]{1,16384}$/

export type AuthenticatedApiErrorKind =
	| 'unauthorized'
	| 'forbidden'
	| 'notFound'
	| 'conflict'
	| 'validation'
	| 'temporary'

export class AuthenticatedApiError extends Error {
	constructor(
		readonly kind: AuthenticatedApiErrorKind,
		message: string
	) {
		super(message)
		this.name = 'AuthenticatedApiError'
	}
}

const sessionRecoveryReadErrors = new WeakSet<AuthenticatedApiError>()

export const isSessionRecoveryReadError = (error: unknown) =>
	error instanceof AuthenticatedApiError &&
	sessionRecoveryReadErrors.has(error)

interface AuthenticatedRequest {
	accessToken: string
	method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
	url: string
	params?: Record<string, string>
	data?: unknown
	headers?: Record<string, string>
	mapError?: (error: unknown) => AuthenticatedApiError | undefined
}

export const authenticatedRequest = async ({
	accessToken,
	method,
	url,
	params,
	data,
	headers,
	mapError
}: AuthenticatedRequest): Promise<unknown> => {
	if (!ACCESS_TOKEN_PATTERN.test(accessToken)) {
		throw new AuthenticatedApiError(
			'temporary',
			'Не удалось подготовить безопасный запрос.'
		)
	}

	const readSessionLease = async (
		read: () => Promise<SessionTransportLease>
	) => {
		try {
			return await read()
		} catch (error) {
			if (
				method === 'GET' &&
				error instanceof AuthenticatedApiError &&
				error.kind === 'temporary'
			) {
				// A single-flight renewal may reject reads and mutations with the
				// same error object. Brand only this GET's copy, never that shared error.
				const readError = new AuthenticatedApiError(
					error.kind,
					error.message
				)
				sessionRecoveryReadErrors.add(readError)
				throw readError
			}
			throw error
		}
	}

	try {
		let lease = await readSessionLease(() =>
			resolveSessionTransport(accessToken)
		)
		const ensureCurrent = () => {
			if (!lease.isCurrent())
				throw new AuthenticatedApiError(
					'unauthorized',
					'Сессия больше не действует.'
				)
			if (!ACCESS_TOKEN_PATTERN.test(lease.accessToken))
				throw new AuthenticatedApiError(
					'temporary',
					'Не удалось подготовить безопасный запрос.'
				)
		}
		const send = () => {
			ensureCurrent()
			return getPublicHttpClient().request<unknown>({
				method,
				url,
				params,
				data,
				headers: {
					...headers,
					Authorization: `Bearer ${lease.accessToken}`
				}
			})
		}
		let response
		try {
			response = await send()
		} catch (error) {
			if (
				!axios.isAxiosError(error) ||
				error.response?.status !== 401 ||
				!lease.refresh
			)
				throw error
			ensureCurrent()
			lease = await readSessionLease(() => lease.refresh!())
			ensureCurrent()
			// A mutation is never replayed implicitly, even after an auth failure.
			if (method !== 'GET')
				throw new AuthenticatedApiError(
					'temporary',
					'Сессия обновлена. Повторите действие.'
				)
			response = await send()
		}
		ensureCurrent()
		return response.data
	} catch (error) {
		if (error instanceof AuthenticatedApiError) {
			throw error
		}
		const mappedError = mapError?.(error)
		if (mappedError) throw mappedError

		if (axios.isAxiosError(error) && error.response?.status === 401) {
			throw new AuthenticatedApiError(
				'unauthorized',
				'Сессия больше не действует.'
			)
		}

		if (axios.isAxiosError(error) && error.response?.status === 403) {
			throw new AuthenticatedApiError(
				'forbidden',
				'Недостаточно прав для выполнения команды.'
			)
		}

		if (axios.isAxiosError(error) && error.response?.status === 409) {
			throw new AuthenticatedApiError(
				'conflict',
				'Команда конфликтует с ранее обработанным запросом.'
			)
		}

		if (axios.isAxiosError(error) && error.response?.status === 404) {
			throw new AuthenticatedApiError(
				'notFound',
				'Запись не найдена или недоступна.'
			)
		}
		if (axios.isAxiosError(error) && error.response?.status === 400) {
			throw new AuthenticatedApiError(
				'validation',
				'Проверьте заполненные поля и повторите попытку.'
			)
		}

		throw new AuthenticatedApiError(
			'temporary',
			'Сервис WinCRM временно недоступен. Повторите попытку.'
		)
	}
}

export const invalidContractError = () =>
	new AuthenticatedApiError(
		'temporary',
		'Сервис WinCRM вернул некорректный ответ.'
	)
