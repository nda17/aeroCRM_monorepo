import type {
	IAdminNavGroup,
	INavItem
} from '@/screens/admin/ui/common/admin-navigation/admin-navigation.interface'
import { ADMIN_PAGES } from '@/shared/config/pages/admin.config'

export const adminNavGroups: IAdminNavGroup[] = [
	{
		id: 'overview',
		title: 'Обзор',
		description: 'Показатели платформы и события, требующие внимания.',
		items: [
			{ title: 'Статистика', link: ADMIN_PAGES.HOME },
			{ title: 'Предупреждения', link: ADMIN_PAGES.ALERTS }
		]
	},
	{
		id: 'products',
		title: 'Клиенты и продукты',
		description: 'Аккаунты и рабочие пространства aeroCRM.',
		items: [
			{
				title: 'Пользователи',
				link: ADMIN_PAGES.USER_LIST,
				option: ADMIN_PAGES.USER
			},
			{ title: 'aeroCRM', link: ADMIN_PAGES.CRM }
		]
	},
	{
		id: 'finance',
		title: 'Финансы',
		description: 'Платежи и тарифы aeroCRM.',
		items: [
			{
				title: 'Подписки и платежи CRM',
				link: ADMIN_PAGES.FINANCE_SUBSCRIPTIONS
			},
			{ title: 'Тарифы CRM', link: ADMIN_PAGES.FINANCE_PRICING }
		]
	},
	{
		id: 'content',
		title: 'Контент и связь',
		description: 'Публичный сайт, документы и каналы коммуникации.',
		items: [
			{ title: 'Контент', link: ADMIN_PAGES.CONTENT },
			{ title: 'Поддержка', link: ADMIN_PAGES.SUPPORT },
			{ title: 'Рассылки', link: ADMIN_PAGES.MAILINGS },
			{ title: 'Telegram-боты', link: ADMIN_PAGES.TELEGRAM_BOT }
		]
	},
	{
		id: 'operations',
		title: 'Эксплуатация',
		description: 'Состояние сервисов, доставка событий и резервные копии.',
		items: [
			{ title: 'Система', link: ADMIN_PAGES.SYSTEM },
			{ title: 'Очереди', link: ADMIN_PAGES.MESSAGING },
			{ title: 'Базы данных', link: ADMIN_PAGES.DATABASES }
		]
	},
	{
		id: 'management',
		title: 'Управление',
		description: 'Настройки платформы, безопасность и аудит действий.',
		items: [
			{ title: 'Настройки', link: ADMIN_PAGES.SETTINGS },
			{ title: 'Журнал событий', link: ADMIN_PAGES.EVENT_LOG }
		]
	}
]

export const isAdminNavItemActive = (pathname: string, item: INavItem) =>
	pathname === item.link ||
	(item.link !== ADMIN_PAGES.HOME &&
		pathname.startsWith(`${item.link}/`)) ||
	Boolean(
		item.option &&
		(pathname === item.option || pathname.startsWith(`${item.option}/`))
	)
