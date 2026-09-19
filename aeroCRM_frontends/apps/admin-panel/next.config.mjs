import path from 'node:path'
import { fileURLToPath } from 'node:url'
import commonConfig from '../../next.config.mjs'

const appDirectory = path.dirname(fileURLToPath(import.meta.url))
const assetPrefix = '/_frontends/admin-panel'

/** @type {import('next').NextConfig} */
const nextConfig = {
	...commonConfig,
	output: 'standalone',
	experimental: {
		outputFileTracingRoot: path.resolve(appDirectory, '../..')
	},
	transpilePackages: ['@aerocrm/web'],
	assetPrefix,
	env: { NEXT_PUBLIC_FRONTEND_APP: 'admin-panel' },
	headers: () => [],
	images: {
		...commonConfig.images,
		path: `${assetPrefix}/_next/image`
	},
	async rewrites() {
		return {
			beforeFiles: [
				{
					source: `${assetPrefix}/_next/:path+`,
					destination: '/_next/:path+'
				}
			],
			afterFiles: [],
			fallback: []
		}
	}
}

export default nextConfig
