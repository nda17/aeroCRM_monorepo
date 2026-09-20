'use client'

import { UserRole, useAuthStore, useUser } from '@/entities/user'
import {
	messagingService,
	type MessagingFailure,
	type MessagingFailureCategory,
	type MessagingFailureSource,
	type MessagingIntegration
} from '@/features/admin-monitoring'
import { errorCatch } from '@/shared/api'
import AdminNavigation from '@/screens/admin/ui/common/admin-navigation/AdminNavigation'
import AdminSectionHeading from '@/screens/admin/ui/common/admin-section-heading/AdminSectionHeading'
import AdminTooltip from '@/screens/admin/ui/common/admin-tooltip/AdminTooltip'
import ConfirmDialog from '@/shared/ui/confirm-dialog/ConfirmDialog'
import Heading from '@/shared/ui/heading/Heading'
import Pagination from '@/shared/ui/pagination/Pagination'
import SkeletonLoader from '@/shared/ui/skeleton-loader/SkeletonLoader'
import {
	useMutation,
	useQuery,
	useQueryClient
} from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import styles from './AdminMessaging.module.scss'

const LIMIT = 20
const RETRY_LEASE_MS = 5 * 60 * 1000
const integrationLabels: Record<MessagingIntegration, string> = {
	email: 'Email',
	webhook: 'Webhook',
	telegram: 'Telegram',
	bitrix24: 'Битрикс24',
	'amo-crm': 'amoCRM',
	'payment-email': 'Email после оплаты',
	'payment-telegram': 'Telegram после оплаты',
	'campaign-email': 'Email-кампания',
	'campaign-telegram': 'Telegram-кампания',
	'daily-summary-delivery-telegram': 'Ежедневная Telegram-сводка',
	'campaign-admin-audit': 'Аудит кампаний',
	'reporting-admin-audit': 'Аудит Reporting',
	'billing-admin-audit': 'Аудит Billing',
	'identity-admin-audit': 'Аудит Identity',
	'platform-admin-audit': 'Аудит Platform',
	'telegram-destination-unavailable':
		'Недоступный Telegram-адресат Identity',
	'billing-payment-projection': 'Проекция платежей Billing',
	'billing-subscription-projection': 'Проекция подписок Billing',
	'billing-affiliate-projection': 'Проекция партнёрки Billing',
	'billing-settings-projection': 'Проекция настроек Billing',
	'billing-identity-source': 'Идентичность для Billing',
	'billing-offer-source': 'Тарифы для Billing',
	'billing-notification-routing-source': 'Маршруты уведомлений Billing',
	'billing-trial-source': 'Trial-подписка Billing',
	'billing-referral-source': 'Реферал Billing',
	'billing-lifecycle-repair-source': 'Восстановление lifecycle Billing',
	'auto-renewal': 'Автопродление Billing',
	'subscription-expiry-email': 'Истечение подписки — Email',
	'subscription-expiry-telegram': 'Истечение подписки — Telegram',
	'limit-email': 'Email о лимите',
	'limit-telegram': 'Telegram о лимите',
	'notification-delivery-outcome': 'Результат доставки уведомления',
	'database-backup': 'Backup PostgreSQL'
}

const categoryLabels: Record<MessagingFailureCategory, string> = {
	TRANSIENT: 'Временная',
	RATE_LIMIT: 'Ограничение частоты',
	PERMANENT: 'Постоянная',
	AUTH_CONFIGURATION: 'Авторизация или настройка'
}

const failureSourceLabels: Record<MessagingFailureSource, string> = {
	operations: 'Operations',
	notificationDelivery: 'Notification Delivery',
	billing: 'Billing',
	identity: 'Identity'
}

const formatDate = (value: string | null) =>
	value
		? new Intl.DateTimeFormat('ru-RU', {
				dateStyle: 'short',
				timeStyle: 'medium'
			}).format(new Date(value))
		: '—'

const getCategoryClassName = (
	category: MessagingFailureCategory | null
): string => {
	switch (category) {
		case 'TRANSIENT':
			return styles.categoryTransient
		case 'RATE_LIMIT':
			return styles.categoryRateLimit
		case 'PERMANENT':
			return styles.categoryPermanent
		case 'AUTH_CONFIGURATION':
			return styles.categoryAuthConfiguration
		default:
			return styles.categoryLegacy
	}
}

