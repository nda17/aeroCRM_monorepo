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
			'ai консультант для сайта',
			'ai чат для сайта',
			'виртуальный консультант',
			'crm для продаж',
			'управление клиентами',
			'увеличение конверсии',
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
			{ text: 'OWNER + 2 сотрудника' }
		]
	},
	analysis: {
		enabled: false,
		title:
			'98% посетителей уходят с вашего сайта навсегда, не оставив контактов',
		subtitle:
			'Вы платите за рекламу, SEO и контент, но клиенты молча закрывают вкладку. Мы поможем их «зацепить», когда они:',
		cards: [
			{
				text: 'Собираются уйти'
			},
			{
				text: 'Долго листают страницу'
			},
			{
				text: 'Сравнивают с конкурентами'
			},
			{
				text: 'Хотят быстрой связи'
			}
		]
	},
	integrations: {
		enabled: false,
		title: 'Готовые интеграции для вашего бизнеса',
		items: [
			{
				title: 'Email',
				tag: 'Уведомления',
				description:
					'Мгновенное письмо с именем, призом и страницей при каждой заявке',
				iconKey: 'email'
			},
			{
				title: 'Telegram',
				tag: 'Мессенджер',
				description:
					'Уведомления прямо в чат — быстрее почты, всегда под рукой',
				iconKey: 'telegram'
			},
			{
				title: 'Webhook',
				tag: 'Интеграция',
				description:
					'POST-запрос с данными лида — подключите Make, Zapier или n8n',
				iconKey: 'webhook'
			},
			{
				title: 'Битрикс24',
				tag: 'CRM',
				description:
					'Лид с именем, телефоном и страницей создаётся автоматически',
				iconKey: 'bitrix'
			},
			{
				title: 'amoCRM',
				tag: 'CRM',
				description:
					'Новая сделка и контакт без ручного ввода при каждой заявке',
				iconKey: 'amocrm'
			},
			{
				title: 'Яндекс Метрика',
				tag: 'Аналитика',
				description:
					'Цели ip3_open и ip3_send — воронка от клика до заявки у вас в счётчике',
				iconKey: 'metrika'
			},
			{
				title: 'VK Ретаргетинг',
				tag: 'Реклама',
				description:
					'Аудитория для ретаргетинга ВКонтакте — показывайте рекламу тем, кто крутил',
				iconKey: 'vk'
			},
			{
				title: 'Roistat',
				tag: 'Аналитика',
				description:
					'Видите ROI каждого канала — события передаются без дополнительных настроек',
				iconKey: 'roistat'
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
		subtitle:
			'Виджет не просто собирает контакт: заявка сразу попадает туда, где её удобно обработать.',
		items: [
			{
				title: 'Посетитель оставляет контакт',
				text: 'Телефон, email, выбранный бонус, результат квиза или страница сохраняются автоматически.'
			},
			{
				title: 'Заявка приходит в нужный канал',
				text: 'Кабинет, Email, Telegram, CRM или webhook получают данные без ручного копирования.'
			},
			{
				title: 'Менеджер быстро связывается',
				text: 'В заявке уже есть контекст: с какой страницы пришёл клиент и что его заинтересовало.'
			},
			{
				title: 'Аналитика показывает результат',
				text: 'Вы видите, какие сценарии и бонусы собирают больше заявок.'
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
		title: 'Полная кастомизация под ваш бренд',
		subtitle:
			'Настраивайте цвета, тексты, бонусы и внешний вид виджета под стиль вашей компании',
		cards: [
			{
				title: 'Цвета и стиль',
				text: 'Подберите идеальные цвета под айдентику вашего бренда'
			},
			{
				title: 'Тексты и кнопки',
				text: 'Изменяйте заголовки, подписи и тексты под свой бренд'
			},
			{
				title: 'Бонусы и логика',
				text: 'Настраивайте бонусы, секторы и вероятность выигрыша'
			},
			{
				title: 'Live превью',
				text: 'Настраивайте виджеты реактивно'
			}
		],
		features: [
			{
				text: 'Свой бренд'
			},
			{
				text: 'Гибкие настройки'
			},
			{
				text: 'Единый стиль сайта'
			}
		],
		bottomText: 'Виджет выглядит так, как нужно именно вашему бизнесу'
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
			{ title: '24/7', text: 'доступ к истории клиентов' }
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
		afterIntegrationsText: 'Хотите получать заявки сразу в удобный канал?',
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
			{ question: 'Сколько сотрудников включено?', answerHtml: 'В базовый тариф включены владелец рабочего пространства и два пользователя. Дополнительные места оплачиваются отдельно.' },
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
