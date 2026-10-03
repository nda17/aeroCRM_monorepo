import { API_URL } from '../config/api.config'
import axios, { AxiosResponse, CreateAxiosDefaults } from 'axios'
import { clearBrowserSession } from './clear-session'
import { errorCatch, getContentType } from './error'
import {
	getAccessToken,
	getTokenBinding,
	getCurrentSessionBinding,
	getSessionRevision,
	isAccessTokenValid,
	saveTokenStorage
} from './token-storage'

interface IAccessTokenResponse {
	accessToken: string
}

const axiosOptions: CreateAxiosDefaults = {
	baseURL: API_URL,
	headers: getContentType(),
	withCredentials: true
}

export const axiosClassicRequest = axios.create(axiosOptions)
export const axiosInterceptorsRequest = axios.create(axiosOptions)

let refreshPromise: Promise<AxiosResponse<IAccessTokenResponse>> | null =
	null

const requestRefreshToken = async () => {
	try {
		return await axiosClassicRequest.post<IAccessTokenResponse>(
			'/auth/refresh'
		)
	} catch (error) {
		if (
			!axios.isAxiosError(error) ||
			error.response?.status !== 409 ||
			error.response.data?.code !== 'refresh_rotation_in_progress'
		)
			throw error
		// A parallel frontend can rotate the shared refresh cookie. Retry once
		// with the browser's updated cookie after Identity's five-second window.
		await new Promise(resolve => setTimeout(resolve, 5_250))
		return axiosClassicRequest.post<IAccessTokenResponse>('/auth/refresh')
	}
}

export const refreshAccessToken = () => {
	if (refreshPromise) {
		return refreshPromise
	}

	const revision = getSessionRevision()
	const binding = getCurrentSessionBinding()
	refreshPromise = requestRefreshToken()
		.then(response => {
			if (!response.data?.accessToken) {
				throw new Error('Refresh response does not contain access token')
			}

			const next = getTokenBinding(response.data.accessToken)
			// Another tab can replace the shared cookie without advancing this
			// tab's in-memory revision. Re-read its binding before any write.
			const current = getCurrentSessionBinding()
			if (
				getSessionRevision() !== revision ||
				(current &&
					(!next ||
						current.subject !== next.subject ||
						current.sessionId !== next.sessionId)) ||
				(binding &&
					(!next ||
						binding.subject !== next.subject ||
						binding.sessionId !== next.sessionId))
			)
				throw new Error('Session changed during renewal')
			saveTokenStorage(response.data.accessToken)

			if (!isAccessTokenValid(getAccessToken())) {
				throw new Error('Refreshed access token is invalid')
			}

			return response
		})
		.finally(() => {
			refreshPromise = null
		})

	return refreshPromise
}

axiosInterceptorsRequest.interceptors.request.use(config => {
	const accessToken = getAccessToken()

	if (config?.headers && accessToken) {
		;(
			config as typeof config & { _sessionRevision?: number }
		)._sessionRevision = getSessionRevision()
		config.headers.Authorization = `Bearer ${accessToken}`
	}

	return config
})

axiosInterceptorsRequest.interceptors.response.use(
	config => config,
	async error => {
		const originalRequest = error.config
		const isAuthenticationError =
			error?.response?.status === 401 ||
			errorCatch(error) === 'jwt expired' ||
			errorCatch(error) === 'jwt must be provided'

		const requestToken =
			originalRequest?.headers?.Authorization?.toString().replace(
				/^Bearer /,
				''
			)
		const captured = getTokenBinding(requestToken ?? null)
		const current = () => {
			const active = getCurrentSessionBinding()
			return (
				originalRequest?._sessionRevision === getSessionRevision() &&
				!!captured &&
				!!active &&
				captured.subject === active.subject &&
				captured.sessionId === active.sessionId
			)
		}
		if (isAuthenticationError && !current()) throw error
		if (isAuthenticationError && originalRequest?._isRetry) {
			clearBrowserSession()
			throw error
		}

		if (isAuthenticationError && originalRequest) {
			originalRequest._isRetry = true

			try {
				await refreshAccessToken()
				return axiosInterceptorsRequest.request(originalRequest)
			} catch (refreshError) {
				if (
					current() &&
					axios.isAxiosError(refreshError) &&
					refreshError.response?.status === 401
				)
					clearBrowserSession({
						reason:
							refreshError.response.data?.code === 'session_revoked'
								? 'revoked'
								: undefined
					})
			}
		}

		throw error
	}
)
