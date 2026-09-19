'use client'

import { UserRole, useAuthStore, useUser } from '@/entities/user'
import { axiosInterceptorsRequest } from '@/shared/api'
import styles from '@/screens/admin/ui/Admin.module.scss'
import AdminNavigation from '@/screens/admin/ui/common/admin-navigation/AdminNavigation'
import AdminSectionHeading from '@/screens/admin/ui/common/admin-section-heading/AdminSectionHeading'
import Heading from '@/shared/ui/heading/Heading'
import { NextPage } from 'next'
import { useQuery } from '@tanstack/react-query'

interface CrmDashboard {
	schemaVersion: 1
	users: { total: number; active30d: number; new30d: number; admins: number; multiLoginUsers: number }
	crm: { activePaidWorkspaces: number; activeTrialWorkspaces: number; expiring7d: number; expiredActive: number }
	revenue: { totalMinor: number; last30dMinor: number; currentMonthMinor: number; paidOrders30d: number; monthly: { month: string; revenueMinor: number; paidOrders: number }[] }
}

const rubles = (minor: number) => (minor / 100).toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' })

const Admin: NextPage = () => {
	const auth = useAuthStore(state => state.auth)
	const resolved = useAuthStore(state => state.isAuthResolved)
	const { user, isLoading } = useUser()
	const canView = Boolean(resolved && auth && !isLoading && user.rights?.some(role => role === UserRole.ADMIN || role === UserRole.DEV))
	const dashboard = useQuery({
		queryKey: ['admin-crm-reporting-dashboard'],
		queryFn: async () => {
			const { data } = await axiosInterceptorsRequest.get<CrmDashboard>('/admin/reporting/dashboard')
			if (data.schemaVersion !== 1 || !data.crm || !data.revenue) throw new Error('Invalid CRM dashboard')
			return data
		},
		enabled: canView,
		staleTime: 60_000,
		retry: 1
	})
	return (
		<section className={styles.wrapper}>
			<Heading text="Панель администратора" />
			<AdminNavigation />
			<AdminSectionHeading
				text="Дашборд"
				title="Панель администратора"
				description="Управление CRM, пользователями и контентом."
				risk="low"
				riskText="Блок только показывает статистику и не меняет данные. Ошибка возможна в трактовке цифр, если смотреть период без контекста."
			/>
			{!resolved || isLoading ? <p role="status">Проверяем доступ...</p> : !canView ? <p>Статистика доступна ADMIN и DEV.</p> : dashboard.isLoading ? <p role="status">Загружаем статистику CRM...</p> : dashboard.isError ? <p role="alert">Статистика CRM временно недоступна.</p> : dashboard.data && <div className={styles.metrics}>
				<article><span>Оплаченные CRM</span><strong>{dashboard.data.crm.activePaidWorkspaces}</strong></article>
				<article><span>Пробные CRM</span><strong>{dashboard.data.crm.activeTrialWorkspaces}</strong></article>
				<article><span>Истекают за 7 дней</span><strong>{dashboard.data.crm.expiring7d}</strong></article>
				<article><span>Пользователей всего</span><strong>{dashboard.data.users.total}</strong></article>
				<article><span>Выручка за 30 дней</span><strong>{rubles(dashboard.data.revenue.last30dMinor)}</strong></article>
				<article><span>Оплаченных заказов за 30 дней</span><strong>{dashboard.data.revenue.paidOrders30d}</strong></article>
			</div>}
		</section>
	)
}

export default Admin
