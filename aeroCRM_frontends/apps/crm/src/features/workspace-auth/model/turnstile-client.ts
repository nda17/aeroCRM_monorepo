export class TurnstileUnavailableError extends Error {
	constructor() {
		super('Сервис проверки CAPTCHA временно недоступен')
		this.name = 'TurnstileUnavailableError'
	}
}

export type TurnstileWidget = {
	render: (
		container: HTMLElement,
		options: {
			sitekey: string
			action: string
			execution: 'render'
			appearance: 'always'
			theme: 'light'
			size: 'flexible' | 'compact'
			callback: (token: string) => void
			'error-callback': () => void
			'expired-callback': () => void
		}
	) => string
	reset: (widgetId: string) => void
	remove: (widgetId: string) => void
}

declare global {
	interface Window {
		turnstile?: TurnstileWidget
	}
}

let scriptPromise: Promise<void> | null = null

export const loadTurnstileScript = () => {
	if (typeof window === 'undefined' || window.turnstile)
		return Promise.resolve()
	if (scriptPromise) return scriptPromise
	const pending = new Promise<void>((resolve, reject) => {
		const script = document.createElement('script')
		const timeout = window.setTimeout(() => finish(false), 8000)
		const finish = (ok: boolean) => {
			window.clearTimeout(timeout)
			if (ok && window.turnstile) resolve()
			else {
				script.remove()
				reject(new TurnstileUnavailableError())
			}
		}
		script.src =
			'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
		script.async = true
		script.addEventListener('load', () => finish(true), { once: true })
		script.addEventListener('error', () => finish(false), { once: true })
		document.head.appendChild(script)
	})
	scriptPromise = pending
	void pending.catch(() => {
		if (scriptPromise === pending) scriptPromise = null
	})
	return pending
}
