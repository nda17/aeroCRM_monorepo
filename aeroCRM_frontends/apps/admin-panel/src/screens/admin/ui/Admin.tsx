'use client'

import { UserRole, useAuthStore, useUser } from '@/entities/user'
import {
	adminAlertsService,
	adminHealthService
} from '@/features/admin-monitoring'
import { axiosInterceptorsRequest } from '@/shared/api'
import { ADMIN_PAGES } from '@/shared/config/pages/admin.config'
import Link from '@/shared/lib/navigation/ZoneLink'
import styles from './Admin.module.scss'
import { useQuery } from '@tanstack/react-query'

interface CrmDashboard {
	schemaVersion: 1
	users: {
		total: number
		active30d: number
		new30d: number
		admins: number
		multiLoginUsers: number
	}
	crm: {
		activePaidWorkspaces: number
		activeTrialWorkspaces: number
		expiring7d: number
		expiredActive: number
	}
	revenue: {
		totalMinor: number
		last30dMinor: number
		currentMonthMinor: number
		paidOrders30d: number
		monthly: { month: string; revenueMinor: number; paidOrders: number }[]
	}
}

const rubles = (minor: number) =>
	(minor / 100).toLocaleString('ru-RU', {
		style: 'currency',
		currency: 'RUB',
		maximumFractionDigits: 0
	})
const statuses = {
	ok: 'Работает',
	warning: 'Внимание',
	down: 'Ошибка',
	disabled: 'Отключено'
}

