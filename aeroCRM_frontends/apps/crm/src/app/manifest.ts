import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
	return {
		id: '/',
		name: 'aeroCRM',
		short_name: 'aeroCRM',
		description: 'CRM для управления обращениями, сделками и задачами.',
		lang: 'ru',
		start_url: '/inbox',
		scope: '/',
		display: 'standalone',
		background_color: '#ffffff',
		theme_color: '#4c165e',
		icons: [
			{
				src: '/icons/icon-192.png',
				sizes: '192x192',
				type: 'image/png',
				purpose: 'any'
			},
			{
				src: '/icons/icon-512.png',
				sizes: '512x512',
				type: 'image/png',
				purpose: 'any'
			},
			{
				src: '/icons/maskable-512.png',
				sizes: '512x512',
				type: 'image/png',
				purpose: 'maskable'
			}
		]
	}
}
