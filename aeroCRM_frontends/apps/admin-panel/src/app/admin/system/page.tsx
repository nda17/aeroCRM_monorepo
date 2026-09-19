import { AdminSystem } from '@/screens/admin'
import type { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Система',
	description: 'Admin system status page'
}

const AdminSystemPage = () => {
	return <AdminSystem />
}

export default AdminSystemPage
