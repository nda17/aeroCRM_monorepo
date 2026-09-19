import { AdminSettings } from '@/screens/admin'
import type { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Настройки',
	description: 'Admin panel page'
}

const AdminSettingsPage = () => {
	return <AdminSettings />
}

export default AdminSettingsPage
