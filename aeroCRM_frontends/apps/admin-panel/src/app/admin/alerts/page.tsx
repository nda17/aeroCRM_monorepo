import { AdminAlerts } from '@/screens/admin'
import type { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Предупреждения',
	description: 'Admin panel alerts page'
}

const AdminAlertsPage = () => {
	return <AdminAlerts />
}

export default AdminAlertsPage
