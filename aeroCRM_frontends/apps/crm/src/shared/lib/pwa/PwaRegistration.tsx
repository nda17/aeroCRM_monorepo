'use client'

import { useEffect } from 'react'

export const PwaRegistration = () => {
	useEffect(() => {
		if (
			process.env.NODE_ENV !== 'production' ||
			!('serviceWorker' in navigator)
		) {
			return
		}

		void navigator.serviceWorker
			.register('/sw.js', { scope: '/', updateViaCache: 'none' })
			.catch(() => {
				// Registration failure must not prevent ordinary online use.
			})
	}, [])

	return null
}
