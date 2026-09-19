'use server'

import { revalidateTag } from 'next/cache'
import { HOME_PAGE_CONTENT_TAG } from '@/entities/home-page-content/api/home-page-content.server'

export const revalidateHomePageContent = async () => {
	revalidateTag(HOME_PAGE_CONTENT_TAG)
}
