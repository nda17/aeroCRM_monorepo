import { cleanup, renderHook } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const APP_CONTEXT_KEY = 'aeroCRM:android-app'

const setReferrer = (value: string) => {
	Object.defineProperty(document, 'referrer', {
		configurable: true,
		value
	})
}

beforeEach(() => {
	vi.resetModules()
	sessionStorage.clear()
	setReferrer('')
})

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('Android app context', () => {
	it('captures only the exact Android package referrer and persists it', async () => {
		const { captureAndroidAppContext } = await import('./app-context')
		setReferrer('android-app://space.aerocrm.workspace/')

		expect(captureAndroidAppContext()).toBe(true)
		expect(sessionStorage.getItem(APP_CONTEXT_KEY)).toBe('true')
	})

	it.each([
		'android-app://space.aerocrm.workspace.evil/',
		'android-app://space.aerocrm.workspace@evil.example/',
		'https://space.aerocrm.workspace/'
	])('rejects a non-exact app referrer: %s', async referrer => {
		const { captureAndroidAppContext } = await import('./app-context')
		setReferrer(referrer)

		expect(captureAndroidAppContext()).toBe(false)
		expect(sessionStorage.getItem(APP_CONTEXT_KEY)).toBeNull()
	})

	it('does not infer app context from standalone display mode', async () => {
		const { captureAndroidAppContext } = await import('./app-context')
		vi.stubGlobal(
			'matchMedia',
			vi.fn(() => ({ matches: true }))
		)

		expect(captureAndroidAppContext()).toBe(false)
	})

	it('restores the captured context from session storage after navigation', async () => {
		let { captureAndroidAppContext } = await import('./app-context')
		setReferrer('android-app://space.aerocrm.workspace')
		expect(captureAndroidAppContext()).toBe(true)

		vi.resetModules()
		setReferrer('')
		;({ captureAndroidAppContext } = await import('./app-context'))
		expect(captureAndroidAppContext()).toBe(true)
	})

	it('keeps the context in module memory when session storage is unavailable', async () => {
		const { captureAndroidAppContext } = await import('./app-context')
		const storage = {
			getItem: vi.fn(() => {
				throw new Error('storage unavailable')
			}),
			setItem: vi.fn(() => {
				throw new Error('storage unavailable')
			})
		}
		vi.stubGlobal('sessionStorage', storage)
		setReferrer('android-app://space.aerocrm.workspace/')
		expect(captureAndroidAppContext()).toBe(true)

		setReferrer('')
		expect(captureAndroidAppContext()).toBe(true)
	})

	it('reports unknown on the server and a captured value in the client hook', async () => {
		const { useAndroidAppContext } = await import('./app-context')
		const Probe = () => <output>{String(useAndroidAppContext())}</output>

		expect(renderToString(<Probe />)).toContain('>null<')

		setReferrer('android-app://space.aerocrm.workspace/')
		const { result } = renderHook(() => useAndroidAppContext())
		expect(result.current).toBe(true)
	})
})
