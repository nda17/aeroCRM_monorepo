'use client'

import { UserRole, useUser } from '@/entities/user'
import { adminTelegramBotService } from '@/features/manage-telegram-bot'
import type {
	AdminTelegramBotSettings,
	TelegramDatabaseBackupAdminJobSummary,
	TelegramDatabaseBackupFreshness,
	TelegramDatabaseBackupJobStatus,
	TelegramDatabaseBackupJobTrigger,
	TelegramDatabaseBackupOverviewItem,
	TelegramDatabaseBackupTarget
} from '@/features/manage-telegram-bot'
import {
	DATABASE_RESTORE_RECOVERY_ACTIONS,
	DATABASE_RESTORE_TARGETS,
	devToolsService,
	type DatabaseRestoreJob,
	type DatabaseRestoreJobStatus,
	type DatabaseRestorePermit,
	type DatabaseRestoreRecoveryAction,
	type DatabaseRestoreRecoveryActionStatus,
	type DatabaseRestoreRecoveryActionType,
	type DatabaseRestoresSettings,
	type DatabaseRestoreTarget,
	type DatabaseRestoreTargetSettings
} from '@/features/run-admin-task'
import AdminNavigation from '@/screens/admin/ui/common/admin-navigation/AdminNavigation'
import AdminSectionHeading from '@/screens/admin/ui/common/admin-section-heading/AdminSectionHeading'
import AdminTooltip from '@/screens/admin/ui/common/admin-tooltip/AdminTooltip'
import { errorCatch } from '@/shared/api'
import { ADMIN_PAGES } from '@/shared/config/pages/admin.config'
import Heading from '@/shared/ui/heading/Heading'
import Pagination from '@/shared/ui/pagination/Pagination'
import SkeletonLoader from '@/shared/ui/skeleton-loader/SkeletonLoader'
import {
	useMutation,
	useQuery,
	useQueryClient
} from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { NextPage } from 'next'
import Link from 'next/link'
import {
	type ChangeEvent,
	useCallback,
	useEffect,
	useRef,
	useState
} from 'react'
import toast from 'react-hot-toast'
import styles from './AdminDatabases.module.scss'
import DatabaseSections from './DatabaseSections'

const SETTINGS_QUERY_KEY = ['admin-telegram-bot-settings']
const DATABASE_BACKUP_OVERVIEW_QUERY_KEY = [
	'admin-telegram-database-backup-overview'
]
const DATABASE_BACKUP_HISTORY_QUERY_KEY = [
	'admin-telegram-database-backup-history'
]
const RESTORE_SETTINGS_QUERY_KEY = ['admin-database-restore-settings']
const DATABASE_BACKUP_JOB_POLL_INTERVAL_MS = 2500
const DATABASE_BACKUP_HISTORY_LIMIT = 20
const DATABASE_RESTORE_JOB_POLL_INTERVAL_MS = 2500
const DATABASE_RESTORE_PUBLICATION_GRACE_MS = 5 * 60 * 1000
const DATABASE_BACKUP_PROVENANCE_MAX_FILE_SIZE_BYTES = 16_384
const DATABASE_BACKUP_PROVENANCE_FILE_EXTENSION = '.provenance.json'
const DATABASE_BACKUP_PROVENANCE_DOMAIN =
	'aerocrm.operations.database-backup-provenance.v1'
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const PROVENANCE_KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
const DATABASE_BACKUP_STORAGE_KEY_PREFIX =
	'aerocrm:admin:database-backup:active'
const DATABASE_RESTORE_STORAGE_KEY_PREFIX =
	'aerocrm:admin:database-restore:latest'
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TERMINAL_DATABASE_BACKUP_JOB_STATUSES: ReadonlySet<TelegramDatabaseBackupJobStatus> =
	new Set<TelegramDatabaseBackupJobStatus>([
		'SUCCEEDED',
		'FAILED',
		'CANCELLED',
		'SKIPPED'
	])
const DATABASE_BACKUP_JOB_STATUS_LABELS: Record<
	TelegramDatabaseBackupJobStatus,
	string
> = {
	QUEUED: 'Ожидает запуска',
	PROCESSING: 'Выполняется',
	SUCCEEDED: 'Завершён',
	FAILED: 'Ошибка',
	CANCELLED: 'Отменён',
	SKIPPED: 'Пропущен'
}
const DATABASE_BACKUP_TARGET_OPTIONS: readonly TelegramDatabaseBackupTarget[] =
	[
		'notification-delivery',
		'campaigns',
		'reporting',
		'billing',
		'identity',
		'platform',
		'support',
		'operations',
		'crm-access',
		'crm-intake',
		'crm-customers',
		'crm-sales'
	]
const DATABASE_BACKUP_SCHEDULE_FIELDS = {
	'notification-delivery': 'notificationDeliveryDatabaseBackupTimeLabel',
	campaigns: 'campaignsDatabaseBackupTimeLabel',
	reporting: 'reportingDatabaseBackupTimeLabel',
	billing: 'billingDatabaseBackupTimeLabel',
	identity: 'identityDatabaseBackupTimeLabel',
	platform: 'platformDatabaseBackupTimeLabel',
	support: 'supportDatabaseBackupTimeLabel',
	operations: 'operationsDatabaseBackupTimeLabel',
	'crm-access': 'crmAccessDatabaseBackupTimeLabel',
	'crm-intake': 'crmIntakeDatabaseBackupTimeLabel',
	'crm-customers': 'crmCustomersDatabaseBackupTimeLabel',
	'crm-sales': 'crmSalesDatabaseBackupTimeLabel'
} as const
const DATABASE_BACKUP_TRIGGER_LABELS: Record<
	TelegramDatabaseBackupJobTrigger,
	string
> = {
	SCHEDULED: 'Плановый',
	MANUAL: 'Ручной'
}
const DATABASE_BACKUP_FRESHNESS_LABELS: Record<
	TelegramDatabaseBackupFreshness,
	string
> = {
	DISABLED: 'Расписание выключено',
	MISSING: 'Нет успешного backup',
	FRESH: 'Актуален',
	STALE: 'Устарел'
}
const TERMINAL_DATABASE_RESTORE_JOB_STATUSES: ReadonlySet<DatabaseRestoreJobStatus> =
	new Set<DatabaseRestoreJobStatus>([
		'CANCELLED',
		'SUCCEEDED',
		'FAILED',
		'RECOVERY_REQUIRED'
	])
const DATABASE_RESTORE_JOB_STATUS_LABELS: Record<
	DatabaseRestoreJobStatus,
	string
> = {
	QUEUED: 'Ожидает запуска',
	PROCESSING: 'Выполняется',
	CANCELLED: 'Отменено до блокировки БД',
	SUCCEEDED: 'Завершён',
	FAILED: 'Ошибка',
	RECOVERY_REQUIRED: 'Требуется ручное восстановление'
}
const DATABASE_RESTORE_RECOVERY_ACTION_LABELS: Record<
	DatabaseRestoreRecoveryActionType,
	string
> = {
	VERIFY_AS_IS: 'Проверить текущее состояние',
	ROLL_BACK_SAFETY: 'Вернуть safety backup',
	ROLL_FORWARD_SOURCE: 'Повторить source restore'
}
const DATABASE_RESTORE_RECOVERY_STATUS_LABELS: Record<
	DatabaseRestoreRecoveryActionStatus,
	string
> = {
	PENDING_APPROVAL: 'Ожидает второго DEV',
	APPROVED: 'Одобрено и поставлено в очередь',
	PROCESSING: 'Выполняется',
	RESOLVED: 'Разрешено',
	BLOCKED: 'Заблокировано',
	EXPIRED: 'Истекло'
}

const isAmbiguousDatabaseRestoreRequestError = (error: unknown) =>
	isAxiosError(error) &&
	(error.response?.status === undefined || error.response.status >= 500)

interface DatabaseRestoreMarker {
	jobId: string
	target: DatabaseRestoreTarget
	recoveryStartedAt: string | null
}

interface DatabaseBackupActiveMarker {
	idempotencyKey: string | null
	jobId: string | null
}

interface SelectedDatabaseBackupProvenance {
	raw: string
	fileName: string
	envelopeSha256: string
	keyId: string
	backupJobId: string
	target: DatabaseRestoreTarget
	artifactSha256: string
	artifactFileName: string
	artifactFileSize: number
}

const getDatabaseBackupMarker = (
	storageKey: string | null
): DatabaseBackupActiveMarker | null => {
	if (!storageKey || typeof window === 'undefined') return null

	try {
		const rawMarker = window.localStorage.getItem(storageKey)
		if (!rawMarker) return null

		const marker = JSON.parse(
			rawMarker
		) as Partial<DatabaseBackupActiveMarker>
		const idempotencyKey =
			typeof marker.idempotencyKey === 'string' &&
			UUID_PATTERN.test(marker.idempotencyKey)
				? marker.idempotencyKey.toLowerCase()
				: null
		const jobId =
			typeof marker.jobId === 'string' && UUID_PATTERN.test(marker.jobId)
				? marker.jobId.toLowerCase()
				: null

		return idempotencyKey || jobId ? { idempotencyKey, jobId } : null
	} catch {
		return null
	}
}

const saveDatabaseBackupMarker = (
	storageKey: string,
	marker: DatabaseBackupActiveMarker
) => {
	try {
		window.localStorage.setItem(storageKey, JSON.stringify(marker))
	} catch {
		// Серверная идемпотентность и active-job endpoint остаются fallback.
	}
}

const clearDatabaseBackupMarker = (
	storageKey: string | null,
	jobId: string
) => {
	if (!storageKey || typeof window === 'undefined') return
	const marker = getDatabaseBackupMarker(storageKey)
	if (!marker?.jobId || marker.jobId === jobId) {
		try {
			window.localStorage.removeItem(storageKey)
		} catch {
			// Marker безопасно очистится при следующем доступном storage.
		}
	}
}

const isDatabaseRestoreTarget = (
	value: unknown
): value is DatabaseRestoreTarget =>
	typeof value === 'string' &&
	DATABASE_RESTORE_TARGETS.some(target => target === value)

const getDatabaseRestoreMarker = (
	storageKey: string | null
): DatabaseRestoreMarker | null => {
	if (!storageKey || typeof window === 'undefined') return null

	try {
		const rawMarker = window.localStorage.getItem(storageKey)
		if (!rawMarker) return null

		const marker = JSON.parse(rawMarker) as Partial<DatabaseRestoreMarker>
		if (
			typeof marker.jobId !== 'string' ||
			!UUID_PATTERN.test(marker.jobId) ||
			!isDatabaseRestoreTarget(marker.target)
		) {
			return null
		}

		return {
			jobId: marker.jobId.toLowerCase(),
			target: marker.target,
			recoveryStartedAt:
				typeof marker.recoveryStartedAt === 'string' &&
				!Number.isNaN(Date.parse(marker.recoveryStartedAt))
					? marker.recoveryStartedAt
					: null
		}
	} catch {
		return null
	}
}

const saveDatabaseRestoreMarker = (
	storageKey: string,
	marker: DatabaseRestoreMarker
) => {
	try {
		window.localStorage.setItem(storageKey, JSON.stringify(marker))
	} catch {
		// Job остаётся доступен в текущей вкладке даже без localStorage.
	}
}

const clearDatabaseRestoreMarker = (
	storageKey: string | null,
	jobId?: string
) => {
	if (!storageKey || typeof window === 'undefined') return
	const marker = getDatabaseRestoreMarker(storageKey)
	if (jobId && marker?.jobId && marker.jobId !== jobId) return

	try {
		window.localStorage.removeItem(storageKey)
	} catch {
		// Некорректный marker будет проигнорирован при следующей загрузке.
	}
}

const formatFileSize = (value: number) => {
	if (value < 1024 * 1024) return `${Math.round(value / 1024)} КБ`
	return `${(value / 1024 / 1024).toFixed(1)} МБ`
}

const calculateFileSha256 = async (file: File) => {
	if (!globalThis.crypto?.subtle) {
		throw new Error('Web Crypto SHA-256 недоступен в этом браузере')
	}

	const digest = await globalThis.crypto.subtle.digest(
		'SHA-256',
		await file.arrayBuffer()
	)

	return Array.from(new Uint8Array(digest), byte =>
		byte.toString(16).padStart(2, '0')
	).join('')
}

