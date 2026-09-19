'use client'

import {
	clearAuthReturnIntent,
	readAuthReturnIntent,
	saveAuthReturnIntent
} from '@/shared/lib/auth-return-url'
import { useEffect, useState } from 'react'

const useAuthReturnUrl = (initialReturnUrl?: string | null) => {
	const [storedReturnUrl, setStoredReturnUrl] = useState<string | null>(
		() => {
			if (
				initialReturnUrl !== undefined ||
				typeof window === 'undefined'
			) {
				return initialReturnUrl || null
			}

			return readAuthReturnIntent(window.sessionStorage)
		}
	)

	useEffect(() => {
		if (initialReturnUrl === null) {
			clearAuthReturnIntent(window.sessionStorage)
			setStoredReturnUrl(null)
			return
		}

		if (initialReturnUrl) {
			setStoredReturnUrl(
				saveAuthReturnIntent(window.sessionStorage, initialReturnUrl)
			)
			return
		}

		setStoredReturnUrl(readAuthReturnIntent(window.sessionStorage))
	}, [initialReturnUrl])

	return initialReturnUrl || storedReturnUrl
}

export default useAuthReturnUrl
