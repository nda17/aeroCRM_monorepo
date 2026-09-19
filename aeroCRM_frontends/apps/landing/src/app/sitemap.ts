import { MetadataRoute } from 'next'
import { DEFAULT_HOME_PAGE_TECHNICAL_SEO_CONTENT } from '@/entities/home-page-content'
import { getHomePageContent } from '@/entities/home-page-content/server'

export const dynamic = 'force-dynamic'

const buildUrl = (baseUrl: string, path: string) => {
	const base = baseUrl.replace(/\/+$/, '')
	const normalizedPath = path === '/' ? '' : path

	return `${base}${normalizedPath}`
}

const sitemap = async (): Promise<MetadataRoute.Sitemap> => {
	const content = await getHomePageContent()
	const baseUrl =
		content.technicalSeo.baseUrl ||
		DEFAULT_HOME_PAGE_TECHNICAL_SEO_CONTENT.baseUrl
	// Missing or unavailable content is already normalized to trusted defaults.
	// An explicitly disabled sitemap must not publish those URLs again.
	const items = content.technicalSeo.sitemapItems.filter(
		item =>
			item.enabled &&
			// Stored CMS content is preserved, but withdrawn pages are not public.
			!/^\/products\/(widgets|crm)\/?$/.test(item.path)
	)
	const lastModified = new Date()

	return items.map(item => ({
		url: buildUrl(baseUrl, item.path),
		lastModified,
		changeFrequency: item.changeFrequency,
		priority: item.priority
	}))
}

export default sitemap
