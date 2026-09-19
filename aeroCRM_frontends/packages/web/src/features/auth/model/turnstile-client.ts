export class TurnstileUnavailableError extends Error {
	constructor() {
		super('Сервис проверки CAPTCHA временно недоступен')
		this.name = 'TurnstileUnavailableError'
	}
}

type TurnstileWidget = {
	render: (container: HTMLElement, options: {
		sitekey: string
		action: string
		execution: 'execute'
		appearance: 'interaction-only'
		callback: (token: string) => void
		'error-callback': () => void
		'expired-callback': () => void
	}) => string
	execute: (widgetId: string) => void
	remove: (widgetId: string) => void
}

declare global {
	interface Window {
		turnstile?: TurnstileWidget
	}
}

let scriptPromise: Promise<void> | null = null

export const loadTurnstileScript = (_siteKey: string) => {
	if (typeof window === 'undefined' || window.turnstile) return Promise.resolve()
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
		script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
		script.async = true
		script.addEventListener('load', () => finish(true), { once: true })
		script.addEventListener('error', () => finish(false), { once: true })
		document.head.appendChild(script)
	})
	scriptPromise = pending
	void pending.catch(() => { if (scriptPromise === pending) scriptPromise = null })
	return pending
}

export const waitForTurnstileReady = async () => {
	if (!window.turnstile) throw new TurnstileUnavailableError()
}

export const executeTurnstileToken = async (siteKey: string, action: string) => {
	const turnstile = window.turnstile
	if (!turnstile) throw new TurnstileUnavailableError()
	const container = document.createElement('div')
	container.setAttribute('aria-hidden', 'true')
	document.body.appendChild(container)
	let widgetId: string | undefined
	let timeout: number | undefined
	try {
		return await new Promise<string>((resolve, reject) => {
			const fail = () => reject(new TurnstileUnavailableError())
			timeout = window.setTimeout(fail, 15000)
			widgetId = turnstile.render(container, {
				sitekey: siteKey,
				action,
				execution: 'execute',
				appearance: 'interaction-only',
				callback: token => token ? resolve(token) : fail(),
				'error-callback': fail,
				'expired-callback': fail
			})
			turnstile.execute(widgetId)
		})
	} finally {
		if (timeout) window.clearTimeout(timeout)
		if (widgetId) turnstile.remove(widgetId)
		container.remove()
	}
}
