import { getRuntimeConfig } from '@/shared/config/runtime'
import axios, { type AxiosInstance } from 'axios'

const REQUEST_TIMEOUT_MS = 10_000

let publicHttpClient: AxiosInstance | undefined
let publicHttpClientBaseUrl: string | undefined

export const getPublicHttpClient = () => {
	const { apiBaseUrl } = getRuntimeConfig()

	if (!publicHttpClient || publicHttpClientBaseUrl !== apiBaseUrl) {
		publicHttpClient = axios.create({
			baseURL: apiBaseUrl,
			withCredentials: true,
			timeout: REQUEST_TIMEOUT_MS,
			headers: {
				Accept: 'application/json'
			}
		})
		publicHttpClientBaseUrl = apiBaseUrl
	}

	return publicHttpClient
}
