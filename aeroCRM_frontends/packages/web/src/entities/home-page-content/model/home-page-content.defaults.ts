import type {
	HomePageContent,
	HomePageIntegrationIconKey,
	HomePageSitemapChangeFrequency,
} from '@/entities/home-page-content/model/home-page-content.types'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const mergeObject = <T extends object>(
	fallback: T,
	value: unknown
): T => ({
	...clone(fallback),
	...(isRecord(value) ? value : {})
})

const mergeSimpleArray = <T extends object>(
	value: unknown,
	fallback: T[]
): T[] => {
	if (!Array.isArray(value)) return clone(fallback)

	return value.map((item, index) => ({
		...clone(fallback[index] ?? fallback[fallback.length - 1]),
		...(isRecord(item) ? item : {})
	})) as T[]
}

const mergeStringArray = (
	value: unknown,
	fallback: string[]
): string[] => {
	if (!Array.isArray(value)) return clone(fallback)

	return value.map(item => String(item))
}

const mergePaymentContent = (
	value: unknown,
	fallback: HomePageContent['payment']
): HomePageContent['payment'] => {
	if (!isRecord(value)) return clone(fallback)

	return {
		seoTitle:
			typeof value.seoTitle === 'string'
				? value.seoTitle
				: fallback.seoTitle,
		seoDescription:
			typeof value.seoDescription === 'string'
				? value.seoDescription
				: fallback.seoDescription
	}
}

const normalizeIconKey = (
	value: unknown,
	fallback: HomePageIntegrationIconKey
): HomePageIntegrationIconKey => {
	const allowed: HomePageIntegrationIconKey[] = [
		'email',
		'telegram',
		'webhook',
		'bitrix',
		'amocrm',
		'metrika',
		'vk',
		'roistat'
	]

	return allowed.includes(value as HomePageIntegrationIconKey)
		? (value as HomePageIntegrationIconKey)
		: fallback
}

const SITEMAP_CHANGE_FREQUENCIES: HomePageSitemapChangeFrequency[] = [
	'always',
	'hourly',
	'daily',
	'weekly',
	'monthly',
	'yearly',
	'never'
]

const normalizeSitemapChangeFrequency = (
	value: unknown,
	fallback: HomePageSitemapChangeFrequency
): HomePageSitemapChangeFrequency =>
	SITEMAP_CHANGE_FREQUENCIES.includes(
		value as HomePageSitemapChangeFrequency
	)
		? (value as HomePageSitemapChangeFrequency)
		: fallback

const normalizePath = (value: unknown, fallback: string): string => {
	const candidate = typeof value === 'string' ? value.trim() : ''
	if (!candidate) return fallback

	if (
		candidate.startsWith('http://') ||
		candidate.startsWith('https://')
	) {
		try {
			return new URL(candidate).pathname || '/'
		} catch {
			return fallback
		}
	}

	return candidate.startsWith('/') ? candidate : `/${candidate}`
}

const normalizeBaseUrl = (value: unknown, fallback: string): string => {
	const candidate = typeof value === 'string' ? value.trim() : ''
	if (!candidate) return fallback

	try {
		return new URL(candidate).origin
	} catch {
		return fallback
	}
}

const normalizePriority = (value: unknown, fallback: number): number => {
	const numeric = Number(value)
	if (!Number.isFinite(numeric)) return fallback

	return Math.min(1, Math.max(0, numeric))
}

const mergeRobotsDisallow = (
	value: unknown,
	fallback: string[]
): string[] => {
	if (!Array.isArray(value)) return clone(fallback)

	const lines = value.map(item => normalizePath(item, '')).filter(Boolean)

	return Array.from(new Set(lines))
}

const mergeSitemapItems = (
	value: unknown,
	fallback: HomePageContent['technicalSeo']['sitemapItems']
): HomePageContent['technicalSeo']['sitemapItems'] => {
	if (!Array.isArray(value)) return clone(fallback)

	return value.map((item, index) => {
		const base = clone(fallback[index] ?? fallback[fallback.length - 1])
		if (!isRecord(item)) return base

		return {
			...base,
			...item,
			path: normalizePath(item.path, base.path),
			changeFrequency: normalizeSitemapChangeFrequency(
				item.changeFrequency,
				base.changeFrequency
			),
			priority: normalizePriority(item.priority, base.priority),
			enabled:
				typeof item.enabled === 'boolean' ? item.enabled : base.enabled
		}
	})
}