const parseDatabaseBackupProvenance = (
	raw: string,
	fileName: string
): SelectedDatabaseBackupProvenance => {
	let value: unknown
	try {
		value = JSON.parse(raw) as unknown
	} catch {
		throw new Error('Sidecar не является корректным JSON')
	}

	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Некорректный корневой объект provenance sidecar')
	}
	const signed = value as Record<string, unknown>
	const envelope = signed.envelope
	if (
		!envelope ||
		typeof envelope !== 'object' ||
		Array.isArray(envelope)
	) {
		throw new Error('В sidecar отсутствует envelope')
	}
	const envelopeRecord = envelope as Record<string, unknown>
	const evidence = envelopeRecord.evidence
	if (
		!evidence ||
		typeof evidence !== 'object' ||
		Array.isArray(evidence)
	) {
		throw new Error('В sidecar отсутствует envelope.evidence')
	}
	const evidenceRecord = evidence as Record<string, unknown>
	if (
		envelopeRecord.domain !== DATABASE_BACKUP_PROVENANCE_DOMAIN ||
		envelopeRecord.schemaVersion !== 1 ||
		envelopeRecord.signatureAlgorithm !== 'Ed25519'
	) {
		throw new Error(
			'Sidecar использует неподдерживаемый provenance-контракт'
		)
	}
	if (
		typeof signed.envelopeSha256 !== 'string' ||
		!SHA256_PATTERN.test(signed.envelopeSha256)
	) {
		throw new Error('В sidecar отсутствует корректный envelope SHA-256')
	}
	if (
		typeof envelopeRecord.keyId !== 'string' ||
		!PROVENANCE_KEY_ID_PATTERN.test(envelopeRecord.keyId)
	) {
		throw new Error('В sidecar отсутствует корректный provenance key ID')
	}
	if (
		typeof signed.signatureEd25519Base64 !== 'string' ||
		!signed.signatureEd25519Base64
	) {
		throw new Error('В sidecar отсутствует Ed25519-подпись')
	}
	if (
		typeof evidenceRecord.backupJobId !== 'string' ||
		!UUID_PATTERN.test(evidenceRecord.backupJobId)
	) {
		throw new Error('В sidecar отсутствует корректный backup job ID')
	}
	if (!isDatabaseRestoreTarget(evidenceRecord.target)) {
		throw new Error('В sidecar указана неподдерживаемая целевая БД')
	}
	if (
		typeof evidenceRecord.artifactSha256 !== 'string' ||
		!SHA256_PATTERN.test(evidenceRecord.artifactSha256)
	) {
		throw new Error('В sidecar отсутствует корректный SHA-256 backup')
	}
	if (
		typeof evidenceRecord.fileName !== 'string' ||
		!evidenceRecord.fileName
	) {
		throw new Error('В sidecar отсутствует имя backup')
	}
	if (
		!Number.isSafeInteger(evidenceRecord.fileSize) ||
		Number(evidenceRecord.fileSize) <= 0
	) {
		throw new Error('В sidecar отсутствует корректный размер backup')
	}

	return {
		raw,
		fileName,
		envelopeSha256: signed.envelopeSha256,
		keyId: envelopeRecord.keyId,
		backupJobId: evidenceRecord.backupJobId.toLowerCase(),
		target: evidenceRecord.target,
		artifactSha256: evidenceRecord.artifactSha256,
		artifactFileName: evidenceRecord.fileName,
		artifactFileSize: Number(evidenceRecord.fileSize)
	}
}

const assertDatabaseBackupProvenanceMatches = (
	provenance: SelectedDatabaseBackupProvenance,
	target: DatabaseRestoreTarget,
	backup: File,
	backupSha256: string
) => {
	if (provenance.target !== target) {
		throw new Error(
			'Target в provenance sidecar не совпадает с выбранной БД'
		)
	}
	if (provenance.artifactSha256 !== backupSha256) {
		throw new Error('SHA-256 в provenance sidecar не совпадает с backup')
	}
	if (provenance.artifactFileName !== backup.name) {
		throw new Error('Имя файла в provenance sidecar не совпадает с backup')
	}
	if (provenance.artifactFileSize !== backup.size) {
		throw new Error('Размер в provenance sidecar не совпадает с backup')
	}
}

const getDatabaseBackupJobBadgeClass = (
	status: TelegramDatabaseBackupJobStatus
) => {
	if (status === 'SUCCEEDED') return styles.badgeOk
	if (status === 'FAILED' || status === 'CANCELLED') {
		return styles.badgeError
	}
	return styles.badgeProgress
}

const getDatabaseRestoreJobBadgeClass = (
	status: DatabaseRestoreJobStatus
) => {
	if (status === 'SUCCEEDED') return styles.badgeOk
	if (status === 'CANCELLED') return styles.badgeNeutral
	if (status === 'FAILED' || status === 'RECOVERY_REQUIRED') {
		return styles.badgeError
	}
	return styles.badgeProgress
}

const getDatabaseRestoreRecoveryBadgeClass = (
	status: DatabaseRestoreRecoveryActionStatus
) => {
	if (status === 'RESOLVED') return styles.badgeOk
	if (status === 'BLOCKED' || status === 'EXPIRED') {
		return styles.badgeError
	}
	return styles.badgeProgress
}

const getDatabaseBackupTargetLabel = (
	target: TelegramDatabaseBackupTarget
) =>
	({
		'notification-delivery': 'БД Notification Delivery',
		campaigns: 'БД Campaigns',
		reporting: 'БД Reporting',
		billing: 'БД Billing',
		identity: 'БД Identity',
		platform: 'БД Platform',
		support: 'БД Support',
		operations: 'БД Operations',
		'crm-access': 'БД CRM Access',
		'crm-intake': 'БД CRM Intake',
		'crm-customers': 'БД CRM Customers',
		'crm-sales': 'БД CRM Sales'
	})[target]

const formatDatabaseBackupDate = (value: string | null) => {
	if (!value) return '—'
	const parsed = new Date(value)
	if (Number.isNaN(parsed.getTime())) return '—'

	return new Intl.DateTimeFormat('ru-RU', {
		dateStyle: 'short',
		timeStyle: 'short'
	}).format(parsed)
}

const getDatabaseBackupFreshnessBadgeClass = (
	freshness: TelegramDatabaseBackupFreshness
) => {
	if (freshness === 'FRESH') return styles.badgeOk
	if (freshness === 'STALE' || freshness === 'MISSING') {
		return styles.badgeError
	}
	return styles.badgeNeutral
}

const DatabaseBackupJobSummary = ({
	job
}: {
	job: TelegramDatabaseBackupAdminJobSummary | null
}) => {
	if (!job) return <p className={styles.statusValue}>Не запускался</p>

	return (
		<>
			<span
				className={`${styles.badge} ${getDatabaseBackupJobBadgeClass(job.status)}`}
			>
				{DATABASE_BACKUP_JOB_STATUS_LABELS[job.status]}
			</span>
			<p className={styles.hint}>
				{formatDatabaseBackupDate(job.completedAt ?? job.queuedAt)}
			</p>
		</>
	)
}

const getDatabaseRestoreTargetLabel = (
	target: DatabaseRestoreTarget,
	targetSettings: DatabaseRestoreTargetSettings[] = []
) =>
	targetSettings.find(item => item.id === target)?.label ??
	{
		'notification-delivery': 'Notification Delivery',
		campaigns: 'Campaigns',
		reporting: 'Reporting',
		billing: 'Billing',
		identity: 'Identity',
		platform: 'Platform',
		support: 'Support',
		operations: 'Operations'
	}[target]

const useDatabaseBackup = (
	target: TelegramDatabaseBackupTarget,
	userId: string | null | undefined
) => {
	const queryClient = useQueryClient()
	const [databaseBackupJobId, setDatabaseBackupJobId] = useState<
		string | null
	>(null)
	const notifiedDatabaseBackupJob = useRef<string | null>(null)
	const checkedStaleDatabaseBackupJob = useRef<string | null>(null)
	const databaseBackupStorageKey = userId
		? `${DATABASE_BACKUP_STORAGE_KEY_PREFIX}:${target}:${userId}`
		: null

	const latestActiveDatabaseBackupJob = useQuery({
		queryKey: [
			'admin-telegram-database-backup-active',
			target,
			userId ?? null
		],
		queryFn: () =>
			adminTelegramBotService.getLatestActiveDatabaseBackupJob(target),
		enabled: Boolean(userId)
	})
	const refetchLatestActiveDatabaseBackupJob =
		latestActiveDatabaseBackupJob.refetch

	const databaseBackupMutation = useMutation({
		mutationFn: (idempotencyKey: string) =>
			adminTelegramBotService.sendDatabaseBackup(target, idempotencyKey),
		onSuccess: (result, idempotencyKey) => {
			notifiedDatabaseBackupJob.current = null
			checkedStaleDatabaseBackupJob.current = null
			setDatabaseBackupJobId(result.jobId)
			if (databaseBackupStorageKey) {
				saveDatabaseBackupMarker(databaseBackupStorageKey, {
					idempotencyKey,
					jobId: result.jobId
				})
			}
			void queryClient.invalidateQueries({
				queryKey: DATABASE_BACKUP_OVERVIEW_QUERY_KEY
			})
			void queryClient.invalidateQueries({
				queryKey: DATABASE_BACKUP_HISTORY_QUERY_KEY
			})
		}
	})

	const databaseBackupJob = useQuery({
		queryKey: [
			'admin-telegram-database-backup-job',
			target,
			databaseBackupJobId
		],
		queryFn: () =>
			adminTelegramBotService.getDatabaseBackupJob(
				target,
				databaseBackupJobId!
			),
		enabled: Boolean(databaseBackupJobId),
		refetchInterval: query => {
			const job = query.state.data
			return job && TERMINAL_DATABASE_BACKUP_JOB_STATUSES.has(job.status)
				? false
				: DATABASE_BACKUP_JOB_POLL_INTERVAL_MS
		}
	})

	useEffect(() => {
		setDatabaseBackupJobId(null)
		checkedStaleDatabaseBackupJob.current = null
		const marker = getDatabaseBackupMarker(databaseBackupStorageKey)
		if (marker?.jobId) {
			setDatabaseBackupJobId(marker.jobId)
		}
	}, [databaseBackupStorageKey])

	useEffect(() => {
		const activeJob = latestActiveDatabaseBackupJob.data
		if (!activeJob || !databaseBackupStorageKey) return

		notifiedDatabaseBackupJob.current = null
		setDatabaseBackupJobId(activeJob.jobId)
		queryClient.setQueryData(
			['admin-telegram-database-backup-job', target, activeJob.jobId],
			activeJob
		)
		const marker = getDatabaseBackupMarker(databaseBackupStorageKey)
		saveDatabaseBackupMarker(databaseBackupStorageKey, {
			idempotencyKey: marker?.idempotencyKey ?? null,
			jobId: activeJob.jobId
		})
	}, [
		databaseBackupStorageKey,
		latestActiveDatabaseBackupJob.data,
		queryClient,
		target
	])

	useEffect(() => {
		if (!databaseBackupStorageKey) return

		const handleStorage = (event: StorageEvent) => {
			if (event.key !== databaseBackupStorageKey) return
			const marker = getDatabaseBackupMarker(databaseBackupStorageKey)
			if (marker?.jobId) {
				notifiedDatabaseBackupJob.current = null
				checkedStaleDatabaseBackupJob.current = null
				setDatabaseBackupJobId(marker.jobId)
				return
			}

			void refetchLatestActiveDatabaseBackupJob().then(result => {
				if (result.isSuccess && result.data === null) {
					setDatabaseBackupJobId(null)
				}
			})
		}

		window.addEventListener('storage', handleStorage)
		return () => window.removeEventListener('storage', handleStorage)
	}, [databaseBackupStorageKey, refetchLatestActiveDatabaseBackupJob])

	useEffect(() => {
		const jobId = databaseBackupJobId
		const status = isAxiosError(databaseBackupJob.error)
			? databaseBackupJob.error.response?.status
			: undefined
		if (
			!jobId ||
			!databaseBackupJob.isError ||
			(status !== 403 && status !== 404) ||
			checkedStaleDatabaseBackupJob.current === jobId
		) {
			return
		}

		checkedStaleDatabaseBackupJob.current = jobId
		void refetchLatestActiveDatabaseBackupJob().then(result => {
			if (!result.isSuccess) {
				checkedStaleDatabaseBackupJob.current = null
				return
			}
			if (result.data !== null) return

			clearDatabaseBackupMarker(databaseBackupStorageKey, jobId)
			setDatabaseBackupJobId(currentJobId =>
				currentJobId === jobId ? null : currentJobId
			)
			toast.error(
				`Задание backup ${getDatabaseBackupTargetLabel(target)} больше не доступно. Активных запусков нет.`
			)
		})
	}, [
		databaseBackupJob.error,
		databaseBackupJob.isError,
		databaseBackupJobId,
		databaseBackupStorageKey,
		refetchLatestActiveDatabaseBackupJob,
		target
	])

	useEffect(() => {
		const job = databaseBackupJob.data
		if (
			!job ||
			!TERMINAL_DATABASE_BACKUP_JOB_STATUSES.has(job.status) ||
			notifiedDatabaseBackupJob.current === job.jobId
		) {
			return
		}

		notifiedDatabaseBackupJob.current = job.jobId
		clearDatabaseBackupMarker(databaseBackupStorageKey, job.jobId)
		queryClient.setQueryData(
			['admin-telegram-database-backup-active', target, userId ?? null],
			null
		)
		void queryClient.invalidateQueries({
			queryKey: DATABASE_BACKUP_OVERVIEW_QUERY_KEY
		})
		void queryClient.invalidateQueries({
			queryKey: DATABASE_BACKUP_HISTORY_QUERY_KEY
		})

		if (job.status === 'SUCCEEDED') {
			const fileSize = job.fileSize
			toast.success(
				fileSize === null
					? `Backup ${getDatabaseBackupTargetLabel(target)} создан и отправлен в Telegram`
					: `Backup ${getDatabaseBackupTargetLabel(target)} отправлен в Telegram: ${formatFileSize(fileSize)}`
			)
			void queryClient.invalidateQueries({
				queryKey: SETTINGS_QUERY_KEY
			})
			return
		}

		if (job.status === 'CANCELLED') {
			toast.error(
				`Создание backup ${getDatabaseBackupTargetLabel(target)} отменено`
			)
			return
		}
		if (job.status === 'SKIPPED') {
			toast(
				`Backup ${getDatabaseBackupTargetLabel(target)} пропущен планировщиком`
			)
			return
		}

		toast.error(
			`Backup ${getDatabaseBackupTargetLabel(target)} завершился с ошибкой`
		)
	}, [
		databaseBackupJob.data,
		databaseBackupStorageKey,
		queryClient,
		target,
		userId
	])

	const handleSendDatabaseBackup = () => {
		if (!databaseBackupStorageKey) {
			toast.error('Не удалось определить администратора')
			return
		}

		const activeJob = latestActiveDatabaseBackupJob.data
		if (activeJob) {
			setDatabaseBackupJobId(activeJob.jobId)
			toast.success(
				`Активный backup ${getDatabaseBackupTargetLabel(target)} уже выполняется`
			)
			return
		}

		const marker = getDatabaseBackupMarker(databaseBackupStorageKey)
		const idempotencyKey =
			marker?.idempotencyKey ?? window.crypto.randomUUID()
		saveDatabaseBackupMarker(databaseBackupStorageKey, {
			idempotencyKey,
			jobId: marker?.jobId ?? null
		})
		const promise = databaseBackupMutation.mutateAsync(idempotencyKey)

		toast.promise(promise, {
			loading: `Ставим backup ${getDatabaseBackupTargetLabel(target)} в очередь...`,
			success: result =>
				result.created
					? `Backup ${getDatabaseBackupTargetLabel(target)} поставлен в очередь`
					: result.status === 'SUCCEEDED'
						? `Этот backup ${getDatabaseBackupTargetLabel(target)} уже был успешно завершён`
						: `Активный backup ${getDatabaseBackupTargetLabel(target)} уже поставлен в очередь`,
			error: error =>
				`Ошибка backup ${getDatabaseBackupTargetLabel(target)}: ${errorCatch(error)}`
		})
	}

	return {
		databaseBackupJob,
		databaseBackupJobId,
		databaseBackupMutation,
		handleSendDatabaseBackup,
		isDatabaseBackupAvailabilityUnknown:
			latestActiveDatabaseBackupJob.isLoading ||
			latestActiveDatabaseBackupJob.isError,
		isDatabaseBackupJobActive: Boolean(
			databaseBackupJobId &&
			(!databaseBackupJob.data ||
				!TERMINAL_DATABASE_BACKUP_JOB_STATUSES.has(
					databaseBackupJob.data.status
				))
		),
		latestActiveDatabaseBackupJob
	}
}

