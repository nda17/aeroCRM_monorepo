import { axiosInterceptorsRequest } from '@/shared/api'
import type {
	BillingPeriod,
	Plan,
	Subscription
} from '@/entities/subscription/model/subscription.types'

export interface IAdminSubscriptionUser {
	id: string
	name: string | null
	email: string | null
}

export interface IAdminSubscription extends Subscription {
	user: IAdminSubscriptionUser | null
}

export interface IAdminSubscriptionsResponse {
	items: IAdminSubscription[]
	total: number
	page: number
	limit: number
	totalPages: number
}

export type SubscriptionHistoryAction = 'BONUS_DAYS'
export type AdminBonusAudience =
	| 'SINGLE'
	| 'ACTIVE_SUBSCRIPTION'
	| 'INACTIVE_SUBSCRIPTION'
	| 'ALL'

export interface IAdminSubscriptionHistory {
	id: string
	subscriptionId: string | null
	userId: string | null
	adminId: string | null
	action: SubscriptionHistoryAction
	days: number | null
	oldExpiresAt: string | null
	newExpiresAt: string | null
	targetAudience: AdminBonusAudience | null
	targetLabel: string | null
	affectedUsersCount: number | null
	createdAt: string
	user: IAdminSubscriptionUser | null
	admin: IAdminSubscriptionUser | null
}

export interface IAdminSubscriptionHistoryResponse {
	items: IAdminSubscriptionHistory[]
	total: number
	page: number
	limit: number
	totalPages: number
}

export type AdminSubscriptionPeriodFilter = BillingPeriod | 'NONE'

export interface IAdminSubscriptionFilters {
	plan?: Plan
	status?: Subscription['status']
	billingPeriod?: AdminSubscriptionPeriodFilter
	expiresFrom?: string
	expiresTo?: string
}

export interface IAdminSubscriptionHistoryFilters {
	audience?: AdminBonusAudience
	adminId?: string
	createdFrom?: string
	createdTo?: string
}

export interface IAdminActivateInput {
	userId: string
	plan: Plan
	billingPeriod?: BillingPeriod
	startsAt?: string
	extendIfActive?: boolean
}

export interface IAdminExtendDaysInput {
	userId?: string
	days: number
	audience?: AdminBonusAudience
}

export interface IAdminExtendDaysResult {
	audience: AdminBonusAudience
	audienceLabel: string
	affectedUsersCount: number
	historyId: string
	subscription?: Subscription
}

export interface IPendingPayment {
	id: string
	yookassaId: string | null
	amount: string
	currency: string
	plan: Plan | null
	billingPeriod: BillingPeriod | null
	status: PaymentStatus
	kind: PaymentKind
	autoRenew: boolean
	confirmationUrl: string | null
	createdAt: string
	expiresAt: string
	providerExpiresAt: string | null
	serverTime: string
}

export type PaymentStatus =
	| 'PENDING'
	| 'SUCCEEDED'
	| 'CANCELLED'
	| 'EXPIRED'
export type PaymentKind = 'ONE_TIME' | 'RECURRING'

export interface ICreatePaymentResponse {
	id: string
	confirmationUrl: string
	status: 'PENDING'
	kind: PaymentKind
	autoRenew: boolean
	expiresAt: string
	providerExpiresAt: string | null
	serverTime: string
}

export type AutoRenewalStatus =
	| 'NEVER_CONSENTED'
	| 'ACTIVE'
	| 'USER_DISABLED'
	| 'ADMIN_PAUSED'
	| 'TECHNICAL_PAUSE'
	| 'REVOKED'

export interface IAutoRenewalPriceChange {
	required: boolean
	previousAmount: string | null
	newAmount: string | null
	currency: string | null
	detectedAt: string | null
	canConfirm: boolean
}

export interface IAutoRenewalRetry {
	active: boolean
	attempt: number
	maxAttempts: number
	startedAt: string | null
	nextRetryAt: string | null
	lastErrorCode: string | null
}

export interface IAutoRenewal {
	status: AutoRenewalStatus
	active: boolean
	plan: Plan | null
	billingPeriod: BillingPeriod | null
	amount: string | null
	currency: string
	nextChargeAt: string | null
	retry: IAutoRenewalRetry | null
	disabledAt: string | null
	disableReason: string | null
	canDisable: boolean
	canEnableViaCheckout: boolean
	serverTime: string
	priceChange: IAutoRenewalPriceChange
}

