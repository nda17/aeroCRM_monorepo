export type PreviewDeal = {
	id: string
	title: string
	company: string
	contact: string
	contactId?: string
	initials: string
	amount: number
	stage: number
	owner: string
	ownerInitials: string
	task: string
	nextTaskOwner?: string
	due: string
	overdue: boolean
	source: string
}

export const PREVIEW_STAGES = [
	'Новые',
	'В работе',
	'Предложение',
	'Согласование',
	'Оплата'
]

export const PREVIEW_DEALS: PreviewDeal[] = [
	{
		id: 'deal-001',
		title: 'Внедрение CRM для отдела продаж',
		company: 'Северный меридиан',
		contact: 'Ирина Ветрова',
		initials: 'ИВ',
		amount: 480000,
		stage: 0,
		owner: 'Анна Смирнова',
		ownerInitials: 'АС',
		task: 'Позвонить и уточнить число пользователей',
		due: 'Сегодня, 11:30',
		overdue: false,
		source: 'Сайт'
	},
	{
		id: 'deal-002',
		title: 'Интеграция с системой учёта',
		company: 'ТехноПарк Волга',
		contact: 'Марк Лавров',
		initials: 'МЛ',
		amount: 720000,
		stage: 0,
		owner: 'Илья Ковалёв',
		ownerInitials: 'ИК',
		task: 'Отправить презентацию решения',
		due: 'Сегодня, 15:00',
		overdue: false,
		source: 'Рекомендация'
	},
	{
		id: 'deal-003',
		title: 'Автоматизация клиентской поддержки',
		company: 'Листва и Ко',
		contact: 'Полина Соколова',
		initials: 'ПС',
		amount: 265000,
		stage: 0,
		owner: 'Мария Орлова',
		ownerInitials: 'МО',
		task: 'Назначить вводную встречу',
		due: 'Завтра, 10:00',
		overdue: false,
		source: 'Вебинар'
	},
	{
		id: 'deal-004',
		title: 'Лицензии CRM на 40 сотрудников',
		company: 'Горизонт Снабжение',
		contact: 'Денис Руденко',
		initials: 'ДР',
		amount: 360000,
		stage: 1,
		owner: 'Анна Смирнова',
		ownerInitials: 'АС',
		task: 'Повторно связаться после демо',
		due: 'Вчера, 16:00',
		overdue: true,
		source: 'Сайт'
	},
	{
		id: 'deal-005',
		title: 'Настройка воронки и аналитики',
		company: 'Атлас Проект',
		contact: 'Кира Белова',
		initials: 'КБ',
		amount: 185000,
		stage: 1,
		owner: 'Павел Миронов',
		ownerInitials: 'ПМ',
		task: 'Согласовать список отчётов',
		due: 'Сегодня, 13:00',
		overdue: false,
		source: 'Партнёр'
	},
	{
		id: 'deal-006',
		title: 'Перенос базы клиентов',
		company: 'Мастерская Берег',
		contact: 'Роман Яшин',
		initials: 'РЯ',
		amount: 125000,
		stage: 1,
		owner: 'Илья Ковалёв',
		ownerInitials: 'ИК',
		task: 'Получить пример файла для импорта',
		due: 'Понедельник, 12:00',
		overdue: false,
		source: 'Выставка'
	},
	{
		id: 'deal-007',
		title: 'CRM и телефония для филиалов',
		company: 'Ритм Логистика',
		contact: 'Алина Зарина',
		initials: 'АЗ',
		amount: 950000,
		stage: 2,
		owner: 'Мария Орлова',
		ownerInitials: 'МО',
		task: 'Подготовить смету на подключение филиалов',
		due: 'Сегодня, 17:30',
		overdue: false,
		source: 'Входящий звонок'
	},
	{
		id: 'deal-008',
		title: 'Корпоративный портал продаж',
		company: 'Клён Девелопмент',
		contact: 'Тимур Сафин',
		initials: 'ТС',
		amount: 2400000,
		stage: 2,
		owner: 'Павел Миронов',
		ownerInitials: 'ПМ',
		task: 'Провести встречу с руководителями',
		due: 'Сегодня, 09:30',
		overdue: true,
		source: 'Рекомендация'
	},
	{
		id: 'deal-009',
		title: 'Настройка процессов закупки',
		company: 'Контур Поставка',
		contact: 'Вера Мельникова',
		initials: 'ВМ',
		amount: 540000,
		stage: 3,
		owner: 'Анна Смирнова',
		ownerInitials: 'АС',
		task: 'Уточнить правки к договору',
		due: 'Вчера, 18:00',
		overdue: true,
		source: 'Партнёр'
	},
	{
		id: 'deal-010',
		title: 'Единое рабочее пространство CRM',
		company: 'Ясный маршрут',
		contact: 'Олег Баженов',
		initials: 'ОБ',
		amount: 1180000,
		stage: 3,
		owner: 'Илья Ковалёв',
		ownerInitials: 'ИК',
		task: 'Отправить финальную редакцию договора',
		due: 'Завтра, 14:00',
		overdue: false,
		source: 'Конференция'
	},
	{
		id: 'deal-011',
		title: 'Годовая подписка и сопровождение',
		company: 'Лаборатория Сфера',
		contact: 'Элина Туманова',
		initials: 'ЭТ',
		amount: 85000,
		stage: 4,
		owner: 'Мария Орлова',
		ownerInitials: 'МО',
		task: 'Проверить поступление оплаты',
		due: 'Сегодня, 16:00',
		overdue: false,
		source: 'Продление'
	},
	{
		id: 'deal-012',
		title: 'Расширение лицензий для команды',
		company: 'Добрый склад',
		contact: 'Степан Жаров',
		initials: 'СЖ',
		amount: 310000,
		stage: 4,
		owner: 'Павел Миронов',
		ownerInitials: 'ПМ',
		task: 'Выставить счёт на расширение',
		due: 'Пятница, 11:00',
		overdue: false,
		source: 'Текущий клиент'
	}
]
