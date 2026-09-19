import { AdminEventLog } from '@/screens/admin'
import type { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Журнал событий',
	description: 'Admin panel event log page'
}

interface AdminEventLogPageProps {
	searchParams?: {
		userId?: string
	}
}

const AdminEventLogPage = ({ searchParams }: AdminEventLogPageProps) => {
	return <AdminEventLog userId={searchParams?.userId} />
}

export default AdminEventLogPage
