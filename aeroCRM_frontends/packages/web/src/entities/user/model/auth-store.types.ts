export interface IAuthStore {
	auth: boolean
	isAuthResolved: boolean
	setAuth: (value: boolean) => void
	setAuthResolved: (value: boolean) => void
}
