import { PREVIEW_DEALS } from './preview-data'

export interface PreviewTask {
	id: string
	title: string
	company: string
	dealId: string | null
	owner: string
	status: 'todo' | 'doing' | 'done'
	priority: 'high' | 'normal'
	due: string
	day: number
	overdue?: boolean
}

export interface PreviewContact {
	id: string
	name: string
	company: string
	email: string
	phone: string
	role: string
	owner: string
	segment: 'Клиент' | 'Партнёр' | 'Лид'
}

export interface PreviewProduct {
	id: string
	title: string
	category: string
	unit: string
	price: number
	active: boolean
}

export interface PreviewEmployee {
	id: string
	name: string
	initials: string
	role: string
	department: string
	email: string
	online: boolean
}

export interface PreviewThread {
	id: string
	name: string
	company: string
	subject: string
	preview: string
	body: string
	channel: 'mail' | 'inbox' | 'chat'
	time: string
	unread: boolean
	status: 'new' | 'accepted' | 'archived'
	dealId: string | null
}

export const PREVIEW_TASKS: PreviewTask[] = PREVIEW_DEALS.map(
	(deal, index) => ({
		id: `task-${deal.id}`,
		title: deal.task,
		company: deal.company,
		dealId: deal.id,
		owner: deal.owner,
		status: index % 2 === 0 ? 'todo' : 'doing',
		priority: deal.overdue ? 'high' : 'normal',
		due: deal.due,
		day: index % 7,
		overdue: deal.overdue
	})
)

export const PREVIEW_CONTACTS: PreviewContact[] = [
	{
		id: 'contact-001',
		name: 'Ирина Ветрова',
		company: 'Северный меридиан',
		email: 'irina.vetrova@example.com',
		phone: '+7 (000) 000-00-01',
		role: 'Руководитель продаж',
		owner: 'Анна Смирнова',
		segment: 'Лид'
	},
	{
		id: 'contact-002',
		name: 'Марк Лавров',
		company: 'ТехноПарк Волга',
		email: 'mark.lavrov@example.com',
		phone: '+7 (000) 000-00-02',
		role: 'ИТ-директор',
		owner: 'Илья Ковалёв',
		segment: 'Лид'
	},
	{
		id: 'contact-003',
		name: 'Полина Соколова',
		company: 'Листва и Ко',
		email: 'polina.sokolova@example.com',
		phone: '+7 (000) 000-00-03',
		role: 'Директор по сервису',
		owner: 'Мария Орлова',
		segment: 'Клиент'
	},
	{
		id: 'contact-004',
		name: 'Денис Руденко',
		company: 'Горизонт Снабжение',
		email: 'denis.rudenko@example.com',
		phone: '+7 (000) 000-00-04',
		role: 'Коммерческий директор',
		owner: 'Анна Смирнова',
		segment: 'Клиент'
	},
	{
		id: 'contact-005',
		name: 'Кира Белова',
		company: 'Атлас Проект',
		email: 'kira.belova@example.com',
		phone: '+7 (000) 000-00-05',
		role: 'Финансовый менеджер',
		owner: 'Павел Миронов',
		segment: 'Партнёр'
	},
	{
		id: 'contact-006',
		name: 'Алина Зарина',
		company: 'Ритм Логистика',
		email: 'alina.zarina@example.com',
		phone: '+7 (000) 000-00-06',
		role: 'Руководитель филиалов',
		owner: 'Мария Орлова',
		segment: 'Лид'
	},
	{
		id: 'contact-007',
		name: 'Вера Мельникова',
		company: 'Контур Поставка',
		email: 'vera.melnikova@example.com',
		phone: '+7 (000) 000-00-07',
		role: 'Начальник закупок',
		owner: 'Анна Смирнова',
		segment: 'Клиент'
	},
	{
		id: 'contact-008',
		name: 'Тимур Сафин',
		company: 'Клён Девелопмент',
		email: 'timur.safin@example.com',
		phone: '+7 (000) 000-00-08',
		role: 'Операционный директор',
		owner: 'Павел Миронов',
		segment: 'Партнёр'
	}
]

