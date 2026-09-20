import type { AuthenticatedSession } from '@/entities/session'
import { parseRefreshResponse } from '@/features/session-bootstrap/api/refresh-session'
import {
	parseLoginOtpCapabilities,
	parseLoginOtpChallenge,
	type LoginOtpChallenge,
	type LoginOtpChannel
} from '@/features/workspace-auth/model/login-otp.contract'
import { getPublicHttpClient } from '@/shared/api/http-client'
import { getRuntimeConfig } from '@/shared/config/runtime'
import { parseWorkspaceReturnPath } from '@/shared/lib/auth-return-url'

export interface WorkspaceAuthSettings {
	turnstileEnabled: boolean
	googleAuthEnabled: boolean
	yandexAuthEnabled: boolean
	vkAuthEnabled: boolean
}

const tokenHeader = (token: string | null) => ({
	...(token ? { turnstile: token } : {})
})

const postSession = async (
	path: string,
	data: Record<string, string>,
	token: string | null
): Promise<AuthenticatedSession> => {
	const response = await getPublicHttpClient().post<unknown>(path, data, {
		timeout: 45_000,
		headers: tokenHeader(token)
	})
	return parseRefreshResponse(response.data)
}

export const workspaceAuthApi = {
	async getSettings(): Promise<WorkspaceAuthSettings> {
		const { data } =
			await getPublicHttpClient().get<WorkspaceAuthSettings>(
				'/auth/settings'
			)
		return data
	},

	login(email: string, password: string, token: string | null) {
		return postSession('/auth/login', { email, password }, token)
	},

	loginPhone(phone: string, password: string, token: string | null) {
		return postSession('/auth/phone/login', { phone, password }, token)
	},

	async startEmailRegistration(
		email: string,
		password: string,
		token: string | null
	) {
		await getPublicHttpClient().post(
			'/auth/register',
			{ email, password },
			{ timeout: 45_000, headers: tokenHeader(token) }
		)
	},

	finishEmailRegistration(
		email: string,
		code: string,
		token: string | null
	) {
		return postSession('/auth/email/register', { email, code }, token)
	},

	async resendEmailCode(email: string, token: string | null) {
		await getPublicHttpClient().post(
			'/auth/email/resend-code',
			{ email },
			{ timeout: 45_000, headers: tokenHeader(token) }
		)
	},

	async sendPhoneCode(phone: string, token: string | null) {
		await getPublicHttpClient().post(
			'/auth/phone/send-code',
			{ phone },
			{ timeout: 45_000, headers: tokenHeader(token) }
		)
	},

	registerPhone(
		phone: string,
		password: string,
		code: string,
		token: string | null
	) {
		return postSession(
			'/auth/phone/register',
			{ phone, password, code },
			token
		)
	},

	async restorePassword(
		contact: { email?: string; phone?: string },
		token: string | null
	) {
		await getPublicHttpClient().patch('/auth/restore-password', contact, {
			timeout: 45_000,
			headers: tokenHeader(token)
		})
	},

	async loginOtpCapabilities() {
		const { data } = await getPublicHttpClient().get<unknown>(
			'/auth/login-otp/capabilities'
		)
		return parseLoginOtpCapabilities(data)
	},

	async requestLoginOtp(channel: LoginOtpChannel, destination: string) {
		const { data } = await getPublicHttpClient().post<unknown>(
			'/auth/login-otp/request',
			{ channel, destination },
			{ timeout: 20_000 }
		)
		return parseLoginOtpChallenge(data)
	},

	async verifyLoginOtp(challenge: LoginOtpChallenge, code: string) {
		const { data } = await getPublicHttpClient().post<unknown>(
			'/auth/login-otp/verify',
			{
				challengeId: challenge.challengeId,
				browserToken: challenge.browserToken,
				code
			},
			{ timeout: 20_000 }
		)
		return parseRefreshResponse(data)
	},

	async logout() {
		await getPublicHttpClient().post('/auth/logout')
	},

	providerUrl(provider: 'google' | 'yandex' | 'vk', returnPath: string) {
		const safeReturnPath = parseWorkspaceReturnPath(returnPath)
		if (!safeReturnPath) throw new Error('CRM return path is invalid')
		const url = new URL(
			`${getRuntimeConfig().apiBaseUrl}/auth/${provider}`
		)
		url.searchParams.set('client', 'workspace')
		url.searchParams.set('returnPath', safeReturnPath)
		return url.toString()
	}
}
