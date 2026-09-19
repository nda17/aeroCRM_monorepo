import Layout from '@/app/_ui/layout/Layout'
import { brandUnbounded } from '@/app/config/fonts'
import AppProviders from '@/app/providers/AppProviders'
import '@/app/styles/globals.scss'
import { EnumTokens } from '@/shared/api/token-names'
import { getHomePageContent } from '@/entities/home-page-content/server'
import { getSiteSettings } from '@/entities/site-settings/server'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import type { PropsWithChildren } from 'react'

export const metadata: Metadata = {
	metadataBase: new URL('https://aerocrm.space'),
	title: {
		default: 'aeroCRM — CRM для продаж и работы с клиентами',
		template: '%s — aeroCRM'
	},
	description:
		'Ведите заявки, клиентов и сделки в одной CRM. Командная работа, задачи и отчёты для продаж.',
	openGraph: {
		siteName: 'aeroCRM',
		locale: 'ru_RU',
		type: 'website',
		images: [{ url: '/opengraph-image', width: 1200, height: 630 }]
	}
}

const RootLayout = async ({ children }: PropsWithChildren<unknown>) => {
	const [siteSettings, homePageContent, cookieStore] =
		await Promise.all([
			getSiteSettings(),
			getHomePageContent(),
			cookies(),
		])
	const headHtml = homePageContent.head.enabled
		? homePageContent.head.html.trim()
		: ''
	const bodyHtml =
		homePageContent.body.enabled
			? homePageContent.body.html.trim()
			: ''
	const hasSessionHint = Boolean(
		cookieStore.get(EnumTokens.ACCESS_TOKEN)?.value ||
		cookieStore.get(EnumTokens.REFRESH_TOKEN)?.value
	)

	return (
		<html lang="ru" className={brandUnbounded.variable}>
			{headHtml && <head dangerouslySetInnerHTML={{ __html: headHtml }} />}
			<body>
				<AppProviders hasSessionHint={hasSessionHint}>
					<Layout
						siteSettings={siteSettings}
						footerContent={homePageContent.footer}
					>
						{children}
					</Layout>
				</AppProviders>
				{bodyHtml && (
					<div
						data-body-html
						style={{ display: 'contents' }}
						dangerouslySetInnerHTML={{ __html: bodyHtml }}
					/>
				)}
			</body>
		</html>
	)
}

export default RootLayout
