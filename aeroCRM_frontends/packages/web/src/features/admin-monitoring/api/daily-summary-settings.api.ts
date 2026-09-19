import { axiosInterceptorsRequest } from '@/shared/api'

export interface ReportingDailySummaryDelivery {
	periodStart: string
}

export interface ReportingDailySummarySuccessfulDelivery extends ReportingDailySummaryDelivery {
	completedAt: string
}

export interface ReportingDailySummaryFailedDelivery extends ReportingDailySummaryDelivery {
	failedAt: string
	code: string | null
	safeReason: string | null
}

export interface ReportingDailySummarySettings {
	id: 'daily-summary'
	enabled: boolean
	destinationChatId: string | null
	messageThreadId: number | null
	operationalAlertsThreadId: number | null
	scheduleTime: string
	timezone: string
	scheduleGeneration: string
	schedulePolicyConfirmationPending: boolean
	lastSuccessfulDelivery: ReportingDailySummarySuccessfulDelivery | null
	lastFailedDelivery: ReportingDailySummaryFailedDelivery | null
	updatedAt: string
}

export interface UpdateReportingDailySummarySettings {
	enabled?: boolean
	destinationChatId?: string | null
	messageThreadId?: number | null
	scheduleTime?: string
	expectedScheduleGeneration?: string
}

const REPORTING_DAILY_SUMMARY_SETTINGS_URL =
	'/admin/reporting/daily-summary/settings'

const reportingDailySummaryService = {
	async get(): Promise<ReportingDailySummarySettings> {
		const { data } =
			await axiosInterceptorsRequest.get<ReportingDailySummarySettings>(
				REPORTING_DAILY_SUMMARY_SETTINGS_URL
			)
		return data
	},

	async update(
		dto: UpdateReportingDailySummarySettings
	): Promise<ReportingDailySummarySettings> {
		const { data } =
			await axiosInterceptorsRequest.patch<ReportingDailySummarySettings>(
				REPORTING_DAILY_SUMMARY_SETTINGS_URL,
				dto
			)
		return data
	}
}

export default reportingDailySummaryService
