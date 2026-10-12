import PageWidthScope from '@/app/_ui/PageWidthScope'
import MobileApps from '@/screens/mobile-app/ui/MobileApps'
import type { Metadata } from 'next'
import androidRelease from '../../../../../brand/android-release.json'

export const metadata: Metadata = {
	title: 'Мобильные приложения',
	description:
		'Приложение aeroCRM для Android: версия, требования и скачивание APK.',
	alternates: { canonical: 'https://aerocrm.space/mobile-app' },
	openGraph: {
		url: 'https://aerocrm.space/mobile-app',
		siteName: 'aeroCRM',
		locale: 'ru_RU',
		type: 'website',
		images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'aeroCRM' }]
	}
}

const MobileAppsPage = () => (
	<PageWidthScope>
		<MobileApps release={androidRelease} />
	</PageWidthScope>
)

export default MobileAppsPage