export default function Admin() {
	const auth = useAuthStore(state => state.auth)
	const resolved = useAuthStore(state => state.isAuthResolved)
	const { user, isLoading } = useUser()
	const canView = Boolean(
		resolved &&
		auth &&
		!isLoading &&
		user.rights?.some(
			role => role === UserRole.ADMIN || role === UserRole.DEV
		)
	)
	const dashboard = useQuery({
		queryKey: ['admin-crm-reporting-dashboard'],
		queryFn: async () => {
			const { data } = await axiosInterceptorsRequest.get<CrmDashboard>(
				'/admin/reporting/dashboard'
			)
			if (
				data.schemaVersion !== 1 ||
				!data.users ||
				!data.crm ||
				!data.revenue
			)
				throw new Error('Invalid CRM dashboard')
			return data
		},
		enabled: canView,
		staleTime: 60_000,
		retry: 1
	})
	const alerts = useQuery({
		queryKey: ['admin-overview-alerts'],
		queryFn: () => adminAlertsService.getAll(1, 4),
		enabled: canView,
		staleTime: 60_000,
		retry: 1
	})
	const health = useQuery({
		queryKey: ['admin-health'],
		queryFn: adminHealthService.get,
		enabled: canView,
		staleTime: 30_000,
		retry: 1
	})
	const refresh = () => {
		void dashboard.refetch()
		void alerts.refetch()
		void health.refetch()
	}
	const busy =
		dashboard.isFetching || alerts.isFetching || health.isFetching
	const data = dashboard.data
	const metrics = data
		? [
				{
					label: 'Оплаченные CRM',
					value: data.crm.activePaidWorkspaces,
					hint: 'Активные рабочие пространства',
					href: ADMIN_PAGES.FINANCE_SUBSCRIPTIONS
				},
				{
					label: 'Пробные CRM',
					value: data.crm.activeTrialWorkspaces,
					hint: 'Действующий пробный период',
					href: ADMIN_PAGES.FINANCE_SUBSCRIPTIONS
				},
				{
					label: 'Истекают за 7 дней',
					value: data.crm.expiring7d,
					hint: 'Потребуется продление доступа',
					href: ADMIN_PAGES.ALERTS
				},
				{
					label: 'Пользователей',
					value: data.users.total,
					hint: 'Всего на платформе',
					href: ADMIN_PAGES.USER_LIST
				},
				{
					label: 'Выручка за 30 дней',
					value: rubles(data.revenue.last30dMinor),
					hint: 'Подтверждённые оплаты',
					href: ADMIN_PAGES.FINANCE_SUBSCRIPTIONS
				},
				{
					label: 'Оплаченных заказов',
					value: data.revenue.paidOrders30d,
					hint: 'За последние 30 дней',
					href: ADMIN_PAGES.FINANCE_SUBSCRIPTIONS
				}
			]
		: []

	return (
		<section className={styles.wrapper}>
			<div className={styles.heading}>
				<div>
					<p className={styles.eyebrow}>ПЛАТФОРМА AEROCRM</p>
					<h1>Обзор</h1>
					<p>Клиенты, подписки и состояние сервиса — в одном месте.</p>
				</div>
				<button
					type="button"
					onClick={refresh}
					disabled={busy || !canView}
					className={styles.refresh}
				>
					{busy ? 'Обновляем…' : 'Обновить данные'}
				</button>
			</div>
			{!resolved || isLoading ? (
				<p role="status" className={styles.state}>
					Проверяем доступ…
				</p>
			) : !canView ? (
				<p className={styles.state}>Статистика доступна ADMIN и DEV.</p>
			) : (
				<>
					{dashboard.isLoading ? (
						<div
							className={styles.metrics}
							aria-label="Загружаем статистику"
							aria-busy="true"
						>
							{Array.from({ length: 6 }, (_, i) => (
								<div key={i} className={styles.skeleton} />
							))}
						</div>
					) : dashboard.isError ? (
						<div role="alert" className={styles.state}>
							Не удалось обновить статистику CRM.{' '}
							<button onClick={() => void dashboard.refetch()}>
								Повторить
							</button>
						</div>
					) : (
						<div className={styles.metrics}>
							{metrics.map(metric => (
								<Link
									href={metric.href}
									key={metric.label}
									className={styles.metric}
								>
									<span>{metric.label}</span>
									<strong>{metric.value}</strong>
									<small>{metric.hint}</small>
								</Link>
							))}
						</div>
					)}
					<div className={styles.columns}>
						<section className={styles.panel}>
							<div className={styles.panelHeader}>
								<h2>
									Требует внимания{' '}
									{alerts.data && (
										<span className={styles.count}>
											{alerts.data.total}
										</span>
									)}
								</h2>
								<Link href={ADMIN_PAGES.ALERTS}>Все предупреждения →</Link>
							</div>
							{alerts.isLoading ? (
								<p className={styles.state} role="status">
									Загружаем предупреждения…
								</p>
							) : alerts.isError ? (
								<p className={styles.state} role="alert">
									Предупреждения временно недоступны.{' '}
									<button onClick={() => void alerts.refetch()}>
										Повторить
									</button>
								</p>
							) : !alerts.data?.items.length ? (
								<div className={styles.state}>
									<strong>Активных предупреждений нет</strong>
									<p>Новые события появятся здесь после обновления.</p>
								</div>
							) : (
								alerts.data.items.map(item => (
									<Link
										className={styles.alert}
										href={ADMIN_PAGES.ALERTS}
										key={`${item.type}-${item.referenceId}`}
									>
										<span
											className={
												styles[
													item.severity === 'HIGH'
														? 'dangerMark'
														: 'warningMark'
												]
											}
											aria-hidden="true"
										>
											!
										</span>
										<div>
											<h3>{item.title}</h3>
											<p>{item.message}</p>
										</div>
										<span aria-hidden="true">→</span>
									</Link>
								))
							)}
						</section>
						<section className={styles.panel}>
							<div className={styles.panelHeader}>
								<h2>Состояние системы</h2>
								<Link href={ADMIN_PAGES.SYSTEM}>Подробнее →</Link>
							</div>
							{health.isLoading ? (
								<p className={styles.state} role="status">
									Проверяем сервисы…
								</p>
							) : health.isError ? (
								<p className={styles.state} role="alert">
									Не удалось проверить сервисы.{' '}
									<button onClick={() => void health.refetch()}>
										Повторить
									</button>
								</p>
							) : (
								health.data && (
									<div className={styles.health}>
										<p className={styles.checkTime}>
											Проверено{' '}
											{new Date(health.data.generatedAt).toLocaleString(
												'ru-RU',
												{
													day: 'numeric',
													month: 'short',
													hour: '2-digit',
													minute: '2-digit'
												}
											)}
										</p>
										{health.data.checks.map(check => (
											<div key={check.id} className={styles.healthRow}>
												<span>{check.title}</span>
												<span className={styles[check.status]}>
													<i aria-hidden="true" />
													{statuses[check.status]}
												</span>
											</div>
										))}
									</div>
								)
							)}
						</section>
					</div>
					<div className={styles.shortcuts}>
						{[
							{
								href: ADMIN_PAGES.USER_LIST,
								title: 'Клиенты',
								text: 'Профили, роли и доступ'
							},
							{
								href: ADMIN_PAGES.FINANCE_SUBSCRIPTIONS,
								title: 'Подписки и платежи',
								text: 'Сроки, места и сверка оплат'
							},
							{
								href: ADMIN_PAGES.SUPPORT,
								title: 'Поддержка',
								text: 'Обращения и ответы клиентам'
							}
						].map(link => (
							<Link key={link.href} href={link.href}>
								<div>
									<h2>{link.title}</h2>
									<p>{link.text}</p>
								</div>
								<span aria-hidden="true">↗</span>
							</Link>
						))}
					</div>
				</>
			)}
		</section>
	)
}
