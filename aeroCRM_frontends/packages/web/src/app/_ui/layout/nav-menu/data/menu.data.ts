import { IMenu } from '@/app/_ui/layout/nav-menu/desktop/menu/menu.interface'
import { CRM_RELEASE } from '@/shared/config/crm-release.config'
import { PUBLIC_PAGES } from '@/shared/config/pages/public.config'
import type { FrontendZone } from '@/shared/lib/navigation/frontend-zones'

export const usesApplicationMenu = (
	pathname: string,
	zone: FrontendZone
) =>
	zone !== 'landing' &&
	!/^\/(login|register|restore-password|social-auth|logout)(?:\/|$)/.test(
		pathname
	)

export const staticMenu: IMenu = {
	items: [
		{
			icon: 'home',
			link: PUBLIC_PAGES.HOME,
			title: 'Главная'
		},
		{
			icon: 'dashboard',
			link: CRM_RELEASE.appUrl,
			title: 'CRM'
		}
	]
}