const isRetryLeaseActive = (retryingAt: string | null): boolean => {
	if (!retryingAt) return false

	const retryStartedAt = Date.parse(retryingAt)
	if (Number.isNaN(retryStartedAt)) return true

	return retryStartedAt >= Date.now() - RETRY_LEASE_MS
}

export default function AdminMessaging() {
	const auth = useAuthStore(state => state.auth)
	const { user, isLoading: isUserLoading } = useUser()
	const isDev = Boolean(user?.rights?.includes(UserRole.DEV))
	const canViewOverview = Boolean(
		user?.rights?.some(
			role => role === UserRole.ADMIN || role === UserRole.DEV
		)
	)
	const queryClient = useQueryClient()
	const [page, setPage] = useState(1)
	const [integration, setIntegration] = useState('ALL')
	const [category, setCategory] = useState<
		MessagingFailureCategory | 'ALL'
	>('ALL')
	const [status, setStatus] = useState('FAILED')
	const [retryTarget, setRetryTarget] = useState<MessagingFailure | null>(
		null
	)
	const [closeTarget, setCloseTarget] = useState<MessagingFailure | null>(
		null
	)
	const [closeComment, setCloseComment] = useState('')

	const overview = useQuery({
		queryKey: ['admin-messaging-overview'],
		queryFn: messagingService.getOverview,
		enabled: auth && canViewOverview,
		refetchInterval: 15000
	})
	const failures = useQuery({
		queryKey: [
			'admin-messaging-failures',
			page,
			integration,
			category,
			status
		],
		queryFn: () =>
			messagingService.getFailures({
				page,
				limit: LIMIT,
				integration: integration === 'ALL' ? undefined : integration,
				category: category === 'ALL' ? undefined : category,
				status
			}),
		enabled: auth && isDev,
		refetchInterval: 15000
	})
	const retryMutation = useMutation({
		mutationFn: messagingService.retryFailure,
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: ['admin-messaging-overview']
				}),
				queryClient.invalidateQueries({
					queryKey: ['admin-messaging-failures']
				})
			])
		}
	})
	const closeMutation = useMutation({
		mutationFn: ({ id, comment }: { id: string; comment: string }) =>
			messagingService.closeFailure(id, comment),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: ['admin-messaging-overview']
				}),
				queryClient.invalidateQueries({
					queryKey: ['admin-messaging-failures']
				})
			])
		}
	})

	const confirmRetry = () => {
		if (!retryTarget || retryMutation.isPending || closeMutation.isPending)
			return

		const failureId = retryTarget.id
		setRetryTarget(null)
		toast.promise(retryMutation.mutateAsync(failureId), {
			loading: 'Пожалуйста, подождите',
			success: 'Событие повторно поставлено в очередь',
			error: error => `Ошибка повтора: ${errorCatch(error)}`
		})
	}

	const openCloseDialog = (failure: MessagingFailure) => {
		setRetryTarget(null)
		setCloseComment('')
		setCloseTarget(failure)
	}

	const closeCloseDialog = () => {
		if (closeMutation.isPending) return
		setCloseTarget(null)
		setCloseComment('')
	}

	const confirmClose = () => {
		const comment = closeComment.trim()
		if (
			!closeTarget ||
			comment.length < 3 ||
			closeMutation.isPending ||
			retryMutation.isPending
		) {
			return
		}

		const promise = closeMutation.mutateAsync({
			id: closeTarget.id,
			comment
		})
		toast.promise(promise, {
			loading: 'Пожалуйста, подождите',
			success: 'Ошибка закрыта без повтора',
			error: error => `Ошибка закрытия: ${errorCatch(error)}`
		})
		void promise
			.then(() => {
				setCloseTarget(null)
				setCloseComment('')
			})
			.catch(() => undefined)
	}

	const totalPages = failures.data?.totalPages || 1
	const pages = Array.from({ length: totalPages }, (_, index) => index + 1)
	const unavailableFailureSources = failures.data
		? (Object.keys(failures.data.sourceErrors) as MessagingFailureSource[])
		: []

	useEffect(() => {
		if (page > totalPages) {
			setPage(totalPages)
		}
	}, [page, totalPages])

	return (
		<section className={styles.wrapper}>
			{isDev && retryTarget && (
				<ConfirmDialog
					title="Повторить доставку?"
					message={`Повторно отправить ${integrationLabels[retryTarget.integration]} для события ${retryTarget.eventId}? Если внешний сервис уже обработал предыдущий запрос, действие может выполниться повторно.`}
					confirmLabel="Повторить"
					cancelLabel="Назад"
					onConfirm={confirmRetry}
					onCancel={() => setRetryTarget(null)}
				/>
			)}
			{isDev && closeTarget && (
				<ConfirmDialog
					title="Закрыть ошибку без повтора?"
					message={`Событие ${closeTarget.eventId} больше не будет отправлено автоматически. Исходная ошибка и комментарий останутся в истории.`}
					confirmLabel="Закрыть без повтора"
					cancelLabel="Назад"
					confirmDisabled={
						closeComment.trim().length < 3 ||
						closeMutation.isPending ||
						retryMutation.isPending
					}
					onConfirm={confirmClose}
					onCancel={closeCloseDialog}
				>
					<label className={styles.commentField}>
						<span>Причина закрытия</span>
						<textarea
							value={closeComment}
							onChange={event => setCloseComment(event.target.value)}
							rows={4}
							placeholder="Опишите, почему повторная доставка не требуется"
							minLength={3}
							maxLength={1000}
							disabled={closeMutation.isPending}
							required
						/>
					</label>
				</ConfirmDialog>
			)}
			<Heading text="Панель администратора" />
			<AdminNavigation />
			<AdminSectionHeading
				text="Очереди"
				title="Интеграции, фоновые задачи и Outbox"
				description={
					isDev
						? 'Состояние PostgreSQL Outbox, RabbitMQ, publisher и workers. Здесь можно повторить доставку из DLQ или закрыть ошибку без повтора.'
						: 'Мониторинг PostgreSQL Outbox, RabbitMQ, publisher и workers доступен только для просмотра. Подробный DLQ и действия с ошибками доступны только DEV.'
				}
				risk={isDev ? 'medium' : undefined}
				riskText={
					isDev
						? 'Повторная отправка может повторно вызвать внешнюю интеграцию, а закрытие без повтора окончательно исключает автоматическую доставку события.'
						: undefined
				}
			/>

			<div className={styles.section}>
				<div className={styles.header}>
					<div>
						<p className={styles.title}>Текущее состояние</p>
						<p className={styles.hint}>Автообновление каждые 15 секунд</p>
					</div>
					<button
						className={styles.button}
						onClick={() => overview.refetch()}
						disabled={overview.isFetching}
					>
						Обновить
					</button>
				</div>
				{isUserLoading || overview.isLoading ? (
					<>
						<div className={styles.cards}>
							{Array.from({ length: 6 }, (_, index) => (
								<SkeletonLoader
									key={index}
									count={1}
									className="h-[86px]"
								/>
							))}
						</div>
						<div className={styles.heartbeats}>
							<SkeletonLoader count={1} className="h-[32px] w-[180px]" />
							<SkeletonLoader count={1} className="h-[32px] w-[180px]" />
							<SkeletonLoader count={1} className="h-[32px] w-[180px]" />
						</div>
						<SkeletonLoader count={1} className="h-[44px]" />
						<SkeletonLoader count={1} className="h-[44px]" />
					</>
				) : overview.data ? (
					<>
						<div className={styles.cards}>
							<Metric
								title="Outbox ожидает"
								value={overview.data.outbox.PENDING}
								description="События уже сохранены в PostgreSQL, но ещё не опубликованы в RabbitMQ. Кратковременное значение допустимо; постоянный рост означает задержку publisher или недоступность RabbitMQ."
							/>
							<Metric
								title="Outbox ошибок"
								value={overview.data.outbox.FAILED}
								description="События, остановленные из-за недопустимого маршрута или контракта. Они не повторяются автоматически: сначала нужно исправить причину, затем безопасно вернуть конкретное событие в обработку."
							/>
							<Metric
								title="DLQ не решено"
								value={overview.data.unresolvedFailures}
								description="Consumers, исчерпавшие автоматические попытки. Ошибки доставки доступны DEV в блоке ниже; внутренние ошибки проекций также входят в итог и требуют проверки health сервиса-владельца."
							/>
							<Metric
								title="Повторяется"
								value={overview.data.retryingFailures}
								description="Ошибки из DLQ, для которых DEV запустил ручную повторную отправку, но успешная доставка ещё не подтверждена."
							/>
							<Metric
								title="Обработано за 24 часа"
								value={overview.data.processedLast24Hours}
								description="Успешно завершённые обработки отдельными consumers, а не уникальные бизнес-события. Например, одна оплата, обработанная email- и Telegram-consumers, даст две обработки. Завершённые backup сюда не входят."
							/>
							<Metric
								title="Успешных бэкапов за 24 часа"
								value={overview.data.completedBackupsLast24Hours}
								description="Успешно завершённые за последние 24 часа резервные копии 12 сервисных баз aeroCRM."
							/>
						</div>
						<div className={styles.heartbeats}>
							{overview.data.heartbeats.map(item => (
								<span key={item.service} className={styles.heartbeat}>
									<i
										className={
											item.status === 'ok' ? styles.ok : styles.down
										}
									/>
									{item.service}: {item.activeInstances}
								</span>
							))}
							<AdminTooltip
								title="Состояние процессов"
								description="Для Operations, Identity, Notification Delivery, Campaigns, Reporting и Billing зелёный индикатор означает heartbeat за последние 30 секунд. Platform и Support проверяются через собственные health endpoints. Число показывает количество активных экземпляров; эти проверки не подтверждают доступность SMTP, Telegram или CRM."
							/>
						</div>
						{overview.data.rabbitMqError && (
							<p className={styles.error}>
								RabbitMQ: {overview.data.rabbitMqError}
							</p>
						)}
						{overview.data.notificationDeliveryError && (
							<p className={styles.error}>
								Notification Delivery:{' '}
								{overview.data.notificationDeliveryError}
							</p>
						)}
						{overview.data.billingError && (
							<p className={styles.error}>
								Billing: {overview.data.billingError}
							</p>
						)}
						{overview.data.identityError && (
							<p className={styles.error}>
								Identity: {overview.data.identityError}
							</p>
						)}
						{overview.data.platformError && (
							<p className={styles.error}>
								Platform: {overview.data.platformError}
							</p>
						)}
						{overview.data.supportError && (
							<p className={styles.error}>
								Support: {overview.data.supportError}
							</p>
						)}
						{overview.data.campaignsError && (
							<p className={styles.error}>
								Campaigns: {overview.data.campaignsError}
							</p>
						)}
						{overview.data.reportingError && (
							<p className={styles.error}>
								Reporting: {overview.data.reportingError}
							</p>
						)}
						<div className={styles.queueHeading}>
							<span>Очереди RabbitMQ</span>
							<AdminTooltip
								title="Как читать таблицу очередей"
								description="«Готово» — сообщения ожидают обработки. «В работе» — уже переданы consumer, но ещё не подтверждены через ack. «Consumers» — подключённые обработчики. Для retry-очередей Consumers = 0 штатно: RabbitMQ сам вернёт сообщение после задержки. У пассивных provider DLQ consumer тоже отсутствует; такая очередь здорова только при «Готово» = 0 и «В работе» = 0, а любое сообщение требует диагностики. Активные DLQ переносят окончательные ошибки в PostgreSQL для ручной обработки."
							/>
						</div>
						<div className={styles.tableWrap}>
							<table>
								<thead>
									<tr>
										<th>Очередь</th>
										<th>Готово</th>
										<th>В работе</th>
										<th>Consumers</th>
									</tr>
								</thead>
								<tbody>
									{overview.data.queues.map(queue => (
										<tr key={queue.name}>
											<td>{queue.name}</td>
											<td>{queue.ready}</td>
											<td>{queue.unacknowledged}</td>
											<td>{queue.consumers}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</>
				) : (
					<p className={styles.empty}>
						Не удалось получить состояние очередей:{' '}
						{errorCatch(overview.error)}
					</p>
				)}
			</div>

			{isUserLoading ? (
				<div className={styles.section}>
					<div className={styles.failureSkeletons}>
						<SkeletonLoader count={1} className="h-[46px]" />
						<SkeletonLoader count={1} className="h-[58px]" />
						<SkeletonLoader count={1} className="h-[58px]" />
						<SkeletonLoader count={1} className="h-[58px]" />
					</div>
				</div>
			) : isDev ? (
				<div className={styles.section}>
					<div className={styles.header}>
						<div>
							<div className={styles.titleWithHelp}>
								<p className={styles.title}>Ошибки доставки</p>
								<AdminTooltip
									title="Ошибки доставки"
									description="Здесь находятся окончательные ошибки, перенесённые consumer из RabbitMQ DLQ в PostgreSQL. После диагностики DEV может повторить доставку или закрыть ошибку без повтора."
									risk="medium"
									riskText="При неопределённом результате внешнего запроса ручной retry может повторить уже выполненное действие. Закрытие без повтора требует обязательного комментария."
								/>
							</div>
							<p className={styles.hint}>
								Сообщения, перенесённые из DLQ в PostgreSQL
							</p>
						</div>
						<div className={styles.filters}>
							<label className={styles.selectWrap}>
								<span className="sr-only">Обработчик</span>
								<select
									value={integration}
									onChange={event => {
										setIntegration(event.target.value)
										setPage(1)
									}}
								>
									<option value="ALL">Все обработчики</option>
									{Object.entries(integrationLabels).map(
										([value, label]) => (
											<option key={value} value={value}>
												{label}
											</option>
										)
									)}
								</select>
							</label>
							<label className={styles.selectWrap}>
								<span className="sr-only">Категория</span>
								<select
									value={category}
									onChange={event => {
										setCategory(
											event.target.value as
												| MessagingFailureCategory
												| 'ALL'
										)
										setPage(1)
									}}
								>
									<option value="ALL">Все категории</option>
									{Object.entries(categoryLabels).map(([value, label]) => (
										<option key={value} value={value}>
											{label}
										</option>
									))}
								</select>
							</label>
							<label className={styles.selectWrap}>
								<span className="sr-only">Статус</span>
								<select
									value={status}
									onChange={event => {
										setStatus(event.target.value)
										setPage(1)
									}}
								>
									<option value="FAILED">Требуют внимания</option>
									<option value="RETRYING">Повторяются</option>
									<option value="RESOLVED">Решённые</option>
									<option value="CLOSED">Закрытые без повтора</option>
									<option value="ALL">Все</option>
								</select>
							</label>
						</div>
					</div>
					{failures.data &&
						unavailableFailureSources.map(source => (
							<p key={source} className={styles.error}>
								{failureSourceLabels[source]}:{' '}
								{failures.data.sourceErrors[source]}
							</p>
						))}
					{failures.isLoading ? (
						<div className={styles.failureSkeletons}>
							<SkeletonLoader count={1} className="h-[46px]" />
							<SkeletonLoader count={1} className="h-[58px]" />
							<SkeletonLoader count={1} className="h-[58px]" />
							<SkeletonLoader count={1} className="h-[58px]" />
						</div>
					) : failures.data?.items.length ? (
						<>
							<div className={styles.tableWrap}>
								<table>
									<thead>
										<tr>
											<th>Обработчик</th>
											<th>Категория</th>
											<th>Объект</th>
											<th>Ошибка</th>
											<th>Попытки</th>
											<th>Дата</th>
											<th>Действие</th>
										</tr>
									</thead>
									<tbody>
										{failures.data.items.map(item => {
											const isUnresolved = Boolean(
												!item.resolvedAt && !item.resolution
											)
											const hasActiveRetryLease = isRetryLeaseActive(
												item.retryingAt
											)
											const isCampaignDelivery =
												item.integration === 'campaign-email' ||
												item.integration === 'campaign-telegram'

											return (
												<tr key={item.id}>
													<td>{integrationLabels[item.integration]}</td>
													<td>
														<span
															className={`${styles.categoryBadge} ${getCategoryClassName(item.category)}`}
														>
															{item.category
																? categoryLabels[item.category]
																: 'Без классификации'}
														</span>
													</td>
													<td>
														{item.entity?.name || item.lead?.id || '—'}
													</td>
													<td>
														<div className={styles.errorDetails}>
															<p className={styles.error}>
																{item.safeReason || item.lastError}
															</p>
															{item.normalizedCode && (
																<code className={styles.errorCode}>
																	Код: {item.normalizedCode}
																</code>
															)}
															{item.resolution === 'DELIVERED' && (
																<span className={styles.resolution}>
																	Доставлено
																</span>
															)}
															{item.resolution === 'CLOSED_NO_RETRY' && (
																<span className={styles.resolution}>
																	Закрыто без повтора
																	{item.resolutionComment
																		? `: ${item.resolutionComment}`
																		: ''}
																</span>
															)}
														</div>
													</td>
													<td>{item.attempts}</td>
													<td>{formatDate(item.failedAt)}</td>
													<td>
														<div
															className={styles.failureActions}
															title={
																isCampaignDelivery
																	? 'Повтор доставки выполняется на странице кампании'
																	: undefined
															}
														>
															<button
																className={styles.retry}
																onClick={() => setRetryTarget(item)}
																disabled={
																	!isUnresolved ||
																	hasActiveRetryLease ||
																	isCampaignDelivery ||
																	retryMutation.isPending ||
																	closeMutation.isPending
																}
															>
																Повторить
															</button>
															{isUnresolved && (
																<button
																	className={styles.close}
																	onClick={() => openCloseDialog(item)}
																	disabled={
																		Boolean(item.retryingAt) ||
																		closeMutation.isPending ||
																		retryMutation.isPending
																	}
																>
																	Закрыть без повтора
																</button>
															)}
														</div>
													</td>
												</tr>
											)
										})}
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
					) : failures.isError ? (
						<p className={styles.empty}>
							Не удалось получить ошибки доставки:{' '}
							{errorCatch(failures.error)}
						</p>
					) : (
						<p className={styles.empty}>
							{unavailableFailureSources.length
								? 'Доступные источники не вернули ошибок; часть данных временно недоступна'
								: 'По выбранным фильтрам ошибок нет'}
						</p>
					)}
				</div>
			) : (
				<LockedFailuresPreview />
			)}
		</section>
	)
}

function LockedFailuresPreview() {
	return (
		<div
			className={`${styles.section} ${styles.lockedSection}`}
			aria-disabled="true"
		>
			<div className={styles.lockedPreview} aria-hidden="true">
				<div className={styles.header}>
					<div>
						<p className={styles.title}>Ошибки доставки</p>
						<p className={styles.hint}>
							Сообщения, перенесённые из DLQ в PostgreSQL
						</p>
					</div>
					<div className={styles.filters}>
						<label className={styles.selectWrap}>
							<select disabled aria-label="Обработчик">
								<option>Все обработчики</option>
							</select>
						</label>
						<label className={styles.selectWrap}>
							<select disabled aria-label="Категория">
								<option>Все категории</option>
							</select>
						</label>
						<label className={styles.selectWrap}>
							<select disabled aria-label="Статус">
								<option>Требуют внимания</option>
							</select>
						</label>
					</div>
				</div>
				<div className={styles.tableWrap}>
					<table>
						<thead>
							<tr>
								<th>Обработчик</th>
								<th>Категория</th>
								<th>Объект</th>
								<th>Ошибка</th>
								<th>Попытки</th>
								<th>Дата</th>
								<th>Действие</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td>Интеграция</td>
								<td>Без классификации</td>
								<td>—</td>
								<td>Детали ошибки доступны DEV</td>
								<td>—</td>
								<td>—</td>
								<td>
									<button className={styles.retry} disabled>
										Повторить
									</button>
								</td>
							</tr>
						</tbody>
					</table>
				</div>
			</div>
			<div className={styles.lockedOverlay}>
				<span className={styles.lockedBadge}>Только для DEV</span>
				<AdminTooltip
					title="DLQ и действия с ошибками заблокированы"
					description="Подробные ошибки доставки, повторная отправка и закрытие без повтора доступны только пользователям с ролью DEV. Мониторинг очередей выше остаётся доступен только для просмотра."
				/>
			</div>
		</div>
	)
}

function Metric({
	title,
	value,
	description
}: {
	title: string
	value: number
	description: string
}) {
	return (
		<div className={styles.metric}>
			<div className={styles.metricTitle}>
				<span>{title}</span>
				<AdminTooltip title={title} description={description} />
			</div>
			<strong>{value}</strong>
		</div>
	)
}
