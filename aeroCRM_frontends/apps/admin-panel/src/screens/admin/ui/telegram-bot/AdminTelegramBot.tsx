'use client'

import { UserRole, useAuthStore, useUser } from '@/entities/user'
import { errorCatch } from '@/shared/api'
import {
	reportingDailySummaryService,
	type UpdateReportingDailySummarySettings
} from '@/features/admin-monitoring'
import AdminNavigation from '@/screens/admin/ui/common/admin-navigation/AdminNavigation'
import AdminSectionHeading from '@/screens/admin/ui/common/admin-section-heading/AdminSectionHeading'
import AdminTooltip from '@/screens/admin/ui/common/admin-tooltip/AdminTooltip'
import Heading from '@/shared/ui/heading/Heading'
import SkeletonLoader from '@/shared/ui/skeleton-loader/SkeletonLoader'
import {
	adminTelegramBotService,
	identityTelegramAuthService,
	supportTelegramService,
	type AdminTelegramBotSettings,
	type TelegramWebhookBot
} from '@/features/manage-telegram-bot'
import {
	useMutation,
	useQuery,
	useQueryClient
} from '@tanstack/react-query'
import { NextPage } from 'next'
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import styles from './AdminTelegramBot.module.scss'

const SETTINGS_QUERY_KEY = ['admin-telegram-bot-settings']
const DAILY_SUMMARY_SETTINGS_QUERY_KEY = [
	'admin-reporting-daily-summary-settings'
]
const SUPPORT_ROUTING_SETTINGS_QUERY_KEY = [
	'admin-support-routing-settings'
]
const SUPPORT_WEBHOOK_QUERY_KEY = ['admin-support-webhook']
const IDENTITY_AUTH_SETTINGS_QUERY_KEY = ['admin-telegram-auth-settings']
const IDENTITY_WEBHOOK_QUERY_KEY = ['admin-telegram-auth-webhook']
const IDENTITY_INFO_WEBHOOK_QUERY_KEY = ['admin-telegram-info-webhook']
const WEBHOOK_BOTS: TelegramWebhookBot[] = ['info', 'auth', 'support']
const MIN_TASK_TIME_GAP_MINUTES = 5
const MAX_TELEGRAM_TOPIC_ID = 2147483647
const OPERATIONS_TELEGRAM_TOPIC_FIELDS = [
	{
		key: 'databaseBackupThreadId',
		label: 'Backups',
		description: 'Ручные и автоматические backup базы данных'
	},
	{
		key: 'paymentsThreadId',
		label: 'Payments',
		description: 'Уведомления о новых успешных платежах'
	},
	{
		key: 'operationalAlertsThreadId',
		label: 'Системные уведомления',
		description:
			'Ошибки RabbitMQ, workers, Outbox и фоновых задач Operations'
	}
] as const

type OperationsTelegramTopicField =
	(typeof OPERATIONS_TELEGRAM_TOPIC_FIELDS)[number]['key']
type TelegramTopicInputs = Record<OperationsTelegramTopicField, string>

const EMPTY_TELEGRAM_TOPIC_INPUTS: TelegramTopicInputs = {
	databaseBackupThreadId: '',
	paymentsThreadId: '',
	operationalAlertsThreadId: ''
}

const getTelegramTopicInputs = (
	settings: AdminTelegramBotSettings
): TelegramTopicInputs => ({
	databaseBackupThreadId:
		settings.databaseBackupThreadId?.toString() ?? '',
	paymentsThreadId: settings.paymentsThreadId?.toString() ?? '',
	operationalAlertsThreadId:
		settings.operationalAlertsThreadId?.toString() ?? ''
})

const parseTelegramTopicId = (value: string) => {
	const normalizedValue = value.trim()

	if (!normalizedValue) return null

	const topicId = Number(normalizedValue)
	return Number.isSafeInteger(topicId) &&
		topicId > 0 &&
		topicId <= MAX_TELEGRAM_TOPIC_ID
		? topicId
		: undefined
}

const formatDate = (value: string) =>
	new Intl.DateTimeFormat('ru-RU', {
		dateStyle: 'short',
		timeStyle: 'medium'
	}).format(new Date(value))

const getTimeMinutes = (value: string) => {
	const [hour, minute] = value.split(':').map(Number)

	if (
		!Number.isInteger(hour) ||
		!Number.isInteger(minute) ||
		hour < 0 ||
		hour > 23 ||
		minute < 0 ||
		minute > 59
	) {
		return null
	}

	return hour * 60 + minute
}

const getTaskTimeGapMinutes = (first: string, second: string) => {
	const firstMinutes = getTimeMinutes(first)
	const secondMinutes = getTimeMinutes(second)

	if (firstMinutes === null || secondMinutes === null) return null

	const directGap = Math.abs(firstMinutes - secondMinutes)
	return Math.min(directGap, 24 * 60 - directGap)
}

const addMinutesToTime = (value: string, minutesToAdd: number) => {
	const minutes = getTimeMinutes(value)
	if (minutes === null) return null

	const nextMinutes = (minutes + minutesToAdd) % (24 * 60)
	return `${String(Math.floor(nextMinutes / 60)).padStart(2, '0')}:${String(
		nextMinutes % 60
	).padStart(2, '0')}`
}

const hasMinimumTaskTimeGap = (
	summaryTime: string,
	backupTime: string,
	backupDelayMinutes: number[]
) =>
	backupDelayMinutes.every(delayMinutes => {
		const delayedBackupTime = addMinutesToTime(backupTime, delayMinutes)
		if (delayedBackupTime === null) return false

		const taskTimeGap = getTaskTimeGapMinutes(
			summaryTime,
			delayedBackupTime
		)
		return taskTimeGap !== null && taskTimeGap >= MIN_TASK_TIME_GAP_MINUTES
	})

