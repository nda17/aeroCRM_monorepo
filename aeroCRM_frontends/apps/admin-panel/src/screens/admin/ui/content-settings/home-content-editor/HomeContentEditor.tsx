'use client'

import ConfirmDialog from '@/shared/ui/confirm-dialog/ConfirmDialog'
import { revalidateHomePageContent } from '@/entities/home-page-content/actions'
import { normalizeHomePageContent } from '@/entities/home-page-content'
import { homePageContentService } from '@/entities/home-page-content'
import type {
	HomePageCaseStudy,
	HomePageContent,
	HomePageContentRecord,
	HomePageFeatureCard,
	HomePageIntegrationIconKey,
	HomePageIntegrationItem,
	HomePageSitemapChangeFrequency,
	HomePageSitemapItem,
	HomePageTextCard,
	StructuredHomePageContent
} from '@/entities/home-page-content'
import { useAuthStore } from '@/entities/user'
import AdminTooltip from '@/screens/admin/ui/common/admin-tooltip/AdminTooltip'
import {
	useMutation,
	useQuery,
	useQueryClient
} from '@tanstack/react-query'
import { useZoneRouter as useRouter } from '@/shared/lib/navigation/useZoneRouter'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import styles from './HomeContentEditor.module.scss'

const ICON_OPTIONS: Array<{
	value: HomePageIntegrationIconKey
	label: string
}> = [
	{ value: 'email', label: 'Email' },
	{ value: 'telegram', label: 'Telegram' },
	{ value: 'webhook', label: 'Webhook' },
	{ value: 'bitrix', label: 'Битрикс24' },
	{ value: 'amocrm', label: 'amoCRM' },
	{ value: 'metrika', label: 'Яндекс Метрика' },
	{ value: 'vk', label: 'VK Ретаргетинг' },
	{ value: 'roistat', label: 'Roistat' }
]

const SITEMAP_CHANGE_FREQUENCY_OPTIONS: Array<{
	value: HomePageSitemapChangeFrequency
	label: string
}> = [
	{ value: 'always', label: 'Всегда' },
	{ value: 'hourly', label: 'Каждый час' },
	{ value: 'daily', label: 'Каждый день' },
	{ value: 'weekly', label: 'Каждую неделю' },
	{ value: 'monthly', label: 'Каждый месяц' },
	{ value: 'yearly', label: 'Каждый год' },
	{ value: 'never', label: 'Никогда' }
]

export type HomeContentEditorArea =
	| 'home'
	| 'footer'
	| 'seo'
	| 'head'
	| 'body'

const EDITOR_META: Record<
	HomeContentEditorArea,
	{
		title: string
		helpTitle: string
		helpDescription: string
		riskText: string
		hint: string
		saveLabel: string
		loadingText: string
		successText: string
		resetSuccessText?: string
	}
> = {
	home: {
		title: 'Главная страница',
		helpTitle: 'Общий редактор главной',
		helpDescription:
			'Здесь собраны основные секции главной страницы: первый экран, блоки, тарифы, FAQ и CTA.',
		riskText:
			'Ошибки в важных текстах сразу увидят посетители. Перед сохранением проверьте смысл, переносы строк и ссылки.',
		hint: 'Изменения попадут на публичную главную после сохранения.',
		saveLabel: 'Сохранить главную',
		loadingText: 'Загрузка контента главной...',
		successText: 'Контент главной сохранён'
	},
	footer: {
		title: 'Footer',
		helpTitle: 'Редактор футера',
		helpDescription:
			'Управляет блоком «О нас», контактами, ссылками на соцсети и юридической информацией в футере.',
		riskText:
			'Эти данные видны на всех страницах с футером. Перед сохранением проверьте реквизиты, email и внешние ссылки.',
		hint: 'Изменения блока «О нас» попадут в футер после сохранения.',
		saveLabel: 'Сохранить footer',
		loadingText: 'Загрузка footer...',
		successText: 'Footer сохранён',
		resetSuccessText: 'Footer сброшен к дефолту'
	},
	seo: {
		title: 'SEO',
		helpTitle: 'SEO-настройки',
		helpDescription:
			'Управляет SEO главной страницы, SEO-текстом на главной, страницей оплаты, robots.txt и sitemap.xml.',
		riskText:
			'Ошибки в SEO могут ухудшить сниппеты, индексацию или открыть служебные разделы поисковикам.',
		hint: 'После сохранения обновятся SEO главной, SEO-текст, страница оплаты, robots.txt и sitemap.xml.',
		saveLabel: 'Сохранить SEO',
		loadingText: 'Загрузка SEO-настроек...',
		successText: 'SEO-настройки сохранены',
		resetSuccessText: 'SEO сброшен к дефолту'
	},
	body: {
		title: 'Body',
		helpTitle: 'Вставка перед </body>',
		helpDescription:
			'Позволяет добавить HTML или скрипты, которые будут выведены в конце body на всех страницах.',
		riskText:
			'Код выполняется на сайте. Вставляйте только доверенные скрипты, иначе можно сломать страницы или создать XSS-риск.',
		hint: 'После сохранения код будет выведен перед закрывающим тегом body.',
		saveLabel: 'Сохранить Body',
		loadingText: 'Загрузка Body...',
		successText: 'Body сохранён',
		resetSuccessText: 'Body сброшен к дефолту'
	},
	head: {
		title: 'Head',
		helpTitle: 'Вставка в <head>',
		helpDescription:
			'Позволяет добавить HTML или скрипты, которые будут выведены внутри head на всех страницах.',
		riskText:
			'Код попадает в head сайта. Вставляйте только доверенные теги, иначе можно сломать SEO, загрузку страниц или создать XSS-риск.',
		hint: 'После сохранения код будет выведен внутри тега head.',
		saveLabel: 'Сохранить Head',
		loadingText: 'Загрузка Head...',
		successText: 'Head сохранён'
	}
}

type RiskLevel = 'low' | 'medium' | 'high'

interface HelpTooltipProps {
	title: string
	description: string
	risk: RiskLevel
	riskText: string
}

const riskLabel: Record<RiskLevel, string> = {
	low: 'Низкая опасность',
	medium: 'Средняя опасность',
	high: 'Высокая опасность'
}

const HelpTooltip = ({
	title,
	description,
	risk,
	riskText
}: HelpTooltipProps) => {
	const [isOpen, setIsOpen] = useState(false)
	const wrapperRef = useRef<HTMLSpanElement>(null)
	const tooltipId = useId()

	useEffect(() => {
		if (!isOpen) return

		const closeOnOutsideClick = (event: PointerEvent) => {
			if (
				wrapperRef.current &&
				!wrapperRef.current.contains(event.target as Node)
			) {
				setIsOpen(false)
			}
		}

		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setIsOpen(false)
		}

		document.addEventListener('pointerdown', closeOnOutsideClick)
		document.addEventListener('keydown', closeOnEscape)

		return () => {
			document.removeEventListener('pointerdown', closeOnOutsideClick)
			document.removeEventListener('keydown', closeOnEscape)
		}
	}, [isOpen])

	return (
		<span
			ref={wrapperRef}
			className={styles.help}
			onMouseEnter={() => setIsOpen(true)}
			onMouseLeave={() => setIsOpen(false)}
		>
			<button
				type="button"
				className={styles.helpBtn}
				aria-label={`Подсказка: ${title}`}
				aria-expanded={isOpen}
				aria-describedby={isOpen ? tooltipId : undefined}
				onClick={() => setIsOpen(prev => !prev)}
				onFocus={() => setIsOpen(true)}
			>
				?
			</button>
			{isOpen && (
				<span id={tooltipId} role="tooltip" className={styles.tooltip}>
					<span className={styles.tooltipTitle}>{title}</span>
					<span className={styles.tooltipText}>{description}</span>
					<span
						className={`${styles.riskBadge} ${styles[`risk-${risk}`]}`}
					>
						{riskLabel[risk]}
					</span>
					<span className={styles.tooltipRisk}>{riskText}</span>
				</span>
			)}
		</span>
	)
}

interface SectionTitleProps extends HelpTooltipProps {
	children: string
	danger?: boolean
}

const SectionTitle = ({
	children,
	danger,
	...tooltip
}: SectionTitleProps) => (
	<div className={styles.titleWithHelp}>
		<h3 className={danger ? styles.dangerTitle : styles.panelTitle}>
			{children}
		</h3>
		<HelpTooltip {...tooltip} />
	</div>
)

const moveItem = <T,>(
	items: T[],
	index: number,
	direction: -1 | 1
): T[] => {
	const nextIndex = index + direction
	if (nextIndex < 0 || nextIndex >= items.length) return items

	const next = [...items]
	const current = next[index]
	next[index] = next[nextIndex]
	next[nextIndex] = current

	return next
}

const updateItem = <T extends object>(
	items: T[],
	index: number,
	patch: Partial<T>
): T[] =>
	items.map((item, itemIndex) =>
		itemIndex === index ? { ...item, ...patch } : item
	)

const removeItem = <T,>(items: T[], index: number): T[] =>
	items.filter((_, itemIndex) => itemIndex !== index)

const featuresToText = (features: string[]) => features.join('\n')

const textToFeatures = (value: string) => value.split('\n')

const cleanStringList = (items: string[]) =>
	items.map(item => item.trim()).filter(Boolean)

const cleanTextCards = (items: HomePageTextCard[]): HomePageTextCard[] =>
	items
		.map(item => ({ ...item, text: item.text.trim() }))
		.filter(item => item.text)

const cleanFeatureCards = (
	items: HomePageFeatureCard[]
): HomePageFeatureCard[] =>
	items
		.map(item => ({
			...item,
			title: item.title.trim(),
			text: item.text.trim()
		}))
		.filter(item => item.title || item.text)

const cleanCaseStudies = (
	items: HomePageCaseStudy[]
): HomePageCaseStudy[] =>
	items
		.map(item => ({
			...item,
			title: item.title.trim(),
			text: item.text.trim(),
			result: item.result.trim()
		}))
		.filter(item => item.title || item.text || item.result)

