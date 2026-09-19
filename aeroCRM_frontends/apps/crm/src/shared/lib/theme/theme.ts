export const THEME_STORAGE_KEY = 'wincrm.theme'
export const THEME_CHANGE_EVENT = 'wincrm:theme-change'
export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'
export const themePreferences = ['light', 'dark', 'system'] as const
export type ThemePreference = (typeof themePreferences)[number]

export const parseThemePreference = (value: unknown): ThemePreference =>
	value === 'dark' || value === 'system' ? value : 'light'

export const resolveTheme = (
	preference: ThemePreference,
	systemDark: boolean
) =>
	preference === 'system' ? (systemDark ? 'dark' : 'light') : preference

/** Runs before the first paint. No session, network or user data is needed. */
export const themeBootstrapScript = `(()=>{let p='light';try{const v=localStorage.getItem('${THEME_STORAGE_KEY}');if(v==='dark'||v==='system')p=v}catch{}const r=document.documentElement;r.dataset.themePreference=p;r.dataset.theme=p==='system'?(window.matchMedia?.('${DARK_MEDIA_QUERY}').matches?'dark':'light'):p})()`

export const getThemePreference = (): ThemePreference =>
	parseThemePreference(document.documentElement.dataset.themePreference)

export const getServerThemePreference = (): ThemePreference => 'light'

const applyTheme = (preference: ThemePreference) => {
	const root = document.documentElement
	root.dataset.themePreference = preference
	root.dataset.theme = resolveTheme(
		preference,
		window.matchMedia?.(DARK_MEDIA_QUERY).matches ?? false
	)
	window.dispatchEvent(new Event(THEME_CHANGE_EVENT))
}

/** Storage can be blocked; the chosen theme still works for this page. */
export const setThemePreference = (preference: ThemePreference) => {
	let persisted = true
	try {
		window.localStorage.setItem(THEME_STORAGE_KEY, preference)
	} catch {
		persisted = false
	}
	applyTheme(preference)
	return persisted
}

export const subscribeTheme = (notify: () => void) => {
	window.addEventListener(THEME_CHANGE_EVENT, notify)
	return () => window.removeEventListener(THEME_CHANGE_EVENT, notify)
}

export const startThemeSynchronization = () => {
	let preference = getThemePreference()
	try {
		preference = parseThemePreference(
			window.localStorage.getItem(THEME_STORAGE_KEY)
		)
	} catch {
		// Keep a theme already applied before hydration, even with blocked storage.
	}
	applyTheme(preference)
	const media = window.matchMedia?.(DARK_MEDIA_QUERY)
	const onSystemChange = () => {
		if (getThemePreference() === 'system') applyTheme('system')
	}
	const onStorage = (event: StorageEvent) => {
		if (event.key !== null && event.key !== THEME_STORAGE_KEY) return
		try {
			if (event.storageArea && event.storageArea !== window.localStorage)
				return
		} catch {
			return
		}
		applyTheme(parseThemePreference(event.newValue))
	}
	media?.addEventListener('change', onSystemChange)
	window.addEventListener('storage', onStorage)
	return () => {
		media?.removeEventListener('change', onSystemChange)
		window.removeEventListener('storage', onStorage)
	}
}
