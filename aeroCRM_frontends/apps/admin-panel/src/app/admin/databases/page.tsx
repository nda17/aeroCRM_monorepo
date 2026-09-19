import { AdminDatabases } from '@/screens/admin'
import type { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Базы данных',
	description: 'Admin panel database backup and restore page'
}

const AdminDatabasesPage = () => {
	return <AdminDatabases />
}

export default AdminDatabasesPage