const prepareContentForSave = (
	content: HomePageContent
): HomePageContent => ({
	...content,
	hero: {
		...content.hero,
		benefits: cleanTextCards(content.hero.benefits)
	},
	seo: {
		...content.seo,
		keywords: cleanStringList(content.seo.keywords)
	},
	technicalSeo: {
		...content.technicalSeo,
		robotsDisallow: cleanStringList(content.technicalSeo.robotsDisallow)
	},
	audiences: {
		...content.audiences,
		items: cleanFeatureCards(content.audiences.items)
	},
	caseStudies: {
		...content.caseStudies,
		items: cleanCaseStudies(content.caseStudies.items)
	},
	leadFlow: {
		...content.leadFlow,
		items: cleanFeatureCards(content.leadFlow.items)
	},
	customization: {
		...content.customization,
		cards: cleanFeatureCards(content.customization.cards),
		features: cleanTextCards(content.customization.features)
	},
	dashboardPreview: {
		...content.dashboardPreview,
		cards: cleanFeatureCards(content.dashboardPreview.cards),
		metrics: cleanFeatureCards(content.dashboardPreview.metrics)
	},
	security: {
		...content.security,
		items: cleanFeatureCards(content.security.items)
	},
	footer: {
		...content.footer,
		infoLines: cleanStringList(content.footer.infoLines),
		legalDisclaimer: (content.footer.legalDisclaimer ?? '').trim()
	},
	cta: {
		...content.cta,
		benefits: cleanTextCards(content.cta.benefits)
	}
})

const prepareStructuredContentForSave = (
	content: HomePageContent
): StructuredHomePageContent => {
	const prepared = prepareContentForSave(content)
	const { head, body, ...structured } = prepared
	void head
	void body

	return structured
}

const normalizePriorityInput = (value: string) => {
	const numeric = Number(value)
	if (!Number.isFinite(numeric)) return 0

	return Math.min(1, Math.max(0, numeric))
}

interface TextFieldProps {
	id: string
	label: string
	value: string
	onChange: (value: string) => void
	placeholder?: string
}

const TextField = ({
	id,
	label,
	value,
	onChange,
	placeholder
}: TextFieldProps) => (
	<div className={styles.field}>
		<label htmlFor={id} className={styles.fieldLabel}>
			{label}
		</label>
		<input
			id={id}
			className={styles.input}
			value={value}
			onChange={event => onChange(event.target.value)}
			placeholder={placeholder}
		/>
	</div>
)

interface TextAreaFieldProps extends TextFieldProps {
	rows?: number
	hint?: string
	disabled?: boolean
}

const TextAreaField = ({
	id,
	label,
	value,
	onChange,
	placeholder,
	rows = 3,
	hint,
	disabled = false
}: TextAreaFieldProps) => (
	<div className={styles.field}>
		<label htmlFor={id} className={styles.fieldLabel}>
			{label}
		</label>
		<textarea
			id={id}
			className={styles.textarea}
			value={value}
			onChange={event => onChange(event.target.value)}
			placeholder={placeholder}
			rows={rows}
			disabled={disabled}
		/>
		{hint && <span className={styles.fieldHint}>{hint}</span>}
	</div>
)

interface ToggleFieldProps {
	label: string
	checked: boolean
	onChange: (checked: boolean) => void
	hint?: string
	disabled?: boolean
}

const ToggleField = ({
	label,
	checked,
	onChange,
	hint,
	disabled = false
}: ToggleFieldProps) => (
	<label
		className={`${styles.toggleField} ${disabled ? styles.toggleFieldDisabled : ''}`}
	>
		<input
			type="checkbox"
			checked={checked}
			onChange={event => onChange(event.target.checked)}
			disabled={disabled}
		/>
		<span className={styles.toggleVisual} />
		<span className={styles.toggleText}>
			<span className={styles.fieldLabel}>{label}</span>
			{hint && <span className={styles.fieldHint}>{hint}</span>}
		</span>
	</label>
)

interface ListActionsProps {
	onMoveUp: () => void
	onMoveDown: () => void
	onRemove: () => void
	disableUp: boolean
	disableDown: boolean
}

const ListActions = ({
	onMoveUp,
	onMoveDown,
	onRemove,
	disableUp,
	disableDown
}: ListActionsProps) => (
	<div className={styles.itemActions}>
		<button
			type="button"
			className={styles.smallBtn}
			onClick={onMoveUp}
			disabled={disableUp}
		>
			Выше
		</button>
		<button
			type="button"
			className={styles.smallBtn}
			onClick={onMoveDown}
			disabled={disableDown}
		>
			Ниже
		</button>
		<button type="button" className={styles.dangerBtn} onClick={onRemove}>
			Удалить
		</button>
	</div>
)

interface HomeContentEditorProps {
	area?: HomeContentEditorArea
	canEditRawCode?: boolean
}

