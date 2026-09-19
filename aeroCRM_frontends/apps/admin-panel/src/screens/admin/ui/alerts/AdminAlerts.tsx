'use client'

import AdminNavigation from '@/screens/admin/ui/common/admin-navigation/AdminNavigation'
import AdminSectionHeading from '@/screens/admin/ui/common/admin-section-heading/AdminSectionHeading'
import Heading from '@/shared/ui/heading/Heading'
import Pagination from '@/shared/ui/pagination/Pagination'
import SkeletonLoader from '@/shared/ui/skeleton-loader/SkeletonLoader'
import { ADMIN_PAGES } from '@/shared/config/pages/admin.config'
import {
	adminAlertsService,
	AdminAlertSeverity,
	AdminAlertType,
	IAdminAlert,
	IAdminAlertFilters
} from '@/features/admin-monitoring'
import { useAuthStore } from '@/entities/user'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { NextPage } from 'next'
import Link from '@/shared/lib/navigation/ZoneLink'
import { FormEvent, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import styles from './AdminAlerts.module.scss'

const TYPE_LABELS: Record<AdminAlertType, string> = {
	EXPIRED_ACTIVE_CRM_ENTITLEMENT: 'CRM-доступ истёк',
	CRM_ENTITLEMENT_EXPIRES_SOON: 'CRM-доступ скоро истекает',
	CRM_PROVIDER_OPERATION_UNKNOWN: 'Операция провайдера требует сверки',
	CRM_SUCCEEDED_ORDER_WITHOUT_ENTITLEMENT: 'Оплата без CRM-доступа',
	CRM_RECEIPT_PENDING: 'Чек ожидает подтверждения',
	INTEGRATION_PROBLEM: 'Проблема интеграции'
}

const SEVERITY_LABELS: Record<AdminAlertSeverity, string> = {
	HIGH: 'Высокая',
	MEDIUM: 'Средняя',
	LOW: 'Низкая'
}

type AlertTypeFilter = AdminAlertType | 'ALL'
type AlertSeverityFilter = AdminAlertSeverity | 'ALL'

interface AlertFilterDraft {
	type: AlertTypeFilter
	severity: AlertSeverityFilter
	search: string
}

const DEFAULT_FILTERS: AlertFilterDraft = {
	type: 'ALL',
	severity: 'ALL',
	search: ''
}

const TYPE_FILTER_OPTIONS: Array<{
	value: AlertTypeFilter
	label: string
}> = [
	{ value: 'ALL', label: 'Все типы' },
	...Object.entries(TYPE_LABELS).map(([value, label]) => ({
		value: value as AdminAlertType,
		label
	}))
]

const SEVERITY_FILTER_OPTIONS: Array<{
	value: AlertSeverityFilter
	label: string
}> = [
	{ value: 'ALL', label: 'Любая важность' },
	{ value: 'HIGH', label: SEVERITY_LABELS.HIGH },
	{ value: 'MEDIUM', label: SEVERITY_LABELS.MEDIUM },
	{ value: 'LOW', label: SEVERITY_LABELS.LOW }
]

const normalizeFilters = (
	draft: AlertFilterDraft
): IAdminAlertFilters => ({
	type: draft.type === 'ALL' ? undefined : draft.type,
	severity: draft.severity === 'ALL' ? undefined : draft.severity,
	search: draft.search.trim() || undefined
})

const hasActiveFilters = (filters: IAdminAlertFilters) =>
	Object.values(filters).some(Boolean)

const formatDateTime = (value: string) =>
	new Intl.DateTimeFormat('ru-RU', {
		dateStyle: 'short',
		timeStyle: 'short'
	}).format(new Date(value))

const formatUser = (item: IAdminAlert) =>
	item.targetUser?.name ||
	item.targetUser?.email ||
	item.targetUser?.id ||
	'—'

const formatUserContact = (item: IAdminAlert) =>
	item.targetUser?.email || item.targetUser?.id || ''

const getUserHref = (item: IAdminAlert) =>
	item.targetUser ? `/admin/user/edit/${item.targetUser.id}` : ''

const getAlertActions = (item: IAdminAlert) => {
	const actions: Array<{ href: string; label: string }> = []

	if (item.targetUser) {
		actions.push({
			href: getUserHref(item),
			label: 'Пользователь'
		})
	}

	if (
		['CRM_PROVIDER_OPERATION_UNKNOWN', 'CRM_SUCCEEDED_ORDER_WITHOUT_ENTITLEMENT', 'CRM_RECEIPT_PENDING'].includes(item.type)
	) {
		actions.push({ href: ADMIN_PAGES.CRM, label: 'Платежи' })
	}

	if (
		['CRM_ENTITLEMENT_EXPIRES_SOON', 'EXPIRED_ACTIVE_CRM_ENTITLEMENT'].includes(
			item.type
		)
	) {
		actions.push({ href: ADMIN_PAGES.CRM, label: 'Подписки' })
	}

	if (item.type === 'INTEGRATION_PROBLEM') {
		actions.push({ href: ADMIN_PAGES.SYSTEM, label: 'Система' })
	}

	return actions
}

const AdminAlerts: NextPage = () => {
	const auth = useAuthStore(state => state.auth)
	const [currentPage, setCurrentPage] = useState(1)
	const [filterDraft, setFilterDraft] = useState(DEFAULT_FILTERS)
	const [filters, setFilters] = useState<IAdminAlertFilters>({})
	const itemQuantity = 20

	const { data, isLoading, isFetching } = useQuery({
		queryKey: ['admin-alerts', currentPage, itemQuantity, filters],
		queryFn: () =>
			adminAlertsService.getAll(currentPage, itemQuantity, filters),
		enabled: auth,
		refetchInterval: 60000
	})

	const totalPages = data?.totalPages ?? 1
	const listPage = Array.from(
		{ length: totalPages },
		(_, index) => index + 1
	)
	const emptyListText = !hasActiveFilters(filters)
		? 'Активных предупреждений нет'
		: 'Предупреждений с такими фильтрами нет'

	useEffect(() => {
		if (currentPage > totalPages) {
			setCurrentPage(totalPages)
		}
	}, [currentPage, totalPages])

	const applyFilters = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		setFilters(normalizeFilters(filterDraft))
		setCurrentPage(1)
		toast.success('Фильтры предупреждений применены')
	}

	const resetFilters = () => {
		setFilterDraft(DEFAULT_FILTERS)
		setFilters({})
		setCurrentPage(1)
		toast.success('Фильтры предупреждений сброшены')
	}

	const prevPage = () => setCurrentPage(page => Math.max(1, page - 1))
	const nextPage = () =>
		setCurrentPage(page => Math.min(totalPages, page + 1))
	const changeActivePage = (page: number) => setCurrentPage(page)

	const renderUser = (item: IAdminAlert) => {
		const content = (
			<span className={styles.userCell}>
				<span>{formatUser(item)}</span>
				<span className={styles.muted}>{formatUserContact(item)}</span>
			</span>
		)

		return item.targetUser ? (
			<Link href={getUserHref(item)} className={styles.userLink}>
				{content}
			</Link>
		) : (
			content
		)
	}

	const renderActions = (item: IAdminAlert) => {
		const actions = getAlertActions(item)

		if (!actions.length) return '—'

		return (
			<div className={styles.actionsCell}>
				{actions.map(action => (
					<Link
						key={`${item.type}-${item.referenceId}-${action.href}`}
						href={action.href}
						className={styles.actionLink}
					>
						{action.label}
					</Link>
				))}
			</div>
		)
	}

	return (
		<section className={styles.wrapper}>
			<Heading text="Панель администратора" />
			<AdminNavigation />

			<AdminSectionHeading
				text="Предупреждения"
				title="Центр предупреждений"
				description="Собирает операционные ситуации, которые требуют внимания: подписки, платежи, домены виджетов, интеграции и партнёрские начисления."
				risk="medium"
				riskText="Раздел показывает проблемы, но не исправляет их автоматически. Перед ручным действием открой пользователя или платёж и проверь контекст."
			/>

			<form className={styles.filters} onSubmit={applyFilters}>
				<div className={styles['filter-grid']}>
					<label className={styles['filter-field']}>
						<span className={styles['filter-label']}>Тип</span>
						<select
							className={styles['filter-input']}
							value={filterDraft.type}
							onChange={event =>
								setFilterDraft(prev => ({
									...prev,
									type: event.target.value as AlertTypeFilter
								}))
							}
						>
							{TYPE_FILTER_OPTIONS.map(option => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					<label className={styles['filter-field']}>
						<span className={styles['filter-label']}>Важность</span>
						<select
							className={styles['filter-input']}
							value={filterDraft.severity}
							onChange={event =>
								setFilterDraft(prev => ({
									...prev,
									severity: event.target.value as AlertSeverityFilter
								}))
							}
						>
							{SEVERITY_FILTER_OPTIONS.map(option => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					<label className={styles['filter-field']}>
						<span className={styles['filter-label']}>Поиск</span>
						<input
							className={styles['filter-input']}
							value={filterDraft.search}
							onChange={event =>
								setFilterDraft(prev => ({
									...prev,
									search: event.target.value
								}))
							}
							placeholder="ID, контакт, имя, текст"
						/>
					</label>
				</div>
				<div className={styles['filter-actions']}>
					<button type="submit" className={styles['filter-apply']}>
						Применить
					</button>
					<button
						type="button"
						className={styles['filter-reset']}
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
			) : data ? (
				<div className={styles['list-section']}>
					<div className={styles['list-meta']}>
						<div>
							<p className={styles['meta-title']}>
								Активные предупреждения
							</p>
							<p className={styles['meta-subtitle']}>
								Всего записей: {data.total}
							</p>
						</div>
						<p className={styles['meta-subtitle']}>
							{isFetching
								? 'Обновляем...'
								: `Страница ${data.page} из ${data.totalPages}`}
						</p>
					</div>

					{data.items.length ? (
						<>
							<div className={styles['mobile-list']}>
								{data.items.map(item => (
									<div
										className={styles.alertCard}
										key={`${item.type}-${item.referenceId}`}
									>
										<div className={styles.cardRow}>
											<span className={styles.cardLabel}>Важность</span>
											<span
												className={clsx(
													styles.severity,
													styles[`severity-${item.severity.toLowerCase()}`]
												)}
											>
												{SEVERITY_LABELS[item.severity]}
											</span>
										</div>
										<div className={styles.cardRow}>
											<span className={styles.cardLabel}>Тип</span>
											<span className={styles.cardValue}>
												{TYPE_LABELS[item.type]}
											</span>
										</div>
										<div className={styles.cardRow}>
											<span className={styles.cardLabel}>
												Пользователь
											</span>
											<span className={styles.cardValue}>
												{renderUser(item)}
											</span>
										</div>
										<div className={styles.cardRow}>
											<span className={styles.cardLabel}>Суть</span>
											<span className={styles.cardValue}>
												{item.message}
											</span>
										</div>
										<div className={styles.cardRow}>
											<span className={styles.cardLabel}>Дата</span>
											<span className={styles.cardValue}>
												{formatDateTime(item.alertAt)}
											</span>
										</div>
										<div className={styles.cardRow}>
											<span className={styles.cardLabel}>Действия</span>
											<span className={styles.cardValue}>
												{renderActions(item)}
											</span>
										</div>
									</div>
								))}
							</div>

							<div className={styles['table-scroll']}>
								<table className={styles.table}>
									<caption className="srOnly">
										Центр предупреждений администратора
									</caption>
									<thead>
										<tr>
											<th scope="col">Важность</th>
											<th scope="col">Тип</th>
											<th scope="col">Пользователь</th>
											<th scope="col">Сообщение</th>
											<th scope="col">Дата</th>
											<th scope="col">Действия</th>
										</tr>
									</thead>
									<tbody>
										{data.items.map(item => (
											<tr key={`${item.type}-${item.referenceId}`}>
												<td>
													<span
														className={clsx(
															styles.severity,
															styles[
																`severity-${item.severity.toLowerCase()}`
															]
														)}
													>
														{SEVERITY_LABELS[item.severity]}
													</span>
												</td>
												<td>{TYPE_LABELS[item.type]}</td>
												<td>{renderUser(item)}</td>
												<td>
													<div className={styles.messageCell}>
														<span>{item.title}</span>
														<span className={styles.muted}>
															{item.message}
														</span>
													</div>
												</td>
												<td>{formatDateTime(item.alertAt)}</td>
												<td>{renderActions(item)}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>

							{data.total > itemQuantity && (
								<Pagination
									listPage={listPage}
									currentPage={currentPage}
									prevPage={prevPage}
									nextPage={nextPage}
									changeActivePage={changeActivePage}
								/>
							)}
						</>
					) : (
						<div className={styles.emptyState}>
							<p className={styles['meta-subtitle']}>{emptyListText}</p>
						</div>
					)}
				</div>
			) : (
				<div className={styles.card}>
					<p className={styles['meta-subtitle']}>
						Активных предупреждений нет
					</p>
				</div>
			)}
		</section>
	)
}

export default AdminAlerts
