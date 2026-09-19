import { axiosInterceptorsRequest } from '@/shared/api'
import { IUserEditInput } from '@/entities/user/model/user-edit.types'
import { IUser } from '@/entities/user/model/user.types'
import {
	BillingPeriod,
	Plan,
	Subscription
} from '@/entities/subscription/@x/user'

export interface IProfileEditInput {
	name?: string
	password?: string
}

export interface IUserAvatarResponse {
	avatarPath: string | null
}

export interface IProfileIdentityCodeInput {
	email?: string
	phone?: string
	code?: string
}

interface IProfileEmailCodeResponse {
	value: string
	expiresAt: string
	resendAvailableAt: string
}

export interface IProfileTelegramBindingResponse {
	requestId: string
	botUrl: string
	expiresAt: string
}

export interface IProfileTelegramNotificationsStatus {
	connected: boolean
	username: string | null
	connectedAt: string | null
	disabledAt: string | null
	telegramBotTokenConfigured: boolean
	telegramBotUsernameConfigured: boolean
	pendingRequest: IProfileTelegramBindingResponse | null
}

export interface IUserListResponse {
	items: IUser[]
	total: number
	page: number
	limit: number
	totalPages: number
}

export type AdminUserSubscriptionFilter = 'HAS' | 'NONE'

export interface IAdminUserListFilters {
	role?: 'USER' | 'ADMIN' | 'DEV'
	registeredFrom?: string
	registeredTo?: string
	subscription?: AdminUserSubscriptionFilter
	includeDeleted?: boolean
	deletedOnly?: boolean
}

export type AdminUserOverviewPaymentStatus =
	| 'PENDING'
	| 'SUCCEEDED'
	| 'CANCELLED'
	| 'EXPIRED'

export type AdminAutoRenewalStatus =
	| 'NEVER_CONSENTED'
	| 'ACTIVE'
	| 'USER_DISABLED'
	| 'ADMIN_PAUSED'
	| 'TECHNICAL_PAUSE'
	| 'REVOKED'

export interface IAdminAutoRenewalMaskedMethod {
	type: string | null
	title: string | null
	last4: string | null
	savedAt: string
}

export interface IAdminAutoRenewalDetail {
	id: string | null
	user: {
		id: string
		name: string | null
		email: string | null
	}
	status: AdminAutoRenewalStatus
	active: boolean
	plan: Plan | null
	billingPeriod: BillingPeriod | null
	amount: string | null
	currency: string | null
	nextChargeAt: string | null
	consentedAt: string | null
	consentVersion: string | null
	disabledAt: string | null
	disableReason: string | null
	lastChargeAttemptAt: string | null
	lastChargeErrorCode: string | null
	maskedMethod: IAdminAutoRenewalMaskedMethod | null
	validity: {
		hasConsent: boolean
		hasPaymentMethod: boolean
		userEligible: boolean
	}
	priceChange: {
		required: boolean
		previousAmount: string | null
		newAmount: string | null
		currency: string | null
		detectedAt: string | null
		canConfirm: boolean
	}
	capabilities: {
		canPause: boolean
		canResumeAdminPause: boolean
		canRevoke: boolean
		canReconcile: boolean
		canResumeTechnical: boolean
	}
	updatedAt: string | null
	serverTime: string
}

export interface IAdminAutoRenewalMutationResponse {
	autoRenewal: IAdminAutoRenewalDetail
	message: string
}

export type AdminUserOverviewActivityRole = 'TARGET' | 'ADMIN'

export interface IAdminUserOverviewPayment {
	id: string
	yookassaId: string | null
	status: AdminUserOverviewPaymentStatus
	amount: string
	plan: Plan | null
	billingPeriod: BillingPeriod | null
	createdAt: string
	updatedAt: string
}

