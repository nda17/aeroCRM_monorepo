import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { readLiveStream, startLiveUpdates } from './live-updates'
import { resolveSessionTransport } from './session-transport'
import { liveInvalidator } from '@/features/live-updates/LiveUpdates'

vi.mock('./session-transport', () => ({
	resolveSessionTransport: vi.fn()
}))
vi.mock('@/shared/config/runtime', () => ({
	getRuntimeConfig: () => ({
		apiBaseUrl: 'https://api.example.test/api/v1'
	})
}))
afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})
const stream = (...chunks: string[]) =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			chunks.forEach(chunk =>
				controller.enqueue(new TextEncoder().encode(chunk))
			)
			controller.close()
		}
	})
describe('live updates', () => {
	it.each([
		[
			'mail',
			[
				'crm-mail-notifications',
				'mail-workspace-messages',
				'mail-mailboxes'
			]
		],
		[
			'collaboration',
			[
				'workspace-directory',
				'workspace-chat-messages',
				'crm-chat-notifications'
			]
		]
	] as const)(
		'invalidates active %s data roots on a committed invalidate event',
		async (owner, expectedRoots) => {
			vi.useFakeTimers()
			const invalidateQueries = vi.fn().mockResolvedValue(undefined)
			const client = { invalidateQueries } as unknown as QueryClient
			const invalidator = liveInvalidator(client, owner, () => true)
			invalidator.event('invalidate')
			await vi.advanceTimersByTimeAsync(300)
			const filters = invalidateQueries.mock.calls[0]?.[0]
			expect(filters?.refetchType).toBe('active')
			const accepts = (key: string) =>
				filters?.predicate?.({
					isActive: () => true,
					queryKey: [key]
				} as never)
			for (const root of expectedRoots) expect(accepts(root)).toBe(true)
			expect(accepts('unrelated-query-root')).toBe(false)
			invalidator.stop()
			vi.useRealTimers()
		}
	)

	it('parses fragmented frames, ignores heartbeats and rejects business payloads', async () => {
		const event = vi.fn()
		await readLiveStream(
			stream(
				'event: inva',
				'lidate\r\ndata: {}\r\n\r\nevent: heartbeat\ndata: {}\n\n',
				'event: clock\ndata: {}\n\nevent: access\ndata: {"title":"private"}\n\n'
			),
			event
		)
		expect(event.mock.calls).toEqual([['invalidate'], ['clock']])
	})
	it('bounds malformed streams', async () => {
		await expect(
			readLiveStream(stream('x'.repeat(16385)), vi.fn())
		).rejects.toThrow('Invalid live stream')
	})
	it('uses the refreshed lease, never sends credentials in the URL and releases the request on unmount', async () => {
		const refresh = vi
			.fn()
			.mockResolvedValue({ accessToken: 'fresh', isCurrent: () => true })
		vi.mocked(resolveSessionTransport).mockResolvedValue({
			accessToken: 'expired',
			isCurrent: () => true,
			refresh
		})
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(new Response(null, { status: 401 }))
			.mockResolvedValueOnce(
				new Response(stream('event: invalidate\ndata: {}\n\n'), {
					headers: { 'Content-Type': 'text/event-stream' }
				})
			)
		vi.stubGlobal('fetch', fetcher)
		const event = vi.fn()
		const stop = startLiveUpdates({
			accessToken: 'anchor',
			path: '/support/events',
			isCurrent: () => true,
			onEvent: event,
			onUnavailable: vi.fn()
		})
		try {
			await vi.waitFor(() =>
				expect(event).toHaveBeenCalledWith('invalidate')
			)
			expect(fetcher.mock.calls[1][0]).toBe(
				'https://api.example.test/api/v1/support/events'
			)
			expect(fetcher.mock.calls[1][1].headers.Authorization).toBe(
				'Bearer fresh'
			)
			expect(refresh).toHaveBeenCalledTimes(1)
		} finally {
			stop()
		}
		expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true)
	})
	it('ignores frames after the session binding changes', async () => {
		let current = true
		let controller!: ReadableStreamDefaultController<Uint8Array>
		vi.mocked(resolveSessionTransport).mockResolvedValue({
			accessToken: 'fresh',
			isCurrent: () => true
		})
		const fetcher = vi.fn().mockResolvedValue(
			new Response(
				new ReadableStream({
					start(value) {
						controller = value
					}
				}),
				{ headers: { 'Content-Type': 'text/event-stream' } }
			)
		)
		vi.stubGlobal('fetch', fetcher)
		const event = vi.fn()
		const stop = startLiveUpdates({
			accessToken: 'anchor',
			path: '/support/events',
			isCurrent: () => current,
			onEvent: event,
			onUnavailable: vi.fn()
		})
		try {
			await vi.waitFor(() => expect(fetcher).toHaveBeenCalled())
			current = false
			controller.enqueue(
				new TextEncoder().encode('event: invalidate\ndata: {}\n\n')
			)
			controller.close()
			await new Promise(resolve => setTimeout(resolve, 10))
			expect(event).not.toHaveBeenCalled()
		} finally {
			stop()
		}
	})
})
