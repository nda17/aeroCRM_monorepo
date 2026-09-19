export type CrmNavigationIcon =
	| 'clock'
	| 'inbox'
	| 'deals'
	| 'tasks'
	| 'contacts'
	| 'analytics'
	| 'settings'

export interface CrmNavigationItem {
	href: string
	icon: CrmNavigationIcon
	label: string
	description: string
}

export const CRM_NAVIGATION = [
	{
		href: '/planner',
		icon: 'clock',
		label: 'Планировщик',
		description:
			'Планируйте задачи на выбранный день или период — списком или на доске.'
	},
	{
		href: '/inbox',
		icon: 'inbox',
		label: 'Входящие',
		description:
			'Обрабатывайте обращения и подключайте источники новых заявок.'
	},
	{
		href: '/deals',
		icon: 'deals',
		label: 'Сделки',
		description:
			'Ведите клиентов по этапам продаж и следите за результатами сделок.'
	},
	{
		href: '/tasks',
		icon: 'tasks',
		label: 'Задачи',
		description:
			'Просматривайте задачи по сделкам и фиксируйте выполненные действия.'
	},
	{
		href: '/contacts',
		icon: 'contacts',
		label: 'Контакты',
		description: 'Храните контакты клиентов, компании и заметки о них.'
	},
	{
		href: '/analytics',
		icon: 'analytics',
		label: 'Аналитика',
		description:
			'Оценивайте показатели продаж и результаты работы команды.'
	},
	{
		href: '/settings',
		icon: 'settings',
		label: 'Настройки',
		description:
			'Управляйте сотрудниками, отделами и настройками рабочего пространства.'
	}
] as const satisfies readonly CrmNavigationItem[]
