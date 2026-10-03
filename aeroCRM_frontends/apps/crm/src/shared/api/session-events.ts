/** Bounded signal-only SSE transport. Credentials stay in Authorization headers. */
export function startSessionEvents(options: {
	url: string
	token: () => Promise<string>
	isCurrent: () => boolean
	onRevoked: () => void
	onUnauthorized: () => Promise<void>
}) {
	let stopped = false
	let active: AbortController | undefined
	let retry: ReturnType<typeof setTimeout> | undefined
	let failures = 0
	const available = () =>
		!stopped && options.isCurrent() && navigator.onLine !== false
	const stopConnection = () => {
		if (retry) clearTimeout(retry)
		retry = undefined
		active?.abort()
		active = undefined
	}
	const connect = async () => {
		if (!available() || active) return
		const abort = new AbortController()
		active = abort
		const current = () =>
			available() && active === abort && !abort.signal.aborted
		let watchdog: ReturnType<typeof setTimeout> | undefined
		const touch = () => {
			if (watchdog) clearTimeout(watchdog)
			watchdog = setTimeout(() => abort.abort(), 20000)
		}
		try {
			const token = await options.token()
			if (!current()) return
			touch()
			const response = await fetch(options.url, {
				headers: {
					Accept: 'text/event-stream',
					Authorization: 'Bearer ' + token
				},
				cache: 'no-store',
				credentials: 'include',
				redirect: 'error',
				signal: abort.signal
			})
			if (!current()) {
				await response.body?.cancel()
				return
			}
			if (response.status === 401) {
				await response.body?.cancel()
				await options.onUnauthorized()
				throw new Error('Session reconnect required')
			}
			if (
				!response.ok ||
				!response.body ||
				response.headers.get('content-type')?.split(';')[0] !==
					'text/event-stream'
			) {
				await response.body?.cancel()
				throw new Error('Session stream unavailable')
			}
			const reader = response.body.getReader()
			const decoder = new TextDecoder('utf-8', { fatal: true })
			let buffer = '',
				event = '',
				data = ''
			try {
				for (;;) {
					const chunk = await reader.read()
					if (chunk.done || !current()) break
					touch()
					buffer += decoder.decode(chunk.value, { stream: true })
					if (buffer.length > 16384)
						throw new Error('Invalid session stream')
					let newline: number
					while ((newline = buffer.indexOf('\n')) >= 0) {
						const line = buffer.slice(0, newline).replace(/\r$/, '')
						buffer = buffer.slice(newline + 1)
						if (!line) {
							if (data === '{}' && event === 'revoked' && current()) {
								options.onRevoked()
								return
							}
							if (
								data === '{}' &&
								(event === 'ready' || event === 'heartbeat')
							)
								failures = 0
							event = ''
							data = ''
						} else if (line.startsWith('event:'))
							event = line.slice(6).trim()
						else if (line.startsWith('data:')) {
							data += line.slice(5).trim()
							if (data.length > 1024)
								throw new Error('Invalid session event')
						}
					}
				}
			} finally {
				await reader.cancel().catch(() => undefined)
				reader.releaseLock()
			}
		} catch {
			if (current()) failures = Math.min(failures + 1, 5)
		} finally {
			if (watchdog) clearTimeout(watchdog)
			abort.abort()
			if (active === abort) {
				active = undefined
				if (available())
					retry = setTimeout(
						() => void connect(),
						Math.min(30000, 1000 * 2 ** failures)
					)
			}
		}
	}
	const resume = () => {
		stopConnection()
		if (available()) void connect()
	}
	window.addEventListener('online', resume)
	window.addEventListener('offline', resume)
	window.addEventListener('pageshow', resume)
	window.addEventListener('pagehide', stopConnection)
	void connect()
	return () => {
		stopped = true
		stopConnection()
		window.removeEventListener('online', resume)
		window.removeEventListener('offline', resume)
		window.removeEventListener('pageshow', resume)
		window.removeEventListener('pagehide', stopConnection)
	}
}
