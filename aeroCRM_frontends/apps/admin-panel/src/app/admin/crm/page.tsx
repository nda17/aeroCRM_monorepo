import { AdminCrm } from '@/screens/admin'
import type { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Шаблоны процессов',
	description: 'Настройки и состояние aeroCRM'
}

const AdminCrmPage = () => {
	return <AdminCrm />
}

export default AdminCrmPage