export const PREVIEW_PRODUCTS: PreviewProduct[] = [
	{
		id: 'product-001',
		title: 'CRM: команда',
		category: 'Лицензия',
		unit: 'пользователь / год',
		price: 24000,
		active: true
	},
	{
		id: 'product-002',
		title: 'Внедрение CRM',
		category: 'Услуга',
		unit: 'проект',
		price: 180000,
		active: true
	},
	{
		id: 'product-003',
		title: 'Интеграция с учётной системой',
		category: 'Услуга',
		unit: 'интеграция',
		price: 95000,
		active: true
	},
	{
		id: 'product-004',
		title: 'Перенос клиентской базы',
		category: 'Услуга',
		unit: 'до 5 000 записей',
		price: 45000,
		active: true
	},
	{
		id: 'product-005',
		title: 'Настройка аналитики',
		category: 'Услуга',
		unit: 'пакет',
		price: 65000,
		active: true
	},
	{
		id: 'product-006',
		title: 'Расширенная поддержка',
		category: 'Поддержка',
		unit: 'месяц',
		price: 18000,
		active: false
	}
]

export const PREVIEW_EMPLOYEES: PreviewEmployee[] = [
	{
		id: 'employee-001',
		name: 'Анна Смирнова',
		initials: 'АС',
		role: 'Аккаунт-директор',
		department: 'Продажи',
		email: 'anna.smirnova@example.com',
		online: true
	},
	{
		id: 'employee-002',
		name: 'Илья Ковалёв',
		initials: 'ИК',
		role: 'Менеджер проектов',
		department: 'Внедрение',
		email: 'ilya.kovalev@example.com',
		online: true
	},
	{
		id: 'employee-003',
		name: 'Мария Орлова',
		initials: 'МО',
		role: 'Менеджер по работе с клиентами',
		department: 'Продажи',
		email: 'maria.orlova@example.com',
		online: false
	},
	{
		id: 'employee-004',
		name: 'Павел Миронов',
		initials: 'ПМ',
		role: 'Руководитель продаж',
		department: 'Продажи',
		email: 'pavel.mironov@example.com',
		online: true
	}
]

