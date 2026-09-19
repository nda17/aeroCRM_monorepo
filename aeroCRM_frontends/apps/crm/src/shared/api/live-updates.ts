import { resolveSessionTransport } from './session-transport'
import { getRuntimeConfig } from '@/shared/config/runtime'

export type LiveEvent = 'invalidate' | 'clock' | 'access'
const EVENTS = new Set(['invalidate', 'clock', 'access', 'heartbeat'])

/** Bounded SSE parser: records carry signals only, never business data. */
export async function readLiveStream(
	body: ReadableStream<Uint8Array>,
	onEvent: (event: LiveEvent) => void
) {
	const reader = body.getReader()
	const decoder = new TextDecoder('utf-8', { fatal: true })
	let buffer = ''
	let event = ''
	let data = ''
	try {
		for (;;) {
			const chunk = await reader.read()
			if (chunk.done) break
			buffer += decoder.decode(chunk.value, { stream: true })
			if (buffer.length > 16384) throw new Error('Invalid live stream')
			let newline: number
			while ((newline = buffer.indexOf('\n')) >= 0) {
				const line = buffer.slice(0, newline).replace(/\r$/, '')
				buffer = buffer.slice(newline + 1)
				if (!line) {
					if (EVENTS.has(event) && data === '{}' && event !== 'heartbeat')
						onEvent(event as LiveEvent)
					event = ''
					data = ''
				} else if (line.startsWith('event:')) event = line.slice(6).trim()
				else if (line.startsWith('data:')) {
					data += line.slice(5).trim()
					if (data.length > 1024) throw new Error('Invalid live event')
				}
			}
		}
	} finally {
		await reader.cancel().catch(() => undefined)
		reader.releaseLock()
	}
}

/** One connection per owner. The session lease supplies refreshed bearer tokens;
 * no credentials are put in URLs, cache keys or browser storage.
 */
export function startLiveUpdates(options: {
	accessToken: string
	path: string
	isCurrent: () => boolean
	onEvent: (event: LiveEvent) => void
	onUnavailable: () => void
}) {
	let stopped = false
	let active: AbortController | undefined
	let retry: ReturnType<typeof setTimeout> | undefined
	let failures = 0
	const available = () =>
		!stopped &&
		options.isCurrent() &&
		document.visibilityState !== 'hidden' &&
		navigator.onLine !== false
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
		let watchdog: ReturnType<typeof setTimeout> | undefined
		const touch = () => {
			if (watchdog) clearTimeout(watchdog)
			watchdog = setTimeout(() => abort.abort(), 25000)
		}
		try {
			let lease = await resolveSessionTransport(options.accessToken)
			const current = () =>
				available() &&
				active === abort &&
				!abort.signal.aborted &&
				lease.isCurrent()
			const send = () => {
				if (!current()) throw new Error('Session changed')
				touch()
				return fetch(getRuntimeConfig().apiBaseUrl + options.path, {
					headers: {
						Accept: 'text/event-stream',
						Authorization: 'Bearer ' + lease.accessToken
					},
					credentials: 'include',
					cache: 'no-store',
					redirect: 'error',
					signal: abort.signal
				})
			}
			let response = await send()
			if (response.status === 401 && lease.refresh && current()) {
				await response.body?.cancel()
				lease = await lease.refresh()
				response = await send()
			}
			if (!current()) {
				await response.body?.cancel()
				return
			}
			if (response.status === 401 || response.status === 403) {
				options.onEvent('access')
				throw new Error('Live access unavailable')
			}
			if (
				!response.ok ||
				!response.body ||
				response.headers.get('content-type')?.split(';')[0] !==
					'text/event-stream'
			) {
				await response.body?.cancel()
				throw new Error('Live updates unavailable')
			}
			failures = 0
			const monitored = response.body.pipeThrough(
				new TransformStream<Uint8Array, Uint8Array>({
					transform(chunk, controller) {
						touch()
						controller.enqueue(chunk)
					}
				})
			)
			await readLiveStream(monitored, event => {
				if (current()) options.onEvent(event)
			})
		} catch {
			if (available() && active === abort) {
				failures = Math.min(failures + 1, 5)
				options.onUnavailable()
			}
		} finally {
			if (watchdog) clearTimeout(watchdog)
			abort.abort()
			if (active === abort) {
				active = undefined
				if (available())
					retry = setTimeout(
						() => void connect(),
						failures
							? Math.min(30000, 1000 * 2 ** failures) +
									Math.random() * 1000
							: 1000
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
	document.addEventListener('visibilitychange', resume)
	void connect()
	return () => {
		stopped = true
		stopConnection()
		window.removeEventListener('online', resume)
		window.removeEventListener('offline', resume)
		window.removeEventListener('pageshow', resume)
		window.removeEventListener('pagehide', stopConnection)
		document.removeEventListener('visibilitychange', resume)
	}
}
