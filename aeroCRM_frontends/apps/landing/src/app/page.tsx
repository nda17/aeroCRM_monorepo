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

	return (
		<Home
			content={content}
			crmPricingPolicy={crmPricingPolicy}
		/>
	)
}

export default HomePage
