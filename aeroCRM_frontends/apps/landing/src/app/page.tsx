import { Home } from '@/screens/home'
import { getHomePageContent } from '@/entities/home-page-content/server'
import { getCrmPricingPolicy } from '@/entities/crm-pricing/server'
import { Metadata } from 'next'

export const generateMetadata = async (): Promise<Metadata> => {
	const content = await getHomePageContent()

	return {
		title: content.seo.title,
		description: content.seo.description,
		keywords: content.seo.keywords,
		openGraph: {
			title: content.seo.ogTitle,
			description: content.seo.ogDescription,
			siteName: 'aeroCRM',
			locale: 'ru_RU',
			url: 'https://aerocrm.space',
			type: 'website',
			images: [
				{
					url: '/opengraph-image',
					width: 1200,
					height: 630,
					alt: 'aeroCRM'
				}
			]
		},
		alternates: {
			canonical: 'https://aerocrm.space'
		}
	}
}

const HomePage = async () => {
	const [content, crmPricingPolicy] = await Promise.all([
		getHomePageContent(),
		getCrmPricingPolicy()
	])
	const siteUrl = 'https://aerocrm.space/'
	const organizationId = `${siteUrl}#organization`
	const structuredData = [
		{
			'@context': 'https://schema.org',
			'@type': 'WebSite',
			'@id': `${siteUrl}#website`,
			url: siteUrl,
			name: 'aeroCRM',
			publisher: { '@id': organizationId }
		},
		{
			'@context': 'https://schema.org',
			'@type': 'Organization',
			'@id': organizationId,
			name: content.footer.infoLines[0] || 'ООО «ЮБС»',
			legalName: content.footer.infoLines[0] || 'ООО «ЮБС»',
			url: content.footer.ybsUrl,
			email: content.footer.email
		}
	]

	return (
		<>
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{
					__html: JSON.stringify(structuredData).replace(/</g, '\\u003c')
				}}
			/>
			<Home
				content={content}
				crmPricingPolicy={crmPricingPolicy}
			/>
		</>
	)
}

export default HomePage
