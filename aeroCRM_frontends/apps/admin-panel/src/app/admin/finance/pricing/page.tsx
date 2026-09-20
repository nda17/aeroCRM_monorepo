import AdminFinance from '@/screens/admin/ui/finance/AdminFinance'
import type { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Тарифы CRM',
	description: 'Настройки тарифа aeroCRM',
	robots: { index: false, follow: false }
}

export default function AdminFinancePricingPage() {
	return <AdminFinance section="pricing" />
}
