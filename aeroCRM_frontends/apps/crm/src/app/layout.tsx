import AppProviders from '@/app/providers/AppProviders'
import '@/app/styles/globals.scss'
import { PwaRegistration } from '@/shared/lib/pwa/PwaRegistration'
import { ThemeRuntime } from '@/shared/lib/theme/ThemeRuntime'
import { themeBootstrapScript } from '@/shared/lib/theme/theme'
import type { Metadata, Viewport } from 'next'
import type { PropsWithChildren } from 'react'

export const metadata: Metadata = {
	metadataBase: new URL('https://workspace.aerocrm.space'),
	title: {
		default: 'aeroCRM',
		template: '%s — aeroCRM'
	},
	description: 'CRM для управления обращениями, сделками и задачами.',
	applicationName: 'aeroCRM',
	manifest: '/manifest.webmanifest',
	appleWebApp: {
		capable: true,
		title: 'aeroCRM',
		statusBarStyle: 'default'
	},
	robots: {
		index: false,
		follow: false,
		noarchive: true
	}
}

export const viewport: Viewport = {
	width: 'device-width',
	initialScale: 1,
	themeColor: '#4c165e'
}

const RootLayout = ({ children }: PropsWithChildren) => {
	return (
		<html
			lang="ru"
			data-theme="light"
			data-theme-preference="light"
			suppressHydrationWarning
		>
			<head>
				<script
					dangerouslySetInnerHTML={{ __html: themeBootstrapScript }}
				/>
			</head>
			<body>
				<ThemeRuntime />
				<PwaRegistration />
				<AppProviders>{children}</AppProviders>
			</body>
		</html>
	)
}

export default RootLayout
