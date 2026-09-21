declare module '@/shared/api' {
	type RequestClient = {
		get: <T = unknown>(...args: unknown[]) => Promise<{ data: T }>
		post: <T = unknown>(...args: unknown[]) => Promise<{ data: T }>
	}
	export const axiosClassicRequest: RequestClient
	export const axiosInterceptorsRequest: RequestClient
	export const getAccessToken: () => string | null
	export const isAccessTokenValid: (accessToken: string | null) => boolean
}

declare module '@/entities/user/model/auth-store' {
	type AuthState = { auth: boolean; isAuthResolved: boolean }
	export const useAuthStore: {
		getState: () => AuthState
		subscribe: (
			listener: (state: AuthState, previous: AuthState) => void
		) => () => void
	}
}