export const DEFAULT_HOME_PAGE_FOOTER_CONTENT: HomePageContent['footer'] =
	{
		aboutTitle: 'О нас:',
		infoLines: ['ООО «ЮБС»', 'ИНН: 2700019628', 'ОГРН: 1232700016460'],
		email: 'info@aerocrm.space',
		ybsUrl: 'https://ybs.one',
		vkUrl: '',
		telegramUrl: '',
		vkAriaLabel: 'aeroCRM во ВКонтакте',
		telegramAriaLabel: 'aeroCRM в Telegram',
		legalDisclaimer:
			'Согласно ст. 437 ГК РФ, информация на сайте не является публичной офертой.'
	}

export const DEFAULT_HOME_PAGE_BODY_CONTENT: HomePageContent['body'] = {
	enabled: false,
	html: ''
}

export const DEFAULT_HOME_PAGE_HEAD_CONTENT: HomePageContent['head'] = {
	enabled: false,
	html: ''
}

export const DEFAULT_HOME_PAGE_TECHNICAL_SEO_CONTENT: HomePageContent['technicalSeo'] =
	{
		baseUrl: 'https://aerocrm.space',
		robotsDisallow: [
			'/logout/',
			'/login/',
			'/register/',
			'/restore-password/',
			'/social-auth/'
		],
		sitemapItems: [
			{
				path: '/',
				changeFrequency: 'weekly',
				priority: 1,
				enabled: true
			},
			{
				path: '/legal-documentation/personal-policy',
				changeFrequency: 'yearly',
				priority: 0.3,
				enabled: true
			},
			{
				path: '/legal-documentation/consent-processing',
				changeFrequency: 'yearly',
				priority: 0.3,
				enabled: true
			},
			{
				path: '/legal-documentation/cookie-notice',
				changeFrequency: 'yearly',
				priority: 0.3,
				enabled: true
			},
			{
				path: '/legal-documentation/oferta',
				changeFrequency: 'yearly',
				priority: 0.3,
				enabled: true
			}
		]
	}

