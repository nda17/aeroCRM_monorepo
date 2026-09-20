'use client'

import AdminNavigation from '@/screens/admin/ui/common/admin-navigation/AdminNavigation'
import AdminSectionHeading from '@/screens/admin/ui/common/admin-section-heading/AdminSectionHeading'
import CrmPricingSettings from '@/screens/admin/ui/crm/CrmPricingSettings'
import CrmProviderOperations from '@/screens/admin/ui/crm/CrmProviderOperations'
import CrmSubscriptionAdmin from '@/screens/admin/ui/crm/CrmSubscriptionAdmin'
import styles from '@/screens/admin/ui/crm/AdminCrm.module.scss'
import Heading from '@/shared/ui/heading/Heading'

interface AdminFinanceProps {
	section: 'subscriptions' | 'pricing'
}

export default function AdminFinance({ section }: AdminFinanceProps) {
	const subscriptions = section === 'subscriptions'
	return (
		<section className={styles.wrapper}>
			<Heading text="Панель администратора" />
			<AdminNavigation />
			<AdminSectionHeading
				text={subscriptions ? 'Подписки и платежи CRM' : 'Тарифы CRM'}
				title={
					subscriptions
						? 'Операции с подписками и платежами'
						: 'Настройки тарифа aeroCRM'
				}
				description={
					subscriptions
						? 'Подписки рабочих пространств, история начислений и состояние платежей.'
						: 'Стоимость подписки и дополнительных сотрудников, число мест в базовом тарифе.'
				}
				risk={subscriptions ? 'medium' : 'high'}
				riskText={
					subscriptions
						? 'Начисление дней и повторная сверка платежей могут изменить состояние подписки. Проверьте выбранное рабочее пространство.'
						: 'Изменение цен и лимитов влияет на будущие расчёты. Перед сохранением проверьте суммы и число включённых мест.'
				}
			/>
			{subscriptions ? (
				<>
					<CrmSubscriptionAdmin />
					<CrmProviderOperations />
				</>
			) : (
				<CrmPricingSettings />
			)}
		</section>
	)
}
