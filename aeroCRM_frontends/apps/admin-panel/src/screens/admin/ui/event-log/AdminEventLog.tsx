'use client'

import AdminNavigation from '@/screens/admin/ui/common/admin-navigation/AdminNavigation'
import AdminSectionHeading from '@/screens/admin/ui/common/admin-section-heading/AdminSectionHeading'
import Heading from '@/shared/ui/heading/Heading'
import Pagination from '@/shared/ui/pagination/Pagination'
import SkeletonLoader from '@/shared/ui/skeleton-loader/SkeletonLoader'
import { ADMIN_PAGES } from '@/shared/config/pages/admin.config'
import {
	adminEventLogService,
	AdminEventLogAction,
	AdminEventLogSection,
	IAdminEventLogFilters,
	IAdminEventLogItem
} from '@/features/view-event-log'
import { useAuthStore } from '@/entities/user'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { NextPage } from 'next'
import Link from '@/shared/lib/navigation/ZoneLink'
import { FormEvent, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import styles from './AdminEventLog.module.scss'

const SECTION_LABELS: Record<AdminEventLogSection, string> = {
	PAYMENTS: 'Платежи',
	CAMPAIGNS: 'Кампании',
	TASKS: 'Ручные задачи',
	SUBSCRIPTIONS: 'Подписки',
	USERS: 'Пользователи',
	WIDGETS: 'Виджеты',
	SITE_SETTINGS: 'Настройки сайта',
	TELEGRAM_BOT: 'Telegram-бот',
	AFFILIATE: 'Партнёрка',
	DEV_TOOLS: 'Базы данных',
	MESSAGING: 'Очереди',
	REPORTING: 'Reporting',
	SUPPORT: 'Support',
	PLATFORM_CONTENT: 'Platform: контент'
}

const ACTION_LABELS: Record<AdminEventLogAction, string> = {
	PAYMENT_MANUAL_CHECK: 'Проверка платежа',
	PAYMENT_UNKNOWN_PROVIDER_RESOLVED:
		'Ручное разрешение неизвестного платежа',
	PAYMENT_CLEANUP_RUN: 'Очистка платежей',
	AUTO_RENEWAL_ADMIN_PAUSE: 'Пауза автопродления',
	AUTO_RENEWAL_ADMIN_RESUME: 'Возобновление автопродления',
	AUTO_RENEWAL_REVOKE: 'Отзыв согласия на автопродление',
	AUTO_RENEWAL_RECONCILE: 'Сверка автопродления',
	AUTO_RENEWAL_TECHNICAL_RESUME: 'Снятие технической паузы',
	TARIFF_PRICES_UPDATE: 'Изменение тарифных цен',
	LEGAL_PAGE_UPDATE: 'Изменение юридической страницы',
	CAMPAIGN_CREATE: 'Создание кампании',
	CAMPAIGN_CANCEL: 'Остановка кампании',
	CAMPAIGN_DELIVERY_RETRY: 'Повтор доставки кампании',
	SUBSCRIPTION_ACTIVATE: 'Активация подписки',
	SUBSCRIPTION_EXTEND_DAYS: 'Бонусные дни',
	SUBSCRIPTION_CANCEL: 'Отмена подписки',
	SUBSCRIPTION_EXPIRY_CHECK_RUN: 'Проверка подписок',
	VERIFICATION_CHALLENGE_CLEANUP_RUN: 'Очистка кодов',
	USER_UPDATE: 'Редактирование пользователя',
	USER_TOGGLE_ACTIVATION: 'Активация пользователя',
	USER_DELETE: 'Удаление пользователя',
	USER_SOFT_DELETE: 'Soft delete пользователя',
	USER_RESTORE: 'Восстановление пользователя',
	WIDGET_UPDATE: 'Редактирование виджета',
	WIDGET_PUBLISH: 'Публикация виджета',
	WIDGET_DRAFT_DISCARD: 'Отмена черновика виджета',
	WIDGET_VERSION_RESTORE: 'Восстановление настроек виджета',
	WIDGET_CLONE: 'Копирование виджета',
	WIDGET_DELETE: 'Удаление виджета',
	WIDGET_BUTTON_IMAGE_UPDATE: 'Изображение кнопки виджета',
	WIDGET_DELIVERY_RETRY: 'Повтор доставки виджета',
	WIDGET_DELIVERY_CLOSE: 'Закрытие доставки виджета без повтора',
	SITE_SETTINGS_UPDATE: 'Настройки сайта',
	AFFILIATE_SETTINGS_UPDATE: 'Настройки партнёрки',
	TELEGRAM_BOT_SETTINGS_UPDATE: 'Настройки Telegram-бота',
	TELEGRAM_SCHEDULE_SETTINGS_REJECTED:
		'Отклонение расписания Telegram-бота',
	TELEGRAM_BOT_WEBHOOK_REINSTALL: 'Webhook Telegram-бота',
	TELEGRAM_DATABASE_BACKUP_CREATE: 'Backup базы данных',
	TELEGRAM_DATABASE_RESTORE: 'Восстановление базы',
	DEV_DATABASE_RESTORE: 'DEV-восстановление базы',
	MESSAGING_FAILURE_RETRY: 'Повтор интеграции',
	MESSAGING_FAILURE_CLOSE_WITHOUT_RETRY: 'Закрытие интеграции без повтора',
	REPORTING_DAILY_SUMMARY_SETTINGS_UPDATE: 'Настройки Daily Summary',
	REPORTING_DAILY_SUMMARY_SCHEDULE_UPDATE: 'Расписание Daily Summary',
	REPORTING_DAILY_SUMMARY_SCHEDULE_REJECTED:
		'Отклонение расписания Daily Summary',
	REPORTING_DELIVERY_RETRY: 'Повтор обработки Reporting',
	SUPPORT_ROUTING_SETTINGS_UPDATE: 'Настройки маршрутизации Support',
	SUPPORT_WEBHOOK_REINSTALL: 'Webhook Support-бота',
	SUPPORT_CONVERSATION_REPLY: 'Ответ в поддержку CRM',
	SUPPORT_CONVERSATION_STATUS_UPDATE: 'Статус обращения поддержки',
	SUPPORT_NOTIFICATION_SETTINGS_UPDATE: 'Настройки уведомлений поддержки',
	PLATFORM_SITE_SETTINGS_UPDATE: 'Настройки сайта Platform',
	PLATFORM_LEGAL_PAGE_UPDATE: 'Юридическая страница Platform',
	PLATFORM_HOME_PAGE_CONTENT_UPDATE: 'Контент главной Platform',
	PLATFORM_HOME_PAGE_RAW_CODE_UPDATE: 'DEV-код Head/Body Platform'
}

type EventLogSectionFilter = AdminEventLogSection | 'ALL'
type EventLogActionFilter = AdminEventLogAction | 'ALL'

interface EventLogFilterDraft {
	section: EventLogSectionFilter
	action: EventLogActionFilter
	adminId: string
	createdFrom: string
	createdTo: string
}

const DEFAULT_EVENT_LOG_FILTERS: EventLogFilterDraft = {
	section: 'ALL',
	action: 'ALL',
	adminId: '',
	createdFrom: '',
	createdTo: ''
}

const SECTION_FILTER_OPTIONS: Array<{
	value: EventLogSectionFilter
	label: string
}> = [
	{ value: 'ALL', label: 'Все разделы' },
	...Object.entries(SECTION_LABELS).map(([value, label]) => ({
		value: value as AdminEventLogSection,
		label
	}))
]

const ACTION_FILTER_OPTIONS: Array<{
	value: EventLogActionFilter
	label: string
}> = [
	{ value: 'ALL', label: 'Все действия' },
	...Object.entries(ACTION_LABELS).map(([value, label]) => ({
		value: value as AdminEventLogAction,
		label
	}))
]

const normalizeEventLogFilters = (
	draft: EventLogFilterDraft
): IAdminEventLogFilters => ({
	section: draft.section === 'ALL' ? undefined : draft.section,
	action: draft.action === 'ALL' ? undefined : draft.action,
	adminId: draft.adminId.trim() || undefined,
	createdFrom: draft.createdFrom || undefined,
	createdTo: draft.createdTo || undefined
})

const formatDateTime = (value: string) =>
	new Intl.DateTimeFormat('ru-RU', {
		dateStyle: 'short',
		timeStyle: 'short'
	}).format(new Date(value))

const formatActor = (item: IAdminEventLogItem) =>
	item.adminName ||
	item.adminEmail ||
	item.adminId ||
	'Администратор не найден'

const formatTarget = (item: IAdminEventLogItem) =>
	item.targetUserName ||
	item.targetUserEmail ||
	item.entityLabel ||
	item.targetUserId ||
	item.entityId ||
	'—'

const getUserFilterHref = (userId: string) =>
	`${ADMIN_PAGES.EVENT_LOG}?userId=${encodeURIComponent(userId)}`

const renderUserFilterLink = (label: string, userId?: string | null) =>
	userId ? (
		<Link href={getUserFilterHref(userId)} className={styles.userLink}>
			{label}
		</Link>
	) : (
		label
	)

const getPrimitiveMetadata = (item: IAdminEventLogItem, key: string) => {
	const value = item.metadata?.[key]

	if (
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	) {
		return String(value)
	}

	return null
}

const formatMetadata = (item: IAdminEventLogItem) => {
	const metadata = item.metadata
	if (!metadata) return '—'

	const parts: string[] = []
	const affectedCount = getPrimitiveMetadata(item, 'affectedCount')
	const recipientCount = getPrimitiveMetadata(item, 'recipientCount')
	const sentCount = getPrimitiveMetadata(item, 'sentCount')
	const failedCount = getPrimitiveMetadata(item, 'failedCount')
	const days = getPrimitiveMetadata(item, 'days')
	const plan = getPrimitiveMetadata(item, 'plan')
	const billingPeriod = getPrimitiveMetadata(item, 'billingPeriod')
	const providerStatus = getPrimitiveMetadata(item, 'providerStatus')
	const localStatus = getPrimitiveMetadata(item, 'localStatus')
	const status = getPrimitiveMetadata(item, 'status')
	const reason = getPrimitiveMetadata(item, 'reason')
	const reasonCode = getPrimitiveMetadata(item, 'reasonCode')
	const previousStatus = getPrimitiveMetadata(item, 'previousStatus')
	const newStatus = getPrimitiveMetadata(item, 'newStatus')
	const amount = getPrimitiveMetadata(item, 'amount')
	const currency = getPrimitiveMetadata(item, 'currency')
	const nextChargeAt = getPrimitiveMetadata(item, 'nextChargeAt')
	const priceChangeRequired = getPrimitiveMetadata(
		item,
		'priceChangeRequired'
	)
	const stateVersion = getPrimitiveMetadata(item, 'stateVersion')
	const result = getPrimitiveMetadata(item, 'result')
	const dailySummaryEnabled = getPrimitiveMetadata(
		item,
		'dailySummaryEnabled'
	)
	const changedFields = metadata.changedFields ?? metadata.updatedFields

	if (affectedCount) parts.push(`Затронуто: ${affectedCount}`)
	if (recipientCount) parts.push(`Получателей: ${recipientCount}`)
	if (sentCount) parts.push(`Отправлено: ${sentCount}`)
	if (failedCount) parts.push(`Ошибок: ${failedCount}`)
	if (days) parts.push(`Дней: ${days}`)
	if (plan) parts.push(`Тариф: ${plan}`)
	if (billingPeriod) parts.push(`Период: ${billingPeriod}`)
	if (providerStatus) parts.push(`YooKassa: ${providerStatus}`)
	if (localStatus) parts.push(`Локально: ${localStatus}`)
	if (status) parts.push(`Статус: ${status}`)
	if (reason) parts.push(`Причина: ${reason}`)
	if (reasonCode) parts.push(`Код причины: ${reasonCode}`)
	if (previousStatus) parts.push(`Было: ${previousStatus}`)
	if (newStatus) parts.push(`Стало: ${newStatus}`)
	if (amount) {
		parts.push(`Сумма: ${amount}${currency ? ` ${currency}` : ''}`)
	}
	if (nextChargeAt) {
		parts.push(`Следующее списание: ${formatDateTime(nextChargeAt)}`)
	}
	if (priceChangeRequired) {
		parts.push(
			`Новая цена: ${
				priceChangeRequired === 'true'
					? 'требует подтверждения'
					: 'подтверждена'
			}`
		)
	}
	if (stateVersion) parts.push(`Версия: ${stateVersion}`)
	if (result) parts.push(`Результат: ${result}`)
	if (dailySummaryEnabled) {
		parts.push(
			`Сводка: ${dailySummaryEnabled === 'true' ? 'включена' : 'выключена'}`
		)
	}
	if (Array.isArray(changedFields) && changedFields.length) {
		parts.push(`Поля: ${changedFields.join(', ')}`)
	}
	if (metadata.passwordChanged === true) {
		parts.push('Пароль изменён')
	}

	return parts.join(' · ') || '—'
}

interface AdminEventLogProps {
	userId?: string
}

const AdminEventLog: NextPage<AdminEventLogProps> = ({ userId }) => {
	const auth = useAuthStore(state => state.auth)
	const userIdFilter = userId?.trim() || undefined
	const [currentPage, setCurrentPage] = useState(1)
	const [filterDraft, setFilterDraft] = useState(DEFAULT_EVENT_LOG_FILTERS)
	const [filters, setFilters] = useState<IAdminEventLogFilters>({})
	const itemQuantity = 20

	const { data, isLoading, isFetching } = useQuery({
		queryKey: [
			'admin-event-log',
			currentPage,
			itemQuantity,
			userIdFilter,
			filters
		],
		queryFn: () =>
			adminEventLogService.getAll(currentPage, itemQuantity, {
				...filters,
				userId: userIdFilter
			}),
		enabled: auth
	})

	const totalItems = data?.total ?? 0
	const totalPages = data?.totalPages ?? currentPage
	const activePage = data?.items ?? []
	const listPage = Array.from({ length: totalPages }, (_, i) => i + 1)

	useEffect(() => {
		if (currentPage > totalPages) {
			setCurrentPage(totalPages)
		}
	}, [currentPage, totalPages])

	useEffect(() => {
		setCurrentPage(1)
	}, [userIdFilter])

	const prevPage = () => setCurrentPage(page => Math.max(1, page - 1))
	const nextPage = () =>
		setCurrentPage(page => Math.min(totalPages, page + 1))
	const changeActivePage = (page: number) => setCurrentPage(page)
	const renderActor = (item: IAdminEventLogItem) =>
		renderUserFilterLink(formatActor(item), item.adminId)
	const renderTarget = (item: IAdminEventLogItem) =>
		renderUserFilterLink(formatTarget(item), item.targetUserId)

	const applyFilters = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		setFilters(normalizeEventLogFilters(filterDraft))
		setCurrentPage(1)
		toast.success('Фильтры журнала применены')
	}

	const resetFilters = () => {
		setFilterDraft(DEFAULT_EVENT_LOG_FILTERS)
		setFilters({})
		setCurrentPage(1)
		toast.success('Фильтры журнала сброшены')
	}

	return (
		<section className={styles.wrapper}>
			<Heading text="Панель администратора" />
			<AdminNavigation />
			<AdminSectionHeading
				text="Журнал событий"
				title="Журнал действий администратора"
				description="Показывает ручные действия администраторов: платежи, рассылки, задачи, подписки, пользователей и служебные операции."
				risk="low"
				riskText="Раздел только показывает уже записанные события и не меняет данные проекта."
			/>

			{userIdFilter && (
				<div className={styles.filterBar}>
					<div>
						<p className={styles.filterTitle}>Фильтр по пользователю</p>
						<p className={styles.filterValue}>{userIdFilter}</p>
					</div>
					<Link
						href={ADMIN_PAGES.EVENT_LOG}
						className={styles.clearFilter}
					>
						Показать все события
					</Link>
				</div>
			)}

			<form className={styles.filters} onSubmit={applyFilters}>
				<div className={styles.filterGrid}>
					<label className={styles.filterField}>
						<span className={styles.filterLabel}>Раздел</span>
						<select
							className={styles.filterInput}
							value={filterDraft.section}
							onChange={event =>
								setFilterDraft(prev => ({
									...prev,
									section: event.target.value as EventLogSectionFilter
								}))
							}
						>
							{SECTION_FILTER_OPTIONS.map(option => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					<label className={styles.filterField}>
						<span className={styles.filterLabel}>Действие</span>
						<select
							className={styles.filterInput}
							value={filterDraft.action}
							onChange={event =>
								setFilterDraft(prev => ({
									...prev,
									action: event.target.value as EventLogActionFilter
								}))
							}
						>
							{ACTION_FILTER_OPTIONS.map(option => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					<label className={styles.filterField}>
						<span className={styles.filterLabel}>ID админа</span>
						<input
							className={styles.filterInput}
							value={filterDraft.adminId}
							onChange={event =>
								setFilterDraft(prev => ({
									...prev,
									adminId: event.target.value
								}))
							}
							placeholder="ID администратора"
						/>
					</label>
					<label className={styles.filterField}>
						<span className={styles.filterLabel}>Дата с</span>
						<input
							className={styles.filterInput}
							type="date"
							value={filterDraft.createdFrom}
							onChange={event =>
								setFilterDraft(prev => ({
									...prev,
									createdFrom: event.target.value
								}))
							}
						/>
					</label>
					<label className={styles.filterField}>
						<span className={styles.filterLabel}>Дата по</span>
						<input
							className={styles.filterInput}
							type="date"
							value={filterDraft.createdTo}
							onChange={event =>
								setFilterDraft(prev => ({
									...prev,
									createdTo: event.target.value
								}))
							}
						/>
					</label>
				</div>
				<div className={styles.filterActions}>
					<button type="submit" className={styles.filterApply}>
						Применить
					</button>
					<button
						type="button"
						className={styles.filterReset}
						onClick={resetFilters}
					>
						Сбросить
					</button>
				</div>
			</form>

			{isLoading ? (
				<div className={styles.card}>
					{Array.from({ length: 6 }).map((_, index) => (
						<SkeletonLoader
							key={index}
							count={1}
							className={styles.skeletonRow}
						/>
					))}
				</div>
			) : totalItems ? (
				<div className={styles.listSection}>
					<div className={styles.listMeta}>
						<div>
							<p className={styles.metaTitle}>События</p>
							<p className={styles.metaSubtitle}>
								Всего записей: {totalItems}
							</p>
						</div>
						<p className={styles.metaSubtitle}>
							{isFetching
								? 'Обновляем...'
								: `Страница ${data?.page ?? currentPage} из ${totalPages}`}
						</p>
					</div>

					<div className={styles.mobileList}>
						{activePage.map(item => (
							<div key={item.id} className={styles.eventCard}>
								<div className={styles.cardRow}>
									<span className={styles.cardLabel}>Дата</span>
									<span className={styles.cardValue}>
										{formatDateTime(item.createdAt)}
									</span>
								</div>
								<div className={styles.cardRow}>
									<span className={styles.cardLabel}>Админ</span>
									<span className={styles.cardValue}>
										{renderActor(item)}
									</span>
								</div>
								<div className={styles.cardRow}>
									<span className={styles.cardLabel}>Раздел</span>
									<span
										className={clsx(
											styles.sectionBadge,
											styles[`section-${item.section.toLowerCase()}`]
										)}
									>
										{SECTION_LABELS[item.section] ?? item.section}
									</span>
								</div>
								<div className={styles.cardRow}>
									<span className={styles.cardLabel}>Действие</span>
									<span className={styles.cardValue}>
										{ACTION_LABELS[item.action] ?? item.action}
									</span>
								</div>
								<div className={styles.cardRow}>
									<span className={styles.cardLabel}>Объект</span>
									<span className={styles.cardValue}>
										{renderTarget(item)}
									</span>
								</div>
								<div className={styles.cardDetails}>
									<p>{item.description}</p>
									<span>{formatMetadata(item)}</span>
								</div>
							</div>
						))}
					</div>

					<div className={styles.tableScroll}>
						<table className={styles.table}>
							<caption className="srOnly">
								Журнал действий администратора
							</caption>
							<thead>
								<tr>
									<th scope="col">Дата</th>
									<th scope="col">Администратор</th>
									<th scope="col">Раздел</th>
									<th scope="col">Действие</th>
									<th scope="col">Объект</th>
									<th scope="col">Детали</th>
									<th scope="col">IP</th>
								</tr>
							</thead>
							<tbody>
								{activePage.map(item => (
									<tr key={item.id}>
										<td>{formatDateTime(item.createdAt)}</td>
										<td>
											<span className={styles.actor}>
												{renderActor(item)}
											</span>
											{item.adminEmail && (
												<span className={styles.actorEmail}>
													{item.adminEmail}
												</span>
											)}
										</td>
										<td>
											<span
												className={clsx(
													styles.sectionBadge,
													styles[`section-${item.section.toLowerCase()}`]
												)}
											>
												{SECTION_LABELS[item.section] ?? item.section}
											</span>
										</td>
										<td>{ACTION_LABELS[item.action] ?? item.action}</td>
										<td>{renderTarget(item)}</td>
										<td>
											<span className={styles.description}>
												{item.description}
											</span>
											<span className={styles.details}>
												{formatMetadata(item)}
											</span>
										</td>
										<td>{item.ip || '—'}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					{totalItems > itemQuantity && (
						<Pagination
							listPage={listPage}
							currentPage={currentPage}
							prevPage={prevPage}
							nextPage={nextPage}
							changeActivePage={changeActivePage}
						/>
					)}
				</div>
			) : (
				<div className={styles.card}>
					<p className={styles.metaSubtitle}>Событий пока нет</p>
				</div>
			)}
		</section>
	)
}

export default AdminEventLog
