'use client'

import { UserRole, useAuthStore, useUser } from '@/entities/user'
import {
	campaignsService,
	type CampaignAudience,
	type CampaignChannel,
	type CampaignDelivery,
	type CampaignDeliveryStatus,
	type CampaignInput,
	type CampaignSnapshotStatus,
	type CampaignStatus,
	type CampaignSummary
} from '@/features/campaigns'
import AdminNavigation from '@/screens/admin/ui/common/admin-navigation/AdminNavigation'
import AdminSectionHeading from '@/screens/admin/ui/common/admin-section-heading/AdminSectionHeading'
import AdminTooltip from '@/screens/admin/ui/common/admin-tooltip/AdminTooltip'
import { errorCatch } from '@/shared/api'
import ConfirmDialog from '@/shared/ui/confirm-dialog/ConfirmDialog'
import Heading from '@/shared/ui/heading/Heading'
import Pagination from '@/shared/ui/pagination/Pagination'
import {
	useMutation,
	useQuery,
	useQueryClient
} from '@tanstack/react-query'
import { FormEvent, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import styles from './AdminMailings.module.scss'

const CAMPAIGN_LIMIT = 10
const DELIVERY_LIMIT = 10

const TOAST_IDS = {
	create: 'admin-campaign-create',
	createValidation: 'admin-campaign-create-validation',
	cancel: 'admin-campaign-cancel',
	listError: 'admin-campaign-list-error',
	listRetry: 'admin-campaign-list-retry',
	detailError: 'admin-campaign-detail-error',
	detailRetry: 'admin-campaign-detail-retry',
	deliveriesError: 'admin-campaign-deliveries-error',
	deliveriesRetry: 'admin-campaign-deliveries-retry'
} as const

const AUDIENCE_LABELS: Record<CampaignAudience, string> = {
	ACTIVE_SUBSCRIPTION:
		'владельцам оплаченной CRM с контактом для выбранного канала',
	ALL: 'всем активным аккаунтам с контактом для выбранного канала'
}

const CHANNEL_LABELS: Record<CampaignChannel, string> = {
	EMAIL: 'Email',
	TELEGRAM: 'Telegram',
	BOTH: 'Email + Telegram'
}

const STATUS_LABELS: Record<CampaignStatus, string> = {
	SNAPSHOTTING: 'Формируется список получателей',
	QUEUED: 'В очереди',
	RUNNING: 'Выполняется',
	CANCEL_REQUESTED: 'Запрошена остановка',
	COMPLETED: 'Завершена',
	PARTIAL_FAILED: 'Завершена с ошибками',
	FAILED: 'Ошибка кампании',
	CANCELLED: 'Отменена'
}

const DELIVERY_STATUS_LABELS: Record<CampaignDeliveryStatus, string> = {
	PENDING: 'Ожидает',
	PROCESSING: 'Отправляется',
	SENT: 'Отправлена',
	FAILED: 'Ошибка',
	CANCELLED: 'Отменена'
}

const SNAPSHOT_STATUS_LABELS: Record<CampaignSnapshotStatus, string> = {
	CREATING: 'Формируется',
	READY: 'Готов',
	FAILED: 'Ошибка',
	CANCELLED: 'Отменён'
}

const ACTIVE_STATUSES: CampaignStatus[] = [
	'SNAPSHOTTING',
	'QUEUED',
	'RUNNING',
	'CANCEL_REQUESTED'
]

const CANCELLABLE_STATUSES: CampaignStatus[] = [
	'SNAPSHOTTING',
	'QUEUED',
	'RUNNING'
]

type DeliveryStatusFilter = CampaignDeliveryStatus | 'ALL'

interface QueryErrorProps {
	message: string
	onRetry: () => void
	isRetrying: boolean
}

const formatDate = (value: string | null | undefined) =>
	value
		? new Intl.DateTimeFormat('ru-RU', {
				dateStyle: 'short',
				timeStyle: 'medium'
			}).format(new Date(value))
		: '—'

const getCampaignProgress = (campaign: CampaignSummary) => {
	if (campaign.recipientCount === 0) return 0

	const processed =
		campaign.sentCount + campaign.failedCount + campaign.cancelledCount

	return Math.min(
		100,
		Math.round((processed / campaign.recipientCount) * 100)
	)
}

const getCampaignErrorMessage = (error: unknown, fallback: string) => {
	const status = (error as { response?: { status?: number } })?.response
		?.status

	if (status === 401) {
		return 'Сессия завершена. Войдите снова и повторите действие.'
	}
	if (status === 403) {
		return 'Недостаточно прав для этого действия с кампаниями.'
	}
	if (status === 503) {
		return 'Campaigns Service временно недоступен. Повторите попытку позже.'
	}

	const apiMessage = errorCatch(error)
	return apiMessage ? `${fallback}: ${apiMessage}` : fallback
}

const QueryError = ({ message, onRetry, isRetrying }: QueryErrorProps) => (
	<div className={styles.errorState} role="alert">
		<p className={styles.errorTitle}>Не удалось загрузить данные</p>
		<p className={styles.errorMessage}>{message}</p>
		<button
			type="button"
			className={styles.secondaryBtn}
			onClick={onRetry}
			disabled={isRetrying}
		>
			{isRetrying ? 'Повторяем...' : 'Повторить'}
		</button>
	</div>
)

const AdminMailings = () => {
	const auth = useAuthStore(state => state.auth)
	const { user, isLoading: isUserLoading } = useUser()
	const queryClient = useQueryClient()
	const isDev = Boolean(user?.rights?.includes(UserRole.DEV))
	const canManageCampaigns = Boolean(
		user?.rights?.includes(UserRole.ADMIN)
	)
	const canReadCampaigns = canManageCampaigns

	const [subject, setSubject] = useState('')
	const [message, setMessage] = useState('')
	const [audience, setAudience] = useState<CampaignAudience>(
		'ACTIVE_SUBSCRIPTION'
	)
	const [channel, setChannel] = useState<CampaignChannel>('EMAIL')
	const [confirmOpened, setConfirmOpened] = useState(false)
	const [cancelCampaign, setCancelCampaign] =
		useState<CampaignSummary | null>(null)
	const [page, setPage] = useState(1)
	const [selectedCampaignId, setSelectedCampaignId] = useState<
		string | null
	>(null)
	const [deliveryPage, setDeliveryPage] = useState(1)
	const [deliveryStatus, setDeliveryStatus] =
		useState<DeliveryStatusFilter>('ALL')
	const [retryingDeliveryId, setRetryingDeliveryId] = useState<
		string | null
	>(null)
	const pendingCreateRef = useRef<{
		fingerprint: string
		idempotencyKey: string
	} | null>(null)
	const pendingRetryKeysRef = useRef(new Map<string, string>())

	const campaigns = useQuery({
		queryKey: ['admin-campaigns', page, CAMPAIGN_LIMIT],
		queryFn: () => campaignsService.getCampaigns(page, CAMPAIGN_LIMIT),
		enabled: Boolean(auth) && !isUserLoading && Boolean(canReadCampaigns),
		refetchInterval: query =>
			query.state.data?.items.some(item =>
				ACTIVE_STATUSES.includes(item.status)
			)
				? 2000
				: 10000
	})

	const campaignDetail = useQuery({
		queryKey: ['admin-campaign', selectedCampaignId],
		queryFn: () => campaignsService.getCampaign(selectedCampaignId!),
		enabled:
			Boolean(auth) &&
			!isUserLoading &&
			Boolean(canReadCampaigns) &&
			Boolean(selectedCampaignId),
		refetchInterval: query =>
			query.state.data && ACTIVE_STATUSES.includes(query.state.data.status)
				? 2000
				: false
	})

	const deliveries = useQuery({
		queryKey: [
			'admin-campaign-deliveries',
			selectedCampaignId,
			deliveryPage,
			DELIVERY_LIMIT,
			deliveryStatus
		],
		queryFn: () =>
			campaignsService.getDeliveries(
				selectedCampaignId!,
				deliveryPage,
				DELIVERY_LIMIT,
				deliveryStatus === 'ALL' ? undefined : deliveryStatus
			),
		enabled:
			Boolean(auth) &&
			!isUserLoading &&
			Boolean(canReadCampaigns) &&
			Boolean(selectedCampaignId),
		refetchInterval:
			campaignDetail.data &&
			ACTIVE_STATUSES.includes(campaignDetail.data.status)
				? 3000
				: false
	})

	useEffect(() => {
		if (!campaigns.isError) return
		toast.error(
			getCampaignErrorMessage(
				campaigns.error,
				'Не удалось загрузить список кампаний'
			),
			{ id: TOAST_IDS.listError }
		)
	}, [campaigns.error, campaigns.isError])

	useEffect(() => {
		if (!campaignDetail.isError) return
		toast.error(
			getCampaignErrorMessage(
				campaignDetail.error,
				'Не удалось загрузить кампанию'
			),
			{ id: TOAST_IDS.detailError }
		)
	}, [campaignDetail.error, campaignDetail.isError])

	useEffect(() => {
		if (!deliveries.isError) return
		toast.error(
			getCampaignErrorMessage(
				deliveries.error,
				'Не удалось загрузить доставки'
			),
			{ id: TOAST_IDS.deliveriesError }
		)
	}, [deliveries.error, deliveries.isError])

	const createMutation = useMutation({
		mutationFn: ({
			payload,
			idempotencyKey
		}: {
			payload: CampaignInput
			idempotencyKey: string
		}) => campaignsService.createCampaign(payload, idempotencyKey),
		onSuccess: async campaign => {
			pendingCreateRef.current = null
			setPage(1)
			setSelectedCampaignId(campaign.id)
			setDeliveryPage(1)
			await queryClient.invalidateQueries({
				queryKey: ['admin-campaigns']
			})
		}
	})

	const cancelMutation = useMutation({
		mutationFn: campaignsService.cancelCampaign,
		onSuccess: async campaign => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: ['admin-campaigns']
				}),
				queryClient.invalidateQueries({
					queryKey: ['admin-campaign', campaign.id]
				}),
				queryClient.invalidateQueries({
					queryKey: ['admin-campaign-deliveries', campaign.id]
				})
			])
		}
	})

	const retryMutation = useMutation({
		mutationFn: ({
			campaignId,
			deliveryId,
			idempotencyKey
		}: {
			campaignId: string
			deliveryId: string
			idempotencyKey: string
		}) =>
			campaignsService.retryDelivery(
				campaignId,
				deliveryId,
				idempotencyKey
			),
		onSuccess: async delivery => {
			pendingRetryKeysRef.current.delete(delivery.id)
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: ['admin-campaigns']
				}),
				queryClient.invalidateQueries({
					queryKey: ['admin-campaign', delivery.campaignId]
				}),
				queryClient.invalidateQueries({
					queryKey: ['admin-campaign-deliveries', delivery.campaignId]
				})
			])
		}
	})

	const trimmedSubject = subject.trim()
	const trimmedMessage = message.trim()
	const totalPages = campaigns.data?.totalPages || 1
	const pages = Array.from({ length: totalPages }, (_, index) => index + 1)
	const deliveryTotalPages = deliveries.data?.totalPages || 1
	const deliveryPages = Array.from(
		{ length: deliveryTotalPages },
		(_, index) => index + 1
	)
	const failedDeliveries =
		deliveries.data?.items.filter(
			delivery => delivery.status === 'FAILED'
		) ?? []

	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (trimmedSubject.length < 3) {
			toast.error('Введите тему кампании', {
				id: TOAST_IDS.createValidation
			})
			return
		}
		if (trimmedMessage.length < 10) {
			toast.error('Введите текст оповещения', {
				id: TOAST_IDS.createValidation
			})
			return
		}
		setConfirmOpened(true)
	}

	const startCampaign = async () => {
		if (createMutation.isPending) return

		const payload: CampaignInput = {
			subject: trimmedSubject,
			message: trimmedMessage,
			audience,
			channel
		}
		const fingerprint = JSON.stringify(payload)
		const pending = pendingCreateRef.current
		const idempotencyKey =
			pending?.fingerprint === fingerprint
				? pending.idempotencyKey
				: window.crypto.randomUUID()

		pendingCreateRef.current = { fingerprint, idempotencyKey }
		setConfirmOpened(false)
		toast.loading('Создаём кампанию...', { id: TOAST_IDS.create })

		try {
			const campaign = await createMutation.mutateAsync({
				payload,
				idempotencyKey
			})
			const result =
				campaign.status === 'SNAPSHOTTING'
					? 'Формируем список получателей.'
					: `Получателей: ${campaign.recipientCount}.`
			toast.success(`Кампания создана. ${result}`, {
				id: TOAST_IDS.create
			})
		} catch (error) {
			toast.error(
				getCampaignErrorMessage(error, 'Не удалось создать кампанию'),
				{ id: TOAST_IDS.create }
			)
		}
	}

	const confirmCancel = async () => {
		if (!cancelCampaign || cancelMutation.isPending) return

		const campaign = cancelCampaign
		setCancelCampaign(null)
		toast.loading('Запрашиваем остановку кампании...', {
			id: `${TOAST_IDS.cancel}-${campaign.id}`
		})

		try {
			await cancelMutation.mutateAsync(campaign.id)
			toast.success('Запрос на остановку принят', {
				id: `${TOAST_IDS.cancel}-${campaign.id}`
			})
		} catch (error) {
			toast.error(
				getCampaignErrorMessage(error, 'Не удалось остановить кампанию'),
				{ id: `${TOAST_IDS.cancel}-${campaign.id}` }
			)
		}
	}

	const retryDelivery = async (delivery: CampaignDelivery) => {
		if (
			!isDev ||
			retryMutation.isPending ||
			delivery.status !== 'FAILED'
		) {
			return
		}

		const idempotencyKey =
			pendingRetryKeysRef.current.get(delivery.id) ??
			window.crypto.randomUUID()
		const toastId = `admin-campaign-delivery-retry-${delivery.id}`

		pendingRetryKeysRef.current.set(delivery.id, idempotencyKey)
		setRetryingDeliveryId(delivery.id)
		toast.loading('Ставим доставку на повтор...', { id: toastId })

		try {
			await retryMutation.mutateAsync({
				campaignId: delivery.campaignId,
				deliveryId: delivery.id,
				idempotencyKey
			})
			toast.success('Доставка поставлена на повтор', { id: toastId })
		} catch (error) {
			toast.error(
				getCampaignErrorMessage(error, 'Не удалось повторить доставку'),
				{ id: toastId }
			)
		} finally {
			setRetryingDeliveryId(null)
		}
	}

	const retryCampaignList = async () => {
		toast.loading('Повторно загружаем кампании...', {
			id: TOAST_IDS.listRetry
		})
		const result = await campaigns.refetch()

		if (result.isError) {
			toast.error(
				getCampaignErrorMessage(
					result.error,
					'Не удалось загрузить список кампаний'
				),
				{ id: TOAST_IDS.listRetry }
			)
			return
		}
		toast.success('Список кампаний обновлён', {
			id: TOAST_IDS.listRetry
		})
	}

	const retryCampaignDetail = async () => {
		toast.loading('Повторно загружаем кампанию...', {
			id: TOAST_IDS.detailRetry
		})
		const result = await campaignDetail.refetch()

		if (result.isError) {
			toast.error(
				getCampaignErrorMessage(
					result.error,
					'Не удалось загрузить кампанию'
				),
				{ id: TOAST_IDS.detailRetry }
			)
			return
		}
		toast.success('Данные кампании обновлены', {
			id: TOAST_IDS.detailRetry
		})
	}

	const retryDeliveries = async () => {
		toast.loading('Повторно загружаем доставки...', {
			id: TOAST_IDS.deliveriesRetry
		})
		const result = await deliveries.refetch()

		if (result.isError) {
			toast.error(
				getCampaignErrorMessage(
					result.error,
					'Не удалось загрузить доставки'
				),
				{ id: TOAST_IDS.deliveriesRetry }
			)
			return
		}
		toast.success('Список доставок обновлён', {
			id: TOAST_IDS.deliveriesRetry
		})
	}

	const openCampaign = (campaignId: string) => {
		setSelectedCampaignId(campaignId)
		setDeliveryPage(1)
		setDeliveryStatus('ALL')
	}

	return (
		<section className={styles.wrapper}>
			{confirmOpened && (
				<ConfirmDialog
					title="Запустить кампанию?"
					message={`${CHANNEL_LABELS[channel]}-кампания будет создана и отправлена ${AUDIENCE_LABELS[audience]}. После запуска её можно остановить, но уже отправленные сообщения отозвать нельзя.`}
					confirmLabel="Запустить"
					cancelLabel="Назад"
					onConfirm={startCampaign}
					onCancel={() => setConfirmOpened(false)}
				/>
			)}
			{cancelCampaign && (
				<ConfirmDialog
					title="Остановить кампанию?"
					message={`Новые сообщения кампании «${cancelCampaign.subject}» отправляться не будут. Уже отправленные сообщения отозвать нельзя.`}
					confirmLabel="Остановить"
					cancelLabel="Назад"
					onConfirm={confirmCancel}
					onCancel={() => setCancelCampaign(null)}
				/>
			)}

			<Heading text="Панель администратора" />
			<AdminNavigation />
			<AdminSectionHeading
				text="Рассылки"
				title="Массовые кампании"
				description="Создаёт email/Telegram-кампанию через Campaigns Service. Список получателей фиксируется отдельно, а прогресс и доставки доступны для контроля."
				risk="high"
				riskText="Проверь канал, аудиторию и текст. Отмена останавливает только ещё не начатые доставки."
			/>

			{isUserLoading ? (
				<div className={styles.card}>
					<p className={styles.historyEmpty}>Проверяем права доступа...</p>
				</div>
			) : canManageCampaigns ? (
				<form className={styles.card} onSubmit={submit}>
					<div className={styles.field}>
						<label htmlFor="campaign-subject" className={styles.label}>
							Тема
						</label>
						<input
							id="campaign-subject"
							className={styles.input}
							value={subject}
							onChange={event => setSubject(event.target.value)}
							maxLength={120}
						/>
						<p className={styles.counter}>{subject.length}/120</p>
					</div>
					<div className={styles.channelBlock}>
						<p className={styles.label}>Канал</p>
						<div className={styles.channelOptions}>
							{(['EMAIL', 'TELEGRAM', 'BOTH'] as const).map(value => (
								<button
									key={value}
									type="button"
									className={`${styles.optionBtn} ${channel === value ? styles.optionBtnActive : ''}`}
									onClick={() => setChannel(value)}
								>
									{CHANNEL_LABELS[value]}
								</button>
							))}
						</div>
					</div>
					<div className={styles.field}>
						<label htmlFor="campaign-message" className={styles.label}>
							Текст оповещения
						</label>
						<textarea
							id="campaign-message"
							className={styles.textarea}
							value={message}
							onChange={event => setMessage(event.target.value)}
							maxLength={5000}
							rows={9}
						/>
						<p className={styles.counter}>{message.length}/5000</p>
					</div>
					<div className={styles.audienceOptions}>
						{(['ACTIVE_SUBSCRIPTION', 'ALL'] as const).map(value => (
							<button
								key={value}
								type="button"
								className={`${styles.optionBtn} ${audience === value ? styles.optionBtnActive : ''}`}
								onClick={() => setAudience(value)}
							>
								{value === 'ACTIVE_SUBSCRIPTION'
									? 'Оплаченная CRM'
									: 'Все без фильтра подписки'}
							</button>
						))}
					</div>
					<p className={styles.hint}>{AUDIENCE_LABELS[audience]}</p>
					<button
						type="submit"
						className={styles.sendBtn}
						disabled={createMutation.isPending}
					>
						{createMutation.isPending
							? 'Создаём...'
							: 'Запустить кампанию'}
					</button>
				</form>
			) : null}

			<div className={styles.historyCard}>
				<div className={styles.historyHeader}>
					<div>
						<p className={styles.resultTitle}>Кампании</p>
						<p className={styles.hint}>
							Текущий прогресс, ошибки и отменённые доставки.
						</p>
					</div>
					{campaigns.isFetching && !campaigns.isError && (
						<span className={styles.historyStatus}>Обновляем...</span>
					)}
				</div>

				{isUserLoading ? (
					<p className={styles.historyEmpty}>Проверяем права доступа...</p>
				) : !canReadCampaigns ? (
					<div className={styles.errorState} role="alert">
						<p className={styles.errorTitle}>Доступ ограничен</p>
						<p className={styles.errorMessage}>
							Для просмотра кампаний нужна роль ADMIN.
						</p>
					</div>
				) : campaigns.isLoading ? (
					<p className={styles.historyEmpty}>Загружаем кампании...</p>
				) : campaigns.isError ? (
					<QueryError
						message={getCampaignErrorMessage(
							campaigns.error,
							'Не удалось загрузить список кампаний'
						)}
						onRetry={retryCampaignList}
						isRetrying={campaigns.isFetching}
					/>
				) : campaigns.data?.items.length ? (
					<>
						<div className={styles.historyList}>
							{campaigns.data.items.map(campaign => {
								const processed =
									campaign.sentCount +
									campaign.failedCount +
									campaign.cancelledCount
								const progress = getCampaignProgress(campaign)

								return (
									<div
										className={`${styles.historyItem} ${
											selectedCampaignId === campaign.id
												? styles.selectedHistoryItem
												: ''
										}`}
										key={campaign.id}
									>
										<div>
											<span className={styles.resultLabel}>Тема</span>
											<span className={styles.resultValue}>
												{campaign.subject}
											</span>
										</div>
										<div>
											<span className={styles.resultLabel}>Статус</span>
											<span className={styles.resultValue}>
												{STATUS_LABELS[campaign.status]}
											</span>
										</div>
										<div>
											<span className={styles.resultLabel}>Прогресс</span>
											<span className={styles.resultValue}>
												{processed}/{campaign.recipientCount} ({progress}%)
											</span>
										</div>
										<div>
											<span className={styles.resultLabel}>Результат</span>
											<span className={styles.resultValue}>
												{campaign.sentCount} отправлено ·{' '}
												{campaign.failedCount} ошибок ·{' '}
												{campaign.cancelledCount} отменено
											</span>
										</div>
										<div>
											<span className={styles.resultLabel}>Канал</span>
											<span className={styles.resultValue}>
												{CHANNEL_LABELS[campaign.requestedChannel]}
											</span>
										</div>
										<div>
											<span className={styles.resultLabel}>Создана</span>
											<span className={styles.resultValue}>
												{formatDate(campaign.createdAt)}
											</span>
										</div>
										<div className={styles.historyActions}>
											<button
												type="button"
												className={styles.secondaryBtn}
												onClick={() => openCampaign(campaign.id)}
											>
												Подробнее
											</button>
											{canManageCampaigns &&
												CANCELLABLE_STATUSES.includes(campaign.status) && (
													<button
														type="button"
														className={styles.cancelBtn}
														onClick={() => setCancelCampaign(campaign)}
													>
														Остановить
													</button>
												)}
										</div>
									</div>
								)
							})}
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
					<p className={styles.historyEmpty}>Кампаний пока нет.</p>
				)}
			</div>

			{selectedCampaignId && (
				<div className={styles.detailCard}>
					<div className={styles.detailHeader}>
						<div>
							<p className={styles.resultTitle}>Детали кампании</p>
							<p className={styles.hint}>
								Снимок получателей и отдельные доставки.
							</p>
						</div>
						<button
							type="button"
							className={styles.secondaryBtn}
							onClick={() => setSelectedCampaignId(null)}
						>
							Закрыть
						</button>
					</div>

					{campaignDetail.isLoading ? (
						<p className={styles.historyEmpty}>Загружаем кампанию...</p>
					) : campaignDetail.isError ? (
						<QueryError
							message={getCampaignErrorMessage(
								campaignDetail.error,
								'Не удалось загрузить кампанию'
							)}
							onRetry={retryCampaignDetail}
							isRetrying={campaignDetail.isFetching}
						/>
					) : campaignDetail.data ? (
						<>
							<div className={styles.detailGrid}>
								<div>
									<span className={styles.resultLabel}>Тема</span>
									<span className={styles.resultValue}>
										{campaignDetail.data.subject}
									</span>
								</div>
								<div>
									<span className={styles.resultLabel}>Статус</span>
									<span className={styles.resultValue}>
										{STATUS_LABELS[campaignDetail.data.status]}
									</span>
								</div>
								<div>
									<span className={styles.resultLabel}>Получатели</span>
									<span className={styles.resultValue}>
										{campaignDetail.data.recipientCount}
									</span>
								</div>
								<div>
									<span className={styles.resultLabel}>Каналы</span>
									<span className={styles.resultValue}>
										Email: {campaignDetail.data.emailCount} · Telegram:{' '}
										{campaignDetail.data.telegramCount}
									</span>
								</div>
								<div>
									<span className={styles.resultLabel}>Создана</span>
									<span className={styles.resultValue}>
										{formatDate(campaignDetail.data.createdAt)}
									</span>
								</div>
								<div>
									<span className={styles.resultLabel}>Завершена</span>
									<span className={styles.resultValue}>
										{formatDate(campaignDetail.data.completedAt)}
									</span>
								</div>
							</div>

							<div className={styles.messageBox}>
								<span className={styles.resultLabel}>Сообщение</span>
								<p>{campaignDetail.data.message}</p>
							</div>

							<div className={styles.snapshotBox}>
								<p className={styles.resultTitle}>Снимки получателей</p>
								{campaignDetail.data.snapshots.length ? (
									campaignDetail.data.snapshots.map(snapshot => (
										<div className={styles.snapshotItem} key={snapshot.id}>
											<span className={styles.resultLabel}>
												{CHANNEL_LABELS[snapshot.channel]}
											</span>
											<div className={styles.detailGrid}>
												<div>
													<span className={styles.resultLabel}>
														Статус
													</span>
													<span className={styles.resultValue}>
														{SNAPSHOT_STATUS_LABELS[snapshot.status]}
													</span>
												</div>
												<div>
													<span className={styles.resultLabel}>
														Получателей
													</span>
													<span className={styles.resultValue}>
														{snapshot.recipientCount}
													</span>
												</div>
												<div>
													<span className={styles.resultLabel}>
														Зафиксирован
													</span>
													<span className={styles.resultValue}>
														{formatDate(snapshot.asOf)}
													</span>
												</div>
												<div>
													<span className={styles.resultLabel}>
														SHA-256
													</span>
													<span className={styles.resultValue}>
														{snapshot.sha256 ?? '—'}
													</span>
												</div>
											</div>
										</div>
									))
								) : (
									<p className={styles.hint}>Снимки ещё формируются.</p>
								)}
							</div>

							<div className={styles.deliverySection}>
								<div className={styles.deliveryHeader}>
									<div>
										<p className={styles.resultTitle}>Доставки</p>
										<p className={styles.hint}>
											Список загружается с серверной пагинацией.
										</p>
									</div>
									<label className={styles.filterField}>
										<span>Статус</span>
										<select
											className={styles.select}
											value={deliveryStatus}
											onChange={event => {
												setDeliveryStatus(
													event.target.value as DeliveryStatusFilter
												)
												setDeliveryPage(1)
											}}
										>
											<option value="ALL">Все</option>
											{(
												Object.keys(
													DELIVERY_STATUS_LABELS
												) as CampaignDeliveryStatus[]
											).map(status => (
												<option key={status} value={status}>
													{DELIVERY_STATUS_LABELS[status]}
												</option>
											))}
										</select>
									</label>
								</div>

								{deliveries.isLoading ? (
									<p className={styles.historyEmpty}>
										Загружаем доставки...
									</p>
								) : deliveries.isError ? (
									<QueryError
										message={getCampaignErrorMessage(
											deliveries.error,
											'Не удалось загрузить доставки'
										)}
										onRetry={retryDeliveries}
										isRetrying={deliveries.isFetching}
									/>
								) : deliveries.data?.items.length ? (
									<>
										<div className={styles.deliveryList}>
											{deliveries.data.items.map(delivery => (
												<div
													className={styles.deliveryItem}
													key={delivery.id}
												>
													<div className={styles.deliveryMeta}>
														<div>
															<span className={styles.resultLabel}>
																Канал
															</span>
															<span className={styles.resultValue}>
																{CHANNEL_LABELS[delivery.channel]}
															</span>
														</div>
														<div>
															<span className={styles.resultLabel}>
																Статус
															</span>
															<span className={styles.resultValue}>
																{DELIVERY_STATUS_LABELS[delivery.status]}
															</span>
														</div>
														<div>
															<span className={styles.resultLabel}>
																Попытки
															</span>
															<span className={styles.resultValue}>
																{delivery.attempts}
															</span>
														</div>
														<div>
															<span className={styles.resultLabel}>
																Поколение
															</span>
															<span className={styles.resultValue}>
																{delivery.dispatchGeneration}
															</span>
														</div>
														<div>
															<span className={styles.resultLabel}>
																Создана
															</span>
															<span className={styles.resultValue}>
																{formatDate(delivery.createdAt)}
															</span>
														</div>
														<div>
															<span className={styles.resultLabel}>
																Отправлена
															</span>
															<span className={styles.resultValue}>
																{formatDate(delivery.sentAt)}
															</span>
														</div>
													</div>
													{delivery.failure && (
														<div className={styles.deliveryFailure}>
															<span>{delivery.failure.code}</span>
															<p>{delivery.failure.reason}</p>
														</div>
													)}
												</div>
											))}
										</div>
										{deliveryTotalPages > 1 && (
											<Pagination
												listPage={deliveryPages}
												currentPage={deliveryPage}
												prevPage={() =>
													setDeliveryPage(value => Math.max(1, value - 1))
												}
												nextPage={() =>
													setDeliveryPage(value =>
														Math.min(deliveryTotalPages, value + 1)
													)
												}
												changeActivePage={setDeliveryPage}
											/>
										)}
									</>
								) : (
									<p className={styles.historyEmpty}>
										Доставок с выбранным статусом пока нет.
									</p>
								)}

								<div className={styles.retryPanel}>
									<div className={styles.retryPanelHeader}>
										<div>
											<p className={styles.resultTitle}>
												Повтор неуспешных доставок
											</p>
											<p className={styles.hint}>
												Каждый повтор создаётся с отдельным idempotency
												key.
											</p>
										</div>
										<AdminTooltip
											title="Ручной повтор доставки"
											description="Изменяющее действие доступно только роли DEV. ADMIN может просматривать статусы и безопасные причины ошибок."
											risk="high"
											riskText="Повтор разрешён только для доставки в статусе FAILED."
										/>
									</div>

									{isDev ? (
										failedDeliveries.length ? (
											<div className={styles.retryList}>
												{failedDeliveries.map(delivery => (
													<div
														className={styles.retryItem}
														key={delivery.id}
													>
														<span>
															{CHANNEL_LABELS[delivery.channel]} · попыток:{' '}
															{delivery.attempts}
														</span>
														<button
															type="button"
															className={styles.retryBtn}
															onClick={() => retryDelivery(delivery)}
															disabled={retryMutation.isPending}
														>
															{retryingDeliveryId === delivery.id
																? 'Повторяем...'
																: 'Повторить'}
														</button>
													</div>
												))}
											</div>
										) : (
											<p className={styles.historyEmpty}>
												На этой странице нет доставок в статусе FAILED.
											</p>
										)
									) : (
										<div
											className={styles.lockedPanel}
											aria-disabled="true"
										>
											<div
												className={styles.lockedContent}
												aria-hidden="true"
											>
												<div className={styles.retryItem}>
													<span>Email · неуспешная доставка</span>
													<button
														type="button"
														className={styles.retryBtn}
														disabled
													>
														Повторить
													</button>
												</div>
											</div>
											<div className={styles.lockedOverlay}>
												<span className={styles.lockedBadge}>
													Только для DEV
												</span>
												<AdminTooltip
													title="Повтор доставки заблокирован"
													description="ADMIN доступен read-only просмотр. Ручной повтор доставки разрешён только пользователям с ролью DEV."
												/>
											</div>
										</div>
									)}
								</div>
							</div>
						</>
					) : null}
				</div>
			)}
		</section>
	)
}

export default AdminMailings
