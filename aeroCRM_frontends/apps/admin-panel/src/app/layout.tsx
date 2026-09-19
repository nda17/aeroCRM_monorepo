import { brandUnbounded } from '@/app/config/fonts'
import PlatformProviders from '@/app/providers/PlatformProviders'
import AdminFrame from './_ui/AdminFrame'
import '@/app/styles/globals.scss'
import { EnumTokens } from '@/shared/api/token-names'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import type { PropsWithChildren } from 'react'

export const metadata: Metadata = {
	metadataBase: new URL('https://aerocrm.space'),
	title: {
		default: 'Панель администратора aeroCRM и aeroCRM',
		template: '%s — aeroCRM'
	},
	robots: { index: false, follow: false, nocache: true },
	icons: { icon: '/favicon.ico', apple: '/apple-icon.png' }
}

export default function AdminRootLayout({ children }: PropsWithChildren) {
	const cookieStore = cookies()
	const hasSessionHint = Boolean(
		cookieStore.get(EnumTokens.ACCESS_TOKEN)?.value ||
		cookieStore.get(EnumTokens.REFRESH_TOKEN)?.value
	)
	return (
		<html lang="ru" className={brandUnbounded.variable}>
			<body>
				<PlatformProviders hasSessionHint={hasSessionHint}>
					<AdminFrame>{children}</AdminFrame>
				</PlatformProviders>
			</body>
		</html>
	)
}