const HomeContentEditor = ({
	area = 'home',
	canEditRawCode = false
}: HomeContentEditorProps) => {
	const auth = useAuthStore(state => state.auth)
	const queryClient = useQueryClient()
	const router = useRouter()
	const meta = EDITOR_META[area]
	const isHomeArea = area === 'home'
	const isFooterArea = area === 'footer'
	const isSeoArea = area === 'seo'
	const isBodyArea = area === 'body'
	const isHeadArea = area === 'head'
	const isRawArea = isBodyArea || isHeadArea
	const defaultContent = useMemo(() => normalizeHomePageContent(), [])
	const [draft, setDraft] = useState<HomePageContent>(defaultContent)
	const [persistedContent, setPersistedContent] =
		useState<HomePageContent>(defaultContent)
	const [showFactoryResetConfirm, setShowFactoryResetConfirm] =
		useState(false)

	const { data, isLoading } = useQuery({
		queryKey: ['home-page-content'],
		queryFn: homePageContentService.get,
		enabled: Boolean(auth)
	})

	useEffect(() => {
		if (data?.content) {
			setDraft(data.content)
			setPersistedContent(data.content)
		}
	}, [data])

	const handleUpdateSuccess = async (result: HomePageContentRecord) => {
		setDraft(result.content)
		setPersistedContent(result.content)
		await queryClient.invalidateQueries({
			queryKey: ['home-page-content']
		})
		await revalidateHomePageContent()
		router.refresh()
	}

	const structuredMutation = useMutation({
		mutationFn: homePageContentService.updateStructured,
		onSuccess: handleUpdateSuccess
	})
	const rawMutation = useMutation({
		mutationFn: homePageContentService.updateRaw,
		onSuccess: handleUpdateSuccess
	})

	const isDirty =
		JSON.stringify(draft) !== JSON.stringify(persistedContent)
	const isSaving = structuredMutation.isPending || rawMutation.isPending

	const save = () => {
		if (isRawArea && !canEditRawCode) {
			toast.error('Изменение Head/Body доступно только DEV')
			return
		}
		const promise = isRawArea
			? rawMutation.mutateAsync({ head: draft.head, body: draft.body })
			: structuredMutation.mutateAsync(
					prepareStructuredContentForSave(draft)
				)

		toast.promise(promise, {
			loading: 'Пожалуйста, подождите',
			success: meta.successText,
			error: 'Ошибка сохранения'
		})
	}

	const factoryReset = () => {
		const defaultHomeContent = normalizeHomePageContent()
		const nextContent: HomePageContent = {
			...draft,
			hero: defaultHomeContent.hero,
			analysis: defaultHomeContent.analysis,
			integrations: defaultHomeContent.integrations,
			audiences: defaultHomeContent.audiences,
			caseStudies: defaultHomeContent.caseStudies,
			leadFlow: defaultHomeContent.leadFlow,
			steps: defaultHomeContent.steps,
			customization: defaultHomeContent.customization,
			dashboardPreview: defaultHomeContent.dashboardPreview,
			security: defaultHomeContent.security,
			pricing: defaultHomeContent.pricing,
			microCta: defaultHomeContent.microCta,
			faq: defaultHomeContent.faq,
			cta: defaultHomeContent.cta
		}
		setShowFactoryResetConfirm(false)
		setDraft(nextContent)

		const promise = structuredMutation.mutateAsync(
			prepareStructuredContentForSave(nextContent)
		)

		toast.promise(promise, {
			loading: 'Пожалуйста, подождите',
			success: 'Главная сброшена до заводских настроек',
			error: 'Ошибка сброса главной'
		})
	}

	const resetAreaToDefault = () => {
		const nextContent: HomePageContent = { ...persistedContent }

		if (isFooterArea) {
			nextContent.footer = defaultContent.footer
		}

		if (isSeoArea) {
			nextContent.seo = defaultContent.seo
			nextContent.payment = defaultContent.payment
			nextContent.technicalSeo = defaultContent.technicalSeo
			nextContent.seoText = defaultContent.seoText
		}

		setDraft(nextContent)

		const promise = structuredMutation.mutateAsync(
			prepareStructuredContentForSave(nextContent)
		)

		toast.promise(promise, {
			loading: 'Пожалуйста, подождите',
			success: meta.resetSuccessText ?? 'Сброшено к дефолту',
			error: 'Ошибка сброса'
		})
	}

	const updateDraft = (
		updater: (content: HomePageContent) => HomePageContent
	) => setDraft(prev => updater(prev))

	const updateCardList = (
		section: 'analysis' | 'steps',
		items: HomePageTextCard[]
	) =>
		updateDraft(prev => ({
			...prev,
			[section]: {
				...prev[section],
				[section === 'analysis' ? 'cards' : 'items']: items
			}
		}))

	const updateHeroBenefits = (benefits: HomePageTextCard[]) =>
		updateDraft(prev => ({
			...prev,
			hero: { ...prev.hero, benefits }
		}))

	const updateIntegrationItems = (items: HomePageIntegrationItem[]) =>
		updateDraft(prev => ({
			...prev,
			integrations: { ...prev.integrations, items }
		}))

	const updateAudienceItems = (items: HomePageFeatureCard[]) =>
		updateDraft(prev => ({
			...prev,
			audiences: { ...prev.audiences, items }
		}))

	const updateCaseStudyItems = (items: HomePageCaseStudy[]) =>
		updateDraft(prev => ({
			...prev,
			caseStudies: { ...prev.caseStudies, items }
		}))

	const updateLeadFlowItems = (items: HomePageFeatureCard[]) =>
		updateDraft(prev => ({
			...prev,
			leadFlow: { ...prev.leadFlow, items }
		}))

	const updateCustomizationCards = (cards: HomePageFeatureCard[]) =>
		updateDraft(prev => ({
			...prev,
			customization: { ...prev.customization, cards }
		}))

	const updateCustomizationFeatures = (features: HomePageTextCard[]) =>
		updateDraft(prev => ({
			...prev,
			customization: { ...prev.customization, features }
		}))

	const updateDashboardCards = (cards: HomePageFeatureCard[]) =>
		updateDraft(prev => ({
			...prev,
			dashboardPreview: { ...prev.dashboardPreview, cards }
		}))

	const updateDashboardMetrics = (metrics: HomePageFeatureCard[]) =>
		updateDraft(prev => ({
			...prev,
			dashboardPreview: { ...prev.dashboardPreview, metrics }
		}))

	const updateSecurityItems = (items: HomePageFeatureCard[]) =>
		updateDraft(prev => ({
			...prev,
			security: { ...prev.security, items }
		}))

	const updateCtaBenefits = (benefits: HomePageTextCard[]) =>
		updateDraft(prev => ({
			...prev,
			cta: { ...prev.cta, benefits }
		}))

	const updatePaymentField = <K extends keyof HomePageContent['payment']>(
		key: K,
		value: HomePageContent['payment'][K]
	) =>
		updateDraft(prev => ({
			...prev,
			payment: { ...prev.payment, [key]: value }
		}))

	const updateSitemapItems = (sitemapItems: HomePageSitemapItem[]) =>
		updateDraft(prev => ({
			...prev,
			technicalSeo: { ...prev.technicalSeo, sitemapItems }
		}))

	if (isLoading) {
		return <p className={styles.loading}>{meta.loadingText}</p>
	}

	return (
		<div className={styles.editor}>
			{isHomeArea && showFactoryResetConfirm && (
				<ConfirmDialog
					title="Скинуть до заводских настроек?"
					message="Основные блоки главной страницы будут перезаписаны текущим дефолтным контентом сайта. Footer и SEO останутся без изменений."
					confirmLabel="Скинуть"
					cancelLabel="Отмена"
					onConfirm={factoryReset}
					onCancel={() => setShowFactoryResetConfirm(false)}
				/>
			)}

			<div className={styles.saveBar}>
				<div>
					<div className={styles.titleWithHelp}>
						<p className={styles.saveTitle}>{meta.title}</p>
						<HelpTooltip
							title={meta.helpTitle}
							description={meta.helpDescription}
							risk="medium"
							riskText={meta.riskText}
						/>
					</div>
					<p className={styles.fieldHint}>{meta.hint}</p>
				</div>
				<div className={styles.saveActions}>
					{!isHomeArea && !isBodyArea && !isHeadArea && (
						<button
							type="button"
							className={styles.resetBtn}
							onClick={resetAreaToDefault}
							disabled={isSaving}
						>
							Сбросить к дефолту
						</button>
					)}
					{isDirty && (
						<button
							type="button"
							className={styles.resetBtn}
							onClick={() => setDraft(persistedContent)}
						>
							Отменить изменения
						</button>
					)}
					<button
						type="button"
						className={styles.saveBtn}
						onClick={save}
						disabled={
							!isDirty || isSaving || (isRawArea && !canEditRawCode)
						}
					>
						{meta.saveLabel}
					</button>
				</div>
			</div>

			{isHomeArea && (
				<section className={styles.dangerZone}>
					<div>
						<SectionTitle
							danger
							title="Сброс главной"
							description="Возвращает основные блоки главной страницы к текущему заводскому конфигу из кода."
							risk="high"
							riskText="После подтверждения основные блоки главной будут перезаписаны дефолтными значениями. Вынесенные Footer и SEO не затрагиваются."
						>
							Опасная зона
						</SectionTitle>
						<p className={styles.dangerText}>
							Сбросит основные блоки главной страницы до текущего
							заводского состояния сайта.
						</p>
					</div>
					<button
						type="button"
						className={styles.factoryResetBtn}
						onClick={() => setShowFactoryResetConfirm(true)}
						disabled={isSaving}
					>
						Скинуть до заводских настроек
					</button>
				</section>
			)}

			{isSeoArea && (
				<>
					<section className={styles.panel}>
						<SectionTitle
							title="Общие SEO"
							description="Управляет title, description, keywords и Open Graph-текстами, которые видят поисковики, браузерные вкладки и соцсети при шаринге ссылки."
							risk="high"
							riskText="Неудачные SEO-тексты могут ухудшить сниппет в поиске и отображение ссылки. Не удаляйте ключевые смыслы про CRM, работу с клиентами и продажи без проверки."
						>
							Общие SEO
						</SectionTitle>
						<div className={styles.gridTwo}>
							<TextField
								id="home-seo-title"
								label="Title"
								value={draft.seo.title}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										seo: { ...prev.seo, title: value }
									}))
								}
							/>
							<TextField
								id="home-seo-og-title"
								label="OG title"
								value={draft.seo.ogTitle}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										seo: { ...prev.seo, ogTitle: value }
									}))
								}
							/>
						</div>
						<TextAreaField
							id="home-seo-description"
							label="Description"
							value={draft.seo.description}
							onChange={value =>
								updateDraft(prev => ({
									...prev,
									seo: { ...prev.seo, description: value }
								}))
							}
						/>
						<TextAreaField
							id="home-seo-og-description"
							label="OG description"
							value={draft.seo.ogDescription}
							onChange={value =>
								updateDraft(prev => ({
									...prev,
									seo: { ...prev.seo, ogDescription: value }
								}))
							}
						/>
						<TextAreaField
							id="home-seo-keywords"
							label="Keywords"
							value={draft.seo.keywords.join('\n')}
							onChange={value =>
								updateDraft(prev => ({
									...prev,
									seo: {
										...prev.seo,
										keywords: textToFeatures(value)
									}
								}))
							}
							hint="Каждый keyword с новой строки."
						/>
					</section>

					<section className={styles.panel}>
						<div className={styles.panelHeader}>
							<SectionTitle
								title="SEO-текст на главной"
								description="Небольшой текстовый блок внизу главной для объяснения продукта посетителям и поисковым системам."
								risk="medium"
								riskText="Не превращайте блок в длинную SEO-простыню. Текст должен оставаться полезным для человека."
							>
								SEO-текст
							</SectionTitle>
							<ToggleField
								label="Показывать"
								checked={draft.seoText.enabled}
								onChange={checked =>
									updateDraft(prev => ({
										...prev,
										seoText: { ...prev.seoText, enabled: checked }
									}))
								}
							/>
						</div>
						<TextField
							id="seo-text-title"
							label="Заголовок"
							value={draft.seoText.title}
							onChange={value =>
								updateDraft(prev => ({
									...prev,
									seoText: { ...prev.seoText, title: value }
								}))
							}
						/>
						<TextAreaField
							id="seo-text-text"
							label="Текст"
							value={draft.seoText.text}
							onChange={value =>
								updateDraft(prev => ({
									...prev,
									seoText: { ...prev.seoText, text: value }
								}))
							}
							rows={6}
							hint="Переносы строк сохраняются."
						/>
					</section>

					<section className={styles.panel}>
						<SectionTitle
							title="SEO страницы платежи"
							description="Управляет SEO title и description публичной страницы /payment."
							risk="high"
							riskText="Эти тексты видят поисковики и пользователи в сниппете страницы оплаты. Они не меняют реальные цены и платежную логику."
						>
							SEO страницы платежи
						</SectionTitle>
						<div className={styles.gridTwo}>
							<TextField
								id="payment-seo-title"
								label="SEO title"
								value={draft.payment.seoTitle}
								onChange={value => updatePaymentField('seoTitle', value)}
							/>
						</div>
						<TextAreaField
							id="payment-seo-description"
							label="SEO description"
							value={draft.payment.seoDescription}
							onChange={value =>
								updatePaymentField('seoDescription', value)
							}
						/>
					</section>

					<section className={styles.panel}>
						<div className={styles.panelHeader}>
							<div>
								<SectionTitle
									title="Robots и sitemap"
									description="Формирует публичные файлы robots.txt и sitemap.xml из безопасных структурированных настроек."
									risk="high"
									riskText="Неверные пути могут открыть служебные страницы для индексации или убрать важные страницы из sitemap. Не добавляйте админку, кабинет, оплату и внутренние страницы CRM в sitemap."
								>
									SEO-файлы
								</SectionTitle>
								<p className={styles.fieldHint}>
									После сохранения обновятся robots.txt и sitemap.xml.
								</p>
							</div>
						</div>

						<TextField
							id="technical-seo-base-url"
							label="Базовый URL сайта"
							value={draft.technicalSeo.baseUrl}
							onChange={value =>
								updateDraft(prev => ({
									...prev,
									technicalSeo: {
										...prev.technicalSeo,
										baseUrl: value
									}
								}))
							}
							placeholder="https://aerocrm.space"
						/>

						<TextAreaField
							id="technical-seo-robots-disallow"
							label="Robots disallow"
							value={draft.technicalSeo.robotsDisallow.join('\n')}
							onChange={value =>
								updateDraft(prev => ({
									...prev,
									technicalSeo: {
										...prev.technicalSeo,
										robotsDisallow: textToFeatures(value)
									}
								}))
							}
							rows={8}
							hint="Каждый закрытый путь с новой строки."
						/>

						<div className={styles.list}>
							{draft.technicalSeo.sitemapItems.map((item, index) => (
								<div key={`sitemap-${index}`} className={styles.itemCard}>
									<div className={styles.itemHeader}>
										<span className={styles.itemTitle}>
											Страница sitemap {index + 1}
										</span>
										<div className={styles.itemActions}>
											<ToggleField
												label="Включить"
												checked={item.enabled}
												onChange={checked =>
													updateSitemapItems(
														updateItem(
															draft.technicalSeo.sitemapItems,
															index,
															{ enabled: checked }
														)
													)
												}
											/>
											<ListActions
												onMoveUp={() =>
													updateSitemapItems(
														moveItem(
															draft.technicalSeo.sitemapItems,
															index,
															-1
														)
													)
												}
												onMoveDown={() =>
													updateSitemapItems(
														moveItem(
															draft.technicalSeo.sitemapItems,
															index,
															1
														)
													)
												}
												onRemove={() =>
													updateSitemapItems(
														removeItem(
															draft.technicalSeo.sitemapItems,
															index
														)
													)
												}
												disableUp={index === 0}
												disableDown={
													index ===
													draft.technicalSeo.sitemapItems.length - 1
												}
											/>
										</div>
									</div>
									<div className={styles.gridThree}>
										<TextField
											id={`sitemap-path-${index}`}
											label="Путь"
											value={item.path}
											onChange={value =>
												updateSitemapItems(
													updateItem(
														draft.technicalSeo.sitemapItems,
														index,
														{ path: value }
													)
												)
											}
											placeholder="/"
										/>
										<div className={styles.field}>
											<label
												htmlFor={`sitemap-frequency-${index}`}
												className={styles.fieldLabel}
											>
												Частота
											</label>
											<select
												id={`sitemap-frequency-${index}`}
												className={styles.select}
												value={item.changeFrequency}
												onChange={event =>
													updateSitemapItems(
														updateItem(
															draft.technicalSeo.sitemapItems,
															index,
															{
																changeFrequency: event.target
																	.value as HomePageSitemapChangeFrequency
															}
														)
													)
												}
											>
												{SITEMAP_CHANGE_FREQUENCY_OPTIONS.map(option => (
													<option key={option.value} value={option.value}>
														{option.label}
													</option>
												))}
											</select>
										</div>
										<div className={styles.field}>
											<label
												htmlFor={`sitemap-priority-${index}`}
												className={styles.fieldLabel}
											>
												Priority
											</label>
											<input
												id={`sitemap-priority-${index}`}
												className={styles.input}
												type="number"
												min="0"
												max="1"
												step="0.1"
												value={item.priority}
												onChange={event =>
													updateSitemapItems(
														updateItem(
															draft.technicalSeo.sitemapItems,
															index,
															{
																priority: normalizePriorityInput(
																	event.target.value
																)
															}
														)
													)
												}
											/>
										</div>
									</div>
								</div>
							))}
						</div>
						<button
							type="button"
							className={styles.addBtn}
							onClick={() =>
								updateSitemapItems([
									...draft.technicalSeo.sitemapItems,
									{
										path: '/new-page',
										changeFrequency: 'weekly',
										priority: 0.5,
										enabled: true
									}
								])
							}
						>
							Добавить страницу в sitemap
						</button>
					</section>
				</>
			)}

			{isFooterArea && (
				<section className={styles.panel}>
					<SectionTitle
						title="Футер: О нас"
						description="Редактирует информационный блок в футере: заголовок, реквизиты, email и ссылки на социальные сети."
						risk="medium"
						riskText="Эти данные видны на всех страницах с футером. Перед сохранением проверьте реквизиты, email и внешние ссылки."
					>
						Футер: О нас
					</SectionTitle>
					<div className={styles.gridTwo}>
						<TextField
							id="footer-about-title"
							label="Заголовок"
							value={draft.footer.aboutTitle}
							onChange={value =>
								updateDraft(prev => ({
									...prev,
									footer: { ...prev.footer, aboutTitle: value }
								}))
							}
						/>
						<TextField
							id="footer-email"
							label="Email"
							value={draft.footer.email}
							onChange={value =>
								updateDraft(prev => ({
									...prev,
									footer: { ...prev.footer, email: value }
								}))
							}
						/>
					</div>
					<TextAreaField
						id="footer-info-lines"
						label="Информационные строки"
						value={draft.footer.infoLines.join('\n')}
						onChange={value =>
							updateDraft(prev => ({
								...prev,
								footer: {
									...prev.footer,
									infoLines: textToFeatures(value)
								}
							}))
						}
						hint="Каждая строка выводится отдельным абзацем."
					/>
					<TextField
						id="footer-ybs-url"
						label="Ссылка ООО ЮБС"
						value={draft.footer.ybsUrl}
						onChange={value =>
							updateDraft(prev => ({
								...prev,
								footer: { ...prev.footer, ybsUrl: value }
							}))
						}
					/>
					<div className={styles.gridTwo}>
						<TextField
							id="footer-vk-url"
							label="Ссылка VK"
							value={draft.footer.vkUrl}
							onChange={value =>
								updateDraft(prev => ({
									...prev,
									footer: { ...prev.footer, vkUrl: value }
								}))
							}
						/>
						<TextField
							id="footer-telegram-url"
							label="Ссылка Telegram"
							value={draft.footer.telegramUrl}
							onChange={value =>
								updateDraft(prev => ({
									...prev,
									footer: { ...prev.footer, telegramUrl: value }
								}))
							}
						/>
					</div>
					<div className={styles.gridTwo}>
						<TextField
							id="footer-vk-label"
							label="Подпись VK для доступности"
							value={draft.footer.vkAriaLabel}
							onChange={value =>
								updateDraft(prev => ({
									...prev,
									footer: { ...prev.footer, vkAriaLabel: value }
								}))
							}
						/>
						<TextField
							id="footer-telegram-label"
							label="Подпись Telegram для доступности"
							value={draft.footer.telegramAriaLabel}
							onChange={value =>
								updateDraft(prev => ({
									...prev,
									footer: {
										...prev.footer,
										telegramAriaLabel: value
									}
								}))
							}
						/>
					</div>
					<TextAreaField
						id="footer-legal-disclaimer"
						label="Текст под договором-офертой"
						value={draft.footer.legalDisclaimer}
						onChange={value =>
							updateDraft(prev => ({
								...prev,
								footer: {
									...prev.footer,
									legalDisclaimer: value
								}
							}))
						}
						hint="Показывается мелким шрифтом под ссылкой «Договор-оферта»."
					/>
				</section>
			)}

			{isBodyArea && (
				<section className={styles.panel}>
					<div className={styles.panelHeader}>
						<div>
							<SectionTitle
								title="Код перед </body>"
								description="Выводит сохранённый HTML или script-блоки последним элементом внутри body."
								risk="high"
								riskText="Этот код выполняется на публичном сайте. Используйте только доверенные скрипты и проверяйте синтаксис перед сохранением."
							>
								Body
							</SectionTitle>
							<p className={styles.fieldHint}>
								Подходит для счётчиков, пикселей и интеграционных
								script/noscript блоков.
							</p>
						</div>
						<ToggleField
							label="Включить вставку"
							checked={draft.body.enabled}
							onChange={checked =>
								updateDraft(prev => ({
									...prev,
									body: { ...prev.body, enabled: checked }
								}))
							}
							disabled={!canEditRawCode}
						/>
					</div>
					<div
						className={
							!canEditRawCode ? styles.devLockedContent : undefined
						}
					>
						<TextAreaField
							id="body-html"
							label="HTML / script перед </body>"
							value={draft.body.html}
							onChange={value =>
								updateDraft(prev => ({
									...prev,
									body: { ...prev.body, html: value }
								}))
							}
							rows={12}
							placeholder={
								'<script src="https://example.com/script.js"></script>'
							}
							hint="Код будет добавлен перед закрывающим тегом body после сохранения."
							disabled={!canEditRawCode}
						/>
					</div>
					{!canEditRawCode && (
						<div className={styles.devLockHint}>
							<span>Только просмотр для ADMIN</span>
							<AdminTooltip
								title="DEV-only действие"
								description="Изменение Body-кода разрешено только DEV и отдельно проверяется backend."
							/>
						</div>
					)}
				</section>
			)}

			{isHeadArea && (
				<section className={styles.panel}>
					<div className={styles.panelHeader}>
						<div>
							<SectionTitle
								title="Код внутри <head>"
								description="Выводит сохранённый HTML или script/link/meta/style-блоки внутри head."
								risk="high"
								riskText="Этот код попадёт в head публичного сайта. Используйте только доверенные теги и проверяйте синтаксис перед сохранением."
							>
								Head
							</SectionTitle>
							<p className={styles.fieldHint}>
								Подходит для мета-тегов, пикселей, внешних script/link и
								проверочных тегов сервисов.
							</p>
						</div>
						<ToggleField
							label="Включить вставку"
							checked={draft.head.enabled}
							onChange={checked =>
								updateDraft(prev => ({
									...prev,
									head: { ...prev.head, enabled: checked }
								}))
							}
							disabled={!canEditRawCode}
						/>
					</div>
					<div
						className={
							!canEditRawCode ? styles.devLockedContent : undefined
						}
					>
						<TextAreaField
							id="head-html"
							label="HTML / script внутри <head>"
							value={draft.head.html}
							onChange={value =>
								updateDraft(prev => ({
									...prev,
									head: { ...prev.head, html: value }
								}))
							}
							rows={12}
							placeholder={'<meta name="example" content="value" />'}
							hint="Код будет добавлен внутри тега head после сохранения."
							disabled={!canEditRawCode}
						/>
					</div>
					{!canEditRawCode && (
						<div className={styles.devLockHint}>
							<span>Только просмотр для ADMIN</span>
							<AdminTooltip
								title="DEV-only действие"
								description="Изменение Head-кода разрешено только DEV и отдельно проверяется backend."
							/>
						</div>
					)}
				</section>
			)}

			{isHomeArea && (
				<>
					<section className={styles.panel}>
						<SectionTitle
							title="Первый экран"
							description="Главный заголовок, процент, подзаголовок и CTA-кнопка в самом верху главной страницы."
							risk="high"
							riskText="Это первое, что видит посетитель. Слишком длинный текст может сломать композицию, а слабый оффер снизит конверсию."
						>
							Первый экран
						</SectionTitle>
						<div className={styles.gridTwo}>
							<TextAreaField
								id="hero-title-before"
								label="Заголовок до акцента"
								value={draft.hero.titleBeforeAccent}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										hero: {
											...prev.hero,
											titleBeforeAccent: value
										}
									}))
								}
								hint="Переносы строк сохраняются."
							/>
							<TextField
								id="hero-accent"
								label="Акцент"
								value={draft.hero.accentText}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										hero: { ...prev.hero, accentText: value }
									}))
								}
							/>
						</div>
						<TextField
							id="hero-title-after"
							label="Заголовок после акцента"
							value={draft.hero.titleAfterAccent}
							onChange={value =>
								updateDraft(prev => ({
									...prev,
									hero: { ...prev.hero, titleAfterAccent: value }
								}))
							}
						/>
						<div className={styles.gridTwo}>
							<TextField
								id="hero-subtitle"
								label="Подзаголовок"
								value={draft.hero.subtitle}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										hero: { ...prev.hero, subtitle: value }
									}))
								}
							/>
							<TextField
								id="hero-primary"
								label="Текст кнопки"
								value={draft.hero.primaryButtonText}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										hero: {
											...prev.hero,
											primaryButtonText: value
										}
									}))
								}
							/>
						</div>
						<div className={styles.list}>
							{draft.hero.benefits.map((benefit, index) => (
								<div
									key={`hero-benefit-${index}`}
									className={styles.itemCard}
								>
									<div className={styles.itemHeader}>
										<span className={styles.itemTitle}>
											Преимущество {index + 1}
										</span>
										<ListActions
											onMoveUp={() =>
												updateHeroBenefits(
													moveItem(draft.hero.benefits, index, -1)
												)
											}
											onMoveDown={() =>
												updateHeroBenefits(
													moveItem(draft.hero.benefits, index, 1)
												)
											}
											onRemove={() =>
												updateHeroBenefits(
													removeItem(draft.hero.benefits, index)
												)
											}
											disableUp={index === 0}
											disableDown={
												index === draft.hero.benefits.length - 1
											}
										/>
									</div>
									<TextField
										id={`hero-benefit-${index}`}
										label="Текст преимущества"
										value={benefit.text}
										onChange={value =>
											updateHeroBenefits(
												updateItem(draft.hero.benefits, index, {
													text: value
												})
											)
										}
									/>
								</div>
							))}
						</div>
						<button
							type="button"
							className={styles.addBtn}
							onClick={() =>
								updateHeroBenefits([
									...draft.hero.benefits,
									{ text: 'Новое преимущество' }
								])
							}
						>
							Добавить преимущество
						</button>
					</section>

					<section className={styles.panel}>
						<div className={styles.panelHeader}>
							<SectionTitle
								title="Блок с проблемой"
								description="Секция о задачах продаж и ситуациях, в которых CRM помогает организовать работу с клиентами."
								risk="medium"
								riskText="Если убрать боль клиента или сделать карточки слишком общими, блок станет менее убедительным. Количество карточек лучше держать умеренным."
							>
								Блок с проблемой
							</SectionTitle>
							<ToggleField
								label="Показывать"
								checked={draft.analysis.enabled}
								onChange={checked =>
									updateDraft(prev => ({
										...prev,
										analysis: {
											...prev.analysis,
											enabled: checked
										}
									}))
								}
							/>
						</div>
						<TextField
							id="analysis-title"
							label="Заголовок"
							value={draft.analysis.title}
							onChange={value =>
								updateDraft(prev => ({
									...prev,
									analysis: { ...prev.analysis, title: value }
								}))
							}
						/>
						<TextAreaField
							id="analysis-subtitle"
							label="Подзаголовок"
							value={draft.analysis.subtitle}
							onChange={value =>
								updateDraft(prev => ({
									...prev,
									analysis: { ...prev.analysis, subtitle: value }
								}))
							}
						/>
						<div className={styles.list}>
							{draft.analysis.cards.map((card, index) => (
								<div
									key={`analysis-card-${index}`}
									className={styles.itemCard}
								>
									<div className={styles.itemHeader}>
										<span className={styles.itemTitle}>
											Кейс {index + 1}
										</span>
										<ListActions
											onMoveUp={() =>
												updateCardList(
													'analysis',
													moveItem(draft.analysis.cards, index, -1)
												)
											}
											onMoveDown={() =>
												updateCardList(
													'analysis',
													moveItem(draft.analysis.cards, index, 1)
												)
											}
											onRemove={() =>
												updateCardList(
													'analysis',
													removeItem(draft.analysis.cards, index)
												)
											}
											disableUp={index === 0}
											disableDown={
												index === draft.analysis.cards.length - 1
											}
										/>
									</div>
									<TextField
										id={`analysis-card-${index}`}
										label="Текст карточки"
										value={card.text}
										onChange={value =>
											updateCardList(
												'analysis',
												updateItem(draft.analysis.cards, index, {
													text: value
												})
											)
										}
									/>
								</div>
							))}
						</div>
						<button
							type="button"
							className={styles.addBtn}
							onClick={() =>
								updateCardList('analysis', [
									...draft.analysis.cards,
									{ text: 'Новая карточка' }
								])
							}
						>
							Добавить кейс
						</button>
					</section>

					<section className={styles.panel}>
						<div className={styles.panelHeader}>
							<SectionTitle
								title="Интеграции"
								description="Карусель готовых подключений: email, Telegram, CRM, аналитика и другие каналы передачи заявок."
								risk="medium"
								riskText="Не обещайте интеграции, которых нет в продукте. Ошибка здесь создаёт неверные ожидания у клиента."
							>
								Интеграции
							</SectionTitle>
							<ToggleField
								label="Показывать"
								checked={draft.integrations.enabled}
								onChange={checked =>
									updateDraft(prev => ({
										...prev,
										integrations: {
											...prev.integrations,
											enabled: checked
										}
									}))
								}
							/>
						</div>
						<TextField
							id="integrations-title"
							label="Заголовок"
							value={draft.integrations.title}
							onChange={value =>
								updateDraft(prev => ({
									...prev,
									integrations: {
										...prev.integrations,
										title: value
									}
								}))
							}
						/>
						<div className={styles.list}>
							{draft.integrations.items.map((item, index) => (
								<div
									key={`integration-${index}`}
									className={styles.itemCard}
								>
									<div className={styles.itemHeader}>
										<span className={styles.itemTitle}>
											Интеграция {index + 1}
										</span>
										<ListActions
											onMoveUp={() =>
												updateIntegrationItems(
													moveItem(draft.integrations.items, index, -1)
												)
											}
											onMoveDown={() =>
												updateIntegrationItems(
													moveItem(draft.integrations.items, index, 1)
												)
											}
											onRemove={() =>
												updateIntegrationItems(
													removeItem(draft.integrations.items, index)
												)
											}
											disableUp={index === 0}
											disableDown={
												index === draft.integrations.items.length - 1
											}
										/>
									</div>
									<div className={styles.gridThree}>
										<TextField
											id={`integration-title-${index}`}
											label="Название"
											value={item.title}
											onChange={value =>
												updateIntegrationItems(
													updateItem(draft.integrations.items, index, {
														title: value
													})
												)
											}
										/>
										<TextField
											id={`integration-tag-${index}`}
											label="Тег"
											value={item.tag}
											onChange={value =>
												updateIntegrationItems(
													updateItem(draft.integrations.items, index, {
														tag: value
													})
												)
											}
										/>
										<div className={styles.field}>
											<label
												htmlFor={`integration-icon-${index}`}
												className={styles.fieldLabel}
											>
												Иконка
											</label>
											<select
												id={`integration-icon-${index}`}
												className={styles.select}
												value={item.iconKey}
												onChange={event =>
													updateIntegrationItems(
														updateItem(draft.integrations.items, index, {
															iconKey: event.target
																.value as HomePageIntegrationIconKey
														})
													)
												}
											>
												{ICON_OPTIONS.map(option => (
													<option key={option.value} value={option.value}>
														{option.label}
													</option>
												))}
											</select>
										</div>
									</div>
									<TextAreaField
										id={`integration-description-${index}`}
										label="Описание"
										value={item.description}
										onChange={value =>
											updateIntegrationItems(
												updateItem(draft.integrations.items, index, {
													description: value
												})
											)
										}
									/>
								</div>
							))}
						</div>
						<button
							type="button"
							className={styles.addBtn}
							onClick={() =>
								updateIntegrationItems([
									...draft.integrations.items,
									{
										title: 'Новая интеграция',
										tag: 'Интеграция',
										description: 'Описание интеграции',
										iconKey: 'webhook'
									}
								])
							}
						>
							Добавить интеграцию
						</button>
					</section>

					<section className={styles.panel}>
						<div className={styles.panelHeader}>
							<SectionTitle
								title="Для каких бизнесов"
								description="Блок социального доказательства: показывает посетителю, что сервис подходит разным нишам и задачам."
								risk="medium"
								riskText="Не указывайте ниши, которым продукт фактически не подходит. Длинные описания могут перегрузить карточки."
							>
								Для каких бизнесов
							</SectionTitle>
							<ToggleField
								label="Показывать"
								checked={draft.audiences.enabled}
								onChange={checked =>
									updateDraft(prev => ({
										...prev,
										audiences: {
											...prev.audiences,
											enabled: checked
										}
									}))
								}
							/>
						</div>
						<div className={styles.gridTwo}>
							<TextField
								id="audiences-title"
								label="Заголовок"
								value={draft.audiences.title}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										audiences: { ...prev.audiences, title: value }
									}))
								}
							/>
							<TextAreaField
								id="audiences-subtitle"
								label="Подзаголовок"
								value={draft.audiences.subtitle}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										audiences: {
											...prev.audiences,
											subtitle: value
										}
									}))
								}
							/>
						</div>
						<div className={styles.list}>
							{draft.audiences.items.map((item, index) => (
								<div key={`audience-${index}`} className={styles.itemCard}>
									<div className={styles.itemHeader}>
										<span className={styles.itemTitle}>
											Ниша {index + 1}
										</span>
										<ListActions
											onMoveUp={() =>
												updateAudienceItems(
													moveItem(draft.audiences.items, index, -1)
												)
											}
											onMoveDown={() =>
												updateAudienceItems(
													moveItem(draft.audiences.items, index, 1)
												)
											}
											onRemove={() =>
												updateAudienceItems(
													removeItem(draft.audiences.items, index)
												)
											}
											disableUp={index === 0}
											disableDown={
												index === draft.audiences.items.length - 1
											}
										/>
									</div>
									<div className={styles.gridTwo}>
										<TextField
											id={`audience-title-${index}`}
											label="Название"
											value={item.title}
											onChange={value =>
												updateAudienceItems(
													updateItem(draft.audiences.items, index, {
														title: value
													})
												)
											}
										/>
										<TextAreaField
											id={`audience-text-${index}`}
											label="Описание"
											value={item.text}
											onChange={value =>
												updateAudienceItems(
													updateItem(draft.audiences.items, index, {
														text: value
													})
												)
											}
										/>
									</div>
								</div>
							))}
						</div>
						<button
							type="button"
							className={styles.addBtn}
							onClick={() =>
								updateAudienceItems([
									...draft.audiences.items,
									{
										title: 'Новая ниша',
										text: 'Описание кейса для этой ниши'
									}
								])
							}
						>
							Добавить нишу
						</button>
					</section>

					<section className={styles.panel}>
						<div className={styles.panelHeader}>
							<SectionTitle
								title="Кейсы"
								description="Примеры использования CRM: задача, сценарий и ожидаемый результат для бизнеса."
								risk="medium"
								riskText="Если кейсы не подтверждены реальными цифрами, формулируйте их как кейсы, а не как гарантированный результат."
							>
								Кейсы
							</SectionTitle>
							<ToggleField
								label="Показывать"
								checked={draft.caseStudies.enabled}
								onChange={checked =>
									updateDraft(prev => ({
										...prev,
										caseStudies: {
											...prev.caseStudies,
											enabled: checked
										}
									}))
								}
							/>
						</div>
						<div className={styles.gridTwo}>
							<TextField
								id="case-studies-title"
								label="Заголовок"
								value={draft.caseStudies.title}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										caseStudies: {
											...prev.caseStudies,
											title: value
										}
									}))
								}
							/>
							<TextAreaField
								id="case-studies-subtitle"
								label="Подзаголовок"
								value={draft.caseStudies.subtitle}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										caseStudies: {
											...prev.caseStudies,
											subtitle: value
										}
									}))
								}
							/>
						</div>
						<div className={styles.list}>
							{draft.caseStudies.items.map((item, index) => (
								<div key={`case-${index}`} className={styles.itemCard}>
									<div className={styles.itemHeader}>
										<span className={styles.itemTitle}>
											Кейс {index + 1}
										</span>
										<ListActions
											onMoveUp={() =>
												updateCaseStudyItems(
													moveItem(draft.caseStudies.items, index, -1)
												)
											}
											onMoveDown={() =>
												updateCaseStudyItems(
													moveItem(draft.caseStudies.items, index, 1)
												)
											}
											onRemove={() =>
												updateCaseStudyItems(
													removeItem(draft.caseStudies.items, index)
												)
											}
											disableUp={index === 0}
											disableDown={
												index === draft.caseStudies.items.length - 1
											}
										/>
									</div>
									<TextField
										id={`case-title-${index}`}
										label="Название"
										value={item.title}
										onChange={value =>
											updateCaseStudyItems(
												updateItem(draft.caseStudies.items, index, {
													title: value
												})
											)
										}
									/>
									<div className={styles.gridTwo}>
										<TextAreaField
											id={`case-text-${index}`}
											label="Кейс"
											value={item.text}
											onChange={value =>
												updateCaseStudyItems(
													updateItem(draft.caseStudies.items, index, {
														text: value
													})
												)
											}
										/>
										<TextAreaField
											id={`case-result-${index}`}
											label="Результат"
											value={item.result}
											onChange={value =>
												updateCaseStudyItems(
													updateItem(draft.caseStudies.items, index, {
														result: value
													})
												)
											}
										/>
									</div>
								</div>
							))}
						</div>
						<button
							type="button"
							className={styles.addBtn}
							onClick={() =>
								updateCaseStudyItems([
									...draft.caseStudies.items,
									{
										title: 'Новый кейс',
										text: 'Описание кейса',
										result: 'Ожидаемый результат'
									}
								])
							}
						>
							Добавить кейс
						</button>
					</section>

					<section className={styles.panel}>
						<div className={styles.panelHeader}>
							<SectionTitle
								title="Путь заявки"
								description="Объясняет путь обращения от формы на сайте до обработки в CRM."
								risk="medium"
								riskText="Не обещайте каналы обработки заявок, которые не включены в продукт или тарифы."
							>
								Путь заявки
							</SectionTitle>
							<ToggleField
								label="Показывать"
								checked={draft.leadFlow.enabled}
								onChange={checked =>
									updateDraft(prev => ({
										...prev,
										leadFlow: {
											...prev.leadFlow,
											enabled: checked
										}
									}))
								}
							/>
						</div>
						<div className={styles.gridTwo}>
							<TextField
								id="lead-flow-title"
								label="Заголовок"
								value={draft.leadFlow.title}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										leadFlow: { ...prev.leadFlow, title: value }
									}))
								}
							/>
							<TextAreaField
								id="lead-flow-subtitle"
								label="Подзаголовок"
								value={draft.leadFlow.subtitle}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										leadFlow: {
											...prev.leadFlow,
											subtitle: value
										}
									}))
								}
							/>
						</div>
						<div className={styles.list}>
							{draft.leadFlow.items.map((item, index) => (
								<div
									key={`lead-flow-${index}`}
									className={styles.itemCard}
								>
									<div className={styles.itemHeader}>
										<span className={styles.itemTitle}>
											Шаг заявки {index + 1}
										</span>
										<ListActions
											onMoveUp={() =>
												updateLeadFlowItems(
													moveItem(draft.leadFlow.items, index, -1)
												)
											}
											onMoveDown={() =>
												updateLeadFlowItems(
													moveItem(draft.leadFlow.items, index, 1)
												)
											}
											onRemove={() =>
												updateLeadFlowItems(
													removeItem(draft.leadFlow.items, index)
												)
											}
											disableUp={index === 0}
											disableDown={
												index === draft.leadFlow.items.length - 1
											}
										/>
									</div>
									<div className={styles.gridTwo}>
										<TextField
											id={`lead-flow-title-${index}`}
											label="Название"
											value={item.title}
											onChange={value =>
												updateLeadFlowItems(
													updateItem(draft.leadFlow.items, index, {
														title: value
													})
												)
											}
										/>
										<TextAreaField
											id={`lead-flow-text-${index}`}
											label="Описание"
											value={item.text}
											onChange={value =>
												updateLeadFlowItems(
													updateItem(draft.leadFlow.items, index, {
														text: value
													})
												)
											}
										/>
									</div>
								</div>
							))}
						</div>
						<button
							type="button"
							className={styles.addBtn}
							onClick={() =>
								updateLeadFlowItems([
									...draft.leadFlow.items,
									{
										title: 'Новый шаг',
										text: 'Описание шага'
									}
								])
							}
						>
							Добавить шаг заявки
						</button>
					</section>

					<section className={styles.panel}>
						<div className={styles.panelHeader}>
							<SectionTitle
								title="Блок кастомизации"
								description="Редактирует блок главной про настройку цветов, текстов, бонусов, превью и единый стиль сайта."
								risk="medium"
								riskText="Это визуальный блок с карточками. Длинные заголовки и описания могут ухудшить сетку на мобильном экране."
							>
								Кастомизация
							</SectionTitle>
							<ToggleField
								label="Показывать"
								checked={draft.customization.enabled}
								onChange={checked =>
									updateDraft(prev => ({
										...prev,
										customization: {
											...prev.customization,
											enabled: checked
										}
									}))
								}
							/>
						</div>
						<div className={styles.gridTwo}>
							<TextAreaField
								id="customization-title"
								label="Заголовок"
								value={draft.customization.title}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										customization: {
											...prev.customization,
											title: value
										}
									}))
								}
								hint="Переносы строк сохраняются."
							/>
							<TextAreaField
								id="customization-subtitle"
								label="Подзаголовок"
								value={draft.customization.subtitle}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										customization: {
											...prev.customization,
											subtitle: value
										}
									}))
								}
								hint="Переносы строк сохраняются."
							/>
						</div>
						<div className={styles.list}>
							{draft.customization.cards.map((card, index) => (
								<div
									key={`customization-card-${index}`}
									className={styles.itemCard}
								>
									<div className={styles.itemHeader}>
										<span className={styles.itemTitle}>
											Карточка {index + 1}
										</span>
										<ListActions
											onMoveUp={() =>
												updateCustomizationCards(
													moveItem(draft.customization.cards, index, -1)
												)
											}
											onMoveDown={() =>
												updateCustomizationCards(
													moveItem(draft.customization.cards, index, 1)
												)
											}
											onRemove={() =>
												updateCustomizationCards(
													removeItem(draft.customization.cards, index)
												)
											}
											disableUp={index === 0}
											disableDown={
												index === draft.customization.cards.length - 1
											}
										/>
									</div>
									<div className={styles.gridTwo}>
										<TextField
											id={`customization-card-title-${index}`}
											label="Заголовок"
											value={card.title}
											onChange={value =>
												updateCustomizationCards(
													updateItem(draft.customization.cards, index, {
														title: value
													})
												)
											}
										/>
										<TextAreaField
											id={`customization-card-text-${index}`}
											label="Описание"
											value={card.text}
											onChange={value =>
												updateCustomizationCards(
													updateItem(draft.customization.cards, index, {
														text: value
													})
												)
											}
											hint="Переносы строк сохраняются."
										/>
									</div>
								</div>
							))}
						</div>
						<button
							type="button"
							className={styles.addBtn}
							onClick={() =>
								updateCustomizationCards([
									...draft.customization.cards,
									{
										title: 'Новая карточка',
										text: 'Описание карточки'
									}
								])
							}
						>
							Добавить карточку
						</button>

						<div className={styles.list}>
							{draft.customization.features.map((feature, index) => (
								<div
									key={`customization-feature-${index}`}
									className={styles.itemCard}
								>
									<div className={styles.itemHeader}>
										<span className={styles.itemTitle}>
											Преимущество {index + 1}
										</span>
										<ListActions
											onMoveUp={() =>
												updateCustomizationFeatures(
													moveItem(draft.customization.features, index, -1)
												)
											}
											onMoveDown={() =>
												updateCustomizationFeatures(
													moveItem(draft.customization.features, index, 1)
												)
											}
											onRemove={() =>
												updateCustomizationFeatures(
													removeItem(draft.customization.features, index)
												)
											}
											disableUp={index === 0}
											disableDown={
												index === draft.customization.features.length - 1
											}
										/>
									</div>
									<TextField
										id={`customization-feature-text-${index}`}
										label="Текст"
										value={feature.text}
										onChange={value =>
											updateCustomizationFeatures(
												updateItem(draft.customization.features, index, {
													text: value
												})
											)
										}
									/>
								</div>
							))}
						</div>
						<button
							type="button"
							className={styles.addBtn}
							onClick={() =>
								updateCustomizationFeatures([
									...draft.customization.features,
									{ text: 'Новое преимущество' }
								])
							}
						>
							Добавить преимущество
						</button>

						<TextAreaField
							id="customization-bottom-text"
							label="Нижняя подпись"
							value={draft.customization.bottomText}
							onChange={value =>
								updateDraft(prev => ({
									...prev,
									customization: {
										...prev.customization,
										bottomText: value
									}
								}))
							}
							hint="Переносы строк сохраняются."
						/>
					</section>

					<section className={styles.panel}>
						<div className={styles.panelHeader}>
							<SectionTitle
								title="Начало работы"
								description="Короткая инструкция по началу работы с aeroCRM."
								risk="low"
								riskText="Риск небольшой, но слишком длинные шаги усложнят восприятие. Лучше оставлять 3-4 коротких действия."
							>
								Начало работы
							</SectionTitle>
							<ToggleField
								label="Показывать"
								checked={draft.steps.enabled}
								onChange={checked =>
									updateDraft(prev => ({
										...prev,
										steps: { ...prev.steps, enabled: checked }
									}))
								}
							/>
						</div>
						<div className={styles.gridTwo}>
							<TextField
								id="steps-title"
								label="Заголовок"
								value={draft.steps.title}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										steps: { ...prev.steps, title: value }
									}))
								}
							/>
							<TextAreaField
								id="steps-result"
								label="Текст результата"
								value={draft.steps.resultText}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										steps: { ...prev.steps, resultText: value }
									}))
								}
								rows={3}
							/>
						</div>
						<div className={styles.list}>
							{draft.steps.items.map((step, index) => (
								<div key={`step-${index}`} className={styles.itemCard}>
									<div className={styles.itemHeader}>
										<span className={styles.itemTitle}>
											Шаг {index + 1}
										</span>
										<ListActions
											onMoveUp={() =>
												updateCardList(
													'steps',
													moveItem(draft.steps.items, index, -1)
												)
											}
											onMoveDown={() =>
												updateCardList(
													'steps',
													moveItem(draft.steps.items, index, 1)
												)
											}
											onRemove={() =>
												updateCardList(
													'steps',
													removeItem(draft.steps.items, index)
												)
											}
											disableUp={index === 0}
											disableDown={index === draft.steps.items.length - 1}
										/>
									</div>
									<TextField
										id={`step-text-${index}`}
										label="Текст"
										value={step.text}
										onChange={value =>
											updateCardList(
												'steps',
												updateItem(draft.steps.items, index, {
													text: value
												})
											)
										}
									/>
								</div>
							))}
						</div>
						<button
							type="button"
							className={styles.addBtn}
							onClick={() =>
								updateCardList('steps', [
									...draft.steps.items,
									{ text: 'Новый шаг' }
								])
							}
						>
							Добавить шаг
						</button>
					</section>

					<section className={styles.panel}>
						<div className={styles.panelHeader}>
							<SectionTitle
								title="Промежуточные CTA"
								description="Короткие призывы к действию после ключевых блоков главной: после интеграций и после шагов установки."
								risk="medium"
								riskText="Слишком частые или агрессивные CTA могут раздражать посетителя. Тексты должны быть короткими."
							>
								Промежуточные CTA
							</SectionTitle>
							<ToggleField
								label="Показывать"
								checked={draft.microCta.enabled}
								onChange={checked =>
									updateDraft(prev => ({
										...prev,
										microCta: { ...prev.microCta, enabled: checked }
									}))
								}
							/>
						</div>
						<div className={styles.gridTwo}>
							<TextAreaField
								id="micro-cta-integrations-text"
								label="Текст после интеграций"
								value={draft.microCta.afterIntegrationsText}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										microCta: {
											...prev.microCta,
											afterIntegrationsText: value
										}
									}))
								}
							/>
							<TextField
								id="micro-cta-integrations-button"
								label="Кнопка после интеграций"
								value={draft.microCta.afterIntegrationsButtonText}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										microCta: {
											...prev.microCta,
											afterIntegrationsButtonText: value
										}
									}))
								}
							/>
						</div>
						<div className={styles.gridTwo}>
							<TextAreaField
								id="micro-cta-steps-text"
								label="Текст после шагов"
								value={draft.microCta.afterStepsText}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										microCta: {
											...prev.microCta,
											afterStepsText: value
										}
									}))
								}
							/>
							<TextField
								id="micro-cta-steps-button"
								label="Кнопка после шагов"
								value={draft.microCta.afterStepsButtonText}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										microCta: {
											...prev.microCta,
											afterStepsButtonText: value
										}
									}))
								}
							/>
						</div>
					</section>

					<section className={styles.panel}>
						<div className={styles.panelHeader}>
							<SectionTitle
								title="Личный кабинет"
								description="Блок показывает, что после регистрации пользователь управляет заявками, настройками, интеграциями и аналитикой."
								risk="medium"
								riskText="Не указывайте возможности кабинета, которых нет в продукте или которые доступны только на другом тарифе без пояснения."
							>
								Личный кабинет
							</SectionTitle>
							<ToggleField
								label="Показывать"
								checked={draft.dashboardPreview.enabled}
								onChange={checked =>
									updateDraft(prev => ({
										...prev,
										dashboardPreview: {
											...prev.dashboardPreview,
											enabled: checked
										}
									}))
								}
							/>
						</div>
						<div className={styles.gridTwo}>
							<TextField
								id="dashboard-title"
								label="Заголовок"
								value={draft.dashboardPreview.title}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										dashboardPreview: {
											...prev.dashboardPreview,
											title: value
										}
									}))
								}
							/>
							<TextAreaField
								id="dashboard-subtitle"
								label="Подзаголовок"
								value={draft.dashboardPreview.subtitle}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										dashboardPreview: {
											...prev.dashboardPreview,
											subtitle: value
										}
									}))
								}
							/>
						</div>
						<div className={styles.list}>
							{draft.dashboardPreview.cards.map((card, index) => (
								<div
									key={`dashboard-card-${index}`}
									className={styles.itemCard}
								>
									<div className={styles.itemHeader}>
										<span className={styles.itemTitle}>
											Карточка кабинета {index + 1}
										</span>
										<ListActions
											onMoveUp={() =>
												updateDashboardCards(
													moveItem(draft.dashboardPreview.cards, index, -1)
												)
											}
											onMoveDown={() =>
												updateDashboardCards(
													moveItem(draft.dashboardPreview.cards, index, 1)
												)
											}
											onRemove={() =>
												updateDashboardCards(
													removeItem(draft.dashboardPreview.cards, index)
												)
											}
											disableUp={index === 0}
											disableDown={
												index === draft.dashboardPreview.cards.length - 1
											}
										/>
									</div>
									<div className={styles.gridTwo}>
										<TextField
											id={`dashboard-card-title-${index}`}
											label="Название"
											value={card.title}
											onChange={value =>
												updateDashboardCards(
													updateItem(draft.dashboardPreview.cards, index, {
														title: value
													})
												)
											}
										/>
										<TextAreaField
											id={`dashboard-card-text-${index}`}
											label="Описание"
											value={card.text}
											onChange={value =>
												updateDashboardCards(
													updateItem(draft.dashboardPreview.cards, index, {
														text: value
													})
												)
											}
										/>
									</div>
								</div>
							))}
						</div>
						<button
							type="button"
							className={styles.addBtn}
							onClick={() =>
								updateDashboardCards([
									...draft.dashboardPreview.cards,
									{
										title: 'Новая карточка',
										text: 'Описание карточки'
									}
								])
							}
						>
							Добавить карточку кабинета
						</button>
						<div className={styles.list}>
							{draft.dashboardPreview.metrics.map((metric, index) => (
								<div
									key={`dashboard-metric-${index}`}
									className={styles.itemCard}
								>
									<div className={styles.itemHeader}>
										<span className={styles.itemTitle}>
											Метрика {index + 1}
										</span>
										<ListActions
											onMoveUp={() =>
												updateDashboardMetrics(
													moveItem(
														draft.dashboardPreview.metrics,
														index,
														-1
													)
												)
											}
											onMoveDown={() =>
												updateDashboardMetrics(
													moveItem(
														draft.dashboardPreview.metrics,
														index,
														1
													)
												)
											}
											onRemove={() =>
												updateDashboardMetrics(
													removeItem(draft.dashboardPreview.metrics, index)
												)
											}
											disableUp={index === 0}
											disableDown={
												index === draft.dashboardPreview.metrics.length - 1
											}
										/>
									</div>
									<div className={styles.gridTwo}>
										<TextField
											id={`dashboard-metric-title-${index}`}
											label="Значение"
											value={metric.title}
											onChange={value =>
												updateDashboardMetrics(
													updateItem(
														draft.dashboardPreview.metrics,
														index,
														{ title: value }
													)
												)
											}
										/>
										<TextAreaField
											id={`dashboard-metric-text-${index}`}
											label="Подпись"
											value={metric.text}
											onChange={value =>
												updateDashboardMetrics(
													updateItem(
														draft.dashboardPreview.metrics,
														index,
														{ text: value }
													)
												)
											}
										/>
									</div>
								</div>
							))}
						</div>
						<button
							type="button"
							className={styles.addBtn}
							onClick={() =>
								updateDashboardMetrics([
									...draft.dashboardPreview.metrics,
									{ title: '1', text: 'Новая метрика' }
								])
							}
						>
							Добавить метрику
						</button>
					</section>

					<section className={styles.panel}>
						<div className={styles.panelHeader}>
							<SectionTitle
								title="Доверие и безопасность"
								description="Блок объясняет хранение заявок, оплату, домен установки и защитные ограничения продукта."
								risk="high"
								riskText="Это доверительный блок. Не обещайте юридические или технические гарантии, которых нет в продукте."
							>
								Доверие и безопасность
							</SectionTitle>
							<ToggleField
								label="Показывать"
								checked={draft.security.enabled}
								onChange={checked =>
									updateDraft(prev => ({
										...prev,
										security: {
											...prev.security,
											enabled: checked
										}
									}))
								}
							/>
						</div>
						<div className={styles.gridTwo}>
							<TextField
								id="security-title"
								label="Заголовок"
								value={draft.security.title}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										security: { ...prev.security, title: value }
									}))
								}
							/>
							<TextAreaField
								id="security-subtitle"
								label="Подзаголовок"
								value={draft.security.subtitle}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										security: {
											...prev.security,
											subtitle: value
										}
									}))
								}
							/>
						</div>
						<div className={styles.list}>
							{draft.security.items.map((item, index) => (
								<div key={`security-${index}`} className={styles.itemCard}>
									<div className={styles.itemHeader}>
										<span className={styles.itemTitle}>
											Пункт доверия {index + 1}
										</span>
										<ListActions
											onMoveUp={() =>
												updateSecurityItems(
													moveItem(draft.security.items, index, -1)
												)
											}
											onMoveDown={() =>
												updateSecurityItems(
													moveItem(draft.security.items, index, 1)
												)
											}
											onRemove={() =>
												updateSecurityItems(
													removeItem(draft.security.items, index)
												)
											}
											disableUp={index === 0}
											disableDown={
												index === draft.security.items.length - 1
											}
										/>
									</div>
									<div className={styles.gridTwo}>
										<TextField
											id={`security-title-${index}`}
											label="Название"
											value={item.title}
											onChange={value =>
												updateSecurityItems(
													updateItem(draft.security.items, index, {
														title: value
													})
												)
											}
										/>
										<TextAreaField
											id={`security-text-${index}`}
											label="Описание"
											value={item.text}
											onChange={value =>
												updateSecurityItems(
													updateItem(draft.security.items, index, {
														text: value
													})
												)
											}
										/>
									</div>
								</div>
							))}
						</div>
						<button
							type="button"
							className={styles.addBtn}
							onClick={() =>
								updateSecurityItems([
									...draft.security.items,
									{
										title: 'Новый пункт',
										text: 'Описание пункта'
									}
								])
							}
						>
							Добавить пункт доверия
						</button>
					</section>

					<section className={styles.panel}>
						<div className={styles.panelHeader}>
							<div>
								<SectionTitle
									title="Тарифы на лендинге"
									description="Маркетинговый блок тарифов на главной: названия, выгоды, подписи и кнопки. Реальные цены берутся из раздела Тарифы."
									risk="high"
									riskText="Изменения в этом блоке не меняют сумму оплаты. Реальные цены редактируются только в разделе Тарифы."
								>
									Тарифы на главной
								</SectionTitle>
								<p className={styles.fieldHint}>
									Цены на главной и странице оплаты подтягиваются из
									раздела Тарифы, чтобы не было рассинхрона. Названия,
									подзаголовки и возможности карточек автоматически
									используются и на странице /payment.
								</p>
							</div>
							<ToggleField
								label="Показывать"
								checked={draft.pricing.enabled}
								onChange={checked =>
									updateDraft(prev => ({
										...prev,
										pricing: { ...prev.pricing, enabled: checked }
									}))
								}
							/>
						</div>
						<div className={styles.gridThree}>
							<TextField
								id="pricing-title"
								label="Заголовок"
								value={draft.pricing.title}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										pricing: { ...prev.pricing, title: value }
									}))
								}
							/>
							<TextField
								id="pricing-button"
								label="Текст кнопок"
								value={draft.pricing.buttonText}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										pricing: { ...prev.pricing, buttonText: value }
									}))
								}
							/>
							<TextField
								id="pricing-discount"
								label="Скидка"
								value={draft.pricing.discountText}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										pricing: { ...prev.pricing, discountText: value }
									}))
								}
							/>
						</div>
						<div className={styles.gridTwo}>
							<TextField
								id="pricing-monthly"
								label="Переключатель помесячно"
								value={draft.pricing.monthlyToggleText}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										pricing: {
											...prev.pricing,
											monthlyToggleText: value
										}
									}))
								}
							/>
							<TextField
								id="pricing-yearly"
								label="Переключатель за год"
								value={draft.pricing.yearlyToggleText}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										pricing: {
											...prev.pricing,
											yearlyToggleText: value
										}
									}))
								}
							/>
						</div>
					</section>

					<section className={styles.panel}>
						<div className={styles.panelHeader}>
							<SectionTitle
								title="Вопросы и ответы"
								description="FAQ внизу главной: ответы про продукт, установку, оплату, уведомления и интеграции."
								risk="medium"
								riskText="Ответы могут содержать ссылки и HTML. Неверная ссылка или обещание несуществующей функции быстро приведёт к вопросам от клиентов."
							>
								FAQ
							</SectionTitle>
							<ToggleField
								label="Показывать"
								checked={draft.faq.enabled}
								onChange={checked =>
									updateDraft(prev => ({
										...prev,
										faq: { ...prev.faq, enabled: checked }
									}))
								}
							/>
						</div>
						<TextField
							id="faq-title"
							label="Заголовок"
							value={draft.faq.title}
							onChange={value =>
								updateDraft(prev => ({
									...prev,
									faq: { ...prev.faq, title: value }
								}))
							}
						/>
						<div className={styles.list}>
							{draft.faq.items.map((item, index) => (
								<div key={`faq-${index}`} className={styles.itemCard}>
									<div className={styles.itemHeader}>
										<span className={styles.itemTitle}>
											Вопрос {index + 1}
										</span>
										<ListActions
											onMoveUp={() =>
												updateDraft(prev => ({
													...prev,
													faq: {
														...prev.faq,
														items: moveItem(prev.faq.items, index, -1)
													}
												}))
											}
											onMoveDown={() =>
												updateDraft(prev => ({
													...prev,
													faq: {
														...prev.faq,
														items: moveItem(prev.faq.items, index, 1)
													}
												}))
											}
											onRemove={() =>
												updateDraft(prev => ({
													...prev,
													faq: {
														...prev.faq,
														items: removeItem(prev.faq.items, index)
													}
												}))
											}
											disableUp={index === 0}
											disableDown={index === draft.faq.items.length - 1}
										/>
									</div>
									<TextField
										id={`faq-question-${index}`}
										label="Вопрос"
										value={item.question}
										onChange={value =>
											updateDraft(prev => ({
												...prev,
												faq: {
													...prev.faq,
													items: prev.faq.items.map(innerItem =>
														innerItem === item
															? {
																	...innerItem,
																	question: value
																}
															: innerItem
													)
												}
											}))
										}
									/>
									<TextAreaField
										id={`faq-answer-${index}`}
										label="Ответ"
										value={item.answerHtml}
										onChange={value =>
											updateDraft(prev => ({
												...prev,
												faq: {
													...prev.faq,
													items: prev.faq.items.map(innerItem =>
														innerItem === item
															? {
																	...innerItem,
																	answerHtml: value
																}
															: innerItem
													)
												}
											}))
										}
										hint="Можно использовать HTML: ссылки, br, b, code."
										rows={5}
									/>
								</div>
							))}
						</div>
						<button
							type="button"
							className={styles.addBtn}
							onClick={() =>
								updateDraft(prev => ({
									...prev,
									faq: {
										...prev.faq,
										items: [
											...prev.faq.items,
											{
												question: 'Новый вопрос',
												answerHtml: 'Новый ответ'
											}
										]
									}
								}))
							}
						>
							Добавить вопрос
						</button>
					</section>

					<section className={styles.panel}>
						<div className={styles.panelHeader}>
							<SectionTitle
								title="Финальный призыв к действию"
								description="Последний баннер на главной перед завершением страницы: основной призыв и текст кнопки."
								risk="medium"
								riskText="Если выключить или ослабить этот блок, часть посетителей не увидит повторный призыв начать бесплатный период."
							>
								Финальный CTA
							</SectionTitle>
							<ToggleField
								label="Показывать"
								checked={draft.cta.enabled}
								onChange={checked =>
									updateDraft(prev => ({
										...prev,
										cta: { ...prev.cta, enabled: checked }
									}))
								}
							/>
						</div>
						<div className={styles.gridTwo}>
							<TextAreaField
								id="cta-text"
								label="Текст"
								value={draft.cta.text}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										cta: { ...prev.cta, text: value }
									}))
								}
								hint="Переносы строк сохраняются."
							/>
							<TextField
								id="cta-button"
								label="Текст кнопки"
								value={draft.cta.buttonText}
								onChange={value =>
									updateDraft(prev => ({
										...prev,
										cta: { ...prev.cta, buttonText: value }
									}))
								}
							/>
						</div>
						<div className={styles.list}>
							{draft.cta.benefits.map((benefit, index) => (
								<div
									key={`cta-benefit-${index}`}
									className={styles.itemCard}
								>
									<div className={styles.itemHeader}>
										<span className={styles.itemTitle}>
											Преимущество {index + 1}
										</span>
										<ListActions
											onMoveUp={() =>
												updateCtaBenefits(
													moveItem(draft.cta.benefits, index, -1)
												)
											}
											onMoveDown={() =>
												updateCtaBenefits(
													moveItem(draft.cta.benefits, index, 1)
												)
											}
											onRemove={() =>
												updateCtaBenefits(
													removeItem(draft.cta.benefits, index)
												)
											}
											disableUp={index === 0}
											disableDown={index === draft.cta.benefits.length - 1}
										/>
									</div>
									<TextAreaField
										id={`cta-benefit-text-${index}`}
										label="Текст"
										value={benefit.text}
										onChange={value =>
											updateCtaBenefits(
												updateItem(draft.cta.benefits, index, {
													text: value
												})
											)
										}
										hint="Переносы строк сохраняются."
									/>
								</div>
							))}
						</div>
						<button
							type="button"
							className={styles.addBtn}
							onClick={() =>
								updateCtaBenefits([
									...draft.cta.benefits,
									{ text: 'Новое преимущество' }
								])
							}
						>
							Добавить преимущество
						</button>
					</section>
				</>
			)}
		</div>
	)
}

export default HomeContentEditor
