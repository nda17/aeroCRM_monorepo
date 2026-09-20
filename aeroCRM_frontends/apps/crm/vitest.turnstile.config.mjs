import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

const crmSrc = fileURLToPath(new URL('./src', import.meta.url))
const webSrc = fileURLToPath(
	new URL('../../packages/web/src', import.meta.url)
)
const frontendRoot = fileURLToPath(new URL('../../', import.meta.url))
const react = fileURLToPath(
	new URL('./node_modules/react', import.meta.url)
)
const reactDom = fileURLToPath(
	new URL('./node_modules/react-dom', import.meta.url)
)
const testingLibraryReact = fileURLToPath(
	new URL('./node_modules/@testing-library/react', import.meta.url)
)
const tanstackReactQuery = fileURLToPath(
	new URL('./node_modules/@tanstack/react-query', import.meta.url)
)

export default defineConfig({
	resolve: {
		dedupe: ['react', 'react-dom'],
		alias: [
			{ find: /^react$/, replacement: react },
			{ find: /^react-dom$/, replacement: reactDom },
			{
				find: '@testing-library/react',
				replacement: testingLibraryReact
			},
			{
				find: '@tanstack/react-query',
				replacement: tanstackReactQuery
			},
			{
				find: /^@\/features\/auth\/(.*)$/,
				replacement: `${webSrc}/features/auth/$1`
			},
			{
				find: /^@\/features\/workspace-auth\/(.*)$/,
				replacement: `${crmSrc}/features/workspace-auth/$1`
			},
			{ find: '@', replacement: crmSrc }
		]
	},
	test: {
		root: frontendRoot,
		include: ['test/turnstile-hook-regression.test.tsx'],
		environment: 'jsdom',
		clearMocks: true,
		restoreMocks: true
	}
})
