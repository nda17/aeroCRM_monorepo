import type { Config } from 'tailwindcss'
import commonConfig from '../../tailwind.config'

const config: Config = {
	presets: [commonConfig],
	theme: {
		extend: {
			colors: {
				primary: 'var(--admin-accent)',
				gray: {
					200: 'var(--admin-border)',
					300: 'rgb(var(--admin-gray-300) / <alpha-value>)',
					500: 'rgb(var(--admin-gray-500) / <alpha-value>)',
					600: 'rgb(var(--admin-gray-600) / <alpha-value>)',
					700: 'rgb(var(--admin-gray-700) / <alpha-value>)'
				},
				red: {
					50: 'var(--admin-danger-soft)',
					100: 'var(--admin-danger-soft)',
					600: 'var(--admin-danger)',
					700: 'var(--admin-danger)'
				},
				green: {
					50: 'var(--admin-success-soft)',
					100: 'var(--admin-success-soft)',
					600: 'var(--admin-success)',
					700: 'var(--admin-success)'
				}
			},
			borderRadius: { layout: '10px' }
		}
	},
	content: {
		relative: true,
		files: [
			'./src/**/*.{js,ts,jsx,tsx,mdx,scss}',
			'../../packages/web/src/**/*.{js,ts,jsx,tsx,mdx,scss}'
		]
	}
}

export default config