export interface IUserPaymentReceipt {
	status: string
	registeredAt: string | null
	url: string | null
	fiscalDocumentNumber: string | null
}

export interface IUserPayment {
	id: string
	yookassaId: string | null
	status: PaymentStatus
	kind: PaymentKind
	amount: string
	currency: string
	plan: Plan | null
	billingPeriod: BillingPeriod | null
	autoRenew: boolean
	createdAt: string
	succeededAt: string | null
	receiptSyncEligible: boolean
	receipt: IUserPaymentReceipt | null
}

export interface IUserPaymentsResponse {
	items: IUserPayment[]
	total: number
	page: number
	limit: number
	totalPages: number
	serverTime: string
}

export interface IPaymentVerification {
	activated: boolean
	status: 'succeeded' | 'pending' | 'cancelled' | 'not_found'
	plan: Plan | null
	billingPeriod: BillingPeriod | null
	message: string
}

const subscriptionService = {
	async getMySubscription(): Promise<Subscription> {
		const { data } = await axiosInterceptorsRequest.get(
			'/subscriptions/me'
		)
		return data
	},

	async createPayment(
		plan: Plan,
		billingPeriod: BillingPeriod,
		expectedAmount: number,
		autoRenew = false,
		consentVersion?: string
	): Promise<ICreatePaymentResponse> {
		const { data } = await axiosInterceptorsRequest.post(
			'/payments/create',
			{
				plan,
				billingPeriod,
				expectedAmount,
				autoRenew,
				...(autoRenew ? { consentVersion } : {})
			}
		)
		return data
	},

	async verifyPayment(paymentId?: string): Promise<IPaymentVerification> {
		const { data } = await axiosInterceptorsRequest.post(
			'/payments/verify',
			{
				paymentId
			}
		)
		return data
	},

	async getPendingPayment(): Promise<IPendingPayment | null> {
		const { data } = await axiosInterceptorsRequest.get(
			'/payments/pending'
		)
		return data
	},

	async cancelPendingPayment(paymentId: string): Promise<{
		cancelled: boolean
		message: string
		cancelledAt: string
	}> {
		const { data } = await axiosInterceptorsRequest.post(
			'/payments/pending/cancel',
			{ paymentId }
		)
		return data
	},

	async getAutoRenewal(): Promise<IAutoRenewal> {
		const { data } = await axiosInterceptorsRequest.get(
			'/payments/auto-renewal'
		)
		return data
	},

	async disableAutoRenewal(): Promise<IAutoRenewal> {
		const { data } = await axiosInterceptorsRequest.delete(
			'/payments/auto-renewal'
		)
		return data
	},

	async confirmAutoRenewalPrice(): Promise<{
		autoRenewal: IAutoRenewal
		message: string
	}> {
		const { data } = await axiosInterceptorsRequest.post(
			'/payments/auto-renewal/confirm-price'
		)
		return data
	},

	async getMyPayments(
		page = 1,
		limit = 10
	): Promise<IUserPaymentsResponse> {
		const { data } = await axiosInterceptorsRequest.get(
			'/payments/history',
			{
				params: { page, limit }
			}
		)
		return data
	},

	async adminGetAll(
		page: number,
		limit: number,
		filters?: IAdminSubscriptionFilters
	): Promise<IAdminSubscriptionsResponse> {
		const { data } = await axiosInterceptorsRequest.get(
			'/subscriptions/admin/list',
			{
				params: { page, limit, ...filters }
			}
		)
		return data
	},

	async adminGetHistory(
		page: number,
		limit: number,
		filters?: IAdminSubscriptionHistoryFilters
	): Promise<IAdminSubscriptionHistoryResponse> {
		const { data } = await axiosInterceptorsRequest.get(
			'/subscriptions/admin/history',
			{
				params: { page, limit, ...filters }
			}
		)
		return data
	},

	async adminActivate(body: IAdminActivateInput): Promise<Subscription> {
		const { data } = await axiosInterceptorsRequest.post(
			'/subscriptions/admin/activate',
			body
		)
		return data
	},

	async adminExtendDays(
		body: IAdminExtendDaysInput
	): Promise<IAdminExtendDaysResult> {
		const { data } = await axiosInterceptorsRequest.post(
			'/subscriptions/admin/extend-days',
			body
		)
		return data
	},

	async adminCancel(userId: string): Promise<Subscription> {
		const { data } = await axiosInterceptorsRequest.patch(
			`/subscriptions/admin/${userId}/cancel`
		)
		return data
	}
}

export default subscriptionService
