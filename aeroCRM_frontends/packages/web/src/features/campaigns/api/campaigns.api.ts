import { axiosInterceptorsRequest } from '@/shared/api'

export type CampaignAudience = 'ACTIVE_SUBSCRIPTION' | 'ALL'
export type CampaignChannel = 'EMAIL' | 'TELEGRAM' | 'BOTH'
export type CampaignStatus =
	| 'SNAPSHOTTING'
	| 'QUEUED'
	| 'RUNNING'
	| 'CANCEL_REQUESTED'
	| 'COMPLETED'
	| 'PARTIAL_FAILED'
	| 'FAILED'
	| 'CANCELLED'
export type CampaignDeliveryChannel = 'EMAIL' | 'TELEGRAM'
export type CampaignDeliveryStatus =
	| 'PENDING'
	| 'PROCESSING'
	| 'SENT'
	| 'FAILED'
	| 'CANCELLED'
export type CampaignSnapshotStatus =
	| 'CREATING'
	| 'READY'
	| 'FAILED'
	| 'CANCELLED'

export interface CampaignInput {
	subject: string
	message: string
	audience: CampaignAudience
	channel: CampaignChannel
}

export interface CampaignSummary {
	id: string
	subject: string
	audience: CampaignAudience
	requestedChannel: CampaignChannel
	status: CampaignStatus
	recipientCount: number
	sentCount: number
	failedCount: number
	cancelledCount: number
	emailCount: number
	telegramCount: number
	createdAt: string
	startedAt: string | null
	completedAt: string | null
	cancelRequestedAt: string | null
}

export interface CampaignSnapshot {
	id: string
	sourceSnapshotId: string | null
	channel: CampaignDeliveryChannel
	status: CampaignSnapshotStatus
	recipientCount: number
	sha256: string | null
	asOf: string | null
	completedAt: string | null
}

export interface CampaignDetail extends CampaignSummary {
	message: string
	snapshots: CampaignSnapshot[]
}

export interface CampaignDeliveryFailure {
	code: string
	reason: string
}

export interface CampaignDelivery {
	id: string
	campaignId: string
	channel: CampaignDeliveryChannel
	status: CampaignDeliveryStatus
	dispatchGeneration: number
	attempts: number
	failure: CampaignDeliveryFailure | null
	createdAt: string
	sentAt: string | null
	cancelledAt: string | null
}

export interface CampaignsResponse {
	items: CampaignSummary[]
	total: number
	page: number
	limit: number
	totalPages: number
}

export interface CampaignDeliveriesResponse {
	items: CampaignDelivery[]
	total: number
	page: number
	limit: number
	totalPages: number
}

const campaignsService = {
	async createCampaign(
		payload: CampaignInput,
		idempotencyKey: string
	): Promise<CampaignDetail> {
		const { data } = await axiosInterceptorsRequest.post<CampaignDetail>(
			'/admin/campaigns',
			payload,
			{
				headers: {
					'Idempotency-Key': idempotencyKey
				}
			}
		)
		return data
	},

	async getCampaigns(page: number, limit: number) {
		const { data } = await axiosInterceptorsRequest.get<CampaignsResponse>(
			'/admin/campaigns',
			{ params: { page, limit } }
		)
		return data
	},

	async getCampaign(id: string) {
		const { data } = await axiosInterceptorsRequest.get<CampaignDetail>(
			`/admin/campaigns/${id}`
		)
		return data
	},

	async cancelCampaign(id: string) {
		const { data } = await axiosInterceptorsRequest.post<CampaignDetail>(
			`/admin/campaigns/${id}/cancel`
		)
		return data
	},

	async getDeliveries(
		campaignId: string,
		page: number,
		limit: number,
		status?: CampaignDeliveryStatus
	) {
		const { data } =
			await axiosInterceptorsRequest.get<CampaignDeliveriesResponse>(
				`/admin/campaigns/${campaignId}/deliveries`,
				{ params: { page, limit, status } }
			)
		return data
	},

	async retryDelivery(
		campaignId: string,
		deliveryId: string,
		idempotencyKey: string
	) {
		const { data } = await axiosInterceptorsRequest.post<CampaignDelivery>(
			`/admin/campaigns/${campaignId}/deliveries/${deliveryId}/retry`,
			undefined,
			{
				headers: {
					'Idempotency-Key': idempotencyKey
				}
			}
		)
		return data
	}
}

export default campaignsService
