import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	oxc: { jsx: { runtime: 'automatic' } },
	resolve: {
		alias: [
			{
				find: /^@\/entities\/user$/,
				replacement: fileURLToPath(
					new URL(
						'../../packages/web/src/entities/user/index.ts',
						import.meta.url
					)
				)
			},
			{
				find: /^@\/features\/campaigns$/,
				replacement: fileURLToPath(
					new URL(
						'../../packages/web/src/features/campaigns/index.ts',
						import.meta.url
					)
				)
			},
			{
				find: /^@\/entities\/user\/model\/auth-store$/,
				replacement: fileURLToPath(
					new URL(
						'../../packages/web/src/entities/user/model/auth-store.ts',
						import.meta.url
					)
				)
			},
			{
				find: /^@\/shared\/api$/,
				replacement: fileURLToPath(
					new URL(
						'../../packages/web/src/shared/api/index.ts',
						import.meta.url
					)
				)
			},
			{
				find: '@/shared',
				replacement: fileURLToPath(
					new URL('../../packages/web/src/shared', import.meta.url)
				)
			},
			{
				find: '@',
				replacement: fileURLToPath(new URL('./src', import.meta.url))
			}
		]
	},
	test: {
		environment: 'jsdom',
		environmentOptions: {
			jsdom: { url: 'http://localhost:3003/admin/users' }
		},
		clearMocks: true,
		restoreMocks: true
	}
})