const AdminTelegramBot: NextPage = () => {
	const auth = useAuthStore(state => state.auth)
	const { user, isLoading: isUserLoading } = useUser()
	const isDev = Boolean(user?.rights?.includes(UserRole.DEV))
	const queryClient = useQueryClient()
	const [chatId, setChatId] = useState('')
	const [topicIds, setTopicIds] = useState<TelegramTopicInputs>(
		EMPTY_TELEGRAM_TOPIC_INPUTS
	)
	const [supportChatId, setSupportChatId] = useState('')
	const [supportThreadId, setSupportThreadId] = useState('')
	const [dailySummaryThreadId, setDailySummaryThreadId] = useState('')
	const [dailySummaryDestinationChatId, setDailySummaryDestinationChatId] =
		useState('')
	const [summaryTime, setSummaryTime] = useState('')
	const [backupTime, setBackupTime] = useState('')
	const isTelegramRoutingDraftDirty = useRef(false)
	const isSupportRoutingDraftDirty = useRef(false)
	const isDailySummaryDraftDirty = useRef(false)
	const isBackupScheduleDraftDirty = useRef(false)

	const { data: settings, isLoading: isTelegramSettingsLoading } =
		useQuery({
			queryKey: SETTINGS_QUERY_KEY,
			queryFn: adminTelegramBotService.get
		})
	const {
		data: supportRoutingSettings,
		isLoading: isSupportRoutingSettingsLoading,
		error: supportRoutingSettingsError,
		refetch: refetchSupportRoutingSettings
	} = useQuery({
		queryKey: SUPPORT_ROUTING_SETTINGS_QUERY_KEY,
		queryFn: supportTelegramService.getRoutingSettings,
		enabled: auth
	})
	const {
		data: identityAuthSettings,
		isLoading: isIdentityAuthSettingsLoading,
		isFetching: isIdentityAuthSettingsFetching,
		isError: isIdentityAuthSettingsError,
		refetch: refetchIdentityAuthSettings
	} = useQuery({
		queryKey: IDENTITY_AUTH_SETTINGS_QUERY_KEY,
		queryFn: identityTelegramAuthService.getSettings
	})
	const {
		data: dailySummarySettings,
		isLoading: isDailySummarySettingsLoading,
		isError: isDailySummarySettingsError,
		error: dailySummarySettingsError,
		refetch: refetchDailySummarySettings
	} = useQuery({
		queryKey: DAILY_SUMMARY_SETTINGS_QUERY_KEY,
		queryFn: reportingDailySummaryService.get
	})

	const {
		data: supportWebhookStatus,
		isFetching: isSupportWebhookStatusFetching,
		isError: isSupportWebhookStatusError,
		refetch: refetchSupportWebhookStatus
	} = useQuery({
		queryKey: SUPPORT_WEBHOOK_QUERY_KEY,
		queryFn: supportTelegramService.getWebhookStatus,
		enabled: auth
	})
	const {
		data: identityWebhookStatus,
		isFetching: isIdentityWebhookStatusFetching,
		isError: isIdentityWebhookStatusError,
		refetch: refetchIdentityWebhookStatus
	} = useQuery({
		queryKey: IDENTITY_WEBHOOK_QUERY_KEY,
		queryFn: identityTelegramAuthService.getWebhookStatus
	})
	const {
		data: identityInfoWebhookStatus,
		isFetching: isIdentityInfoWebhookStatusFetching,
		isError: isIdentityInfoWebhookStatusError,
		refetch: refetchIdentityInfoWebhookStatus
	} = useQuery({
		queryKey: IDENTITY_INFO_WEBHOOK_QUERY_KEY,
		queryFn: identityTelegramAuthService.getInfoWebhookStatus
	})
	const isOperationsChatFrozen = Boolean(
		settings?.dailySummaryChatId.trim()
	)
	const isOperationalAlertsThreadFrozen = Boolean(
		settings && settings.operationalAlertsThreadId !== null
	)
	const isDailySummaryDestinationFrozen = Boolean(
		dailySummarySettings && dailySummarySettings.destinationChatId !== null
	)

	useEffect(() => {
		if (!settings) return

		if (!isTelegramRoutingDraftDirty.current) {
			setChatId(settings.dailySummaryChatId)
			setTopicIds(getTelegramTopicInputs(settings))
		}

		if (!isBackupScheduleDraftDirty.current) {
			setBackupTime(settings.databaseBackupTime)
		}
	}, [settings])

	useEffect(() => {
		if (!supportRoutingSettings || isSupportRoutingDraftDirty.current) {
			return
		}

		setSupportChatId(supportRoutingSettings.adminChatId)
		setSupportThreadId(
			supportRoutingSettings.supportThreadId?.toString() ?? ''
		)
	}, [supportRoutingSettings])

	useEffect(() => {
		if (!dailySummarySettings || isDailySummaryDraftDirty.current) return

		setDailySummaryThreadId(
			dailySummarySettings.messageThreadId?.toString() ?? ''
		)
		setDailySummaryDestinationChatId(
			dailySummarySettings.destinationChatId ?? ''
		)
		setSummaryTime(dailySummarySettings.scheduleTime)
	}, [dailySummarySettings])

	const mutation = useMutation({
		mutationFn: adminTelegramBotService.update,
		onSuccess: async (result, patch) => {
			if (
				'dailySummaryChatId' in patch ||
				OPERATIONS_TELEGRAM_TOPIC_FIELDS.some(field => field.key in patch)
			) {
				isTelegramRoutingDraftDirty.current = false
				setChatId(result.dailySummaryChatId)
				setTopicIds(getTelegramTopicInputs(result))
			}

			if ('databaseBackupTime' in patch) {
				isBackupScheduleDraftDirty.current = false
				setBackupTime(result.databaseBackupTime)
			}

			await queryClient.invalidateQueries({
				queryKey: SETTINGS_QUERY_KEY
			})
		}
	})

	const supportRoutingMutation = useMutation({
		mutationFn: supportTelegramService.updateRoutingSettings,
		onSuccess: async result => {
			isSupportRoutingDraftDirty.current = false
			setSupportChatId(result.adminChatId)
			setSupportThreadId(result.supportThreadId?.toString() ?? '')
			await queryClient.invalidateQueries({
				queryKey: SUPPORT_ROUTING_SETTINGS_QUERY_KEY
			})
		},
		onError: async () => {
			await queryClient.invalidateQueries({
				queryKey: SUPPORT_ROUTING_SETTINGS_QUERY_KEY
			})
		}
	})

	const dailySummaryMutation = useMutation({
		mutationFn: reportingDailySummaryService.update,
		onSuccess: async result => {
			isDailySummaryDraftDirty.current = false
			setDailySummaryDestinationChatId(result.destinationChatId ?? '')
			setDailySummaryThreadId(result.messageThreadId?.toString() ?? '')
			setSummaryTime(result.scheduleTime)

			await queryClient.invalidateQueries({
				queryKey: DAILY_SUMMARY_SETTINGS_QUERY_KEY
			})
		},
		onError: async () => {
			await queryClient.invalidateQueries({
				queryKey: DAILY_SUMMARY_SETTINGS_QUERY_KEY
			})
		}
	})

	const webhookMutation = useMutation({
		mutationFn: async (bot: TelegramWebhookBot) => {
			if (bot === 'auth') {
				const result = await identityTelegramAuthService.reinstallWebhook()
				return { title: result.title }
			}
			if (bot === 'info') {
				const result =
					await identityTelegramAuthService.reinstallInfoWebhook()
				return { title: result.title }
			}
			const result = await supportTelegramService.reinstallWebhook()
			return { title: result.title }
		}
	})

	const saveWithToast = (
		patch: Parameters<typeof adminTelegramBotService.update>[0]
	) => {
		const promise = mutation.mutateAsync(patch)

		toast.promise(promise, {
			loading: 'Пожалуйста, подождите',
			success: 'Настройки сохранены',
			error: error => `Ошибка сохранения: ${errorCatch(error)}`
		})
	}

	const saveDailySummaryWithToast = (
		patch: UpdateReportingDailySummarySettings
	) => {
		const promise = dailySummaryMutation.mutateAsync(patch)

		toast.promise(promise, {
			loading: 'Пожалуйста, подождите',
			success: 'Настройки Daily Summary сохранены',
			error: error => `Ошибка сохранения: ${errorCatch(error)}`
		})
	}

	const saveSupportRoutingWithToast = (
		patch: Parameters<
			typeof supportTelegramService.updateRoutingSettings
		>[0]
	) => {
		const promise = supportRoutingMutation.mutateAsync(patch)

		toast.promise(promise, {
			loading: 'Пожалуйста, подождите',
			success: 'Настройки Support_bot сохранены',
			error: error => `Ошибка сохранения Support: ${errorCatch(error)}`
		})
	}

	const handleReinstallWebhook = (bot: TelegramWebhookBot) => {
		const promise = webhookMutation.mutateAsync(bot).finally(async () => {
			await queryClient.invalidateQueries({
				queryKey:
					bot === 'auth'
						? IDENTITY_WEBHOOK_QUERY_KEY
						: bot === 'info'
							? IDENTITY_INFO_WEBHOOK_QUERY_KEY
							: SUPPORT_WEBHOOK_QUERY_KEY
			})
		})

		toast.promise(promise, {
			loading: 'Пожалуйста, подождите',
			success: result => `Webhook ${result.title} переустановлен`,
			error: error => `Ошибка webhook: ${errorCatch(error)}`
		})
	}

	const handleRefreshWebhookStatuses = () => {
		const promise = Promise.all([
			refetchSupportWebhookStatus({ throwOnError: true }),
			refetchIdentityWebhookStatus({ throwOnError: true }),
			refetchIdentityInfoWebhookStatus({ throwOnError: true }),
			refetchIdentityAuthSettings({ throwOnError: true })
		])

		toast.promise(promise, {
			loading: 'Пожалуйста, подождите',
			success: 'Статусы webhook обновлены',
			error: error => `Ошибка обновления: ${errorCatch(error)}`
		})
	}

	const handleToggleSummary = () => {
		if (!dailySummarySettings) return

		if (!dailySummarySettings.enabled) {
			if (!dailySummarySettings.destinationChatId?.trim()) {
				toast.error('Сначала сохраните ID группы для Daily Summary')
				return
			}

			if (!dailySummarySettings.messageThreadId) {
				toast.error('Сначала сохраните ID топика Reports')
				return
			}

			if (!dailySummarySettings.operationalAlertsThreadId) {
				toast.error('Сначала сохраните ID топика системных уведомлений')
				return
			}

			if (
				dailySummarySettings.messageThreadId ===
				dailySummarySettings.operationalAlertsThreadId
			) {
				toast.error(
					'Daily Summary и системные уведомления должны использовать разные топики'
				)
				return
			}
		}

		saveDailySummaryWithToast({ enabled: !dailySummarySettings.enabled })
	}

	const handleToggleDatabaseBackup = () => {
		if (!settings) return

		if (!settings.databaseBackupEnabled) {
			if (!settings.dailySummaryChatId.trim()) {
				toast.error('Сначала сохраните ID группы Telegram')
				return
			}

			if (!settings.databaseBackupThreadId) {
				toast.error('Сначала сохраните ID топика Backups')
				return
			}
		}

		saveWithToast({
			databaseBackupEnabled: !settings.databaseBackupEnabled
		})
	}

	const handleSaveTelegramRouting = () => {
		if (!settings) return

		const normalizedChatId = chatId.trim()
		const effectiveChatId = isOperationsChatFrozen
			? settings.dailySummaryChatId
			: normalizedChatId
		const normalizedTopicIds = {} as Record<
			OperationsTelegramTopicField,
			number | null
		>

		for (const field of OPERATIONS_TELEGRAM_TOPIC_FIELDS) {
			if (
				field.key === 'operationalAlertsThreadId' &&
				isOperationalAlertsThreadFrozen
			) {
				normalizedTopicIds[field.key] = settings.operationalAlertsThreadId
				continue
			}

			const topicId = parseTelegramTopicId(topicIds[field.key])

			if (topicId === undefined) {
				toast.error(
					`ID топика ${field.label} должен быть целым числом от 1 до ${MAX_TELEGRAM_TOPIC_ID}`
				)
				return
			}

			normalizedTopicIds[field.key] = topicId
		}

		if (settings.databaseBackupEnabled && !effectiveChatId) {
			toast.error('Укажите ID группы Telegram')
			return
		}

		if (
			!effectiveChatId &&
			Object.values(normalizedTopicIds).some(topicId => topicId !== null)
		) {
			toast.error('Укажите ID Telegram-группы для настроенных топиков')
			return
		}

		if (
			settings.databaseBackupEnabled &&
			normalizedTopicIds.databaseBackupThreadId === null
		) {
			toast.error('Для включённого backup укажите ID топика Backups')
			return
		}

		if (
			effectiveChatId === dailySummarySettings?.destinationChatId &&
			normalizedTopicIds.operationalAlertsThreadId !== null &&
			normalizedTopicIds.operationalAlertsThreadId ===
				dailySummarySettings?.messageThreadId
		) {
			toast.error(
				'Daily Summary и системные уведомления должны использовать разные топики'
			)
			return
		}

		const patch: Parameters<typeof adminTelegramBotService.update>[0] = {
			databaseBackupThreadId: normalizedTopicIds.databaseBackupThreadId,
			paymentsThreadId: normalizedTopicIds.paymentsThreadId
		}
		if (!isOperationsChatFrozen) {
			patch.dailySummaryChatId = normalizedChatId
		}
		if (!isOperationalAlertsThreadFrozen) {
			patch.operationalAlertsThreadId =
				normalizedTopicIds.operationalAlertsThreadId
		}

		saveWithToast(patch)
	}

	const handleSaveSupportRouting = () => {
		if (!supportRoutingSettings || !isDev) return

		const adminChatId = supportChatId.trim()
		const parsedSupportThreadId = parseTelegramTopicId(supportThreadId)

		if (
			!/^(?:-?[1-9]\d*|@[A-Za-z][A-Za-z0-9_]{4,31})$/.test(adminChatId)
		) {
			toast.error(
				'ID группы Support должен быть целым числом без ведущих нулей или username вида @group_name'
			)
			return
		}

		if (
			parsedSupportThreadId === undefined ||
			parsedSupportThreadId === null
		) {
			toast.error(
				`ID топика Support_chat должен быть целым числом от 1 до ${MAX_TELEGRAM_TOPIC_ID}`
			)
			return
		}

		saveSupportRoutingWithToast({
			adminChatId,
			supportThreadId: parsedSupportThreadId
		})
	}

	const handleSaveDailySummary = () => {
		if (!settings || !dailySummarySettings) return

		if (!summaryTime) {
			toast.error('Укажите время сводки')
			return
		}

		if (
			!hasMinimumTaskTimeGap(summaryTime, settings.databaseBackupTime, [
				settings.notificationDeliveryDatabaseBackupDelayMinutes,
				settings.campaignsDatabaseBackupDelayMinutes,
				settings.reportingDatabaseBackupDelayMinutes,
				settings.billingDatabaseBackupDelayMinutes,
				settings.identityDatabaseBackupDelayMinutes,
				settings.platformDatabaseBackupDelayMinutes,
				settings.supportDatabaseBackupDelayMinutes,
				settings.operationsDatabaseBackupDelayMinutes,
				settings.crmAccessDatabaseBackupDelayMinutes,
				settings.crmIntakeDatabaseBackupDelayMinutes,
				settings.crmCustomersDatabaseBackupDelayMinutes,
				settings.crmSalesDatabaseBackupDelayMinutes
			])
		) {
			toast.error(
				`Разнесите сводку и все backup минимум на ${MIN_TASK_TIME_GAP_MINUTES} минут`
			)
			return
		}

		const messageThreadId = parseTelegramTopicId(dailySummaryThreadId)
		const destinationChatId = isDailySummaryDestinationFrozen
			? (dailySummarySettings.destinationChatId ?? '')
			: dailySummaryDestinationChatId.trim()

		if (messageThreadId === undefined) {
			toast.error(
				`ID топика Reports должен быть целым числом от 1 до ${MAX_TELEGRAM_TOPIC_ID}`
			)
			return
		}

		if (
			dailySummarySettings.enabled &&
			(!destinationChatId || messageThreadId === null)
		) {
			toast.error(
				'Для включённой сводки укажите ID группы и топика Reports'
			)
			return
		}

		if (
			destinationChatId === settings?.dailySummaryChatId &&
			messageThreadId !== null &&
			messageThreadId === dailySummarySettings.operationalAlertsThreadId
		) {
			toast.error(
				'Daily Summary и системные уведомления должны использовать разные топики'
			)
			return
		}

		const patch: UpdateReportingDailySummarySettings = {}
		if (
			!isDailySummaryDestinationFrozen &&
			destinationChatId !== (dailySummarySettings.destinationChatId ?? '')
		) {
			patch.destinationChatId = destinationChatId || null
		}
		if (messageThreadId !== dailySummarySettings.messageThreadId) {
			patch.messageThreadId = messageThreadId
		}
		if (
			summaryTime !== dailySummarySettings.scheduleTime ||
			dailySummarySettings.schedulePolicyConfirmationPending
		) {
			patch.scheduleTime = summaryTime
			patch.expectedScheduleGeneration =
				dailySummarySettings.scheduleGeneration
		}

		if (Object.keys(patch).length === 0) return
		saveDailySummaryWithToast(patch)
	}

	const handleSaveBackupSchedule = () => {
		if (!settings) return

		if (!backupTime) {
			toast.error('Укажите время backup')
			return
		}

		if (
			dailySummarySettings &&
			!hasMinimumTaskTimeGap(
				dailySummarySettings.scheduleTime,
				backupTime,
				[
					settings.notificationDeliveryDatabaseBackupDelayMinutes,
					settings.campaignsDatabaseBackupDelayMinutes,
					settings.reportingDatabaseBackupDelayMinutes,
					settings.billingDatabaseBackupDelayMinutes,
					settings.identityDatabaseBackupDelayMinutes,
					settings.platformDatabaseBackupDelayMinutes,
					settings.supportDatabaseBackupDelayMinutes,
					settings.operationsDatabaseBackupDelayMinutes,
					settings.crmAccessDatabaseBackupDelayMinutes,
					settings.crmIntakeDatabaseBackupDelayMinutes,
					settings.crmCustomersDatabaseBackupDelayMinutes,
					settings.crmSalesDatabaseBackupDelayMinutes
				]
			)
		) {
			toast.error(
				`Разнесите сводку и все backup минимум на ${MIN_TASK_TIME_GAP_MINUTES} минут`
			)
			return
		}
		if (!dailySummarySettings) {
			toast('Reporting недоступен: интервал с Daily Summary не проверен', {
				icon: '⚠️'
			})
		}

		saveWithToast({ databaseBackupTime: backupTime })
	}

	const lastSentText = dailySummarySettings?.lastSuccessfulDelivery
		? formatDate(dailySummarySettings.lastSuccessfulDelivery.completedAt)
		: 'Ещё не отправлялась'
	const latestDailySummaryFailure =
		dailySummarySettings?.lastFailedDelivery &&
		(!dailySummarySettings.lastSuccessfulDelivery ||
			new Date(
				dailySummarySettings.lastFailedDelivery.failedAt
			).getTime() >
				new Date(
					dailySummarySettings.lastSuccessfulDelivery.completedAt
				).getTime())
			? dailySummarySettings.lastFailedDelivery
			: null
	const isWebhookActionPending = webhookMutation.isPending
	const notificationDeliveryBackupTime = settings
		? (addMinutesToTime(
				backupTime,
				settings.notificationDeliveryDatabaseBackupDelayMinutes
			) ?? settings.notificationDeliveryDatabaseBackupTime)
		: null
	const campaignsBackupTime = settings
		? (addMinutesToTime(
				backupTime,
				settings.campaignsDatabaseBackupDelayMinutes
			) ?? settings.campaignsDatabaseBackupTime)
		: null
	const reportingBackupTime = settings
		? (addMinutesToTime(
				backupTime,
				settings.reportingDatabaseBackupDelayMinutes
			) ?? settings.reportingDatabaseBackupTime)
		: null
	const billingBackupTime = settings
		? (addMinutesToTime(
				backupTime,
				settings.billingDatabaseBackupDelayMinutes
			) ?? settings.billingDatabaseBackupTime)
		: null
	const identityBackupTime = settings
		? (addMinutesToTime(
				backupTime,
				settings.identityDatabaseBackupDelayMinutes
			) ?? settings.identityDatabaseBackupTime)
		: null
	const platformBackupTime = settings
		? (addMinutesToTime(
				backupTime,
				settings.platformDatabaseBackupDelayMinutes
			) ?? settings.platformDatabaseBackupTime)
		: null
	const supportBackupTime = settings
		? (addMinutesToTime(
				backupTime,
				settings.supportDatabaseBackupDelayMinutes
			) ?? settings.supportDatabaseBackupTime)
		: null
	const operationsBackupTime = settings
		? (addMinutesToTime(
				backupTime,
				settings.operationsDatabaseBackupDelayMinutes
			) ?? settings.operationsDatabaseBackupTime)
		: null
	const crmAccessBackupTime = settings
		? (addMinutesToTime(
				backupTime,
				settings.crmAccessDatabaseBackupDelayMinutes
			) ?? settings.crmAccessDatabaseBackupTime)
		: null
	const crmIntakeBackupTime = settings
		? (addMinutesToTime(
				backupTime,
				settings.crmIntakeDatabaseBackupDelayMinutes
			) ?? settings.crmIntakeDatabaseBackupTime)
		: null
	const crmCustomersBackupTime = settings
		? (addMinutesToTime(
				backupTime,
				settings.crmCustomersDatabaseBackupDelayMinutes
			) ?? settings.crmCustomersDatabaseBackupTime)
		: null
	const crmSalesBackupTime = settings
		? (addMinutesToTime(
				backupTime,
				settings.crmSalesDatabaseBackupDelayMinutes
			) ?? settings.crmSalesDatabaseBackupTime)
		: null
	const isLoading = isTelegramSettingsLoading
	const isDailySummarySettingsChanged = Boolean(
		dailySummarySettings &&
		((!isDailySummaryDestinationFrozen &&
			dailySummaryDestinationChatId.trim() !==
				(dailySummarySettings.destinationChatId ?? '')) ||
			dailySummaryThreadId.trim() !==
				(dailySummarySettings.messageThreadId?.toString() ?? '') ||
			summaryTime !== dailySummarySettings.scheduleTime ||
			dailySummarySettings.schedulePolicyConfirmationPending)
	)
	const isTelegramRoutingChanged = Boolean(
		settings &&
		((!isOperationsChatFrozen &&
			chatId.trim() !== settings.dailySummaryChatId) ||
			OPERATIONS_TELEGRAM_TOPIC_FIELDS.some(
				field =>
					(field.key !== 'operationalAlertsThreadId' ||
						!isOperationalAlertsThreadFrozen) &&
					topicIds[field.key].trim() !==
						(settings[field.key]?.toString() ?? '')
			))
	)
	const isSupportRoutingChanged = Boolean(
		supportRoutingSettings &&
		(supportChatId.trim() !== supportRoutingSettings.adminChatId ||
			supportThreadId.trim() !==
				(supportRoutingSettings.supportThreadId?.toString() ?? ''))
	)
	const webhookStatusItems = [
		...(supportWebhookStatus ? [supportWebhookStatus] : []),
		...(identityWebhookStatus ? [identityWebhookStatus] : []),
		...(identityInfoWebhookStatus ? [identityInfoWebhookStatus] : [])
	]
	const statusByBot = new Map(
		webhookStatusItems.map(status => [status.bot, status])
	)
	const isBotTokenConfigured = (bot: TelegramWebhookBot) => {
		if (bot === 'auth') {
			return Boolean(identityAuthSettings?.authTelegramBotTokenConfigured)
		}
		if (bot === 'info') {
			return Boolean(identityInfoWebhookStatus?.configured)
		}
		return Boolean(supportWebhookStatus?.configured)
	}

	return (
		<section className={styles.wrapper}>
			<Heading text="Панель администратора" />
			<AdminNavigation />

			<AdminSectionHeading
				text="Telegram-боты"
				title="Webhook и сообщения в Telegram"
				description="Показывает webhook Identity-ботов и Support_bot, маршрутизацию служебных сообщений и расписание резервных копий сервисов."
				risk="medium"
				riskText="Группа должна быть супергруппой с включёнными Topics. Если ID группы или нужного топика указан неверно, соответствующие сообщения не отправятся. INFO-бот и SUPPORT-бот должны быть добавлены в группу, а токены должны быть настроены на сервере."
			/>

			<div className={styles.card}>
				{isLoading ? (
					<>
						<div className={styles.statusGrid}>
							<SkeletonLoader count={1} className="h-[76px]" />
							<SkeletonLoader count={1} className="h-[76px]" />
							<SkeletonLoader count={1} className="h-[76px]" />
						</div>
						<SkeletonLoader count={1} className="h-[58px]" />
						<SkeletonLoader count={1} className="h-[82px]" />
					</>
				) : settings ? (
					<>
						<div className={styles.statusGrid}>
							<div className={styles.statusItem}>
								<p className={styles.statusLabel}>Токен INFO-бот</p>
								<span
									className={`${styles.badge} ${
										settings.telegramBotTokenConfigured
											? styles.badgeOk
											: styles.badgeWarning
									}`}
								>
									{settings.telegramBotTokenConfigured
										? 'Настроен'
										: 'Не настроен'}
								</span>
							</div>
							<div className={styles.statusItem}>
								<p className={styles.statusLabel}>Username INFO-бот</p>
								<span
									className={`${styles.badge} ${
										settings.telegramBotUsernameConfigured
											? styles.badgeOk
											: styles.badgeWarning
									}`}
								>
									{settings.telegramBotUsernameConfigured
										? 'Настроен'
										: 'Не настроен'}
								</span>
							</div>
							<div className={styles.statusItem}>
								<p className={styles.statusLabel}>Токен Auth_bot</p>
								<span
									className={`${styles.badge} ${
										identityAuthSettings?.authTelegramBotTokenConfigured
											? styles.badgeOk
											: styles.badgeWarning
									}`}
								>
									{isIdentityAuthSettingsLoading
										? 'Загрузка...'
										: isIdentityAuthSettingsError
											? 'Недоступен'
											: identityAuthSettings?.authTelegramBotTokenConfigured
												? 'Настроен'
												: 'Не настроен'}
								</span>
							</div>
							<div className={styles.statusItem}>
								<p className={styles.statusLabel}>Токен SUPPORT-бот</p>
								<span
									className={`${styles.badge} ${
										supportWebhookStatus?.configured
											? styles.badgeOk
											: styles.badgeWarning
									}`}
								>
									{isSupportWebhookStatusFetching
										? 'Загрузка...'
										: isSupportWebhookStatusError
											? 'Support недоступен'
											: supportWebhookStatus?.configured
												? 'Настроен'
												: 'Не настроен'}
								</span>
							</div>
							<div className={styles.statusItem}>
								<p className={styles.statusLabel}>Username Auth_bot</p>
								<span
									className={`${styles.badge} ${
										identityAuthSettings?.authTelegramBotUsernameConfigured
											? styles.badgeOk
											: styles.badgeWarning
									}`}
								>
									{isIdentityAuthSettingsLoading
										? 'Загрузка...'
										: isIdentityAuthSettingsError
											? 'Недоступен'
											: identityAuthSettings?.authTelegramBotUsernameConfigured
												? 'Настроен'
												: 'Не настроен'}
								</span>
							</div>
							<div className={styles.statusItem}>
								<p className={styles.statusLabel}>Webhook Support_bot</p>
								<span
									className={`${styles.badge} ${
										supportWebhookStatus?.webhookMatchesExpected
											? styles.badgeOk
											: styles.badgeWarning
									}`}
								>
									{isSupportWebhookStatusFetching
										? 'Проверяем'
										: supportWebhookStatus?.webhookMatchesExpected
											? 'Актуальный'
											: 'Требует проверки'}
								</span>
							</div>
							<div className={styles.statusItem}>
								<p className={styles.statusLabel}>Последняя сводка</p>
								<p className={styles.statusValue}>
									{isDailySummarySettingsLoading
										? 'Загрузка...'
										: isDailySummarySettingsError
											? 'Reporting недоступен'
											: lastSentText}
								</p>
							</div>
							{latestDailySummaryFailure && (
								<div className={styles.statusItem}>
									<p className={styles.statusLabel}>
										Последняя ошибка Daily Summary
									</p>
									<p className={styles.webhookStatusError}>
										{formatDate(latestDailySummaryFailure.failedAt)}
										{latestDailySummaryFailure.code
											? ` · ${latestDailySummaryFailure.code}`
											: ''}
										{latestDailySummaryFailure.safeReason
											? ` · ${latestDailySummaryFailure.safeReason}`
											: ''}
									</p>
								</div>
							)}
						</div>

						<div className={styles.webhookRow}>
							<div>
								<p className={styles.label}>Webhook ботов</p>
								<p className={styles.hint}>
									Переустанавливает webhook с секретом. Ожидающие
									обновления INFO и SUPPORT сохраняются
								</p>
							</div>
							<div className={styles.webhookActions}>
								<button
									type="button"
									className={styles.actionBtn}
									onClick={() => handleReinstallWebhook('info')}
									disabled={
										isWebhookActionPending ||
										!identityInfoWebhookStatus?.configured ||
										!identityInfoWebhookStatus.secretConfigured ||
										!identityInfoWebhookStatus.expectedWebhookUrl
									}
								>
									INFO-бот
								</button>
								<button
									type="button"
									className={styles.actionBtn}
									onClick={() => handleReinstallWebhook('auth')}
									disabled={
										isWebhookActionPending ||
										!identityAuthSettings?.authTelegramBotTokenConfigured
									}
								>
									Auth_bot
								</button>
								<span className={styles.devOnlyAction}>
									<button
										type="button"
										className={styles.actionBtn}
										onClick={() => handleReinstallWebhook('support')}
										disabled={
											isUserLoading ||
											!isDev ||
											isWebhookActionPending ||
											!supportWebhookStatus?.configured ||
											!supportWebhookStatus.secretConfigured ||
											!supportWebhookStatus.expectedWebhookUrl
										}
									>
										SUPPORT-бот
									</button>
									{!isUserLoading && !isDev && (
										<AdminTooltip
											title="Переустановка Support webhook"
											description="Статус доступен ADMIN, а переустанавливать webhook может только DEV."
											risk="medium"
											riskText="Операция изменяет webhook Telegram для Support Service."
										/>
									)}
								</span>
							</div>
						</div>

						<div className={styles.webhookStatusPanel}>
							<div className={styles.webhookStatusHeader}>
								<div>
									<p className={styles.label}>Статус webhook</p>
									<p className={styles.hint}>
										Показывает текущую очередь Telegram и последнюю ошибку
										доставки
									</p>
								</div>
								<button
									type="button"
									className={styles.actionBtn}
									onClick={handleRefreshWebhookStatuses}
									disabled={
										isSupportWebhookStatusFetching ||
										isIdentityWebhookStatusFetching ||
										isIdentityInfoWebhookStatusFetching ||
										isIdentityAuthSettingsFetching
									}
								>
									Обновить
								</button>
							</div>

							<div className={styles.webhookStatusGrid}>
								{WEBHOOK_BOTS.map(bot => {
									const status = statusByBot.get(bot)
									const pendingCount = status?.pendingUpdateCount ?? null
									const isIdentityUnavailable =
										(bot === 'auth' &&
											(isIdentityAuthSettingsError ||
												isIdentityWebhookStatusError)) ||
										(bot === 'info' && isIdentityInfoWebhookStatusError)
									const isSupportUnavailable =
										bot === 'support' && isSupportWebhookStatusError
									const hasProblem = Boolean(
										status &&
										(!status.ok ||
											!status.webhookMatchesExpected ||
											status.usernameMatchesConfigured === false ||
											(pendingCount ?? 0) > 0)
									)

									return (
										<div key={bot} className={styles.webhookStatusItem}>
											<div className={styles.webhookStatusTitleRow}>
												<p className={styles.statusValue}>
													{status?.title ??
														(bot === 'auth'
															? 'Auth_bot'
															: bot === 'support'
																? 'SUPPORT-бот'
																: 'INFO-бот')}
												</p>
												<span
													className={`${styles.badge} ${
														!status
															? styles.badgeWarning
															: hasProblem
																? styles.badgeWarning
																: styles.badgeOk
													}`}
												>
													{isIdentityUnavailable || isSupportUnavailable
														? 'Недоступен'
														: !status
															? 'Проверяем'
															: hasProblem
																? 'Внимание'
																: 'OK'}
												</span>
											</div>
											<p className={styles.webhookStatusLine}>
												Очередь: {pendingCount ?? '—'}
											</p>
											<p className={styles.webhookStatusLine}>
												Username: {status?.actualUsername ?? '—'}
											</p>
											<p className={styles.webhookStatusLine}>
												Env:{' '}
												{status?.configuredUsername
													? `@${status.configuredUsername}`
													: '—'}
											</p>
											<p className={styles.webhookStatusLine}>
												URL:{' '}
												{status?.error
													? 'проверить не удалось'
													: status?.webhookMatchesExpected
														? 'актуальный'
														: status?.webhookUrl
															? 'отличается'
															: 'не установлен'}
											</p>
											{status &&
												!status.error &&
												!status.webhookMatchesExpected && (
													<>
														<p className={styles.webhookStatusLine}>
															Ожидаемый: {status.expectedWebhookUrl ?? '—'}
														</p>
														<p className={styles.webhookStatusLine}>
															Фактический: {status.webhookUrl ?? '—'}
														</p>
													</>
												)}
											{status?.lastErrorMessage && (
												<p
													className={
														hasProblem
															? styles.webhookStatusError
															: styles.webhookStatusHistory
													}
												>
													История последней ошибки
													{status.lastErrorAt
														? ` ${formatDate(status.lastErrorAt)}`
														: ''}
													: {status.lastErrorMessage}
												</p>
											)}
											{status?.error && (
												<p className={styles.webhookStatusError}>
													{status.error}
												</p>
											)}
											{status?.usernameMatchesConfigured === false && (
												<p className={styles.webhookStatusError}>
													Username в env не совпадает с токеном
												</p>
											)}
											{isIdentityUnavailable || isSupportUnavailable ? (
												<p className={styles.webhookStatusError}>
													{isSupportUnavailable
														? 'Support Service недоступен'
														: 'Identity Service недоступен'}
												</p>
											) : !isBotTokenConfigured(bot) ? (
												<p className={styles.webhookStatusError}>
													Токен не настроен
												</p>
											) : null}
										</div>
									)
								})}
							</div>
						</div>

						{isDailySummarySettingsLoading ? (
							<div className={styles.schedulePanel}>
								<SkeletonLoader count={1} className="h-[82px]" />
							</div>
						) : dailySummarySettings ? (
							<>
								<div className={styles.toggleRow}>
									<div>
										<p className={styles.label}>Отправка сводки</p>
										<p className={styles.hint}>
											INFO-бот отправляет сводку каждый день в{' '}
											{dailySummarySettings.scheduleTime} (
											{dailySummarySettings.timezone}) и явно показывает
											период отчёта. Настройками владеет Reporting Service.
										</p>
									</div>
									<button
										type="button"
										className={`${styles.toggle} ${dailySummarySettings.enabled ? styles.toggleOn : ''}`}
										onClick={handleToggleSummary}
										disabled={dailySummaryMutation.isPending}
										aria-label={
											dailySummarySettings.enabled
												? 'Выключить отправку сводки'
												: 'Включить отправку сводки'
										}
									>
										<span className={styles.toggleThumb} />
									</button>
								</div>

								<div className={styles.schedulePanel}>
									<div className={styles.scheduleGrid}>
										<label className={styles.field}>
											<span className={styles.label}>Время сводки</span>
											<input
												type="time"
												className={styles.input}
												value={summaryTime}
												disabled={dailySummaryMutation.isPending}
												onChange={event => {
													isDailySummaryDraftDirty.current = true
													setSummaryTime(event.target.value)
												}}
											/>
										</label>
										<label className={styles.field}>
											<span className={styles.label}>
												ID группы Daily Summary
											</span>
											<input
												className={styles.input}
												value={dailySummaryDestinationChatId}
												disabled={
													dailySummaryMutation.isPending ||
													isDailySummaryDestinationFrozen
												}
												onChange={event => {
													isDailySummaryDraftDirty.current = true
													setDailySummaryDestinationChatId(
														event.target.value
													)
												}}
												placeholder="-1001234567890"
												maxLength={255}
											/>
										</label>
										<label className={styles.field}>
											<span className={styles.label}>Топик Reports</span>
											<input
												type="number"
												className={styles.input}
												value={dailySummaryThreadId}
												disabled={dailySummaryMutation.isPending}
												onChange={event => {
													isDailySummaryDraftDirty.current = true
													setDailySummaryThreadId(event.target.value)
												}}
												placeholder="123"
												min={1}
												max={MAX_TELEGRAM_TOPIC_ID}
												step={1}
												inputMode="numeric"
											/>
										</label>
										<div className={styles.field}>
											<span className={styles.label}>Часовой пояс</span>
											<p className={styles.derivedTime}>
												{dailySummarySettings.timezone}
											</p>
										</div>
										<button
											type="button"
											className={`${styles.saveBtn} ${styles.scheduleSaveBtn}`}
											onClick={handleSaveDailySummary}
											disabled={
												dailySummaryMutation.isPending ||
												!isDailySummarySettingsChanged
											}
										>
											Сохранить Daily Summary
										</button>
									</div>
									<p className={styles.hint}>
										Reporting Service хранит назначение, топик и расписание
										сводки как единственный источник истины. Время сводки
										должно быть разнесено с каждым backup минимум на{' '}
										{MIN_TASK_TIME_GAP_MINUTES} минут.
									</p>
									<p className={styles.hint}>
										После первичной настройки ID группы Daily Summary
										изменяется только через maintenance-процедуру.
									</p>
									{dailySummarySettings.schedulePolicyConfirmationPending && (
										<p className={styles.webhookStatusError}>
											Настройки сохранены в Reporting, но подтверждение
											policy в Operations ещё не завершено. Нажмите
											сохранить повторно.
										</p>
									)}
								</div>
							</>
						) : (
							<div className={styles.schedulePanel}>
								<p className={styles.empty}>
									Настройки Daily Summary временно недоступны
								</p>
								<p className={styles.hint}>
									{dailySummarySettingsError
										? errorCatch(dailySummarySettingsError)
										: 'Reporting Service не вернул настройки'}
								</p>
								<button
									type="button"
									className={styles.actionBtn}
									onClick={() => void refetchDailySummarySettings()}
								>
									Повторить
								</button>
							</div>
						)}

						<div className={styles.toggleRow}>
							<div>
								<p className={styles.label}>Отправка backup</p>
								<p className={styles.hint}>
									Backup баз сохраняется в приватном S3. Notification
									Delivery — в{' '}
									{settings.notificationDeliveryDatabaseBackupTimeLabel},
									Campaigns — в {settings.campaignsDatabaseBackupTimeLabel}
									, Reporting — в{' '}
									{settings.reportingDatabaseBackupTimeLabel}, Billing — в{' '}
									{settings.billingDatabaseBackupTimeLabel}, Identity — в{' '}
									{settings.identityDatabaseBackupTimeLabel}, Platform — в{' '}
									{settings.platformDatabaseBackupTimeLabel}, Support — в{' '}
									{settings.supportDatabaseBackupTimeLabel}, Operations — в{' '}
									{settings.operationsDatabaseBackupTimeLabel}, CRM Access
									— в {settings.crmAccessDatabaseBackupTimeLabel}, CRM
									Intake — в {settings.crmIntakeDatabaseBackupTimeLabel},
									CRM Customers — в{' '}
									{settings.crmCustomersDatabaseBackupTimeLabel}, CRM Sales
									— в {settings.crmSalesDatabaseBackupTimeLabel}. Базовое
									время {settings.databaseBackupTimeLabel} задаёт
									расписание, но все файлы приходят отдельно в топик
									Backups.
								</p>
							</div>
							<button
								type="button"
								className={`${styles.toggle} ${settings.databaseBackupEnabled ? styles.toggleOn : ''}`}
								onClick={handleToggleDatabaseBackup}
								disabled={mutation.isPending}
								aria-label={
									settings.databaseBackupEnabled
										? 'Выключить отправку backup'
										: 'Включить отправку backup'
								}
							>
								<span className={styles.toggleThumb} />
							</button>
						</div>

						<div className={styles.schedulePanel}>
							<div className={styles.scheduleGrid}>
								<label className={styles.field}>
									<span className={styles.label}>
										Базовое время backup
									</span>
									<input
										type="time"
										className={styles.input}
										value={backupTime}
										disabled={mutation.isPending}
										onChange={event => {
											isBackupScheduleDraftDirty.current = true
											setBackupTime(event.target.value)
										}}
									/>
								</label>
								<div className={styles.field}>
									<span className={styles.label}>
										Backup Notification Delivery
									</span>
									<p className={styles.derivedTime}>
										{notificationDeliveryBackupTime
											? `${notificationDeliveryBackupTime} МСК`
											: '—'}
									</p>
								</div>
								<div className={styles.field}>
									<span className={styles.label}>Backup Campaigns</span>
									<p className={styles.derivedTime}>
										{campaignsBackupTime
											? `${campaignsBackupTime} МСК`
											: '—'}
									</p>
								</div>
								<div className={styles.field}>
									<span className={styles.label}>Backup Reporting</span>
									<p className={styles.derivedTime}>
										{reportingBackupTime
											? `${reportingBackupTime} МСК`
											: '—'}
									</p>
								</div>

								<div className={styles.field}>
									<span className={styles.label}>Backup Billing</span>
									<p className={styles.derivedTime}>
										{billingBackupTime ? `${billingBackupTime} МСК` : '—'}
									</p>
								</div>
								<div className={styles.field}>
									<span className={styles.label}>Backup Identity</span>
									<p className={styles.derivedTime}>
										{identityBackupTime
											? `${identityBackupTime} МСК`
											: '—'}
									</p>
								</div>
								<div className={styles.field}>
									<span className={styles.label}>Backup Platform</span>
									<p className={styles.derivedTime}>
										{platformBackupTime
											? `${platformBackupTime} МСК`
											: '—'}
									</p>
								</div>
								<div className={styles.field}>
									<span className={styles.label}>Backup Support</span>
									<p className={styles.derivedTime}>
										{supportBackupTime ? `${supportBackupTime} МСК` : '—'}
									</p>
								</div>
								<div className={styles.field}>
									<span className={styles.label}>Backup Operations</span>
									<p className={styles.derivedTime}>
										{operationsBackupTime
											? `${operationsBackupTime} МСК`
											: '—'}
									</p>
								</div>
								<div className={styles.field}>
									<span className={styles.label}>Backup CRM Access</span>
									<p className={styles.derivedTime}>
										{crmAccessBackupTime
											? `${crmAccessBackupTime} МСК`
											: '—'}
									</p>
								</div>
								<div className={styles.field}>
									<span className={styles.label}>Backup CRM Intake</span>
									<p className={styles.derivedTime}>
										{crmIntakeBackupTime
											? `${crmIntakeBackupTime} МСК`
											: '—'}
									</p>
								</div>
								<div className={styles.field}>
									<span className={styles.label}>
										Backup CRM Customers
									</span>
									<p className={styles.derivedTime}>
										{crmCustomersBackupTime
											? `${crmCustomersBackupTime} МСК`
											: '—'}
									</p>
								</div>
								<div className={styles.field}>
									<span className={styles.label}>Backup CRM Sales</span>
									<p className={styles.derivedTime}>
										{crmSalesBackupTime
											? `${crmSalesBackupTime} МСК`
											: '—'}
									</p>
								</div>
								<button
									type="button"
									className={`${styles.saveBtn} ${styles.scheduleSaveBtn}`}
									onClick={handleSaveBackupSchedule}
									disabled={
										mutation.isPending ||
										backupTime === settings.databaseBackupTime
									}
								>
									Сохранить расписание backup
								</button>
							</div>
							<p className={styles.hint}>
								Время указывается по Москве. Notification Delivery,
								Campaigns, Reporting, Billing, Identity, Platform, Support,
								Operations, CRM Access, CRM Intake, CRM Customers и CRM
								Sales запускаются через{' '}
								{settings.notificationDeliveryDatabaseBackupDelayMinutes}
								{', '}
								{settings.campaignsDatabaseBackupDelayMinutes}
								{', '}
								{settings.reportingDatabaseBackupDelayMinutes}
								{', '}
								{', '}
								{settings.billingDatabaseBackupDelayMinutes}
								{', '}
								{settings.identityDatabaseBackupDelayMinutes}
								{', '}
								{settings.platformDatabaseBackupDelayMinutes}
								{', '}
								{settings.supportDatabaseBackupDelayMinutes}
								{', '}
								{settings.operationsDatabaseBackupDelayMinutes}
								{', '}
								{settings.crmAccessDatabaseBackupDelayMinutes}
								{', '}
								{settings.crmIntakeDatabaseBackupDelayMinutes}
								{', '}
								{settings.crmCustomersDatabaseBackupDelayMinutes}
								{' и '}
								{settings.crmSalesDatabaseBackupDelayMinutes} минут после
								базового времени соответственно. Сводка должна быть
								разнесена с каждым backup минимум на{' '}
								{MIN_TASK_TIME_GAP_MINUTES} минут.
							</p>
						</div>

						<div className={styles.schedulePanel}>
							<div className={styles.panelTitleRow}>
								<div>
									<p className={styles.label}>Маршрутизация Support_bot</p>
									<p className={styles.hint}>
										Источник истины — Support Service. ADMIN видит текущий
										маршрут, изменять его может только DEV.
									</p>
								</div>
								<AdminTooltip
									title="Маршрут чата с оператором"
									description="Support_bot направляет сообщения операторам в указанную группу и топик Support_chat."
									risk="medium"
									riskText="Неверный маршрут остановит доставку новых сообщений операторам."
								/>
							</div>

							{isUserLoading || isSupportRoutingSettingsLoading ? (
								<SkeletonLoader count={1} className="h-[150px]" />
							) : supportRoutingSettings ? (
								<>
									<p className={styles.readOnlyValue}>
										Текущий маршрут: {supportRoutingSettings.adminChatId} ·
										топик {supportRoutingSettings.supportThreadId ?? '—'}
									</p>
									<div
										className={!isDev ? styles.lockedSection : undefined}
										aria-disabled={!isDev}
									>
										<div
											className={!isDev ? styles.lockedContent : undefined}
											aria-hidden={!isDev}
										>
											<div className={styles.supportRoutingGrid}>
												<label className={styles.field}>
													<span className={styles.label}>
														ID группы Support
													</span>
													<input
														className={styles.input}
														value={supportChatId}
														disabled={
															!isDev || supportRoutingMutation.isPending
														}
														onChange={event => {
															isSupportRoutingDraftDirty.current = true
															setSupportChatId(event.target.value)
														}}
														placeholder="-1001234567890"
														maxLength={100}
													/>
												</label>
												<label className={styles.field}>
													<span className={styles.label}>
														Топик Support_chat
													</span>
													<input
														type="number"
														className={styles.input}
														value={supportThreadId}
														disabled={
															!isDev || supportRoutingMutation.isPending
														}
														onChange={event => {
															isSupportRoutingDraftDirty.current = true
															setSupportThreadId(event.target.value)
														}}
														placeholder="123"
														min={1}
														max={MAX_TELEGRAM_TOPIC_ID}
														step={1}
														inputMode="numeric"
													/>
												</label>
												<button
													type="button"
													className={styles.saveBtn}
													onClick={handleSaveSupportRouting}
													disabled={
														!isDev ||
														supportRoutingMutation.isPending ||
														!isSupportRoutingChanged
													}
												>
													Сохранить маршрут Support
												</button>
											</div>
										</div>
										{!isUserLoading && !isDev && (
											<div className={styles.lockedOverlay}>
												<span className={styles.lockedBadge}>
													Только для DEV
												</span>
												<AdminTooltip
													title="Изменение маршрута заблокировано"
													description="ADMIN доступен read-only просмотр. Изменять группу и топик Support_bot может только DEV."
												/>
											</div>
										)}
									</div>
								</>
							) : (
								<div>
									<p className={styles.empty}>
										Настройки Support Service недоступны
									</p>
									<p className={styles.hint}>
										{supportRoutingSettingsError
											? errorCatch(supportRoutingSettingsError)
											: 'Support Service не вернул настройки'}
									</p>
									<button
										type="button"
										className={styles.actionBtn}
										onClick={() => {
											const promise = refetchSupportRoutingSettings()
											toast.promise(promise, {
												loading: 'Пожалуйста, подождите',
												success: 'Настройки Support обновлены',
												error: error =>
													`Support недоступен: ${errorCatch(error)}`
											})
										}}
									>
										Повторить
									</button>
								</div>
							)}
						</div>

						<div className={styles.schedulePanel}>
							<div className={styles.field}>
								<label
									htmlFor="telegram-group-id"
									className={styles.label}
								>
									ID группы Operations
								</label>
								<input
									id="telegram-group-id"
									className={styles.input}
									value={chatId}
									disabled={mutation.isPending || isOperationsChatFrozen}
									onChange={event => {
										isTelegramRoutingDraftDirty.current = true
										setChatId(event.target.value)
									}}
									placeholder="-1001234567890"
									maxLength={100}
								/>
							</div>

							<div className={styles.statusGrid}>
								{OPERATIONS_TELEGRAM_TOPIC_FIELDS.map(field => (
									<label key={field.key} className={styles.field}>
										<span className={styles.label}>{field.label}</span>
										<input
											type="number"
											className={styles.input}
											value={topicIds[field.key]}
											disabled={
												mutation.isPending ||
												(field.key === 'operationalAlertsThreadId' &&
													isOperationalAlertsThreadFrozen)
											}
											onChange={event => {
												isTelegramRoutingDraftDirty.current = true
												setTopicIds(current => ({
													...current,
													[field.key]: event.target.value
												}))
											}}
											placeholder="123"
											min={1}
											max={MAX_TELEGRAM_TOPIC_ID}
											step={1}
											inputMode="numeric"
										/>
										<span className={styles.hint}>
											{field.description}
										</span>
									</label>
								))}
							</div>

							<p className={styles.hint}>
								Группа должна быть супергруппой с включёнными Topics. Для
								каждого назначения укажите его message_thread_id. Если ID
								топика не заполнен, сообщения этого типа не отправляются;
								fallback в General не используется. Маршрут Daily Summary
								настраивается отдельно в Reporting Service выше. После
								Operations хранит системную маршрутизацию, а Reporting
								отдельно хранит назначение Daily Summary.
							</p>
							<p className={styles.hint}>
								После первичной настройки ID общей группы Operations и
								топик системных уведомлений изменяются только через
								maintenance-процедуру. Топики Backups и Payments остаются
								редактируемыми.
							</p>

							<button
								type="button"
								className={styles.saveBtn}
								onClick={handleSaveTelegramRouting}
								disabled={mutation.isPending || !isTelegramRoutingChanged}
							>
								Сохранить маршрутизацию
							</button>
						</div>
					</>
				) : (
					<p className={styles.empty}>Не удалось загрузить настройки</p>
				)}
			</div>
		</section>
	)
}

export default AdminTelegramBot
