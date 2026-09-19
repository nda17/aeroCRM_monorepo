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

export const refreshAccessToken = () => {
	if (refreshPromise) {
		return refreshPromise
	}

	refreshPromise = axiosClassicRequest
		.post<IAccessTokenResponse>('/auth/refresh')
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
