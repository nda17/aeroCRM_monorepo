import { MetadataRoute } from 'next'

const manifest = (): MetadataRoute.Manifest => {
	return {
		name: 'aeroCRM — CRM для продаж',
		short_name: 'aeroCRM',
		description: 'Продающие виджеты для повышения конверсии сайта',
		start_url: '/',
		display: 'standalone',
		background_color: '#f8f5ff',
		theme_color: '#470B58',
		icons: [
			{
				src: '/favicon-16x16.png',
				sizes: '16x16',
				type: 'image/png'
			},
			{
				src: '/favicon-32x32.png',
				sizes: '32x32',
				type: 'image/png'
			},
			{
				src: '/icon-192x192.png',
				sizes: '192x192',
				type: 'image/png'
			},
			{
				src: '/icon-512x512.png',
				sizes: '512x512',
				type: 'image/png'
			}
		]
	}
}

export default manifest
