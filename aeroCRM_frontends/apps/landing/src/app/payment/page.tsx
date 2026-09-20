import PaymentPageClient from '@/screens/account/ui/PaymentPageClient'
import type { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Подписка и оплата',
	robots: { index: false, follow: false }
}

export default function PaymentPage() {
	return <PaymentPageClient />
}
