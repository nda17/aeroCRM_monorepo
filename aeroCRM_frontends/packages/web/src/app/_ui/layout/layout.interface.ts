import type { SiteSettings } from '@/entities/site-settings'
import type { HomePageFooterContent } from '@/entities/home-page-content'

export interface ILayout {
	children: React.ReactNode
	siteSettings?: SiteSettings | null
	footerContent?: HomePageFooterContent
}