export const PREVIEW_THREADS: PreviewThread[] = [
	{
		id: 'thread-001',
		name: 'Ирина Ветрова',
		company: 'Северный меридиан',
		subject: 'Состав лицензий для команды',
		preview: 'Подготовили список сотрудников для пилотного запуска.',
		body: 'Здравствуйте!\n\nПодготовили список сотрудников для пилотного запуска. Сейчас в команде 18 менеджеров и 3 руководителя. Подскажите, пожалуйста, можно ли начать с этой группы, а остальных подключить позднее?\n\nБуду ждать расчёт и короткое описание следующего шага.\n\nИрина Ветрова',
		channel: 'mail',
		time: '10:42',
		unread: true,
		status: 'new',
		dealId: 'deal-001'
	},
	{
		id: 'thread-002',
		name: 'Марк Лавров',
		company: 'ТехноПарк Волга',
		subject: 'Вопрос по интеграции',
		preview: 'Коллеги посмотрели схему обмена и собрали уточнения.',
		body: 'Добрый день!\n\nКоллеги посмотрели схему обмена и собрали уточнения по расписанию синхронизации. Для первого этапа достаточно передавать карточки компаний и статусы заказов раз в час.\n\nНаправьте, пожалуйста, оценку сроков и перечень данных, которые потребуются от нашей ИТ-команды.\n\nМарк Лавров',
		channel: 'mail',
		time: 'Вчера',
		unread: false,
		status: 'accepted',
		dealId: 'deal-002'
	},
	{
		id: 'thread-003',
		name: 'Кира Белова',
		company: 'Атлас Проект',
		subject: 'Отчёты для руководителя',
		preview: 'Спасибо за демонстрацию, хотим уточнить состав отчётов.',
		body: 'Здравствуйте!\n\nСпасибо за демонстрацию. Хотим включить в первый набор отчётов план и факт по новым сделкам, конверсию по этапам и загрузку команды.\n\nМожете прислать пример такого дашборда и подсказать, какие показатели можно менять самостоятельно?\n\nКира Белова',
		channel: 'mail',
		time: 'Вчера',
		unread: false,
		status: 'archived',
		dealId: 'deal-005'
	},
	{
		id: 'thread-004',
		name: 'Денис Руденко',
		company: 'Горизонт Снабжение',
		subject: 'Повторное демо для команды',
		preview: 'Хотим показать обновлённый сценарий ещё двум коллегам.',
		body: 'Добрый день!\n\nХотим показать обновлённый сценарий ещё двум коллегам из региональных офисов. Им особенно важны история взаимодействий и быстрый поиск по компаниям.\n\nПредложите, пожалуйста, несколько окон на следующей неделе.\n\nДенис Руденко',
		channel: 'inbox',
		time: '09:18',
		unread: true,
		status: 'new',
		dealId: 'deal-004'
	},
	{
		id: 'thread-005',
		name: 'Алина Зарина',
		company: 'Ритм Логистика',
		subject: 'Подключение новых филиалов',
		preview: 'Для расчёта собрали адреса и ответственных по филиалам.',
		body: 'Здравствуйте!\n\nДля расчёта собрали адреса и ответственных по филиалам. На первом этапе планируем подключить четыре площадки, затем ещё три после завершения обучения.\n\nПодскажите, какие данные нужны, чтобы подготовить оценку и график запуска.\n\nАлина Зарина',
		channel: 'inbox',
		time: 'Вчера',
		unread: false,
		status: 'accepted',
		dealId: 'deal-007'
	},
	{
		id: 'thread-006',
		name: 'Вера Мельникова',
		company: 'Контур Поставка',
		subject: 'Правки к проекту договора',
		preview: 'Передали документ юристам и вернёмся с комментариями.',
		body: 'Добрый день!\n\nПередали документ юристам и вернёмся с комментариями по разделам об этапах работ и приёмке. Остальные условия предварительно подходят.\n\nЕсли удобно, назначим короткий звонок после того, как соберём замечания.\n\nВера Мельникова',
		channel: 'inbox',
		time: 'Пн',
		unread: false,
		status: 'archived',
		dealId: 'deal-009'
	},
	{
		id: 'thread-007',
		name: 'Общий чат',
		company: 'Студия Север',
		subject: 'Следующие шаги по Клён Девелопмент',
		preview: 'Сверим участников и сценарий демонстрации перед встречей.',
		body: 'Коллеги, перед встречей по Клён Девелопмент давайте сверим демонстрационный сценарий.\n\nСначала покажем путь сделки от обращения до отчёта, затем обсудим роли руководителей и ИТ-команды. Павел ведёт встречу, Илья подготовит тестовый пример, я соберу вопросы по этапам согласования.\n\nОбновите заметки в сделке, если появились новые вводные.',
		channel: 'chat',
		time: 'Вт',
		unread: true,
		status: 'new',
		dealId: 'deal-008'
	},
	{
		id: 'thread-008',
		name: 'Илья Ковалёв',
		company: 'Студия Север',
		subject: 'План интеграции для ТехноПарка',
		preview: 'Собрал вопросы команды к схеме обмена и оценке.',
		body: 'Коллеги, посмотрел материалы по интеграции для ТехноПарка Волга.\n\nПредлагаю на первой встрече пройти сценарий синхронизации раз в час и отдельно уточнить, кто со стороны клиента отвечает за справочники. Я добавил вопросы в план сделки, чтобы не потерять их перед оценкой.\n\nАнна, сможешь проверить, что состав участников со стороны клиента подтверждён?',
		channel: 'chat',
		time: '11:06',
		unread: false,
		status: 'accepted',
		dealId: 'deal-002'
	},
	{
		id: 'thread-009',
		name: 'Мария Орлова',
		company: 'Студия Север',
		subject: 'Подготовка встречи по филиалам',
		preview: 'Разложила запуск Ритм Логистики на два этапа.',
		body: 'Команда, по сделке Ритм Логистики предлагаю зафиксировать запуск в два этапа: сначала четыре площадки, затем ещё три после обучения.\n\nПавел, проверь, пожалуйста, оценку подключения. Я подготовлю список ответственных и соберу удобные окна для общей встречи с клиентом.\n\nЕсли увидите зависимость от телефонии, напишите сюда, добавлю её в повестку.',
		channel: 'chat',
		time: 'Вчера',
		unread: false,
		status: 'archived',
		dealId: 'deal-007'
	}
]
