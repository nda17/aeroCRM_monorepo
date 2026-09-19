import { axiosInterceptorsRequest } from '@/shared/api'

export interface AdminTelegramBotSettings {
	dailySummaryChatId: string
	databaseBackupThreadId: number | null
	paymentsThreadId: number | null
	operationalAlertsThreadId: number | null
	databaseBackupEnabled: boolean
	databaseBackupTime: string
	databaseBackupTimeLabel: string
	notificationDeliveryDatabaseBackupDelayMinutes: number
	notificationDeliveryDatabaseBackupTime: string
	notificationDeliveryDatabaseBackupTimeLabel: string
	campaignsDatabaseBackupDelayMinutes: number
	campaignsDatabaseBackupTime: string
	campaignsDatabaseBackupTimeLabel: string
	reportingDatabaseBackupDelayMinutes: number
	reportingDatabaseBackupTime: string
	reportingDatabaseBackupTimeLabel: string
	billingDatabaseBackupDelayMinutes: number
	billingDatabaseBackupTime: string
	billingDatabaseBackupTimeLabel: string
	identityDatabaseBackupDelayMinutes: number
	identityDatabaseBackupTime: string
	identityDatabaseBackupTimeLabel: string
	platformDatabaseBackupDelayMinutes: number
	platformDatabaseBackupTime: string
	platformDatabaseBackupTimeLabel: string
	supportDatabaseBackupDelayMinutes: number
	supportDatabaseBackupTime: string
	supportDatabaseBackupTimeLabel: string
	operationsDatabaseBackupDelayMinutes: number
	operationsDatabaseBackupTime: string
	operationsDatabaseBackupTimeLabel: string
	crmAccessDatabaseBackupDelayMinutes: number
	crmAccessDatabaseBackupTime: string
	crmAccessDatabaseBackupTimeLabel: string
	crmIntakeDatabaseBackupDelayMinutes: number
	crmIntakeDatabaseBackupTime: string
	crmIntakeDatabaseBackupTimeLabel: string
	crmCustomersDatabaseBackupDelayMinutes: number
	crmCustomersDatabaseBackupTime: string
	crmCustomersDatabaseBackupTimeLabel: string
	crmSalesDatabaseBackupDelayMinutes: number
	crmSalesDatabaseBackupTime: string
	crmSalesDatabaseBackupTimeLabel: string
	databaseBackupLastSentPeriodStart: string | null
	databaseBackupLastSentAt: string | null
	telegramBotTokenConfigured: boolean
	telegramBotUsernameConfigured: boolean
	updatedAt: string
}

export interface UpdateAdminTelegramBotSettings {
	dailySummaryChatId?: string
	databaseBackupThreadId?: number | null
	paymentsThreadId?: number | null
	operationalAlertsThreadId?: number | null
	databaseBackupEnabled?: boolean
	databaseBackupTime?: string
}

export type TelegramWebhookBot = 'info' | 'auth' | 'support'

export interface AdminSupportRoutingSettings {
	schemaVersion: 1
	adminChatId: string
	supportThreadId: number | null
	aggregateVersion: string
	updatedAt: string
}

export interface UpdateAdminSupportRoutingSettings {
	adminChatId: string
	supportThreadId: number
}

interface SupportTelegramWebhookStatus {
	schemaVersion: 1
	bot: 'support'
	configuredUsername: string
	actualUsername: string
	usernameMatchesConfigured: boolean
	expectedWebhookUrl: string
	webhookUrl: string
	webhookMatchesExpected: boolean
	pendingUpdateCount: number
	lastErrorMessage: string | null
	secretConfigured: boolean
}

export interface AdminTelegramAuthSettings {
	authTelegramBotTokenConfigured: boolean
	authTelegramBotUsernameConfigured: boolean
}

export interface TelegramWebhookInstallResult {
	bot: TelegramWebhookBot
	title: string
	webhookUrl: string
	dropPendingUpdates: boolean
	allowedUpdates: string[]
	secretConfigured: boolean
	installedAt: string
}

export interface TelegramWebhookStatus {
	bot: TelegramWebhookBot
	title: string
	configured: boolean
	ok: boolean
	expectedWebhookUrl: string | null
	webhookUrl: string | null
	webhookMatchesExpected: boolean
	pendingUpdateCount: number | null
	lastErrorAt: string | null
	lastErrorMessage: string | null
	allowedUpdates: string[] | null
	secretConfigured: boolean
	configuredUsername: string | null
	actualUsername: string | null
	usernameMatchesConfigured: boolean | null
	error: string | null
}

