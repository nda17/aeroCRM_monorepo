import AdminSupport from '@/screens/admin/ui/support/AdminSupport'
import type { Metadata } from 'next'
export const metadata: Metadata = {
	title: 'Поддержка',
	description: 'Обращения клиентов aeroCRM'
}
export default function SupportPage() {
	return <AdminSupport />
}
