import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	DARK_MEDIA_QUERY,
	getThemePreference,
	parseThemePreference,
	resolveTheme,
	setThemePreference,
	startThemeSynchronization,
	subscribeTheme,
	themeBootstrapScript,
	THEME_STORAGE_KEY
} from './theme'

let systemDark = false
let stop: (() => void) | undefined
let media: MediaQueryList

beforeEach(() => {
	localStorage.clear()
	document.documentElement.dataset.theme = 'light'
	document.documentElement.dataset.themePreference = 'light'
	systemDark = false
	const target = new EventTarget()
	media = Object.assign(target, {
		get matches() {
			return systemDark
		},
		media: DARK_MEDIA_QUERY
	}) as MediaQueryList
	// Object.assign reads getters; define the live match explicitly.
	Object.defineProperty(media, 'matches', { get: () => systemDark })
	vi.stubGlobal(
		'matchMedia',
		vi.fn(() => media)
	)
})
afterEach(() => {
	stop?.()
	stop = undefined
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
	localStorage.clear()
	delete document.documentElement.dataset.theme
	delete document.documentElement.dataset.themePreference
})

describe('CRM theme preferences', () => {
	it.each([null, undefined, '', 'other', '<script>', {}, 'LIGHT'])(
		'keeps unknown preference %s on the existing light theme',
		value => {
			expect(parseThemePreference(value)).toBe('light')
		}
	)
	it('only follows the device for explicit system preference', () => {
		expect(resolveTheme('light', true)).toBe('light')
		expect(resolveTheme('dark', false)).toBe('dark')
		expect(resolveTheme('system', true)).toBe('dark')
		expect(resolveTheme('system', false)).toBe('light')
	})
	it.each(['light', 'dark', 'system'] as const)(
		'bootstrap and mounted runtime agree for %s without network or auth',
		value => {
			localStorage.setItem(THEME_STORAGE_KEY, value)
			systemDark = true
			// Exercise our constant script exactly as emitted by RootLayout.
			new Function(themeBootstrapScript)()
			expect(getThemePreference()).toBe(value)
			expect(document.documentElement.dataset.theme).toBe(
				resolveTheme(value, true)
			)
			stop = startThemeSynchronization()
			expect(document.documentElement.dataset.theme).toBe(
				resolveTheme(value, true)
			)
		}
	)
	it('persists changes, notifies subscribers and releases listeners', () => {
		stop = startThemeSynchronization()
		const notify = vi.fn()
		const unsubscribe = subscribeTheme(notify)
		expect(setThemePreference('dark')).toBe(true)
		expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
		expect(notify).toHaveBeenCalledOnce()
		expect(document.documentElement.dataset.theme).toBe('dark')
		unsubscribe()
		setThemePreference('light')
		expect(notify).toHaveBeenCalledOnce()
	})
	it('updates on system change only in system mode and stops after unmount', () => {
		stop = startThemeSynchronization()
		setThemePreference('system')
		systemDark = true
		media.dispatchEvent(new Event('change'))
		expect(document.documentElement.dataset.theme).toBe('dark')
		setThemePreference('light')
		media.dispatchEvent(new Event('change'))
		expect(document.documentElement.dataset.theme).toBe('light')
		setThemePreference('system')
		stop()
		systemDark = false
		media.dispatchEvent(new Event('change'))
		expect(document.documentElement.dataset.theme).toBe('dark')
	})
	it('synchronizes other tabs, handles removal and ignores unrelated storage', () => {
		stop = startThemeSynchronization()
		window.dispatchEvent(
			new StorageEvent('storage', {
				key: THEME_STORAGE_KEY,
				newValue: 'dark',
				storageArea: localStorage
			})
		)
		expect(getThemePreference()).toBe('dark')
		window.dispatchEvent(
			new StorageEvent('storage', { key: 'other', newValue: 'light' })
		)
		window.dispatchEvent(
			new StorageEvent('storage', {
				key: THEME_STORAGE_KEY,
				newValue: 'light',
				storageArea: sessionStorage
			})
		)
		expect(getThemePreference()).toBe('dark')
		window.dispatchEvent(
			new StorageEvent('storage', {
				key: THEME_STORAGE_KEY,
				newValue: null
			})
		)
		expect(getThemePreference()).toBe('light')
		setThemePreference('dark')
		window.dispatchEvent(new StorageEvent('storage', { key: null }))
		expect(getThemePreference()).toBe('light')
	})
	it('continues when browser storage is blocked', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked')
		})
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('blocked')
		})
		expect(() => new Function(themeBootstrapScript)()).not.toThrow()
		stop = startThemeSynchronization()
		expect(setThemePreference('dark')).toBe(false)
		expect(document.documentElement.dataset.theme).toBe('dark')
	})
	it('works without matchMedia', () => {
		vi.stubGlobal('matchMedia', undefined)
		localStorage.setItem(THEME_STORAGE_KEY, 'system')
		expect(() => new Function(themeBootstrapScript)()).not.toThrow()
		stop = startThemeSynchronization()
		expect(document.documentElement.dataset.theme).toBe('light')
	})
})