export interface TelegramWebhookStatusResponse {
	items: TelegramWebhookStatus[]
}

export type TelegramDatabaseBackupJobStatus =
	| 'QUEUED'
	| 'PROCESSING'
	| 'SUCCEEDED'
	| 'FAILED'
	| 'CANCELLED'
	| 'SKIPPED'

export type TelegramDatabaseBackupJobTrigger = 'SCHEDULED' | 'MANUAL'

export type TelegramDatabaseBackupFreshness =
	| 'DISABLED'
	| 'MISSING'
	| 'FRESH'
	| 'STALE'

export type TelegramDatabaseBackupTarget =
	| 'notification-delivery'
	| 'campaigns'
	| 'reporting'
	| 'billing'
	| 'identity'
	| 'platform'
	| 'support'
	| 'operations'
	| 'crm-access'
	| 'crm-intake'
	| 'crm-customers'
	| 'crm-sales'

export interface TelegramDatabaseBackupAcceptedJob {
	target: TelegramDatabaseBackupTarget
	jobId: string
	status: TelegramDatabaseBackupJobStatus
	queuedAt: string
	created: boolean
}

export interface TelegramDatabaseBackupJob {
	target: TelegramDatabaseBackupTarget
	jobId: string
	status: TelegramDatabaseBackupJobStatus
	queuedAt: string
	startedAt: string | null
	completedAt: string | null
	fileSize: number | null
	hasError: boolean
}

export interface TelegramDatabaseBackupAdminJobSummary {
	target: TelegramDatabaseBackupTarget
	jobId: string
	trigger: TelegramDatabaseBackupJobTrigger
	status: TelegramDatabaseBackupJobStatus
	queuedAt: string
	startedAt: string | null
	completedAt: string | null
	attempts: number
	maxAttempts: number
	fileSize: number | null
	hasError: boolean
}

export interface TelegramDatabaseBackupOverviewItem {
	target: TelegramDatabaseBackupTarget
	freshness: TelegramDatabaseBackupFreshness
	staleAfter: string | null
	latest: TelegramDatabaseBackupAdminJobSummary | null
	latestScheduled: TelegramDatabaseBackupAdminJobSummary | null
	latestManual: TelegramDatabaseBackupAdminJobSummary | null
	latestSuccessful: TelegramDatabaseBackupAdminJobSummary | null
}

export interface TelegramDatabaseBackupOverview {
	databaseBackupEnabled: boolean
	generatedAt: string
	staleAfterHours: number
	items: TelegramDatabaseBackupOverviewItem[]
}

export interface TelegramDatabaseBackupJobsFilters {
	target?: TelegramDatabaseBackupTarget
	trigger?: TelegramDatabaseBackupJobTrigger
	status?: TelegramDatabaseBackupJobStatus
	page: number
	limit: number
}

export interface TelegramDatabaseBackupJobsPage {
	items: TelegramDatabaseBackupAdminJobSummary[]
	page: number
	limit: number
	total: number
	totalPages: number
}

const normalizeSupportWebhookStatus = (
	status: SupportTelegramWebhookStatus
): TelegramWebhookStatus => ({
	bot: 'support',
	title: 'SUPPORT-бот',
	configured: true,
	ok:
		status.webhookMatchesExpected &&
		status.usernameMatchesConfigured &&
		status.secretConfigured,
	expectedWebhookUrl: status.expectedWebhookUrl,
	webhookUrl: status.webhookUrl,
	webhookMatchesExpected: status.webhookMatchesExpected,
	pendingUpdateCount: status.pendingUpdateCount,
	lastErrorAt: null,
	lastErrorMessage: status.lastErrorMessage,
	allowedUpdates: null,
	secretConfigured: status.secretConfigured,
	configuredUsername: status.configuredUsername,
	actualUsername: status.actualUsername,
	usernameMatchesConfigured: status.usernameMatchesConfigured,
	error: null
})

