const path = require('node:path')

module.exports = {
	extends: ['next/core-web-vitals', 'plugin:jsx-a11y/recommended'],
	settings: {
		next: {
			rootDir: ['landing', 'widgets', 'admin-panel'].map(app =>
				path.join(__dirname, 'apps', app)
			)
		}
	}
}
