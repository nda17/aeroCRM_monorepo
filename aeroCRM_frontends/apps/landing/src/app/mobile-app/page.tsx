import PageWidthScope from '@/app/_ui/PageWidthScope'
import MobileApps from '@/screens/mobile-app/ui/MobileApps'
import type { Metadata } from 'next'
import androidRelease from '../../../../../brand/android-release.json'

export const metadata: Metadata = {
	title: 'Мобильные приложения',
	description:
		'Приложение aeroCRM для Android: версия, требования и скачивание APK.',
	alternates: { canonical: 'https://aerocrm.space/mobile-app' }
}

const MobileAppsPage = () => (
	<PageWidthScope>
		<MobileApps release={androidRelease} />
	</PageWidthScope>
)

export default MobileAppsPage
