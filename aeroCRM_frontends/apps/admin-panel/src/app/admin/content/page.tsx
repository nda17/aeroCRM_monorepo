import { AdminContentSettings } from '@/screens/admin'
import type { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Настройки контента сайта',
	description: 'Admin panel page'
}

const AdminContentSettingsPage = () => {
	return <AdminContentSettings />
}

export default AdminContentSettingsPage
