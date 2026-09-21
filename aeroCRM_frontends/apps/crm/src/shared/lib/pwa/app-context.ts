'use client'

import { useSyncExternalStore } from 'react'

const APP_CONTEXT_KEY = 'aeroCRM:android-app'
let androidAppContext = false

// A presentation hint for this tab only, never an authorization signal.
export const captureAndroidAppContext = (): boolean => {
	if (typeof window === 'undefined') return false
	if (androidAppContext) return true
	try {
		const referrer = new URL(document.referrer)
		androidAppContext =
			referrer.protocol === 'android-app:' &&
			referrer.hostname === 'space.aerocrm.workspace'
	} catch {
		// An empty referrer is normal after navigation or reload.
	}
	try {
		if (androidAppContext) sessionStorage.setItem(APP_CONTEXT_KEY, 'true')
		else
			androidAppContext =
				sessionStorage.getItem(APP_CONTEXT_KEY) === 'true'
	} catch {
		// Keep the launch hint in memory when storage is unavailable.
	}
	return androidAppContext
}

const subscribe = () => () => {}
const serverSnapshot = () => null

export const useAndroidAppContext = (): boolean | null =>
	useSyncExternalStore(subscribe, captureAndroidAppContext, serverSnapshot)
