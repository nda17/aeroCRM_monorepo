import { UserList } from '@/screens/admin'
import type { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Пользователи',
	description: 'Admin panel page'
}

const UserListPage = async () => {
	return <UserList />
}

export default UserListPage
