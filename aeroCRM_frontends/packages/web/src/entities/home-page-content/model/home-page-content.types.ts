export type HomePageIntegrationIconKey =
	| 'email'
	| 'telegram'
	| 'webhook'
	| 'bitrix'
	| 'amocrm'
	| 'metrika'
	| 'vk'
	| 'roistat'

export interface HomePageContentRecord {
	id: string
	content: HomePageContent
	updatedAt: string
}

export interface HomePageContent {
	seo: HomePageSeoContent
	technicalSeo: HomePageTechnicalSeoContent
	hero: HomePageHeroContent
	analysis: HomePageAnalysisContent
	integrations: HomePageIntegrationsContent
	audiences: HomePageAudiencesContent
	caseStudies: HomePageCaseStudiesContent
	leadFlow: HomePageLeadFlowContent
	steps: HomePageStepsContent
	customization: HomePageCustomizationContent
	dashboardPreview: HomePageDashboardPreviewContent
	security: HomePageSecurityContent
	pricing: HomePagePricingContent
	microCta: HomePageMicroCtaContent
	seoText: HomePageSeoTextContent
	payment: HomePagePaymentContent
	faq: HomePageFaqContent
	cta: HomePageCtaContent
	footer: HomePageFooterContent
	head: HomePageHeadContent
	body: HomePageBodyContent
}

export type StructuredHomePageContent = Omit<
	HomePageContent,
	'head' | 'body'
>

export type RawHomePageContent = Pick<HomePageContent, 'head' | 'body'>

export interface HomePageSeoContent {
	title: string
	description: string
	keywords: string[]
	ogTitle: string
	ogDescription: string
}

export type HomePageSitemapChangeFrequency =
	| 'always'
	| 'hourly'
	| 'daily'
	| 'weekly'
	| 'monthly'
	| 'yearly'
	| 'never'

export interface HomePageTechnicalSeoContent {
	baseUrl: string
	robotsDisallow: string[]
	sitemapItems: HomePageSitemapItem[]
}

export interface HomePageSitemapItem {
	path: string
	changeFrequency: HomePageSitemapChangeFrequency
	priority: number
	enabled: boolean
}

export interface HomePageHeroContent {
	titleBeforeAccent: string
	accentText: string
	titleAfterAccent: string
	subtitle: string
	primaryButtonText: string
	faqButtonLabel: string
	benefits: HomePageTextCard[]
}

export interface HomePageAnalysisContent {
	enabled: boolean
	title: string
	subtitle: string
	cards: HomePageTextCard[]
}

export interface HomePageIntegrationsContent {
	enabled: boolean
	title: string
	items: HomePageIntegrationItem[]
}

export interface HomePageIntegrationItem {
	title: string
	tag: string
	description: string
	iconKey: HomePageIntegrationIconKey
}

export interface HomePageAudiencesContent {
	enabled: boolean
	title: string
	subtitle: string
	items: HomePageFeatureCard[]
}

export interface HomePageCaseStudiesContent {
	enabled: boolean
	title: string
	subtitle: string
	items: HomePageCaseStudy[]
}

export interface HomePageCaseStudy {
	title: string
	text: string
	result: string
}

export interface HomePageLeadFlowContent {
	enabled: boolean
	title: string
	subtitle: string
	items: HomePageFeatureCard[]
}

export interface HomePageStepsContent {
	enabled: boolean
	title: string
	resultText: string
	items: HomePageTextCard[]
}

export interface HomePageTextCard {
	text: string
}

export interface HomePageFeatureCard {
	title: string
	text: string
}

export interface HomePageCustomizationContent {
	enabled: boolean
	title: string
	subtitle: string
	cards: HomePageFeatureCard[]
	features: HomePageTextCard[]
	bottomText: string
}

export interface HomePageDashboardPreviewContent {
	enabled: boolean
	title: string
	subtitle: string
	cards: HomePageFeatureCard[]
	metrics: HomePageFeatureCard[]
}

export interface HomePageSecurityContent {
	enabled: boolean
	title: string
	subtitle: string
	items: HomePageFeatureCard[]
}

export interface HomePagePricingContent {
	enabled: boolean
	title: string
	monthlyToggleText: string
	yearlyToggleText: string
	discountText: string
	buttonText: string
}

export interface HomePageMicroCtaContent {
	enabled: boolean
	afterIntegrationsText: string
	afterIntegrationsButtonText: string
	afterStepsText: string
	afterStepsButtonText: string
}

export interface HomePageSeoTextContent {
	enabled: boolean
	title: string
	text: string
}

export interface HomePagePaymentContent {
	seoTitle: string
	seoDescription: string
}

export interface HomePageFaqContent {
	enabled: boolean
	title: string
	items: HomePageFaqItem[]
}

export interface HomePageFaqItem {
	question: string
	answerHtml: string
}

export interface HomePageCtaContent {
	enabled: boolean
	text: string
	buttonText: string
	benefits: HomePageTextCard[]
}

export interface HomePageFooterContent {
	aboutTitle: string
	infoLines: string[]
	email: string
	ybsUrl: string
	vkUrl: string
	telegramUrl: string
	vkAriaLabel: string
	telegramAriaLabel: string
	legalDisclaimer: string
}

export interface HomePageBodyContent {
	enabled: boolean
	html: string
}

export interface HomePageHeadContent {
	enabled: boolean
	html: string
}
