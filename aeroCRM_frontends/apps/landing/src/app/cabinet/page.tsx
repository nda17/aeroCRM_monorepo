import CabinetPageClient from '@/screens/account/ui/CabinetPageClient'
import type { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Личный кабинет',
	robots: { index: false, follow: false }
}

export default function CabinetPage() {
	return <CabinetPageClient />
}
