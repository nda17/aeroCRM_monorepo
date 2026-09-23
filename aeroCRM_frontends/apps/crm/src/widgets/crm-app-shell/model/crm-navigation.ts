export type CrmNavigationIcon =
	| 'clock'
	| 'inbox'
	| 'deals'
	| 'tasks'
	| 'contacts'
	| 'analytics'
	| 'settings'
	| 'products'

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
			'Здесь задачи собраны по датам: выберите день или период и переключайтесь между списком и доской.'
	},
	{
		href: '/inbox',
		icon: 'inbox',
		label: 'Входящие',
		description:
			'Новые обращения поступают сюда из подключённых источников или создаются вручную. Принятие в работу выполняется отдельно.'
	},
	{
		href: '/deals',
		icon: 'deals',
		label: 'Сделки',
		description:
			'Ведите сделки по этапам, готовьте коммерческие предложения и отслеживайте связанные оплаты.'
	},
	{
		href: '/catalog',
		icon: 'products',
		label: 'Каталог',
		description:
			'Общий каталог товаров и услуг для сделок и предложений. Импорт из Excel или CSV меняет данные каталога.'
	},
	{
		href: '/tasks',
		icon: 'tasks',
		label: 'Задачи',
		description:
			'Здесь собраны задачи по сделкам: назначайте сроки и ответственных, отмечайте завершённые действия.'
	},
	{
		href: '/contacts',
		icon: 'contacts',
		label: 'Контакты',
		description:
			'Контакты связывают людей и компании со сделками. Здесь же хранятся заметки о клиентах.'
	},
	{
		href: '/analytics',
		icon: 'analytics',
		label: 'Аналитика',
		description:
			'Показатели продаж и работы команды рассчитываются по данным сделок и задач выбранного пространства.'
	},
	{
		href: '/settings',
		icon: 'settings',
		label: 'Настройки',
		description:
			'Здесь настраиваются сотрудники, отделы, права, источники обращений, SLA и оформление пространства.'
	}
] as const satisfies readonly CrmNavigationItem[]
