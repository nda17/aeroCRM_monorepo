import { AdminMessaging } from '@/screens/admin'
import type { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Очереди интеграций',
	description: 'Admin messaging monitoring page'
}

export default function AdminMessagingPage() {
	return <AdminMessaging />
}
