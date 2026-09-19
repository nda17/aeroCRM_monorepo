import { axiosInterceptorsRequest } from '@/shared/api'

export type MessagingIntegration =
	| 'email'
	| 'webhook'
	| 'telegram'
	| 'bitrix24'
	| 'amo-crm'
	| 'payment-email'
	| 'payment-telegram'
	| 'campaign-email'
	| 'campaign-telegram'
	| 'daily-summary-delivery-telegram'
	| 'campaign-admin-audit'
	| 'reporting-admin-audit'
	| 'billing-admin-audit'
	| 'identity-admin-audit'
	| 'platform-admin-audit'
	| 'telegram-destination-unavailable'
	| 'billing-payment-projection'
	| 'billing-subscription-projection'
	| 'billing-affiliate-projection'
	| 'billing-settings-projection'
	| 'billing-identity-source'
	| 'billing-offer-source'
	| 'billing-notification-routing-source'
	| 'billing-trial-source'
	| 'billing-referral-source'
	| 'billing-lifecycle-repair-source'
	| 'auto-renewal'
	| 'subscription-expiry-email'
	| 'subscription-expiry-telegram'
	| 'limit-email'
	| 'limit-telegram'
	| 'notification-delivery-outcome'
	| 'database-backup'

export type MessagingFailureCategory =
	| 'TRANSIENT'
	| 'RATE_LIMIT'
	| 'PERMANENT'
	| 'AUTH_CONFIGURATION'

export type MessagingFailureResolution =
	| 'DELIVERED'
	| 'CLOSED_NO_RETRY'
	| null

export interface MessagingOverview {
	generatedAt: string
	outbox: Record<'PENDING' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED', number>
	oldestPendingAt: string | null
	unresolvedFailures: number
	retryingFailures: number
	processedLast24Hours: number
	completedBackupsLast24Hours: number
	rabbitMqError: string | null
	notificationDeliveryError: string | null
	billingError: string | null
	identityError: string | null
	platformError: string | null
	supportError: string | null
	campaignsError: string | null
	reportingError: string | null
	heartbeats: Array<{
		service: string
		status: 'ok' | 'down'
		activeInstances: number
		lastSeenAt: string | null
	}>
	queues: Array<{
		name: string
		messages: number
		ready: number
		unacknowledged: number
		consumers: number
		state: string | null
	}>
}

export interface MessagingFailure {
	id: string
	eventId: string
	integration: MessagingIntegration
	attempts: number
	lastError: string
	category: MessagingFailureCategory | null
	normalizedCode: string | null
	safeReason: string | null
	failedAt: string
	retryingAt: string | null
	resolvedAt: string | null
	resolution: MessagingFailureResolution
	resolutionComment: string | null
	source: string | null
	entity?: { id?: string; name?: string }
	lead?: {
		id?: string | null
		contact?: string | null
		phone?: string | null
		email?: string | null
		url?: string | null
		createdAt?: string | null
	}
}

export type MessagingFailureSource =
	| 'operations'
	| 'notificationDelivery'
	| 'billing'
	| 'identity'

export type MessagingFailureCoverage =
	| 'complete'
	| 'unavailable'
	| 'not_queried'

export interface MessagingFailuresResponse {
	items: MessagingFailure[]
	total: number
	page: number
	limit: number
	totalPages: number
	sourceErrors: Partial<Record<MessagingFailureSource, string>>
	coverage: Record<MessagingFailureSource, MessagingFailureCoverage>
}

class MessagingService {
	async getOverview() {
		const { data } = await axiosInterceptorsRequest.get<MessagingOverview>(
			'/messaging/admin/overview'
		)
		return data
	}

	async getFailures(params: {
		page: number
		limit: number
		integration?: string
		category?: MessagingFailureCategory
		status?: string
	}) {
		const { data } =
			await axiosInterceptorsRequest.get<MessagingFailuresResponse>(
				'/messaging/admin/failures',
				{ params }
			)
		return data
	}

	async retryFailure(id: string) {
		const { data } = await axiosInterceptorsRequest.post(
			`/messaging/admin/failures/${id}/retry`
		)
		return data
	}

	async closeFailure(id: string, comment: string) {
		const { data } = await axiosInterceptorsRequest.post(
			`/messaging/admin/failures/${id}/close`,
			{ comment }
		)
		return data
	}
}

const messagingService = new MessagingService()

export default messagingService
