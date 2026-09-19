import { AdminTelegramBot } from '@/screens/admin'
import type { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Telegram-бот',
	description: 'Admin panel Telegram bot settings page'
}

const AdminTelegramBotPage = () => {
	return <AdminTelegramBot />
}

export default AdminTelegramBotPage
