import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startSessionEvents } from './session-events'

const headers = { 'content-type': 'text/event-stream; charset=utf-8' }
const encoder = new TextEncoder()
const stream = () => {
	let controller!: ReadableStreamDefaultController<Uint8Array>
	const body = new ReadableStream<Uint8Array>({
		start(value) {
			controller = value
		}
	})
	return {
		body,
		send: (value: string) => controller.enqueue(encoder.encode(value))
	}
}
const response = (body: ReadableStream<Uint8Array>, status = 200) =>
	new Response(body, { status, headers })
const turn = async () => {
	for (let index = 0; index < 5; index++) await Promise.resolve()
}

describe('session event transport', () => {
	let fetchMock: ReturnType<typeof vi.fn>
	let controllers: AbortSignal[]
	let stops: Array<() => void>
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-10-04T12:00:00.000Z'))
		controllers = []
		stops = []
		fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
			controllers.push(init.signal!)
			return response(stream().body)
		})
		vi.stubGlobal('fetch', fetchMock)
		Object.defineProperty(navigator, 'onLine', {
			configurable: true,
			value: true
		})
	})
	afterEach(() => {
		for (const stop of stops) stop()
		vi.unstubAllGlobals()
		vi.useRealTimers()
	})

	it('sends credentials only in the Authorization header and stops on cleanup', async () => {
		const current = vi.fn(() => true)
		const stop = startSessionEvents({
			url: '/auth/session/events',
			token: async () => 'fresh-bearer',
			isCurrent: current,
			onRevoked: vi.fn(),
			onUnauthorized: vi.fn().mockResolvedValue(undefined)
		})
		stops.push(stop)
		await turn()
		expect(fetchMock).toHaveBeenCalledOnce()
		const [url, init] = fetchMock.mock.calls[0]
		expect(url).toBe('/auth/session/events')
		expect(init).toMatchObject({
			headers: {
				Accept: 'text/event-stream',
				Authorization: 'Bearer fresh-bearer'
			},
			cache: 'no-store',
			credentials: 'include',
			redirect: 'error'
		})
		expect(url).not.toContain('fresh-bearer')
		stop()
		expect(controllers[0].aborted).toBe(true)
	})

	it('handles only the exact revoked event while the original session is current', async () => {
		const incoming = stream()
		fetchMock.mockResolvedValue(response(incoming.body))
		const onRevoked = vi.fn()
		const stop = startSessionEvents({
			url: '/auth/session/events',
			token: async () => 'bearer',
			isCurrent: () => true,
			onRevoked,
			onUnauthorized: vi.fn().mockResolvedValue(undefined)
		})
		stops.push(stop)
		await turn()
		incoming.send('event: ready\ndata: {}\n\n')
		await turn()
		expect(onRevoked).not.toHaveBeenCalled()
		incoming.send('event: revoked\ndata: {"session":"other"}\n\n')
		await turn()
		expect(onRevoked).not.toHaveBeenCalled()
		incoming.send('event: revoked\ndata: {}\n\n')
		await turn()
		expect(onRevoked).toHaveBeenCalledOnce()
	})

	it('ignores a revoke arriving after its bound session is no longer current', async () => {
		const incoming = stream()
		fetchMock.mockResolvedValue(response(incoming.body))
		let current = true
		const onRevoked = vi.fn()
		const stop = startSessionEvents({
			url: '/auth/session/events',
			token: async () => 'old-bearer',
			isCurrent: () => current,
			onRevoked,
			onUnauthorized: vi.fn().mockResolvedValue(undefined)
		})
		stops.push(stop)
		await turn()
		current = false
		incoming.send('event: revoked\ndata: {}\n\n')
		await turn()
		expect(onRevoked).not.toHaveBeenCalled()
	})

	it('delegates 401 recovery and reconnects with a fresh bearer', async () => {
		fetchMock
			.mockResolvedValueOnce(new Response(null, { status: 401 }))
			.mockImplementationOnce(async (_url: string, init: RequestInit) => {
				controllers.push(init.signal!)
				return response(stream().body)
			})
		let tokenNumber = 0
		const onUnauthorized = vi.fn().mockResolvedValue(undefined)
		const stop = startSessionEvents({
			url: '/auth/session/events',
			token: async () => `bearer-${++tokenNumber}`,
			isCurrent: () => true,
			onRevoked: vi.fn(),
			onUnauthorized
		})
		stops.push(stop)
		await turn()
		expect(onUnauthorized).toHaveBeenCalledOnce()
		await vi.advanceTimersByTimeAsync(2000)
		await turn()
		expect(fetchMock).toHaveBeenCalledTimes(2)
		expect(fetchMock.mock.calls[1][1]).toMatchObject({
			headers: expect.objectContaining({
				Authorization: 'Bearer bearer-2'
			})
		})
	})

	it('aborts on offline and resumes with a fresh connection when online', async () => {
		const stop = startSessionEvents({
			url: '/auth/session/events',
			token: async () => 'bearer',
			isCurrent: () => true,
			onRevoked: vi.fn(),
			onUnauthorized: vi.fn().mockResolvedValue(undefined)
		})
		stops.push(stop)
		await turn()
		window.dispatchEvent(new Event('offline'))
		expect(controllers[0].aborted).toBe(true)
		Object.defineProperty(navigator, 'onLine', {
			configurable: true,
			value: true
		})
		window.dispatchEvent(new Event('online'))
		await turn()
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})
})