export const DEFAULT_HOME_PAGE_CONTENT: HomePageContent = {
	seo: {
		title: 'aeroCRM — CRM для продаж и работы с клиентами',
		description:
			'aeroCRM помогает вести обращения, клиентов, сделки и задачи команды в одном рабочем пространстве.',
		keywords: [
			'crm для продаж',
			'управление клиентами',
			'учёт заявок',
			'воронка продаж',
			'задачи команды',
			'aeroCRM'
		],
		ogTitle: 'aeroCRM — управление продажами и клиентами',
		ogDescription:
			'Ведите входящие обращения, сделки и задачи в общей CRM для команды.'
	},
	technicalSeo: DEFAULT_HOME_PAGE_TECHNICAL_SEO_CONTENT,

	hero: {
		titleBeforeAccent: 'Работа с клиентами\nв одной',
		accentText: 'CRM',
		titleAfterAccent: 'для всей команды',
		subtitle: 'Заявки, сделки, задачи и отчёты в одном месте.',
		primaryButtonText: 'Попробовать бесплатно 10 дней',
		faqButtonLabel: 'Прокрутить к вопросам и ответам',
		benefits: [
			{ text: '10 дней бесплатно' },
			{ text: 'Оплата через ЮKassa' },
			{ text: 'Владелец и 2 сотрудника' }
		]
	},
	analysis: {
		enabled: false,
		title: 'Держите работу с клиентами под контролем',
		subtitle: 'Когда обращения, сделки и задачи ведутся отдельно, команде сложнее видеть следующий шаг. В aeroCRM можно:',
		cards: [
			{
				text: 'Сохранять входящие обращения'
			},
			{
				text: 'Вести контакты и компании'
			},
			{
				text: 'Отслеживать этапы сделок'
			},
			{
				text: 'Планировать задачи команды'
			}
		]
	},
	integrations: {
		enabled: false,
		title: 'Способы добавить обращения в CRM',
		items: [
			{
				title: 'CSV',
				tag: 'Импорт',
				description: 'Импортируйте имеющийся список обращений из файла CSV.',
				iconKey: 'email'
			},
			{
				title: 'API',
				tag: 'Источник',
				description: 'Передавайте обращения из своей системы через API-источник.',
				iconKey: 'webhook'
			},
			{
				title: 'Tilda',
				tag: 'Формы сайта',
				description: 'Принимайте заявки из форм Tilda в список входящих обращений.',
				iconKey: 'webhook'
			}
		]
	},
	audiences: {
		enabled: true,
		title: 'Подходит бизнесам, где важна каждая заявка',
		subtitle:
			'aeroCRM помогает командам сохранять историю общения и доводить каждую заявку до результата.',
		items: [
			{
				title: 'E-commerce',
				text: 'Входящие обращения и повторные продажи остаются под контролем.'
			},
			{
				title: 'Услуги и консультации',
				text: 'Ведите клиентов от первого обращения до закрытой сделки.'
			},
			{
				title: 'Бьюти и медицина',
				text: 'Храните историю клиента и планируйте следующие контакты.'
			},
			{
				title: 'Обучение и мероприятия',
				text: 'Распределяйте обращения и не забывайте о задачах команды.'
			}
		]
	},
	caseStudies: {
		enabled: true,
		title: 'Как это работает на практике',
		subtitle:
			'Примеры работы с заявками и сделками в общей CRM.',
		items: [
			{
				title: 'Интернет-магазин',
				text: 'Менеджер получает обращение, создаёт контакт и фиксирует следующую задачу.',
				result: 'Команда видит ответственного и следующий шаг по сделке.'
			},
			{
				title: 'Сайт услуг',
				text: 'Обращение из формы сайта попадает во входящие с контекстом запроса.',
				result:
					'Менеджер видит историю работы с клиентом.'
			},
			{
				title: 'Команда продаж',
				text: 'Руководитель видит ход сделок и загрузку команды в отчётах.',
				result: 'Решения опираются на актуальные данные.'
			}
		]
	},
	leadFlow: {
		enabled: false,
		title: 'Что происходит после заявки',
		subtitle: 'Входящее обращение остаётся в CRM, где команда может продолжить работу с клиентом.',
		items: [
			{
				title: 'Обращение поступает во входящие',
				text: 'Добавьте его вручную, импортируйте из CSV или примите через API и Tilda.'
			},
			{
				title: 'Менеджер уточняет запрос',
				text: 'Во входящих можно просмотреть данные обращения и начать работу с клиентом.'
			},
			{
				title: 'Команда ведёт сделку',
				text: 'Создавайте контакт, сделку и задачи для следующих шагов.'
			},
			{
				title: 'Руководитель смотрит отчёты',
				text: 'Показатели помогают оценить работу со сделками и задачами.'
			}
		]
	},
	steps: {
		enabled: true,
		title: 'Начните работу за три шага',
		resultText: 'Работайте\nс клиентами\nвместе!',
		items: [
			{
				text: 'Создайте рабочее пространство'
			},
			{
				text: 'Пригласите сотрудников'
			},
			{
				text: 'Добавьте клиентов и сделки'
			}
		]
	},
	customization: {
		enabled: false,
		title: 'Настройте работу команды в CRM',
		subtitle: 'Организуйте воронки, этапы и задачи под свой процесс продаж.',
		cards: [
			{
				title: 'Воронки и этапы',
				text: 'Разделяйте сделки по воронкам и отслеживайте их этапы.'
			},
			{
				title: 'Сотрудники и права',
				text: 'Приглашайте коллег и назначайте доступ к рабочему пространству.'
			},
			{
				title: 'Контакты и компании',
				text: 'Храните данные клиентов и историю работы с ними.'
			},
			{
				title: 'Задачи команды',
				text: 'Планируйте следующие действия по клиентам и сделкам.'
			}
		],
		features: [
			{
				text: 'Свои этапы'
			},
			{
				text: 'Ответственные'
			},
			{
				text: 'Задачи команды'
			}
		],
		bottomText: 'Рабочее пространство отражает процесс вашей команды.'
	},
	dashboardPreview: {
		enabled: true,
		title: 'В личном кабинете видно всё важное',
		subtitle:
			'Ведите обращения, клиентов, сделки и задачи в одном рабочем пространстве.',
		cards: [
			{
				title: 'Заявки',
				text: 'Контакты, сообщения и история обращений доступны вашей команде.'
			},
			{
				title: 'Настройки',
				text: 'Настраивайте рабочее пространство и права команды.'
			},
			{
				title: 'Аналитика',
				text: 'Смотрите показатели продаж и загрузки команды.'
			}
		],
		metrics: [
			{ title: '3', text: 'места включены в тариф' },
			{ title: '10 дней', text: 'пробный период' },
			{ title: 'История', text: 'работы с клиентами и сделками' }
		]
	},
	security: {
		enabled: true,
		title: 'Доверие, безопасность и контроль',
		subtitle:
			'aeroCRM хранит историю работы с клиентами и разделяет доступ сотрудников.',
		items: [
			{
				title: 'Данные заявок сохраняются',
				text: 'Контакты и история заявок остаются в личном кабинете.'
			},
			{
				title: 'Автоматическая активация',
				text: 'Подписка активируется автоматически после оплаты.'
			},
			{
				title: 'Права доступа',
				text: 'Участники видят данные и действия в рамках своих прав.'
			},
			{
				title: 'История изменений',
				text: 'История действий помогает разбирать изменения по клиентам и сделкам.'
			}
		]
	},
	pricing: {
		enabled: true,
		title: 'Выберите удобный тариф',
		monthlyToggleText: 'Ежемесячно',
		yearlyToggleText: 'За год',
		discountText: '−10%',
		buttonText: 'Попробовать',

	},
	microCta: {
		enabled: true,
		afterIntegrationsText: 'Хотите собрать обращения в одном рабочем пространстве?',
		afterIntegrationsButtonText: 'Попробовать aeroCRM',
		afterStepsText:
			'Готовы организовать работу с клиентами в одной CRM?',
		afterStepsButtonText: 'Попробовать бесплатно'
	},
	seoText: {
		enabled: true,
		title: 'aeroCRM для управления клиентами и продажами',
		text: 'aeroCRM объединяет входящие обращения, карточки клиентов, сделки, задачи и отчёты. Команда видит контекст общения и планирует следующий шаг по каждому клиенту.'
	},
	payment: {
		seoTitle: 'Тарифы и оплата',
		seoDescription:
			'Тариф aeroCRM, пробный период и оплата подписки через ЮKassa.'
	},
	faq: {
		enabled: true,
		title: 'Часто задаваемые вопросы',
		items: [
			{ question: 'Для чего нужна aeroCRM?', answerHtml: 'aeroCRM помогает вести входящие обращения, клиентов, сделки и задачи команды в одном рабочем пространстве.' },
			{ question: 'Сколько длится пробный период?', answerHtml: 'Пробный период длится 10 дней после активации рабочего пространства.' },
			{ question: 'Сколько сотрудников включено?', answerHtml: 'В базовый тариф включены владелец рабочего пространства и два пользователя. При добавлении сотрудников стоимость мест пересчитывается за счёт оставшегося срока подписки, без отдельного платежа.' },
			{ question: 'Можно ли платить за год?', answerHtml: 'Да. Годовая стоимость базового тарифа рассчитывается со скидкой 10% по сравнению с двенадцатью месячными платежами.' },
			{ question: 'Как обратиться в поддержку?', answerHtml: 'Напишите в веб-чат поддержки из рабочего пространства или на <a href="mailto:info@aerocrm.space">info@aerocrm.space</a>.' }
		]
	},
	cta: {
		enabled: true,
		text: 'Попробуйте aeroCRM\nи ведите клиентов вместе с командой',
		buttonText: 'Начать бесплатный период',
		benefits: [
			{
				text: 'Безопасная оплата\nчерез ЮKassa'
			},
			{
				text: '10 дней пробного\nдоступа'
			},
			{
				text: 'Работа в интересах\nбизнеса'
			}
		]
	},
	footer: DEFAULT_HOME_PAGE_FOOTER_CONTENT,
	head: DEFAULT_HOME_PAGE_HEAD_CONTENT,
	body: DEFAULT_HOME_PAGE_BODY_CONTENT
}