export interface IAdminUserOverviewActivity {
	id: string
	section: string
	action: string
	description: string
	entityType: string | null
	entityLabel: string | null
	adminName: string | null
	adminEmail: string | null
	targetUserId: string | null
	createdAt: string
	role: AdminUserOverviewActivityRole
}

export interface IAdminUserOverview {
	subscription: Subscription | null
	payments: {
		total: number
		counts: Record<AdminUserOverviewPaymentStatus, number>
		latest: IAdminUserOverviewPayment[]
	}
	activity: {
		latest: IAdminUserOverviewActivity[]
	}
}

class UserService {
	private _BASE_URL = '/users'

	private async uploadAvatar(path: string, file: File) {
		const formData = new FormData()
		formData.append('file', file)

		const { data } =
			await axiosInterceptorsRequest.put<IUserAvatarResponse>(
				path,
				formData,
				{
					headers: {
						'Content-Type': 'multipart/form-data'
					}
				}
			)

		if (!data.avatarPath) {
			throw new Error('Ответ загрузки не содержит адрес аватара')
		}

		return data.avatarPath
	}

	private async deleteAvatar(path: string) {
		const { data } =
			await axiosInterceptorsRequest.delete<IUserAvatarResponse>(path)

		if (data.avatarPath !== null) {
			throw new Error('Ответ удаления содержит некорректный адрес аватара')
		}
	}

	async fetchProfile() {
		return axiosInterceptorsRequest.get<IUser>(`${this._BASE_URL}/profile`)
	}

	async fetchUserList(
		searchTerm?: string,
		page = 1,
		limit = 20,
		filters?: IAdminUserListFilters
	) {
		return axiosInterceptorsRequest.get<IUserListResponse>(
			`${this._BASE_URL}/user-list`,
			{
				params: {
					searchTerm: searchTerm || undefined,
					page,
					limit,
					...filters
				}
			}
		)
	}

	async fetchUserById(id: string) {
		return axiosInterceptorsRequest.get<IUser>(
			`${this._BASE_URL}/edit/${id}`
		)
	}

	async fetchUserOverview(id: string) {
		return axiosInterceptorsRequest.get<IAdminUserOverview>(
			`${this._BASE_URL}/edit/${id}/overview`
		)
	}

	async fetchAdminUserAutoRenewal(id: string) {
		return axiosInterceptorsRequest.get<IAdminAutoRenewalDetail>(
			`/payments/admin/auto-renewals/${id}`
		)
	}

	async pauseAdminUserAutoRenewal(id: string, reason: string) {
		return axiosInterceptorsRequest.post<IAdminAutoRenewalMutationResponse>(
			`/payments/admin/auto-renewals/${id}/pause`,
			{ reason }
		)
	}

	async resumeAdminUserAutoRenewal(id: string, reason: string) {
		return axiosInterceptorsRequest.post<IAdminAutoRenewalMutationResponse>(
			`/payments/admin/auto-renewals/${id}/resume`,
			{ reason }
		)
	}

	async revokeAdminUserAutoRenewal(id: string, reason: string) {
		return axiosInterceptorsRequest.post<IAdminAutoRenewalMutationResponse>(
			`/payments/admin/auto-renewals/${id}/revoke`,
			{ reason }
		)
	}

	async reconcileAdminUserAutoRenewal(id: string) {
		return axiosInterceptorsRequest.post<IAdminAutoRenewalMutationResponse>(
			`/payments/dev/auto-renewals/${id}/reconcile`
		)
	}

	async resumeTechnicalAdminUserAutoRenewal(id: string, reason: string) {
		return axiosInterceptorsRequest.post<IAdminAutoRenewalMutationResponse>(
			`/payments/dev/auto-renewals/${id}/resume-technical`,
			{ reason }
		)
	}

	async deleteUser(id: string) {
		return axiosInterceptorsRequest.delete<IUser>(
			`${this._BASE_URL}/user/${id}`
		)
	}

