import AppProviders from '@/app/providers/AppProviders'
import '@/app/styles/globals.scss'
import { ThemeRuntime } from '@/shared/lib/theme/ThemeRuntime'
import { themeBootstrapScript } from '@/shared/lib/theme/theme'
import type { Metadata } from 'next'
import type { PropsWithChildren } from 'react'

export const metadata: Metadata = {
	metadataBase: new URL('https://workspace.aerocrm.space'),
	title: {
		default: 'aeroCRM',
		template: '%s — aeroCRM'
	},
	description: 'CRM для управления обращениями, сделками и задачами.',
	robots: {
		index: false,
		follow: false,
		noarchive: true
	}
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
				<AppProviders>{children}</AppProviders>
			</body>
		</html>
	)
}

export default RootLayout
