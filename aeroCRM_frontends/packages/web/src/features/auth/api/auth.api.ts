import {
	axiosClassicRequest,
	axiosInterceptorsRequest,
	refreshAccessToken,
	saveTokenStorage
} from '@/shared/api'
import { IFormData } from '@/features/auth/model/form.types'
import type { IUser } from '@/entities/user'
import {
	LoginOtpChannel,
	LoginOtpChallenge,
	parseLoginOtpCapabilities,
	parseLoginOtpChallenge
} from '../model/login-otp.contract'

interface IAuthResponse {
	accessToken: string
	user: IUser
}

interface IEmail {
	email?: string
	phone?: string
}

interface IPhonePayload {
	phone: string
	password?: string
	code?: string
	referrerId?: string
}

interface IEmailCodePayload {
	email: string
	password?: string
	code?: string
	referrerId?: string
}

export interface IEmailRegistrationResponse {
	email: string
	expiresAt: string
	resendAvailableAt: string
}

export interface IUserSession {
	id: string
	userAgent: string | null
	ipAddress: string | null
	createdAt: string
	lastUsedAt: string
	expiresAt: string
	isCurrent: boolean
}

export interface IRevokeSessionResponse {
	currentSessionRevoked: boolean
}

export interface IAuthSettings {
	turnstileEnabled: boolean
	googleAuthEnabled: boolean
	yandexAuthEnabled: boolean
	vkAuthEnabled: boolean
}

export const authSettingsService = {
	async get(): Promise<IAuthSettings> {
		const { data } =
			await axiosClassicRequest.get<IAuthSettings>('/auth/settings')

		return data
	},

	async update(payload: Partial<IAuthSettings>): Promise<IAuthSettings> {
		const { data } = await axiosInterceptorsRequest.patch<IAuthSettings>(
			'/auth/admin/settings',
			payload
		)

		return data
	}
}

class AuthService {
	async loginOtpCapabilities() {
		const { data } = await axiosClassicRequest.get<unknown>(
			'/auth/login-otp/capabilities',
			{ timeout: 10000 }
		)
		return parseLoginOtpCapabilities(data)
	}

	async requestLoginOtp(channel: LoginOtpChannel, destination: string) {
		const { data } = await axiosClassicRequest.post<unknown>(
			'/auth/login-otp/request',
			{ channel, destination },
			{ timeout: 20000 }
		)
		return parseLoginOtpChallenge(data)
	}

	async verifyLoginOtp(challenge: LoginOtpChallenge, code: string) {
		const response = await axiosClassicRequest.post<IAuthResponse>(
			'/auth/login-otp/verify',
			{
				challengeId: challenge.challengeId,
				browserToken: challenge.browserToken,
				code
			},
			{ timeout: 20000 }
		)
		if (!response.data.accessToken)
			throw new Error('Не удалось завершить вход')
		saveTokenStorage(response.data.accessToken)
		return response
	}

	async main(type: 'login', data: IFormData, token?: string | null) {
		const response = await axiosClassicRequest.post<IAuthResponse>(
			`/auth/${type}`,
			data,
			{
				headers: {
					turnstile: token
				}
			}
		)

		if (response.data.accessToken) {
			saveTokenStorage(response.data.accessToken)
		}

		return response
	}

	async getNewTokens() {
		return refreshAccessToken()
	}

	async getRestorePassword(data: IEmail, token?: string | null) {
		const response = await axiosClassicRequest.patch<IEmail>(
			'/auth/restore-password',
			{ email: data.email, phone: data.phone },
			{
				timeout: 45000,
				headers: {
					turnstile: token
				}
			}
		)

		return response
	}

	async logout() {
		return axiosClassicRequest.post<boolean>('/auth/logout')
	}

	async getSessions() {
		const { data } =
			await axiosInterceptorsRequest.get<IUserSession[]>('/auth/sessions')

		return data
	}

	async revokeSession(sessionId: string) {
		const { data } =
			await axiosInterceptorsRequest.delete<IRevokeSessionResponse>(
				`/auth/sessions/${sessionId}`
			)

		return data
	}

	async revokeAllSessions() {
		const { data } =
			await axiosInterceptorsRequest.delete<boolean>('/auth/sessions')

		return data
	}

	async sendEmailCode(data: IEmailCodePayload, token?: string | null) {
		return axiosClassicRequest.post<IEmailRegistrationResponse>(
			'/auth/register',
			{
				email: data.email,
				password: data.password
			},
			{
				timeout: 45000,
				headers: {
					turnstile: token
				}
			}
		)
	}

	async registerByEmail(data: IEmailCodePayload, token?: string | null) {
		const response = await axiosClassicRequest.post<IAuthResponse>(
			'/auth/email/register',
			{
				email: data.email,
				code: data.code,
				referrerId: data.referrerId
			},
			{
				timeout: 45000,
				headers: {
					turnstile: token
				}
			}
		)

		if (response.data.accessToken) {
			saveTokenStorage(response.data.accessToken)
		}

		return response
	}

	async resendEmailCode(data: IEmailCodePayload, token?: string | null) {
		return axiosClassicRequest.post<IEmailRegistrationResponse>(
			'/auth/email/resend-code',
			{
				email: data.email
			},
			{
				timeout: 45000,
				headers: {
					turnstile: token
				}
			}
		)
	}

	async sendPhoneCode(data: IPhonePayload, token?: string | null) {
		return axiosClassicRequest.post<boolean>(
			'/auth/phone/send-code',
			{ phone: data.phone },
			{
				headers: {
					turnstile: token
				}
			}
		)
	}

	async registerByPhone(data: IPhonePayload, token?: string | null) {
		const response = await axiosClassicRequest.post<IAuthResponse>(
			'/auth/phone/register',
			{
				phone: data.phone,
				password: data.password,
				code: data.code,
				referrerId: data.referrerId
			},
			{
				headers: {
					turnstile: token
				}
			}
		)

		if (response.data.accessToken) {
			saveTokenStorage(response.data.accessToken)
		}

		return response
	}

	async loginByPhone(data: IPhonePayload, token?: string | null) {
		const response = await axiosClassicRequest.post<IAuthResponse>(
			'/auth/phone/login',
			{
				phone: data.phone,
				password: data.password
			},
			{
				headers: {
					turnstile: token
				}
			}
		)

		if (response.data.accessToken) {
			saveTokenStorage(response.data.accessToken)
		}

		return response
	}

}

const authService = new AuthService()

export default authService