	async restoreUser(id: string) {
		return axiosInterceptorsRequest.patch<IUser>(
			`${this._BASE_URL}/user/${id}/restore`
		)
	}

	async updateUser(id: string, data: IUserEditInput) {
		return axiosInterceptorsRequest.patch<string>(
			`${this._BASE_URL}/user/${id}`,
			data
		)
	}

	async uploadAdminUserAvatar(id: string, file: File) {
		return this.uploadAvatar(`${this._BASE_URL}/user/${id}/avatar`, file)
	}

	async deleteAdminUserAvatar(id: string) {
		return this.deleteAvatar(`${this._BASE_URL}/user/${id}/avatar`)
	}

	async toggleUserActivation(id: string) {
		return axiosInterceptorsRequest.patch<IUser>(
			`${this._BASE_URL}/user/${id}/toggle-activation`
		)
	}

	async updateProfile(data: IProfileEditInput) {
		return axiosInterceptorsRequest.patch<boolean>(
			`${this._BASE_URL}/profile`,
			data
		)
	}

	async uploadProfileAvatar(file: File) {
		return this.uploadAvatar(`${this._BASE_URL}/profile/avatar`, file)
	}

	async deleteProfileAvatar() {
		return this.deleteAvatar(`${this._BASE_URL}/profile/avatar`)
	}

	async sendProfileEmailCode(data: IProfileIdentityCodeInput) {
		return axiosInterceptorsRequest.post<IProfileEmailCodeResponse>(
			`${this._BASE_URL}/profile/bind/email/send-code`,
			{
				email: data.email
			},
			{ timeout: 45_000 }
		)
	}

	async verifyProfileEmailCode(data: IProfileIdentityCodeInput) {
		return axiosInterceptorsRequest.post<IUser>(
			`${this._BASE_URL}/profile/bind/email/verify`,
			{
				email: data.email,
				code: data.code
			},
			{ timeout: 30_000 }
		)
	}

	async sendProfilePhoneCode(data: IProfileIdentityCodeInput) {
		return axiosInterceptorsRequest.post(
			`${this._BASE_URL}/profile/bind/phone/send-code`,
			{
				phone: data.phone
			}
		)
	}

	async verifyProfilePhoneCode(data: IProfileIdentityCodeInput) {
		return axiosInterceptorsRequest.post<IUser>(
			`${this._BASE_URL}/profile/bind/phone/verify`,
			{
				phone: data.phone,
				code: data.code
			}
		)
	}

	async startProfileTelegramBinding() {
		const { data } =
			await axiosInterceptorsRequest.post<IProfileTelegramBindingResponse>(
				`${this._BASE_URL}/profile/bind/telegram/start`
			)

		return data
	}

	async cancelProfileTelegramBinding() {
		return axiosInterceptorsRequest.post(
			`${this._BASE_URL}/profile/bind/telegram/cancel`
		)
	}

	async unlinkProfileTelegramBinding() {
		const { data } = await axiosInterceptorsRequest.delete<IUser>(
			`${this._BASE_URL}/profile/bind/telegram`
		)

		return data
	}

	async fetchProfileTelegramNotifications() {
		const { data } =
			await axiosInterceptorsRequest.get<IProfileTelegramNotificationsStatus>(
				`${this._BASE_URL}/profile/telegram-notifications`
			)

		return data
	}

	async startProfileTelegramNotifications() {
		const { data } =
			await axiosInterceptorsRequest.post<IProfileTelegramBindingResponse>(
				`${this._BASE_URL}/profile/telegram-notifications/start`
			)

		return data
	}

	async cancelProfileTelegramNotifications() {
		return axiosInterceptorsRequest.post(
			`${this._BASE_URL}/profile/telegram-notifications/cancel`
		)
	}

	async disconnectProfileTelegramNotifications() {
		return axiosInterceptorsRequest.delete(
			`${this._BASE_URL}/profile/telegram-notifications`
		)
	}
}

const userService = new UserService()

export default userService