export const normalizeHomePageContent = (
	value?: unknown
): HomePageContent => {
	if (!isRecord(value)) return clone(DEFAULT_HOME_PAGE_CONTENT)

	const content = value as Partial<HomePageContent>
	const defaultContent = clone(DEFAULT_HOME_PAGE_CONTENT)
	const integrations = mergeObject(
		defaultContent.integrations,
		content.integrations
	)

	const integrationItems: HomePageContent['integrations']['items'] =
		mergeSimpleArray(
			isRecord(content.integrations)
				? content.integrations.items
				: undefined,
			defaultContent.integrations.items
		).map((item, index) => ({
			...item,
			iconKey: normalizeIconKey(
				item.iconKey,
				defaultContent.integrations.items[index]?.iconKey ?? 'webhook'
			)
		}))

	return {
		...defaultContent,
		...content,
		seo: mergeObject(defaultContent.seo, content.seo),
		technicalSeo: {
			...mergeObject(defaultContent.technicalSeo, content.technicalSeo),
			baseUrl: normalizeBaseUrl(
				isRecord(content.technicalSeo)
					? content.technicalSeo.baseUrl
					: undefined,
				defaultContent.technicalSeo.baseUrl
			),
			robotsDisallow: mergeRobotsDisallow(
				isRecord(content.technicalSeo)
					? content.technicalSeo.robotsDisallow
					: undefined,
				defaultContent.technicalSeo.robotsDisallow
			),
			sitemapItems: mergeSitemapItems(
				isRecord(content.technicalSeo)
					? content.technicalSeo.sitemapItems
					: undefined,
				defaultContent.technicalSeo.sitemapItems
			)
		},

		hero: {
			...mergeObject(defaultContent.hero, content.hero),
			benefits: mergeSimpleArray(
				isRecord(content.hero) ? content.hero.benefits : undefined,
				defaultContent.hero.benefits
			)
		},
		analysis: {
			...defaultContent.analysis,
			...(isRecord(content.analysis) ? content.analysis : {}),
			cards: mergeSimpleArray(
				isRecord(content.analysis) ? content.analysis.cards : undefined,
				defaultContent.analysis.cards
			)
		},
		integrations: {
			...integrations,
			items: integrationItems
		},
		audiences: {
			...defaultContent.audiences,
			...(isRecord(content.audiences) ? content.audiences : {}),
			items: mergeSimpleArray(
				isRecord(content.audiences) ? content.audiences.items : undefined,
				defaultContent.audiences.items
			)
		},
		caseStudies: {
			...defaultContent.caseStudies,
			...(isRecord(content.caseStudies) ? content.caseStudies : {}),
			items: mergeSimpleArray(
				isRecord(content.caseStudies)
					? content.caseStudies.items
					: undefined,
				defaultContent.caseStudies.items
			)
		},
		leadFlow: {
			...defaultContent.leadFlow,
			...(isRecord(content.leadFlow) ? content.leadFlow : {}),
			items: mergeSimpleArray(
				isRecord(content.leadFlow) ? content.leadFlow.items : undefined,
				defaultContent.leadFlow.items
			)
		},
		steps: {
			...defaultContent.steps,
			...(isRecord(content.steps) ? content.steps : {}),
			items: mergeSimpleArray(
				isRecord(content.steps) ? content.steps.items : undefined,
				defaultContent.steps.items
			)
		},
		customization: {
			...defaultContent.customization,
			...(isRecord(content.customization) ? content.customization : {}),
			cards: mergeSimpleArray(
				isRecord(content.customization)
					? content.customization.cards
					: undefined,
				defaultContent.customization.cards
			),
			features: mergeSimpleArray(
				isRecord(content.customization)
					? content.customization.features
					: undefined,
				defaultContent.customization.features
			)
		},
		dashboardPreview: {
			...defaultContent.dashboardPreview,
			...(isRecord(content.dashboardPreview)
				? content.dashboardPreview
				: {}),
			cards: mergeSimpleArray(
				isRecord(content.dashboardPreview)
					? content.dashboardPreview.cards
					: undefined,
				defaultContent.dashboardPreview.cards
			),
			metrics: mergeSimpleArray(
				isRecord(content.dashboardPreview)
					? content.dashboardPreview.metrics
					: undefined,
				defaultContent.dashboardPreview.metrics
			)
		},
		security: {
			...defaultContent.security,
			...(isRecord(content.security) ? content.security : {}),
			items: mergeSimpleArray(
				isRecord(content.security) ? content.security.items : undefined,
				defaultContent.security.items
			)
		},
		pricing: mergeObject(defaultContent.pricing, content.pricing),
		microCta: mergeObject(defaultContent.microCta, content.microCta),
		seoText: mergeObject(defaultContent.seoText, content.seoText),
		payment: mergePaymentContent(content.payment, defaultContent.payment),
		faq: {
			...defaultContent.faq,
			...(isRecord(content.faq) ? content.faq : {}),
			items: mergeSimpleArray(
				isRecord(content.faq) ? content.faq.items : undefined,
				defaultContent.faq.items
			)
		},
		cta: {
			...mergeObject(defaultContent.cta, content.cta),
			benefits: mergeSimpleArray(
				isRecord(content.cta) ? content.cta.benefits : undefined,
				defaultContent.cta.benefits
			)
		},
		footer: {
			...mergeObject(defaultContent.footer, content.footer),
			infoLines: mergeStringArray(
				isRecord(content.footer) ? content.footer.infoLines : undefined,
				defaultContent.footer.infoLines
			)
		},
		head: {
			...mergeObject(defaultContent.head, content.head),
			enabled:
				isRecord(content.head) && typeof content.head.enabled === 'boolean'
					? content.head.enabled
					: defaultContent.head.enabled,
			html:
				isRecord(content.head) && typeof content.head.html === 'string'
					? content.head.html
					: defaultContent.head.html
		},
		body: {
			...mergeObject(defaultContent.body, content.body),
			enabled:
				isRecord(content.body) && typeof content.body.enabled === 'boolean'
					? content.body.enabled
					: defaultContent.body.enabled,
			html:
				isRecord(content.body) && typeof content.body.html === 'string'
					? content.body.html
					: defaultContent.body.html
		}
	}
}
