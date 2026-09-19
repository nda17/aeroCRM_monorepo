import type { Config } from 'tailwindcss'
import commonConfig from '../../tailwind.config'

const config: Config = {
	presets: [commonConfig],
	content: {
		relative: true,
		files: [
			'./src/**/*.{js,ts,jsx,tsx,mdx,scss}',
			'../../packages/web/src/**/*.{js,ts,jsx,tsx,mdx,scss}'
		]
	}
}

export default config
