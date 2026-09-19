import 'server-only'

import { API_URL } from '@/shared/config/api.config'
import { normalizeHomePageContent } from '@/entities/home-page-content/model/home-page-content.defaults'
import type { HomePageContent } from '@/entities/home-page-content/model/home-page-content.types'
import { cache } from 'react'

export const HOME_PAGE_CONTENT_TAG = 'home-page-content'

interface HomePageContentApiRecord {
	content: unknown
}

export const getHomePageContent = cache(
	async (): Promise<HomePageContent> => {
		try {
			const response = await fetch(`${API_URL}/home-page-content`, {
				next: { revalidate: 60, tags: [HOME_PAGE_CONTENT_TAG] }
			})

			if (!response.ok) {
				return normalizeHomePageContent()
			}

			const record = (await response.json()) as HomePageContentApiRecord

			return normalizeHomePageContent(record.content)
		} catch (error) {
			console.error('Failed to load home page content on server', error)
			return normalizeHomePageContent()
		}
	}
)
