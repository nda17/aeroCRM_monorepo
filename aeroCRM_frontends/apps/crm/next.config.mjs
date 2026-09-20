import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(
	readFileSync(new URL('./package.json', import.meta.url), 'utf8')
)

/** @type {import('next').NextConfig} */
const nextConfig = {
	env: { NEXT_PUBLIC_CRM_APP_VERSION: version },
	agentRules: false,
	output: 'standalone',
	outputFileTracingRoot: path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		'../..'
	),
	poweredByHeader: false,
	async redirects() {
		return [
			{
				source: '/my-day',
				destination: '/planner',
				permanent: true
			},
			{
				source: '/favicon.ico',
				destination: '/icon',
				permanent: true
			}
		]
	},
	async headers() {
		return [
			{
				source: '/sw.js',
				headers: [
					{
						key: 'Content-Type',
						value: 'application/javascript; charset=utf-8'
					},
					{ key: 'Cache-Control', value: 'no-store, max-age=0' },
					{ key: 'Service-Worker-Allowed', value: '/' }
				]
			},
			{
				source: '/offline.html',
				headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }]
			},
			{
				source: '/manifest.webmanifest',
				headers: [
					{
						key: 'Cache-Control',
						value: 'public, max-age=0, must-revalidate'
					}
				]
			},
			{
				source: '/:path*',
				headers: [
					{
						key: 'Content-Security-Policy',
						value: "frame-ancestors 'none'"
					},
					{
						key: 'Referrer-Policy',
						value: 'strict-origin-when-cross-origin'
					},
					{
						key: 'X-Content-Type-Options',
						value: 'nosniff'
					},
					{
						key: 'X-Frame-Options',
						value: 'DENY'
					},
					{
						key: 'X-Robots-Tag',
						value: 'noindex, nofollow, noarchive'
					}
				]
			}
		]
	}
}

export default nextConfig
