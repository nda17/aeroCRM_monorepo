import { Admin } from '@/screens/admin'
import type { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Обзор',
	description: 'Admin panel page'
}

const AdminPage = async () => {
	return <Admin />
}

export default AdminPage