interface DatabaseBackupPanelProps {
	description: string
	overviewError: unknown
	overviewItem: TelegramDatabaseBackupOverviewItem | null
	overviewLoading: boolean
	scheduleTimeLabel: string
	settings: AdminTelegramBotSettings
	target: TelegramDatabaseBackupTarget
	title: string
	userId: string | null | undefined
}

const DatabaseBackupPanel = ({
	description,
	overviewError,
	overviewItem,
	overviewLoading,
	scheduleTimeLabel,
	settings,
	target,
	title,
	userId
}: DatabaseBackupPanelProps) => {
	const backup = useDatabaseBackup(target, userId)
	const disabledReason = !userId
		? 'Проверяем доступ к резервным копиям.'
		: !settings.databaseBackupEnabled
			? 'Резервное копирование выключено. Включите его в настройках Telegram.'
			: !settings.telegramBotTokenConfigured ||
				  !settings.dailySummaryChatId.trim() ||
				  !settings.databaseBackupThreadId
				? 'Для отправки копии настройте Telegram-бота, чат и тему резервных копий.'
				: backup.databaseBackupMutation.isPending
					? 'Запрос на создание копии отправляется.'
					: backup.isDatabaseBackupJobActive
						? 'Для этой базы уже выполняется задание.'
						: backup.isDatabaseBackupAvailabilityUnknown
							? 'Не удалось подтвердить отсутствие активного задания. Дождитесь проверки статуса.'
							: null

	return (
		<div className={styles.card}>
			<div className={styles.backupPanel}>
				<div className={styles.backupHeader}>
					<div>
						<p className={styles.label}>{title}</p>
						<p className={styles.hint}>{description}</p>
					</div>
					<button
						type="button"
						className={styles.actionBtn}
						onClick={backup.handleSendDatabaseBackup}
						disabled={Boolean(disabledReason)}
						aria-describedby={`backup-${target}-availability`}
					>
						Создать копию
					</button>
				</div>
				<p
					id={`backup-${target}-availability`}
					className={styles.hint}
					role="status"
				>
					{disabledReason ??
						'Копия будет создана в фоне и отправлена в настроенный чат Telegram.'}
				</p>
				<div className={styles.backupMetaGrid}>
					<div className={styles.statusItem}>
						<p className={styles.statusLabel}>Плановое время</p>
						<p className={styles.statusValue}>{scheduleTimeLabel}</p>
					</div>
					<div className={styles.statusItem}>
						<p className={styles.statusLabel}>Последний плановый</p>
						{overviewLoading ? (
							<p className={styles.statusValue}>Загрузка...</p>
						) : overviewError ? (
							<p className={styles.hint}>Статус недоступен</p>
						) : (
							<DatabaseBackupJobSummary
								job={overviewItem?.latestScheduled ?? null}
							/>
						)}
					</div>
					<div className={styles.statusItem} aria-live="polite">
						<p className={styles.statusLabel}>Последний ручной</p>
						{backup.databaseBackupJob.data ? (
							<>
								<span
									className={`${styles.badge} ${getDatabaseBackupJobBadgeClass(backup.databaseBackupJob.data.status)}`}
								>
									{
										DATABASE_BACKUP_JOB_STATUS_LABELS[
											backup.databaseBackupJob.data.status
										]
									}
								</span>
								{backup.databaseBackupJob.data.hasError && (
									<p className={styles.hint}>
										Подробности доступны в защищённых server logs
									</p>
								)}
							</>
						) : backup.databaseBackupJob.isError ? (
							<p className={styles.hint}>
								Не удалось получить статус:{' '}
								{errorCatch(backup.databaseBackupJob.error)}
							</p>
						) : backup.databaseBackupJobId ? (
							<p className={styles.statusValue}>Проверяем статус...</p>
						) : overviewLoading ? (
							<p className={styles.statusValue}>Загрузка...</p>
						) : overviewError ||
						  backup.latestActiveDatabaseBackupJob.isError ? (
							<p className={styles.hint}>
								Не удалось получить общий статус backup
							</p>
						) : (
							<DatabaseBackupJobSummary
								job={overviewItem?.latestManual ?? null}
							/>
						)}
					</div>
					<div className={styles.statusItem}>
						<p className={styles.statusLabel}>Свежесть</p>
						{overviewLoading ? (
							<p className={styles.statusValue}>Загрузка...</p>
						) : overviewItem ? (
							<>
								<span
									className={`${styles.badge} ${getDatabaseBackupFreshnessBadgeClass(overviewItem.freshness)}`}
								>
									{
										DATABASE_BACKUP_FRESHNESS_LABELS[
											overviewItem.freshness
										]
									}
								</span>
								{overviewItem.staleAfter && (
									<p className={styles.hint}>
										{overviewItem.freshness === 'STALE'
											? 'устарел с'
											: 'свеж до'}{' '}
										{formatDatabaseBackupDate(overviewItem.staleAfter)}
									</p>
								)}
							</>
						) : (
							<p className={styles.hint}>Статус недоступен</p>
						)}
					</div>
					<div className={styles.statusItem}>
						<p className={styles.statusLabel}>Последний успешный файл</p>
						{overviewItem?.latestSuccessful ? (
							<>
								<p className={styles.statusValue}>
									{overviewItem.latestSuccessful.fileSize === null
										? 'Размер не записан'
										: formatFileSize(
												overviewItem.latestSuccessful.fileSize
											)}
								</p>
								<p className={styles.hint}>
									{formatDatabaseBackupDate(
										overviewItem.latestSuccessful.completedAt
									)}
								</p>
							</>
						) : overviewLoading ? (
							<p className={styles.statusValue}>Загрузка...</p>
						) : (
							<p className={styles.statusValue}>Нет данных</p>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}

const DatabaseBackupHistory = () => {
	const [page, setPage] = useState(1)
	const [target, setTarget] = useState<TelegramDatabaseBackupTarget | ''>(
		''
	)
	const [trigger, setTrigger] = useState<
		TelegramDatabaseBackupJobTrigger | ''
	>('')
	const [status, setStatus] = useState<
		TelegramDatabaseBackupJobStatus | ''
	>('')
	const history = useQuery({
		queryKey: [
			...DATABASE_BACKUP_HISTORY_QUERY_KEY,
			page,
			target,
			trigger,
			status
		],
		queryFn: () =>
			adminTelegramBotService.getDatabaseBackupJobs({
				page,
				limit: DATABASE_BACKUP_HISTORY_LIMIT,
				...(target ? { target } : {}),
				...(trigger ? { trigger } : {}),
				...(status ? { status } : {})
			}),
		refetchInterval: 30_000
	})
	const totalPages = history.data?.totalPages ?? 1
	const pages = Array.from({ length: totalPages }, (_, index) => index + 1)

	useEffect(() => {
		if (page > totalPages) setPage(totalPages)
	}, [page, totalPages])

	return (
		<div className={styles.card}>
			<div className={styles.historyHeader}>
				<div>
					<p className={styles.label}>История резервных копий</p>
					<p className={styles.hint}>
						Общая серверная история плановых и ручных запусков всех
						активных PostgreSQL-баз.
					</p>
				</div>
				<p className={styles.hint}>
					{history.data
						? `Всего заданий: ${history.data.total}`
						: 'Загрузка...'}
				</p>
			</div>
			<div className={styles.historyFilters}>
				<label className={styles.fieldLabel}>
					База данных
					<select
						className={styles.select}
						value={target}
						onChange={event => {
							setTarget(
								event.target.value as TelegramDatabaseBackupTarget | ''
							)
							setPage(1)
						}}
					>
						<option value="">Все базы</option>
						{DATABASE_BACKUP_TARGET_OPTIONS.map(item => (
							<option key={item} value={item}>
								{getDatabaseBackupTargetLabel(item)}
							</option>
						))}
					</select>
				</label>
				<label className={styles.fieldLabel}>
					Запуск
					<select
						className={styles.select}
						value={trigger}
						onChange={event => {
							setTrigger(
								event.target.value as TelegramDatabaseBackupJobTrigger | ''
							)
							setPage(1)
						}}
					>
						<option value="">Все запуски</option>
						<option value="SCHEDULED">Плановые</option>
						<option value="MANUAL">Ручные</option>
					</select>
				</label>
				<label className={styles.fieldLabel}>
					Статус
					<select
						className={styles.select}
						value={status}
						onChange={event => {
							setStatus(
								event.target.value as TelegramDatabaseBackupJobStatus | ''
							)
							setPage(1)
						}}
					>
						<option value="">Все статусы</option>
						{Object.entries(DATABASE_BACKUP_JOB_STATUS_LABELS).map(
							([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							)
						)}
					</select>
				</label>
			</div>

			{history.isLoading ? (
				<SkeletonLoader count={4} className="h-[52px]" />
			) : history.isError ? (
				<p className={styles.restoreError}>
					Не удалось получить историю backup: {errorCatch(history.error)}
				</p>
			) : history.data?.items.length ? (
				<>
					<div className={styles.historyTableWrap}>
						<table className={styles.historyTable}>
							<thead>
								<tr>
									<th>База</th>
									<th>Запуск</th>
									<th>Статус</th>
									<th>Поставлен</th>
									<th>Завершён</th>
									<th>Попытки</th>
									<th>Размер</th>
								</tr>
							</thead>
							<tbody>
								{history.data.items.map(job => (
									<tr key={job.jobId}>
										<td>{getDatabaseBackupTargetLabel(job.target)}</td>
										<td>{DATABASE_BACKUP_TRIGGER_LABELS[job.trigger]}</td>
										<td>
											<span
												className={`${styles.badge} ${getDatabaseBackupJobBadgeClass(job.status)}`}
											>
												{DATABASE_BACKUP_JOB_STATUS_LABELS[job.status]}
											</span>
										</td>
										<td>{formatDatabaseBackupDate(job.queuedAt)}</td>
										<td>{formatDatabaseBackupDate(job.completedAt)}</td>
										<td>
											{job.attempts} / {job.maxAttempts}
										</td>
										<td>
											{job.fileSize === null
												? '—'
												: formatFileSize(job.fileSize)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					{totalPages > 1 && (
						<Pagination
							listPage={pages}
							currentPage={page}
							prevPage={() => setPage(value => Math.max(1, value - 1))}
							nextPage={() =>
								setPage(value => Math.min(totalPages, value + 1))
							}
							changeActivePage={setPage}
						/>
					)}
				</>
			) : (
				<p className={styles.empty}>По выбранным фильтрам запусков нет</p>
			)}
		</div>
	)
}

interface DatabaseRestorePanelProps {
	isDev: boolean
	isUserLoading: boolean
	userId: string | null | undefined
}

const formatRestoreJobDate = (value: string | null) => {
	if (!value) return '—'
	const parsed = new Date(value)
	if (Number.isNaN(parsed.getTime())) return value

	return new Intl.DateTimeFormat('ru-RU', {
		dateStyle: 'short',
		timeStyle: 'medium'
	}).format(parsed)
}

const DatabaseRestorePanel = ({
	isDev,
	isUserLoading,
	userId
}: DatabaseRestorePanelProps) => {
	const queryClient = useQueryClient()
	const [restoreTarget, setRestoreTarget] =
		useState<DatabaseRestoreTarget>('notification-delivery')
	const [restoreFile, setRestoreFile] = useState<File | null>(null)
	const [restoreFileSha256, setRestoreFileSha256] = useState<
		string | null
	>(null)
	const [isRestoreFileHashing, setIsRestoreFileHashing] = useState(false)
	const [restoreBackupProvenance, setRestoreBackupProvenance] =
		useState<SelectedDatabaseBackupProvenance | null>(null)
	const [restoreConfirmation, setRestoreConfirmation] = useState('')
	const [createdPermit, setCreatedPermit] =
		useState<DatabaseRestorePermit | null>(null)
	const [permitApprovalId, setPermitApprovalId] = useState('')
	const [recoveryAction, setRecoveryAction] =
		useState<DatabaseRestoreRecoveryActionType>('VERIFY_AS_IS')
	const [restoreJobLookupId, setRestoreJobLookupId] = useState('')
	const [restoreJobMarker, setRestoreJobMarker] =
		useState<DatabaseRestoreMarker | null>(null)
	const restoreFileInput = useRef<HTMLInputElement | null>(null)
	const restoreProvenanceInput = useRef<HTMLInputElement | null>(null)
	const restoreFileHashRequest = useRef(0)
	const notifiedRestoreJob = useRef<string | null>(null)
	const notifiedRecoveryAction = useRef<string | null>(null)
	const databaseRestoreStorageKey = userId
		? `${DATABASE_RESTORE_STORAGE_KEY_PREFIX}:${userId}`
		: null
	const resetRestoreBackupProvenance = useCallback(() => {
		setRestoreBackupProvenance(null)
		if (restoreProvenanceInput.current) {
			restoreProvenanceInput.current.value = ''
		}
	}, [])

	const databaseRestoreSettings = useQuery({
		queryKey: RESTORE_SETTINGS_QUERY_KEY,
		queryFn: devToolsService.getDatabaseRestoresSettings,
		enabled: Boolean(userId),
		refetchInterval: 10_000
	})
	const trackDatabaseRestoreJob = useCallback(
		async (job: DatabaseRestoreJob) => {
			await queryClient.cancelQueries({
				queryKey: ['admin-database-restore-job', job.jobId],
				exact: true
			})
			const marker = {
				jobId: job.jobId,
				target: job.target,
				recoveryStartedAt: null
			}
			notifiedRestoreJob.current = null
			setRestoreJobMarker(marker)
			queryClient.setQueryData(
				['admin-database-restore-job', job.jobId],
				job
			)
			if (databaseRestoreStorageKey) {
				saveDatabaseRestoreMarker(databaseRestoreStorageKey, marker)
			}
		},
		[databaseRestoreStorageKey, queryClient]
	)

	const databaseRestoreJob = useQuery({
		queryKey: [
			'admin-database-restore-job',
			restoreJobMarker?.jobId ?? null
		],
		queryFn: ({ signal }) =>
			devToolsService.getDatabaseRestoreJob(
				restoreJobMarker!.jobId,
				signal
			),
		enabled: Boolean(userId && restoreJobMarker?.jobId),
		refetchInterval: query => {
			const job = query.state.data
			if (job?.status === 'RECOVERY_REQUIRED' && !job.recoveryResolvedAt) {
				return DATABASE_RESTORE_JOB_POLL_INTERVAL_MS
			}
			return job && TERMINAL_DATABASE_RESTORE_JOB_STATUSES.has(job.status)
				? false
				: DATABASE_RESTORE_JOB_POLL_INTERVAL_MS
		}
	})

	const databaseRestorePermitMutation = useMutation({
		mutationFn: devToolsService.createDatabaseRestorePermit,
		onSuccess: permit => {
			setCreatedPermit(permit)
			setPermitApprovalId(permit.permitId)
		}
	})

	const databaseRestorePermitApprovalMutation = useMutation({
		mutationFn: devToolsService.approveDatabaseRestorePermit,
		onSuccess: permit => {
			setCreatedPermit(current =>
				current?.permitId === permit.permitId ? permit : current
			)
			queryClient.setQueryData<DatabaseRestoresSettings>(
				RESTORE_SETTINGS_QUERY_KEY,
				current => (current ? { ...current, approved: permit } : current)
			)
		}
	})

	const databaseRestoreMutation = useMutation({
		mutationFn: ({
			target,
			file,
			confirmation,
			requestId
		}: {
			target: DatabaseRestoreTarget
			file: File
			confirmation: string
			requestId: string
		}) => {
			const request = async () => {
				const assertExactJob = (job: DatabaseRestoreJob) => {
					if (job.jobId !== requestId || job.target !== target) {
						throw new Error(
							'Сервер вернул задание, не соответствующее одобренному восстановлению'
						)
					}

					return job
				}
				const getExactJob = async () => {
					const job = await devToolsService
						.getDatabaseRestoreJob(requestId)
						.catch(() => null)

					return job?.jobId === requestId && job.target === target
						? job
						: null
				}
				const publish = async () =>
					assertExactJob(
						await devToolsService.startDatabaseRestore(
							target,
							file,
							confirmation,
							requestId
						)
					)

				let job: DatabaseRestoreJob
				try {
					job = await publish()
				} catch (error) {
					if (!isAmbiguousDatabaseRestoreRequestError(error)) {
						throw error
					}
					const exactJob = await getExactJob()
					if (!exactJob) throw error
					job = exactJob
				}

				if (job.publicationConfirmed) return job

				try {
					const retriedJob = await publish()
					if (retriedJob.publicationConfirmed) return retriedJob

					const exactJob = await getExactJob()
					if (exactJob?.publicationConfirmed) return exactJob
					throw new Error(
						'Публикация задания не подтверждена. Повторно выберите тот же backup для восстановления по одобренному jobId.'
					)
				} catch (error) {
					if (!isAmbiguousDatabaseRestoreRequestError(error)) throw error
					const exactJob = await getExactJob()
					if (exactJob?.publicationConfirmed) return exactJob
					throw error
				}
			}

			return request()
		},
		onSuccess: async job => {
			await trackDatabaseRestoreJob(job)
			setRestoreFile(null)
			setRestoreFileSha256(null)
			resetRestoreBackupProvenance()
			setRestoreConfirmation('')
			if (restoreFileInput.current) {
				restoreFileInput.current.value = ''
			}
		},
		onError: (error, variables) => {
			const status = isAxiosError(error)
				? error.response?.status
				: undefined
			if (status === undefined || status >= 500) {
				const recoveryMarker: DatabaseRestoreMarker = {
					jobId: variables.requestId,
					target: variables.target,
					recoveryStartedAt: new Date().toISOString()
				}
				setRestoreJobMarker(current =>
					current?.jobId === variables.requestId ? recoveryMarker : current
				)
				if (
					databaseRestoreStorageKey &&
					getDatabaseRestoreMarker(databaseRestoreStorageKey)?.jobId ===
						variables.requestId
				) {
					saveDatabaseRestoreMarker(
						databaseRestoreStorageKey,
						recoveryMarker
					)
				}
				return
			}

			clearDatabaseRestoreMarker(
				databaseRestoreStorageKey,
				variables.requestId
			)
			setRestoreJobMarker(current =>
				current?.jobId === variables.requestId ? null : current
			)
		}
	})

	const databaseRestoreCancelMutation = useMutation({
		mutationFn: (jobId: string) =>
			devToolsService.cancelDatabaseRestoreJob(jobId),
		onSuccess: job => {
			queryClient.setQueryData(
				['admin-database-restore-job', job.jobId],
				job
			)
		}
	})

	const updateRecoveryAction = (action: DatabaseRestoreRecoveryAction) => {
		queryClient.setQueryData<DatabaseRestoreJob>(
			['admin-database-restore-job', action.jobId],
			current => {
				if (!current) return current
				const exists = current.recoveryActions.some(
					item => item.actionId === action.actionId
				)
				return {
					...current,
					recoveryActions: exists
						? current.recoveryActions.map(item =>
								item.actionId === action.actionId ? action : item
							)
						: [action, ...current.recoveryActions]
				}
			}
		)
	}

	const databaseRestoreRecoveryMutation = useMutation({
		mutationFn: ({
			jobId,
			action
		}: {
			jobId: string
			action: DatabaseRestoreRecoveryActionType
		}) =>
			devToolsService.createDatabaseRestoreRecoveryAction(jobId, action),
		onSuccess: updateRecoveryAction
	})

	const databaseRestoreRecoveryApprovalMutation = useMutation({
		mutationFn: ({
			jobId,
			actionId
		}: {
			jobId: string
			actionId: string
		}) =>
			devToolsService.approveDatabaseRestoreRecoveryAction(
				jobId,
				actionId
			),
		onSuccess: updateRecoveryAction
	})

	useEffect(() => {
		const marker = getDatabaseRestoreMarker(databaseRestoreStorageKey)
		setRestoreJobMarker(marker)
		if (marker) setRestoreTarget(marker.target)
	}, [databaseRestoreStorageKey])

	useEffect(() => {
		const targets = databaseRestoreSettings.data?.targets
		if (!targets?.length) return
		const approvedTarget = databaseRestoreSettings.data?.approved?.target
		if (
			approvedTarget &&
			targets.some(target => target.id === approvedTarget)
		) {
			if (restoreTarget === approvedTarget) return

			setRestoreTarget(approvedTarget)
			setRestoreFile(null)
			setRestoreFileSha256(null)
			resetRestoreBackupProvenance()
			setRestoreConfirmation('')
			if (restoreFileInput.current) restoreFileInput.current.value = ''
			return
		}
		if (targets.some(target => target.id === restoreTarget)) return

		setRestoreTarget(targets[0].id)
		setRestoreFile(null)
		setRestoreFileSha256(null)
		resetRestoreBackupProvenance()
		setRestoreConfirmation('')
		if (restoreFileInput.current) restoreFileInput.current.value = ''
	}, [
		databaseRestoreSettings.data?.approved?.target,
		databaseRestoreSettings.data?.targets,
		resetRestoreBackupProvenance,
		restoreTarget
	])

	useEffect(() => {
		if (!databaseRestoreStorageKey) return

		const handleStorage = (event: StorageEvent) => {
			if (event.key !== databaseRestoreStorageKey) return
			const marker = getDatabaseRestoreMarker(databaseRestoreStorageKey)
			notifiedRestoreJob.current = null
			setRestoreJobMarker(marker)
			if (marker) setRestoreTarget(marker.target)
		}

		window.addEventListener('storage', handleStorage)
		return () => window.removeEventListener('storage', handleStorage)
	}, [databaseRestoreStorageKey])

	useEffect(() => {
		const job = databaseRestoreJob.data
		if (!job || restoreJobMarker?.target === job.target) return
		const exactMarker: DatabaseRestoreMarker = {
			jobId: job.jobId,
			target: job.target,
			recoveryStartedAt: restoreJobMarker?.recoveryStartedAt ?? null
		}
		setRestoreJobMarker(exactMarker)
		if (databaseRestoreStorageKey) {
			saveDatabaseRestoreMarker(databaseRestoreStorageKey, exactMarker)
		}
	}, [
		databaseRestoreJob.data,
		databaseRestoreStorageKey,
		restoreJobMarker?.recoveryStartedAt,
		restoreJobMarker?.target
	])

	useEffect(() => {
		const marker = restoreJobMarker
		const status = isAxiosError(databaseRestoreJob.error)
			? databaseRestoreJob.error.response?.status
			: undefined
		const recoveryStartedAt = marker?.recoveryStartedAt
			? Date.parse(marker.recoveryStartedAt)
			: Number.NaN
		const publicationGraceActive =
			status === 404 &&
			(databaseRestoreMutation.isPending ||
				(!Number.isNaN(recoveryStartedAt) &&
					Date.now() - recoveryStartedAt <
						DATABASE_RESTORE_PUBLICATION_GRACE_MS))
		if (
			!marker ||
			!databaseRestoreJob.isError ||
			(status !== 403 && status !== 404) ||
			databaseRestoreJob.data?.jobId === marker.jobId ||
			publicationGraceActive
		) {
			return
		}

		clearDatabaseRestoreMarker(databaseRestoreStorageKey, marker.jobId)
		setRestoreJobMarker(current =>
			current?.jobId === marker.jobId ? null : current
		)
		toast.error(
			'Задание восстановления больше недоступно. Проверьте журнал событий и состояние целевой БД.'
		)
	}, [
		databaseRestoreJob.error,
		databaseRestoreJob.data,
		databaseRestoreJob.isError,
		databaseRestoreStorageKey,
		databaseRestoreMutation.isPending,
		restoreJobMarker
	])

	useEffect(() => {
		const job = databaseRestoreJob.data
		if (
			!job ||
			!TERMINAL_DATABASE_RESTORE_JOB_STATUSES.has(job.status) ||
			notifiedRestoreJob.current === job.jobId
		) {
			return
		}

		notifiedRestoreJob.current = job.jobId
		if (job.status !== 'RECOVERY_REQUIRED') {
			clearDatabaseRestoreMarker(databaseRestoreStorageKey, job.jobId)
		}
		const targetLabel = getDatabaseRestoreTargetLabel(
			job.target,
			databaseRestoreSettings.data?.targets
		)

		if (job.status === 'SUCCEEDED') {
			toast.success(`БД ${targetLabel} успешно восстановлена`)
			return
		}

		if (job.status === 'CANCELLED') {
			toast.success(
				`Восстановление БД ${targetLabel} отменено до блокировки подключений`
			)
			return
		}

		if (job.status === 'RECOVERY_REQUIRED') {
			toast.error(
				`КРИТИЧНО: исход восстановления БД ${targetLabel} после начала изменений требует ручной проверки. Source и safety backup сохранены; не повторяйте restore автоматически и следуйте production runbook.`,
				{ duration: 15000 }
			)
			return
		}

		toast.error(
			`Восстановление БД ${targetLabel} завершилось с ошибкой: ${job.error?.message || 'неизвестная ошибка'}`
		)
	}, [
		databaseRestoreJob.data,
		databaseRestoreSettings.data?.targets,
		databaseRestoreStorageKey
	])

	useEffect(() => {
		const action = databaseRestoreJob.data?.recoveryActions[0]
		if (
			!action ||
			!['RESOLVED', 'BLOCKED', 'EXPIRED'].includes(action.status)
		) {
			return
		}
		const notificationKey = `${action.actionId}:${action.status}`
		if (notifiedRecoveryAction.current === notificationKey) return
		notifiedRecoveryAction.current = notificationKey

		if (action.status === 'RESOLVED') {
			toast.success(
				`Recovery ${DATABASE_RESTORE_RECOVERY_ACTION_LABELS[action.action]} завершён; writer fence проверен и снят.`
			)
			return
		}
		toast.error(
			`Recovery ${DATABASE_RESTORE_RECOVERY_ACTION_LABELS[action.action]}: ${DATABASE_RESTORE_RECOVERY_STATUS_LABELS[action.status]}${action.error ? ` — ${action.error}` : ''}`,
			{ duration: 15000 }
		)
	}, [databaseRestoreJob.data?.recoveryActions])

	if (isUserLoading) {
		return (
			<div className={styles.card}>
				<SkeletonLoader count={1} className="h-[52px]" />
				<SkeletonLoader count={1} className="h-[52px]" />
			</div>
		)
	}

	if (databaseRestoreSettings.isLoading) {
		return (
			<div className={styles.card}>
				<SkeletonLoader count={1} className="h-[52px]" />
				<SkeletonLoader count={1} className="h-[52px]" />
			</div>
		)
	}

	if (!databaseRestoreSettings.data) {
		return (
			<div className={styles.card}>
				<p className={styles.empty}>
					Не удалось загрузить настройки восстановления
					{databaseRestoreSettings.error
						? `: ${errorCatch(databaseRestoreSettings.error)}`
						: ''}
				</p>
			</div>
		)
	}

	const selectedTargetSettings = databaseRestoreSettings.data.targets.find(
		target => target.id === restoreTarget
	)
	const restoreJob = databaseRestoreJob.data
	const hasActiveRecoveryAction = Boolean(
		restoreJob?.recoveryActions.some(action =>
			['PENDING_APPROVAL', 'APPROVED', 'PROCESSING'].includes(
				action.status
			)
		)
	)
	const restoreJobErrorStatus = isAxiosError(databaseRestoreJob.error)
		? databaseRestoreJob.error.response?.status
		: undefined
	const restoreRecoveryStartedAt = restoreJobMarker?.recoveryStartedAt
		? Date.parse(restoreJobMarker.recoveryStartedAt)
		: Number.NaN
	const isRestorePublicationPending = Boolean(
		restoreJobMarker &&
		restoreJobErrorStatus === 404 &&
		(databaseRestoreMutation.isPending ||
			Number.isNaN(restoreRecoveryStartedAt) ||
			Date.now() - restoreRecoveryStartedAt <
				DATABASE_RESTORE_PUBLICATION_GRACE_MS)
	)
	const isRestorePublicationUnconfirmed = Boolean(
		restoreJobMarker &&
		restoreJob?.jobId === restoreJobMarker.jobId &&
		restoreJob.status === 'QUEUED' &&
		!restoreJob.publicationConfirmed
	)
	const isRestoreJobActive = Boolean(
		restoreJobMarker &&
		(!restoreJob ||
			!TERMINAL_DATABASE_RESTORE_JOB_STATUSES.has(restoreJob.status)) &&
		!isRestorePublicationUnconfirmed
	)
	const isRestoreBlockedByRecovery =
		restoreJob?.status === 'RECOVERY_REQUIRED'
	const isRestoreEnabled = databaseRestoreSettings.data.enabled
	const restoreApproval = databaseRestoreSettings.data.approved
	const isRestoreTargetApproved =
		!restoreApproval || restoreApproval.target === restoreTarget
	const canRetryRestorePublication = Boolean(
		isRestorePublicationUnconfirmed &&
		restoreApproval?.jobId === restoreJobMarker?.jobId &&
		restoreApproval.target === restoreJobMarker?.target &&
		restoreApproval.requestedById === userId
	)
	const isRestorePermitOwner = Boolean(
		restoreApproval && restoreApproval.requestedById === userId
	)
	const isRestoreStartAllowed = Boolean(
		(isRestoreEnabled && restoreApproval && isRestorePermitOwner) ||
		canRetryRestorePublication
	)
	const allowedFileExtension =
		databaseRestoreSettings.data.allowedFileExtension
	const maxFileSizeBytes = databaseRestoreSettings.data.maxFileSizeBytes

	const handleRestoreTargetChange = (
		event: ChangeEvent<HTMLSelectElement>
	) => {
		const target = event.target.value
		if (!isDatabaseRestoreTarget(target)) return
		if (restoreApproval && target !== restoreApproval.target) {
			toast.error(
				'Разовый production-допуск разрешает восстановление только одобренной БД.'
			)
			return
		}

		setRestoreTarget(target)
		setRestoreFile(null)
		setRestoreFileSha256(null)
		resetRestoreBackupProvenance()
		setRestoreConfirmation('')
		if (restoreFileInput.current) restoreFileInput.current.value = ''
	}

	const handleRestoreFileChange = async (
		event: ChangeEvent<HTMLInputElement>
	) => {
		const file = event.target.files?.[0] ?? null
		const request = restoreFileHashRequest.current + 1
		restoreFileHashRequest.current = request
		setRestoreFile(file)
		setRestoreFileSha256(null)
		resetRestoreBackupProvenance()
		setCreatedPermit(null)
		setIsRestoreFileHashing(false)

		if (!file) {
			return
		}
		if (!file.name.toLowerCase().endsWith(allowedFileExtension)) {
			toast.error(`Допустим только файл ${allowedFileExtension}`)
			return
		}
		if (file.size > maxFileSizeBytes) {
			toast.error(
				`Файл превышает допустимый размер ${formatFileSize(maxFileSizeBytes)}`
			)
			return
		}

		setIsRestoreFileHashing(true)
		try {
			const sha256 = await calculateFileSha256(file)
			if (restoreFileHashRequest.current !== request) return
			setRestoreFileSha256(sha256)
			toast.success('SHA-256 backup рассчитан в браузере')
		} catch (error) {
			if (restoreFileHashRequest.current !== request) return
			toast.error(`Не удалось рассчитать SHA-256: ${errorCatch(error)}`)
		} finally {
			if (restoreFileHashRequest.current === request) {
				setIsRestoreFileHashing(false)
			}
		}
	}

	const handleRestoreProvenanceChange = async (
		event: ChangeEvent<HTMLInputElement>
	) => {
		const input = event.currentTarget
		const file = input.files?.[0] ?? null
		setRestoreBackupProvenance(null)

		if (!file) return
		if (!restoreFile || !restoreFileSha256 || isRestoreFileHashing) {
			input.value = ''
			toast.error('Сначала выберите backup и дождитесь расчёта SHA-256')
			return
		}
		if (
			!file.name
				.toLowerCase()
				.endsWith(DATABASE_BACKUP_PROVENANCE_FILE_EXTENSION)
		) {
			input.value = ''
			toast.error(
				`Допустим только sidecar ${DATABASE_BACKUP_PROVENANCE_FILE_EXTENSION}`
			)
			return
		}
		if (
			file.size <= 0 ||
			file.size > DATABASE_BACKUP_PROVENANCE_MAX_FILE_SIZE_BYTES
		) {
			input.value = ''
			toast.error(
				'Размер provenance sidecar должен быть от 1 байта до 16 КБ'
			)
			return
		}

		try {
			const raw = new TextDecoder('utf-8', { fatal: true }).decode(
				await file.arrayBuffer()
			)
			const provenance = parseDatabaseBackupProvenance(raw, file.name)
			assertDatabaseBackupProvenanceMatches(
				provenance,
				restoreTarget,
				restoreFile,
				restoreFileSha256
			)
			setRestoreBackupProvenance(provenance)
			toast.success('Provenance sidecar совпадает с выбранным backup')
		} catch (error) {
			input.value = ''
			toast.error(`Sidecar отклонён: ${errorCatch(error)}`)
		}
	}

	const handleCreateRestorePermit = () => {
		if (!isDev) return
		if (!isRestoreEnabled) {
			toast.error('Создание one-shot permit отключено release-gate')
			return
		}
		if (restoreApproval) {
			toast.error(
				'Сначала используйте или закройте активный one-shot permit'
			)
			return
		}
		if (!restoreFile || !restoreFileSha256 || isRestoreFileHashing) {
			toast.error('Выберите backup и дождитесь расчёта SHA-256')
			return
		}
		if (!restoreBackupProvenance) {
			toast.error(
				'Выберите подписанный provenance sidecar для этого backup'
			)
			return
		}
		if (!selectedTargetSettings) {
			toast.error('Выберите целевую БД')
			return
		}

		try {
			assertDatabaseBackupProvenanceMatches(
				restoreBackupProvenance,
				restoreTarget,
				restoreFile,
				restoreFileSha256
			)
		} catch (error) {
			toast.error(errorCatch(error))
			return
		}

		const promise = databaseRestorePermitMutation.mutateAsync({
			target: restoreTarget,
			sourceSha256: restoreFileSha256,
			expectedServicesSha: databaseRestoreSettings.data.currentServicesSha,
			backupProvenance: restoreBackupProvenance.raw
		})
		void toast.promise(promise, {
			loading: 'Создаём one-shot permit...',
			success:
				'Permit создан. Передайте его ID второму DEV для независимого подтверждения.',
			error: error => `Не удалось создать permit: ${errorCatch(error)}`
		})
	}

	const handleApproveRestorePermit = () => {
		if (!isDev) return
		const permitId = permitApprovalId.trim()
		if (!permitId) {
			toast.error('Введите ID permit от первого DEV')
			return
		}
		if (
			createdPermit?.permitId === permitId &&
			createdPermit.requestedById === userId
		) {
			toast.error('Permit должен подтвердить другой DEV')
			return
		}

		const promise =
			databaseRestorePermitApprovalMutation.mutateAsync(permitId)
		void toast.promise(promise, {
			loading: 'Подтверждаем exact permit...',
			success: 'Permit подтверждён вторым DEV',
			error: error => `Не удалось подтвердить permit: ${errorCatch(error)}`
		})
	}

	const handleCopyPermitId = async () => {
		if (!createdPermit) return
		try {
			await navigator.clipboard.writeText(createdPermit.permitId)
			toast.success('ID permit скопирован')
		} catch (error) {
			toast.error(`Не удалось скопировать ID: ${errorCatch(error)}`)
		}
	}

	const handleLookupRestoreJob = () => {
		const jobId = restoreJobLookupId.trim().toLowerCase()
		if (!UUID_PATTERN.test(jobId)) {
			toast.error('Введите корректный UUID задания восстановления')
			return
		}
		const marker: DatabaseRestoreMarker = {
			jobId,
			target:
				restoreApproval?.jobId === jobId
					? restoreApproval.target
					: restoreTarget,
			recoveryStartedAt: null
		}
		notifiedRestoreJob.current = null
		notifiedRecoveryAction.current = null
		setRestoreJobMarker(marker)
		if (databaseRestoreStorageKey) {
			saveDatabaseRestoreMarker(databaseRestoreStorageKey, marker)
		}
		toast.success('Запрашиваем read-only статус задания')
	}

	const handleRestoreDatabaseBackup = () => {
		if (!isDev) return
		if (!isRestoreStartAllowed) {
			toast.error(
				'Нужен активный one-shot permit, созданный текущим DEV и подтверждённый другим DEV.'
			)
			return
		}
		if (!restoreApproval || restoreApproval.status !== 'APPROVED') {
			toast.error('One-shot permit не подтверждён')
			return
		}
		if (!isRestorePermitOwner) {
			toast.error('Запустить restore может только DEV, создавший permit')
			return
		}
		if (!selectedTargetSettings) {
			toast.error('Выберите целевую БД')
			return
		}
		if (!isRestoreTargetApproved) {
			toast.error(
				'Выбранная БД не соответствует разовому production-допуску.'
			)
			return
		}
		if (isRestoreJobActive) {
			toast.error('Дождитесь завершения текущего восстановления')
			return
		}
		if (isRestoreBlockedByRecovery) {
			toast.error(
				'Сначала проверьте целевую БД и сохранённые artifacts по production runbook, затем подтвердите критическое предупреждение.'
			)
			return
		}
		if (!restoreFile) {
			toast.error(`Выберите файл backup ${allowedFileExtension}`)
			return
		}
		if (!restoreFileSha256 || isRestoreFileHashing) {
			toast.error('Дождитесь расчёта SHA-256 выбранного backup')
			return
		}
		if (!restoreBackupProvenance) {
			toast.error(
				'Выберите подписанный provenance sidecar для этого backup'
			)
			return
		}
		if (!restoreFile.name.toLowerCase().endsWith(allowedFileExtension)) {
			toast.error(`Допустим только файл ${allowedFileExtension}`)
			return
		}
		if (restoreFile.size > maxFileSizeBytes) {
			toast.error(
				`Файл превышает допустимый размер ${formatFileSize(maxFileSizeBytes)}`
			)
			return
		}
		if (restoreFileSha256 !== restoreApproval.sourceSha256) {
			toast.error('SHA-256 файла не совпадает с exact permit')
			return
		}
		try {
			assertDatabaseBackupProvenanceMatches(
				restoreBackupProvenance,
				restoreTarget,
				restoreFile,
				restoreFileSha256
			)
		} catch (error) {
			toast.error(errorCatch(error))
			return
		}
		if (restoreFile.size !== restoreApproval.sourceSize) {
			toast.error('Размер backup не совпадает с exact permit')
			return
		}
		if (
			restoreBackupProvenance.backupJobId !==
			restoreApproval.sourceBackupJobId
		) {
			toast.error('Backup job ID sidecar не совпадает с exact permit')
			return
		}
		if (
			restoreBackupProvenance.envelopeSha256 !==
			restoreApproval.backupProvenanceEnvelopeSha256
		) {
			toast.error('Envelope SHA-256 sidecar не совпадает с exact permit')
			return
		}
		if (
			restoreBackupProvenance.keyId !==
			restoreApproval.backupProvenanceKeyId
		) {
			toast.error('Provenance key ID не совпадает с exact permit')
			return
		}
		if (
			restoreApproval.expectedServicesSha !==
			databaseRestoreSettings.data.currentServicesSha
		) {
			toast.error('Версия Operations изменилась после выдачи permit')
			return
		}
		if (
			restoreApproval.migrationManifestSha !==
			selectedTargetSettings.migrationManifestSha
		) {
			toast.error('Migration manifest изменился после выдачи permit')
			return
		}
		if (
			restoreConfirmation.trim() !== selectedTargetSettings.confirmation
		) {
			toast.error(
				`Введите точную контрольную фразу для БД ${selectedTargetSettings.label}`
			)
			return
		}

		const requestId = restoreApproval.jobId
		const requestMarker: DatabaseRestoreMarker = {
			jobId: requestId,
			target: restoreTarget,
			recoveryStartedAt: null
		}
		notifiedRestoreJob.current = null
		setRestoreJobMarker(requestMarker)
		if (databaseRestoreStorageKey) {
			saveDatabaseRestoreMarker(databaseRestoreStorageKey, requestMarker)
		}
		const promise = databaseRestoreMutation.mutateAsync({
			target: restoreTarget,
			file: restoreFile,
			confirmation: restoreConfirmation.trim(),
			requestId
		})

		toast.promise(promise, {
			loading: `Загружаем backup БД ${selectedTargetSettings.label}...`,
			success: `Восстановление БД ${selectedTargetSettings.label} поставлено в очередь`,
			error: error =>
				isAxiosError(error) &&
				(error.response?.status === undefined ||
					error.response.status >= 500)
					? 'Ответ не подтверждён; интерфейс продолжает точную проверку по requestId.'
					: `Ошибка запуска восстановления: ${errorCatch(error)}`
		})
	}

	const handleCreateRecoveryAction = () => {
		if (!isDev || !restoreJob) return
		if (
			restoreJob.status !== 'RECOVERY_REQUIRED' ||
			restoreJob.recoveryResolvedAt
		) {
			toast.error('Это задание не требует нового recovery action')
			return
		}
		if (!restoreJob.terminalReceipt) {
			toast.error('Recovery невозможен без подписанного terminal receipt')
			return
		}

		const promise = databaseRestoreRecoveryMutation.mutateAsync({
			jobId: restoreJob.jobId,
			action: recoveryAction
		})
		void toast.promise(promise, {
			loading: 'Создаём recovery action...',
			success:
				'Recovery action создан. Выполнение начнётся только после подтверждения другим DEV.',
			error: error =>
				`Не удалось создать recovery action: ${errorCatch(error)}`
		})
	}

	const handleApproveRecoveryAction = (
		action: DatabaseRestoreRecoveryAction
	) => {
		if (!isDev || !restoreJob) return
		if (action.status !== 'PENDING_APPROVAL') {
			toast.error('Recovery action уже обработан')
			return
		}
		if (action.requestedById === userId) {
			toast.error('Recovery action должен подтвердить другой DEV')
			return
		}

		const promise = databaseRestoreRecoveryApprovalMutation.mutateAsync({
			jobId: restoreJob.jobId,
			actionId: action.actionId
		})
		void toast.promise(promise, {
			loading: 'Подтверждаем recovery action...',
			success: 'Recovery action подтверждён и поставлен в durable очередь',
			error: error =>
				`Не удалось подтвердить recovery action: ${errorCatch(error)}`
		})
	}

	const handleClearRestoreJob = () => {
		if (
			!restoreJob ||
			!TERMINAL_DATABASE_RESTORE_JOB_STATUSES.has(restoreJob.status)
		) {
			return
		}
		clearDatabaseRestoreMarker(databaseRestoreStorageKey, restoreJob.jobId)
		setRestoreJobMarker(null)
		if (restoreJob.status === 'RECOVERY_REQUIRED') {
			if (restoreJob.recoveryResolvedAt) {
				toast.success('Разрешённое recovery-задание скрыто')
				return
			}
			toast.error(
				'Предупреждение скрыто только в интерфейсе. Неопределённый исход restore и сохранённые artifacts этим действием не разрешаются.',
				{ duration: 10000 }
			)
			return
		}
		toast.success('Завершённое задание скрыто')
	}

	const handleCancelRestoreJob = () => {
		if (
			!isDev ||
			!restoreJob?.canCancel ||
			restoreJob.cancellationRequested ||
			databaseRestoreCancelMutation.isPending
		) {
			return
		}

		const promise = databaseRestoreCancelMutation.mutateAsync(
			restoreJob.jobId
		)
		void toast.promise(promise, {
			loading: 'Фиксируем отмену до начала блокировки БД...',
			success: 'Отмена принята. Worker завершит задание без изменения БД.',
			error: error =>
				`Не удалось отменить восстановление: ${errorCatch(error)}`
		})
	}

	return (
		<div className={styles.card}>
			<div>
				<h2 className={styles.panelTitle}>
					Восстановление из резервной копии
				</h2>
				<p className={styles.hint}>
					Восстановление заменяет данные только выбранной базы. Для запуска
					нужны проверенная копия и подтверждение двух разных DEV. Все
					действия и результат сохраняются в Журнале событий.
				</p>
			</div>

			<details className={styles.technicalDetails}>
				<summary>Техническая готовность и проверяемые версии</summary>
				<div className={styles.restoreContractGrid}>
					<div>
						<p className={styles.statusLabel}>Release-gate</p>
						<span
							className={`${styles.badge} ${isRestoreEnabled ? styles.badgeOk : styles.badgeNeutral}`}
						>
							{isRestoreEnabled ? 'Включён' : 'Отключён'}
						</span>
					</div>
					<div>
						<p className={styles.statusLabel}>Services revision</p>
						<code className={styles.hashValue}>
							{databaseRestoreSettings.data.currentServicesSha}
						</code>
					</div>
					<div>
						<p className={styles.statusLabel}>Авторизация</p>
						<p className={styles.statusValue}>Два разных DEV</p>
					</div>
				</div>

				<div className={styles.restoreManifestList}>
					{databaseRestoreSettings.data.targets.map(target => (
						<div key={target.id}>
							<p className={styles.statusLabel}>{target.label}</p>
							<code className={styles.hashValue}>
								{target.migrationManifestSha}
							</code>
						</div>
					))}
				</div>
			</details>

			{!isRestoreEnabled && !canRetryRestorePublication && (
				<p className={styles.restoreAvailability} role="status">
					Восстановление пока недоступно: сначала необходимо завершить
					проверки безопасности. Уже созданные задания и их статусы
					остаются доступны ниже.
				</p>
			)}
			{canRetryRestorePublication && (
				<p className={styles.restoreApproval} role="status">
					Manifest задания сохранён, но публикация ещё не подтверждена.
					Повторно выберите тот же backup и его provenance sidecar, затем
					отправьте файл с тем же jobId; worker не начнёт восстановление до
					подписанного подтверждения.
				</p>
			)}
			{restoreApproval && (
				<div className={styles.restoreApproval} role="status">
					<p>
						Разовый production-допуск: БД{' '}
						<b>
							{getDatabaseRestoreTargetLabel(
								restoreApproval.target,
								databaseRestoreSettings.data.targets
							)}
						</b>
						, действует до{' '}
						<b>{formatRestoreJobDate(restoreApproval.expiresAt)}</b>.
					</p>
					<details className={styles.technicalDetails}>
						<summary>Идентификаторы и контрольные суммы допуска</summary>
						<div className={styles.exactBindingGrid}>
							<div>
								<p className={styles.statusLabel}>jobId</p>
								<code className={styles.hashValue}>
									{restoreApproval.jobId}
								</code>
							</div>
							<div>
								<p className={styles.statusLabel}>Source SHA-256</p>
								<code className={styles.hashValue}>
									{restoreApproval.sourceSha256}
								</code>
							</div>
							<div>
								<p className={styles.statusLabel}>Source size</p>
								<p className={styles.statusValue}>
									{formatFileSize(restoreApproval.sourceSize)}
								</p>
							</div>
							<div>
								<p className={styles.statusLabel}>Backup job ID</p>
								<code className={styles.hashValue}>
									{restoreApproval.sourceBackupJobId}
								</code>
							</div>
							<div>
								<p className={styles.statusLabel}>Provenance key</p>
								<code className={styles.hashValue}>
									{restoreApproval.backupProvenanceKeyId}
								</code>
							</div>
							<div>
								<p className={styles.statusLabel}>Provenance envelope</p>
								<code className={styles.hashValue}>
									{restoreApproval.backupProvenanceEnvelopeSha256}
								</code>
							</div>
							<div>
								<p className={styles.statusLabel}>Migration manifest</p>
								<code className={styles.hashValue}>
									{restoreApproval.migrationManifestSha}
								</code>
							</div>
						</div>
					</details>
					{isDev && !isRestorePermitOwner && (
						<p className={styles.hint}>
							Этот permit виден read-only. Загрузить dump может только DEV,
							который создал permit.
						</p>
					)}
				</div>
			)}

			{isDev ? (
				<div className={styles.restoreMutationPanel}>
					<div>
						<p className={styles.label}>
							1. Выберите копию и запросите допуск
						</p>
						<p className={styles.hint}>
							Выберите базу, файл копии и файл подписи, полученный вместе с
							ней. Система проверит контрольную сумму, подпись и
							совместимость копии перед выдачей допуска.
						</p>
					</div>
					<div className={styles.permitGrid}>
						<label className={styles.fieldLabel}>
							<span>Целевая БД</span>
							<select
								className={styles.select}
								value={restoreTarget}
								onChange={handleRestoreTargetChange}
								disabled={
									databaseRestorePermitMutation.isPending ||
									databaseRestoreMutation.isPending ||
									Boolean(restoreApproval) ||
									isRestoreJobActive ||
									isRestoreBlockedByRecovery
								}
							>
								{databaseRestoreSettings.data.targets.map(target => (
									<option key={target.id} value={target.id}>
										{target.label}
									</option>
								))}
							</select>
						</label>
						<label className={styles.fileInputLabel}>
							<span>Файл {allowedFileExtension}</span>
							<input
								ref={restoreFileInput}
								type="file"
								accept={allowedFileExtension}
								onChange={handleRestoreFileChange}
								disabled={
									databaseRestorePermitMutation.isPending ||
									databaseRestoreMutation.isPending ||
									Boolean(restoreApproval && !isRestorePermitOwner) ||
									isRestoreJobActive ||
									isRestoreBlockedByRecovery
								}
							/>
						</label>
						<label className={styles.fileInputLabel}>
							<span>
								Sidecar {DATABASE_BACKUP_PROVENANCE_FILE_EXTENSION}
							</span>
							<input
								ref={restoreProvenanceInput}
								type="file"
								accept={DATABASE_BACKUP_PROVENANCE_FILE_EXTENSION}
								onChange={handleRestoreProvenanceChange}
								disabled={
									databaseRestorePermitMutation.isPending ||
									databaseRestoreMutation.isPending ||
									!restoreFileSha256 ||
									isRestoreFileHashing ||
									Boolean(restoreApproval && !isRestorePermitOwner) ||
									isRestoreJobActive ||
									isRestoreBlockedByRecovery
								}
							/>
						</label>
						<button
							type="button"
							className={styles.actionBtn}
							onClick={handleCreateRestorePermit}
							disabled={
								databaseRestorePermitMutation.isPending ||
								!isRestoreEnabled ||
								Boolean(restoreApproval) ||
								!restoreFileSha256 ||
								isRestoreFileHashing ||
								!restoreBackupProvenance
							}
						>
							{databaseRestorePermitMutation.isPending
								? 'Создаём...'
								: 'Запросить допуск'}
						</button>
					</div>
					<p className={styles.hint}>
						Максимальный размер: {formatFileSize(maxFileSizeBytes)}.
						{isRestoreFileHashing && ' Вычисляем SHA-256...'}
						{restoreFile && ` Выбран файл ${restoreFile.name}.`}
						{restoreBackupProvenance &&
							` Sidecar ${restoreBackupProvenance.fileName} совпадает.`}
					</p>
					{restoreFileSha256 && (
						<details className={styles.technicalDetails}>
							<summary>Контрольная сумма выбранного файла</summary>
							<code className={styles.hashValue}>{restoreFileSha256}</code>
						</details>
					)}
					{restoreBackupProvenance && (
						<details className={styles.technicalDetails}>
							<summary>Подпись и происхождение копии</summary>
							<div className={styles.exactBindingGrid}>
								<div>
									<p className={styles.statusLabel}>Backup job ID</p>
									<code className={styles.hashValue}>
										{restoreBackupProvenance.backupJobId}
									</code>
								</div>
								<div>
									<p className={styles.statusLabel}>Provenance key</p>
									<code className={styles.hashValue}>
										{restoreBackupProvenance.keyId}
									</code>
								</div>
								<div>
									<p className={styles.statusLabel}>Envelope SHA-256</p>
									<code className={styles.hashValue}>
										{restoreBackupProvenance.envelopeSha256}
									</code>
								</div>
							</div>
						</details>
					)}

					{createdPermit && (
						<div className={styles.pendingPermit} role="status">
							<div>
								<p className={styles.statusLabel}>Permit ID</p>
								<code className={styles.hashValue}>
									{createdPermit.permitId}
								</code>
							</div>
							<p className={styles.hint}>
								Статус: <b>{createdPermit.status}</b>; действует до{' '}
								<b>{formatRestoreJobDate(createdPermit.expiresAt)}</b>.
							</p>
							<button
								type="button"
								className={styles.secondaryBtn}
								onClick={() => void handleCopyPermitId()}
							>
								Скопировать ID для второго DEV
							</button>
						</div>
					)}

					<div>
						<p className={styles.label}>2. Независимое подтверждение</p>
						<p className={styles.hint}>
							Второй DEV вставляет полученный ID. Backend определяет
							пользователя из текущей сессии и запрещает self-approval.
						</p>
					</div>
					<div className={styles.approvalGrid}>
						<label className={styles.fieldLabel}>
							<span>ID permit</span>
							<input
								className={styles.input}
								value={permitApprovalId}
								onChange={event => setPermitApprovalId(event.target.value)}
								placeholder="UUID от первого DEV"
								disabled={
									databaseRestorePermitApprovalMutation.isPending ||
									Boolean(restoreApproval)
								}
							/>
						</label>
						<button
							type="button"
							className={styles.actionBtn}
							onClick={handleApproveRestorePermit}
							disabled={
								databaseRestorePermitApprovalMutation.isPending ||
								Boolean(restoreApproval) ||
								!permitApprovalId.trim()
							}
						>
							{databaseRestorePermitApprovalMutation.isPending
								? 'Подтверждаем...'
								: 'Подтвердить допуск'}
						</button>
					</div>

					<div>
						<p className={styles.label}>3. Подтвердите восстановление</p>
						<p className={styles.hint}>
							Запуск доступен создателю допуска только для той же базы и
							проверенной копии. Изменение файла или версии сервиса требует
							нового допуска.
						</p>
					</div>
					<div className={styles.restoreExecutionGrid}>
						<label className={styles.fieldLabel}>
							<span>Контрольная фраза</span>
							<input
								className={styles.input}
								value={restoreConfirmation}
								onChange={event =>
									setRestoreConfirmation(event.target.value)
								}
								placeholder={selectedTargetSettings?.confirmation}
								disabled={
									databaseRestoreMutation.isPending ||
									!isRestoreStartAllowed ||
									!isRestoreTargetApproved ||
									isRestoreJobActive ||
									isRestoreBlockedByRecovery
								}
							/>
						</label>
						<button
							type="button"
							className={styles.dangerBtn}
							onClick={handleRestoreDatabaseBackup}
							disabled={
								databaseRestoreMutation.isPending ||
								!isRestoreStartAllowed ||
								!isRestoreTargetApproved ||
								!restoreFileSha256 ||
								isRestoreFileHashing ||
								!restoreBackupProvenance ||
								isRestoreJobActive ||
								isRestoreBlockedByRecovery
							}
						>
							{canRetryRestorePublication
								? 'Подтвердить публикацию повторно'
								: 'Поставить в очередь'}
						</button>
					</div>
					<p className={styles.hint}>
						Для БД <b>{selectedTargetSettings?.label}</b> введите:{' '}
						<b>{selectedTargetSettings?.confirmation}</b>.
					</p>
				</div>
			) : (
				<div
					className={`${styles.restoreMutationPanel} ${styles.lockedCard}`}
					aria-disabled="true"
				>
					<div className={styles.lockedContent} aria-hidden="true">
						<p className={styles.label}>DEV-only действия</p>
						<div className={styles.permitGrid}>
							<select className={styles.select} disabled>
								<option>БД микросервиса</option>
							</select>
							<label className={styles.fileInputLabel}>
								<span>Файл .dump</span>
								<input type="file" accept=".dump" disabled />
							</label>
							<label className={styles.fileInputLabel}>
								<span>Sidecar .provenance.json</span>
								<input type="file" accept=".provenance.json" disabled />
							</label>
							<button type="button" className={styles.dangerBtn} disabled>
								Создать permit
							</button>
						</div>
					</div>
					<div className={styles.lockedOverlay}>
						<span className={styles.lockedBadge}>Только для DEV</span>
						<AdminTooltip
							title="Изменяющие действия заблокированы"
							description="ADMIN может просматривать настройки и задания. Запрос и подтверждение допуска, загрузка копии, отмена и восстановление после сбоя доступны только DEV. Сервер отдельно проверяет права."
						/>
					</div>
				</div>
			)}

			<div className={styles.restoreLookupPanel}>
				<div>
					<p className={styles.label}>Статус существующего задания</p>
					<p className={styles.hint}>
						Введите UUID задания, чтобы посмотреть его состояние. Проверка
						не меняет данные и не запускает восстановление.
					</p>
				</div>
				<div className={styles.approvalGrid}>
					<label className={styles.fieldLabel}>
						<span>Job ID</span>
						<input
							className={styles.input}
							value={restoreJobLookupId}
							onChange={event => setRestoreJobLookupId(event.target.value)}
							placeholder="UUID задания"
						/>
					</label>
					<button
						type="button"
						className={styles.secondaryBtn}
						onClick={handleLookupRestoreJob}
						disabled={!restoreJobLookupId.trim()}
					>
						Показать статус
					</button>
				</div>
			</div>
			{restoreJobMarker && (
				<div className={styles.restoreStatus} aria-live="polite">
					<div className={styles.restoreStatusHeader}>
						<div>
							<p className={styles.statusLabel}>Последнее задание</p>
							<p className={styles.statusValue}>
								{getDatabaseRestoreTargetLabel(
									restoreJob?.target ?? restoreJobMarker.target,
									databaseRestoreSettings.data.targets
								)}
							</p>
						</div>
						{restoreJob && (
							<span
								className={`${styles.badge} ${restoreJob.recoveryResolvedAt ? styles.badgeOk : getDatabaseRestoreJobBadgeClass(restoreJob.status)}`}
							>
								{restoreJob.recoveryResolvedAt
									? 'Recovery разрешён'
									: DATABASE_RESTORE_JOB_STATUS_LABELS[restoreJob.status]}
							</span>
						)}
					</div>

					{restoreJob ? (
						<>
							<div className={styles.restoreStatusGrid}>
								<div>
									<p className={styles.statusLabel}>Файл</p>
									<p className={styles.statusValue}>
										{restoreJob.originalFileName} ·{' '}
										{formatFileSize(restoreJob.fileSize)}
									</p>
								</div>
								<div>
									<p className={styles.statusLabel}>Запрошено</p>
									<p className={styles.statusValue}>
										{formatRestoreJobDate(restoreJob.requestedAt)}
									</p>
								</div>
								<div>
									<p className={styles.statusLabel}>Завершено</p>
									<p className={styles.statusValue}>
										{formatRestoreJobDate(restoreJob.finishedAt)}
									</p>
								</div>
							</div>
							<details className={styles.technicalDetails}>
								<summary>Технические данные задания</summary>
								<div className={styles.exactBindingGrid}>
									<div>
										<p className={styles.statusLabel}>Backup job ID</p>
										<code className={styles.hashValue}>
											{restoreJob.sourceBackupJobId}
										</code>
									</div>
									<div>
										<p className={styles.statusLabel}>Provenance key</p>
										<code className={styles.hashValue}>
											{restoreJob.backupProvenanceKeyId}
										</code>
									</div>
									<div>
										<p className={styles.statusLabel}>
											Provenance envelope
										</p>
										<code className={styles.hashValue}>
											{restoreJob.backupProvenanceEnvelopeSha256}
										</code>
									</div>
								</div>
							</details>
							{restoreJob.error && (
								<p className={styles.restoreError}>
									{restoreJob.error.code}: {restoreJob.error.message}
								</p>
							)}
							{restoreJob.status === 'RECOVERY_REQUIRED' && (
								<div className={styles.recoveryPanel}>
									<div
										className={
											restoreJob.recoveryResolvedAt
												? styles.recoveryResolved
												: styles.recoveryWarning
										}
										role={
											restoreJob.recoveryResolvedAt ? 'status' : 'alert'
										}
									>
										<strong>
											{restoreJob.recoveryResolvedAt
												? 'Recovery завершён.'
												: 'Критическое состояние.'}
										</strong>{' '}
										{restoreJob.recoveryResolvedAt
											? 'Exact-проверки пройдены, writer fence безопасно снят, resolution receipt подписан.'
											: 'Terminal outcome исходного restore не доказан. Выберите ровно один recovery action; выполнение начнётся только после подтверждения другим DEV.'}
									</div>

									{restoreJob.terminalReceipt && (
										<details className={styles.technicalDetails}>
											<summary>
												Проверки результата и страховочной копии
											</summary>
											<div className={styles.receiptGrid}>
												<div>
													<p className={styles.statusLabel}>
														Terminal receipt
													</p>
													<code className={styles.hashValue}>
														{restoreJob.terminalReceipt.payloadSha256}
													</code>
												</div>
												<div>
													<p className={styles.statusLabel}>
														Safety backup
													</p>
													<code className={styles.hashValue}>
														{restoreJob.terminalReceipt
															.safetyBackupSha256 ?? 'не создан'}
													</code>
												</div>
												<div>
													<p className={styles.statusLabel}>Source size</p>
													<p className={styles.statusValue}>
														{formatFileSize(
															restoreJob.terminalReceipt.sourceSize
														)}
													</p>
												</div>
												<div>
													<p className={styles.statusLabel}>
														Backup job ID
													</p>
													<code className={styles.hashValue}>
														{restoreJob.terminalReceipt.sourceBackupJobId}
													</code>
												</div>
												<div>
													<p className={styles.statusLabel}>
														Provenance key
													</p>
													<code className={styles.hashValue}>
														{
															restoreJob.terminalReceipt
																.backupProvenanceKeyId
														}
													</code>
												</div>
												<div>
													<p className={styles.statusLabel}>
														Provenance envelope
													</p>
													<code className={styles.hashValue}>
														{
															restoreJob.terminalReceipt
																.backupProvenanceEnvelopeSha256
														}
													</code>
												</div>
												<div>
													<p className={styles.statusLabel}>
														Signature key
													</p>
													<code className={styles.hashValue}>
														{restoreJob.terminalReceipt.signatureKeyId}
													</code>
												</div>
											</div>
										</details>
									)}

									{restoreJob.recoveryActions.map(action => (
										<div
											key={action.actionId}
											className={styles.recoveryActionCard}
										>
											<div className={styles.restoreStatusHeader}>
												<div>
													<p className={styles.statusLabel}>
														Recovery action
													</p>
													<p className={styles.statusValue}>
														{
															DATABASE_RESTORE_RECOVERY_ACTION_LABELS[
																action.action
															]
														}
													</p>
												</div>
												<span
													className={`${styles.badge} ${getDatabaseRestoreRecoveryBadgeClass(action.status)}`}
												>
													{
														DATABASE_RESTORE_RECOVERY_STATUS_LABELS[
															action.status
														]
													}
												</span>
											</div>
											<div className={styles.recoveryMetaGrid}>
												<p>
													Фаза: <b>{action.phase ?? '—'}</b>
												</p>
												<p>
													Попытки: <b>{action.attempts}</b>
												</p>
												<p>
													Writer fence:{' '}
													<b>
														{action.writerFenceReleasedAt
															? 'снят'
															: action.writerFenceAppliedAt
																? 'активен'
																: 'не применён'}
													</b>
												</p>
											</div>
											<code className={styles.hashValue}>
												{action.actionId}
											</code>
											{action.error && (
												<p className={styles.restoreError}>
													{action.error}
												</p>
											)}
											{isDev &&
												action.status === 'PENDING_APPROVAL' &&
												action.requestedById !== userId && (
													<button
														type="button"
														className={styles.dangerBtn}
														onClick={() =>
															handleApproveRecoveryAction(action)
														}
														disabled={
															databaseRestoreRecoveryApprovalMutation.isPending
														}
													>
														Подтвердить вторым DEV
													</button>
												)}
											{isDev &&
												action.status === 'PENDING_APPROVAL' &&
												action.requestedById === userId && (
													<p className={styles.hint}>
														Ожидается подтверждение другого DEV.
													</p>
												)}
										</div>
									))}

									{restoreJob.recoveryResolutionReceipt && (
										<details className={styles.technicalDetails}>
											<summary>
												Подтверждение завершённого восстановления
											</summary>
											<div className={styles.resolutionReceipt}>
												<p className={styles.label}>Resolution receipt</p>
												<code className={styles.hashValue}>
													{
														restoreJob.recoveryResolutionReceipt
															.payloadSha256
													}
												</code>
												<p className={styles.hint}>
													Разрешено:{' '}
													{formatRestoreJobDate(
														restoreJob.recoveryResolvedAt
													)}
													; artifacts хранятся до{' '}
													{formatRestoreJobDate(
														restoreJob.artifactRetainUntil
													)}
													.
												</p>
											</div>
										</details>
									)}

									{!restoreJob.recoveryResolvedAt &&
										(isDev ? (
											<div className={styles.recoveryMutationGrid}>
												<label className={styles.fieldLabel}>
													<span>Новый recovery action</span>
													<select
														className={styles.select}
														value={recoveryAction}
														onChange={event =>
															setRecoveryAction(
																event.target
																	.value as DatabaseRestoreRecoveryActionType
															)
														}
														disabled={
															hasActiveRecoveryAction ||
															databaseRestoreRecoveryMutation.isPending
														}
													>
														{DATABASE_RESTORE_RECOVERY_ACTIONS.map(
															action => (
																<option key={action} value={action}>
																	{
																		DATABASE_RESTORE_RECOVERY_ACTION_LABELS[
																			action
																		]
																	}
																</option>
															)
														)}
													</select>
												</label>
												<button
													type="button"
													className={styles.dangerBtn}
													onClick={handleCreateRecoveryAction}
													disabled={
														hasActiveRecoveryAction ||
														databaseRestoreRecoveryMutation.isPending ||
														!restoreJob.terminalReceipt
													}
												>
													Создать recovery action
												</button>
											</div>
										) : (
											<p className={styles.hint}>
												Recovery-действия доступны только DEV; ADMIN видит
												их статус read-only.
											</p>
										))}
								</div>
							)}
							{restoreJob.cancellationRequested &&
								restoreJob.status !== 'CANCELLED' && (
									<p className={styles.hint}>
										Отмена зафиксирована. Worker ещё не начинал блокировку
										БД и завершит задание безопасно.
									</p>
								)}
							{restoreJob.cancellationPending && (
								<p className={styles.hint}>
									Worker приостановлен: отмена зарезервирована и ожидает
									обязательной записи в Журнал событий.
								</p>
							)}
							{isDev &&
								restoreJob.canCancel &&
								!restoreJob.cancellationRequested && (
									<button
										type="button"
										className={styles.secondaryBtn}
										onClick={handleCancelRestoreJob}
										disabled={databaseRestoreCancelMutation.isPending}
									>
										{databaseRestoreCancelMutation.isPending
											? 'Отменяем...'
											: 'Отменить до блокировки БД'}
									</button>
								)}
							{TERMINAL_DATABASE_RESTORE_JOB_STATUSES.has(
								restoreJob.status
							) && (
								<button
									type="button"
									className={styles.secondaryBtn}
									onClick={handleClearRestoreJob}
								>
									{restoreJob.status === 'RECOVERY_REQUIRED'
										? restoreJob.recoveryResolvedAt
											? 'Скрыть разрешённое recovery-задание'
											: 'Подтвердить предупреждение и скрыть'
										: 'Скрыть завершённое задание'}
								</button>
							)}
						</>
					) : isRestorePublicationPending ? (
						<p className={styles.hint}>
							Запрос отправлен. Ожидаем появление подписанного задания по
							точному requestId; повторно загружать backup не нужно.
						</p>
					) : databaseRestoreJob.isError ? (
						<p className={styles.restoreError}>
							Не удалось получить статус:{' '}
							{errorCatch(databaseRestoreJob.error)}
						</p>
					) : (
						<p className={styles.hint}>Проверяем состояние задания...</p>
					)}
				</div>
			)}
		</div>
	)
}

const AdminDatabases: NextPage = () => {
	const { user, isLoading: isUserLoading } = useUser()
	const isDev = Boolean(user?.rights?.includes(UserRole.DEV))
	const [selectedTarget, setSelectedTarget] =
		useState<TelegramDatabaseBackupTarget>('notification-delivery')
	const settingsQuery = useQuery({
		queryKey: SETTINGS_QUERY_KEY,
		queryFn: adminTelegramBotService.get
	})
	const { data: settings, isLoading } = settingsQuery
	const databaseBackupOverview = useQuery({
		queryKey: DATABASE_BACKUP_OVERVIEW_QUERY_KEY,
		queryFn: adminTelegramBotService.getDatabaseBackupOverview,
		refetchInterval: 30_000
	})
	const databaseBackupOverviewByTarget = new Map(
		databaseBackupOverview.data?.items.map(item => [item.target, item]) ??
			[]
	)
	const activeBackups =
		databaseBackupOverview.data?.items.filter(
			item =>
				item.latest &&
				['QUEUED', 'PROCESSING'].includes(item.latest.status)
		) ?? []
	const selectTarget = (target: TelegramDatabaseBackupTarget) => {
		setSelectedTarget(target)
		toast.success('Выбрана ' + getDatabaseBackupTargetLabel(target), {
			id: 'database-backup-target',
			duration: 1800
		})
	}
	const settingsUnavailable = isLoading ? (
		<div className={styles.card}>
			<SkeletonLoader count={1} className="h-[64px]" />
			<SkeletonLoader count={1} className="h-[100px]" />
		</div>
	) : (
		<div className={styles.card} role="alert">
			<p className={styles.label}>
				Не удалось загрузить настройки резервных копий
			</p>
			<p className={styles.hint}>
				Создание копий недоступно до получения актуальных настроек. История
				и уже созданные задания остаются в своих разделах.
			</p>
			<button
				type="button"
				className={styles.secondaryBtn}
				disabled={settingsQuery.isFetching}
				onClick={() => {
					toast.success('Повторно проверяем настройки', {
						id: 'database-settings-retry'
					})
					void settingsQuery.refetch()
				}}
			>
				Повторить загрузку
			</button>
		</div>
	)

	return (
		<section className={styles.wrapper}>
			<Heading text="Панель администратора" />
			<AdminNavigation />
			<AdminSectionHeading
				text="Базы данных"
				title="Резервные копии и восстановление"
				description="Создавайте копии отдельных баз, проверяйте историю и расписание. Восстановление вынесено в отдельный защищённый раздел."
				risk="medium"
				riskText="Копии отправляются в настроенный чат Telegram. Создание копии не изменяет рабочую базу."
			/>
			<DatabaseSections
				panels={{
					overview: (
						<>
							<div className={styles.card}>
								<div className={styles.overviewHeading}>
									<div>
										<h2 className={styles.panelTitle}>Резервные копии</h2>
										<p className={styles.hint}>
											Выберите базу для проверки состояния или создания
											копии. История объединяет задания всех баз.
										</p>
									</div>
									<span className={styles.summaryCount}>
										{DATABASE_BACKUP_TARGET_OPTIONS.length} баз
									</span>
								</div>
								<label className={styles.fieldLabel}>
									<span>База данных</span>
									<select
										className={styles.select}
										value={selectedTarget}
										onChange={event =>
											selectTarget(
												event.target.value as TelegramDatabaseBackupTarget
											)
										}
									>
										{DATABASE_BACKUP_TARGET_OPTIONS.map(target => (
											<option key={target} value={target}>
												{getDatabaseBackupTargetLabel(target)}
											</option>
										))}
									</select>
								</label>
								{activeBackups.length > 0 && (
									<div className={styles.activeBackups} role="status">
										<p className={styles.label}>Незавершённые задания</p>
										<div className={styles.activeBackupLinks}>
											{activeBackups.map(item => (
												<button
													key={item.target}
													type="button"
													className={styles.secondaryBtn}
													onClick={() => selectTarget(item.target)}
												>
													{getDatabaseBackupTargetLabel(item.target)} ·{' '}
													{
														DATABASE_BACKUP_JOB_STATUS_LABELS[
															item.latest!.status
														]
													}
												</button>
											))}
										</div>
									</div>
								)}
							</div>
							{settings
								? DATABASE_BACKUP_TARGET_OPTIONS.map(target => (
										<div
											key={target}
											className={styles.targetPanel}
											hidden={selectedTarget !== target}
										>
											<DatabaseBackupPanel
												target={target}
												overviewError={databaseBackupOverview.error}
												overviewItem={
													databaseBackupOverviewByTarget.get(target) ??
													null
												}
												overviewLoading={databaseBackupOverview.isLoading}
												title={getDatabaseBackupTargetLabel(target)}
												description="Отдельная резервная копия базы выбранного сервиса."
												scheduleTimeLabel={
													settings[DATABASE_BACKUP_SCHEDULE_FIELDS[target]]
												}
												settings={settings}
												userId={user?.id}
											/>
										</div>
									))
								: settingsUnavailable}
						</>
					),
					history: <DatabaseBackupHistory />,
					schedule: settings ? (
						<div className={styles.card}>
							<div className={styles.overviewHeading}>
								<div>
									<h2 className={styles.panelTitle}>
										Расписание копирования
									</h2>
									<p className={styles.hint}>
										Время указано по Москве. Копии создаются отдельно для
										каждой базы и отправляются в Telegram.
									</p>
								</div>
								<span
									className={
										styles.badge +
										' ' +
										(settings.databaseBackupEnabled
											? styles.badgeOk
											: styles.badgeNeutral)
									}
								>
									{settings.databaseBackupEnabled
										? 'Включено'
										: 'Выключено'}
								</span>
							</div>
							<ul className={styles.scheduleList}>
								{DATABASE_BACKUP_TARGET_OPTIONS.map(target => (
									<li key={target}>
										<span>{getDatabaseBackupTargetLabel(target)}</span>
										<span className={styles.scheduleTime}>
											{settings[DATABASE_BACKUP_SCHEDULE_FIELDS[target]]}
										</span>
									</li>
								))}
							</ul>
							<p className={styles.hint}>
								Общее время запуска, интервалы между базами и получатель
								настраиваются в разделе Telegram-ботов.
							</p>
							<Link
								className={styles.secondaryBtn}
								href={ADMIN_PAGES.TELEGRAM_BOT}
								onClick={() =>
									toast.success(
										'Открываем настройки расписания и Telegram'
									)
								}
							>
								Настроить расписание
							</Link>
						</div>
					) : (
						settingsUnavailable
					),
					restore: (
						<DatabaseRestorePanel
							isDev={isDev}
							isUserLoading={isUserLoading}
							userId={user?.id}
						/>
					)
				}}
			/>
		</section>
	)
}

export default AdminDatabases
