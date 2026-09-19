import { MetadataRoute } from 'next'
import { DEFAULT_HOME_PAGE_TECHNICAL_SEO_CONTENT } from '@/entities/home-page-content'
import { getHomePageContent } from '@/entities/home-page-content/server'

export const dynamic = 'force-dynamic'

const robots = async (): Promise<MetadataRoute.Robots> => {
	const content = await getHomePageContent()
	const baseUrl = (
		content.technicalSeo.baseUrl ||
		DEFAULT_HOME_PAGE_TECHNICAL_SEO_CONTENT.baseUrl
	).replace(/\/+$/, '')
	const disallow = content.technicalSeo.robotsDisallow.length
		? content.technicalSeo.robotsDisallow
		: DEFAULT_HOME_PAGE_TECHNICAL_SEO_CONTENT.robotsDisallow

	return {
		rules: {
			userAgent: '*',
			disallow
		},
		sitemap: `${baseUrl}/sitemap.xml`
	}
}

export default robots
