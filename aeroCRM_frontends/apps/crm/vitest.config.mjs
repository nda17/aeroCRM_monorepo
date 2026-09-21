import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	resolve: {
		alias: [
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
				find: '@',
				replacement: fileURLToPath(new URL('./src', import.meta.url))
			}
		]
	},
	test: {
		environment: 'jsdom',
		environmentOptions: {
			jsdom: {
				url: 'http://localhost:3001/inbox'
			}
		},
		clearMocks: true,
		restoreMocks: true
	}
})
