import { AdminMailings } from '@/screens/admin'
import type { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Рассылки',
	description: 'Admin panel page'
}

const AdminMailingsPage = () => {
	return <AdminMailings />
}

export default AdminMailingsPage
