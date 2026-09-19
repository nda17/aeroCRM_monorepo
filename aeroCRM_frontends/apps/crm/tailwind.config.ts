import type { Config } from 'tailwindcss'

const config: Config = {
	content: ['./src/**/*.{js,ts,jsx,tsx,mdx,scss}'],
	theme: {
		extend: {
			colors: {
				primary: 'rgb(var(--crm-primary) / <alpha-value>)',
				'crm-brand': '#7b3fa0',
				'crm-action': '#7b3fa0',
				'crm-action-danger': '#c0392b',
				accent: '#ff9902',
				secondary: '#161d25',
				'crm-bg': 'rgb(var(--crm-bg) / <alpha-value>)',
				'crm-surface': 'rgb(var(--crm-surface) / <alpha-value>)',
				'crm-surface-muted':
					'rgb(var(--crm-surface-muted) / <alpha-value>)',
				'crm-border': 'rgb(var(--crm-border) / <alpha-value>)',
				'crm-border-strong':
					'rgb(var(--crm-border-strong) / <alpha-value>)',
				'crm-text': 'rgb(var(--crm-text) / <alpha-value>)',
				'crm-muted': 'rgb(var(--crm-muted) / <alpha-value>)',
				'crm-success': 'rgb(var(--crm-success) / <alpha-value>)',
				'crm-warning': 'rgb(var(--crm-warning) / <alpha-value>)',
				'crm-danger': 'rgb(var(--crm-danger) / <alpha-value>)',
				'crm-info': 'rgb(var(--crm-info) / <alpha-value>)'
			},
			fontFamily: {
				sans: [
					'system-ui',
					'-apple-system',
					'BlinkMacSystemFont',
					'Segoe UI',
					'sans-serif'
				],
				display: [
					'system-ui',
					'-apple-system',
					'BlinkMacSystemFont',
					'Segoe UI',
					'sans-serif'
				]
			},
			backgroundImage: {
				'brand-gradient':
					'linear-gradient(120deg, #470b58 0%, #c21b84 42%, #fa595e 72%, #f8bd31 100%)'
			},
			boxShadow: {
				panel: '0 18px 52px rgba(71, 11, 88, 0.08)',
				floating: '0 24px 70px rgba(31, 18, 42, 0.2)'
			},
			borderRadius: {
				panel: '1.25rem'
			}
		}
	},
	plugins: []
}

export default config