const adminTelegramBotService = {
	async get(): Promise<AdminTelegramBotSettings> {
		const { data } = await axiosInterceptorsRequest.get(
			'/telegram-bot/admin/settings'
		)
		return data
	},

	async update(
		dto: UpdateAdminTelegramBotSettings
	): Promise<AdminTelegramBotSettings> {
		const { data } = await axiosInterceptorsRequest.patch(
			'/telegram-bot/admin/settings',
			dto
		)
		return data
	},

	async sendDatabaseBackup(
		target: TelegramDatabaseBackupTarget,
		idempotencyKey: string
	): Promise<TelegramDatabaseBackupAcceptedJob> {
		const { data } = await axiosInterceptorsRequest.post(
			`/telegram-bot/admin/database-backups/${target}/send`,
			undefined,
			{
				headers: {
					'Idempotency-Key': idempotencyKey
				}
			}
		)
		return data
	},

	async getLatestActiveDatabaseBackupJob(
		target: TelegramDatabaseBackupTarget
	): Promise<TelegramDatabaseBackupJob | null> {
		const { data } =
			await axiosInterceptorsRequest.get<TelegramDatabaseBackupJob | null>(
				`/telegram-bot/admin/database-backups/${target}/jobs/active`
			)
		return data
	},

	async getDatabaseBackupJob(
		target: TelegramDatabaseBackupTarget,
		jobId: string
	): Promise<TelegramDatabaseBackupJob> {
		const { data } =
			await axiosInterceptorsRequest.get<TelegramDatabaseBackupJob>(
				`/telegram-bot/admin/database-backups/${target}/jobs/${jobId}`
			)
		return data
	},

	async getDatabaseBackupOverview(): Promise<TelegramDatabaseBackupOverview> {
		const { data } =
			await axiosInterceptorsRequest.get<TelegramDatabaseBackupOverview>(
				'/telegram-bot/admin/database-backups/overview'
			)
		return data
	},

	async getDatabaseBackupJobs(
		filters: TelegramDatabaseBackupJobsFilters
	): Promise<TelegramDatabaseBackupJobsPage> {
		const { data } =
			await axiosInterceptorsRequest.get<TelegramDatabaseBackupJobsPage>(
				'/telegram-bot/admin/database-backups/jobs',
				{ params: filters }
			)
		return data
	}
}

export const supportTelegramService = {
	async getRoutingSettings(): Promise<AdminSupportRoutingSettings> {
		const { data } =
			await axiosInterceptorsRequest.get<AdminSupportRoutingSettings>(
				'/support/admin/routing-settings'
			)

		return data
	},

	async updateRoutingSettings(
		dto: UpdateAdminSupportRoutingSettings
	): Promise<AdminSupportRoutingSettings> {
		const { data } =
			await axiosInterceptorsRequest.patch<AdminSupportRoutingSettings>(
				'/support/admin/routing-settings',
				dto
			)

		return data
	},

	async getWebhookStatus(): Promise<TelegramWebhookStatus> {
		const { data } =
			await axiosInterceptorsRequest.get<SupportTelegramWebhookStatus>(
				'/support/admin/webhook/status'
			)

		return normalizeSupportWebhookStatus(data)
	},

	async reinstallWebhook(): Promise<TelegramWebhookStatus> {
		const { data } =
			await axiosInterceptorsRequest.post<SupportTelegramWebhookStatus>(
				'/support/admin/webhook/reinstall'
			)

		return normalizeSupportWebhookStatus(data)
	}
}

export const identityTelegramAuthService = {
	async getSettings(): Promise<AdminTelegramAuthSettings> {
		const { data } =
			await axiosInterceptorsRequest.get<AdminTelegramAuthSettings>(
				'/telegram-auth/admin/settings'
			)

		return data
	},

	async getWebhookStatus(): Promise<TelegramWebhookStatus> {
		const { data } =
			await axiosInterceptorsRequest.get<TelegramWebhookStatus>(
				'/telegram-auth/admin/webhook/status'
			)

		return data
	},

	async reinstallWebhook(): Promise<TelegramWebhookInstallResult> {
		const { data } =
			await axiosInterceptorsRequest.post<TelegramWebhookInstallResult>(
				'/telegram-auth/admin/webhook/reinstall'
			)

		return data
	},

	async getInfoWebhookStatus(): Promise<TelegramWebhookStatus> {
		const { data } =
			await axiosInterceptorsRequest.get<TelegramWebhookStatus>(
				'/telegram-auth/admin/info-webhook/status'
			)

		return data
	},

	async reinstallInfoWebhook(): Promise<TelegramWebhookInstallResult> {
		const { data } =
			await axiosInterceptorsRequest.post<TelegramWebhookInstallResult>(
				'/telegram-auth/admin/info-webhook/reinstall'
			)

		return data
	}
}

export default adminTelegramBotService
