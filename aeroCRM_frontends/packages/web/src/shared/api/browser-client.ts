import { API_URL } from '@/shared/config/api.config'
import axios, { AxiosResponse, CreateAxiosDefaults } from 'axios'
import { clearBrowserSession } from './clear-session'
import { errorCatch, getContentType } from './error'
import {
	getAccessToken,
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

	refreshPromise = requestRefreshToken()
		.then(response => {
			if (!response.data?.accessToken) {
				throw new Error('Refresh response does not contain access token')
			}

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

		if (isAuthenticationError && originalRequest?._isRetry) {
			clearBrowserSession()
			throw error
		}

		if (isAuthenticationError && originalRequest) {
			originalRequest._isRetry = true

			try {
				await refreshAccessToken()
				return axiosInterceptorsRequest.request(originalRequest)
			} catch {
				clearBrowserSession()
			}
		}

		throw error
	}
)
