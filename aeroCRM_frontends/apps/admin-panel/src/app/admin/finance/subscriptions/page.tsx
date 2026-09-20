import AdminFinance from '@/screens/admin/ui/finance/AdminFinance'
import type { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Подписки и платежи CRM',
	description: 'Управление подписками и платежными операциями aeroCRM',
	robots: { index: false, follow: false }
}

export default function AdminFinanceSubscriptionsPage() {
	return <AdminFinance section="subscriptions" />
}
