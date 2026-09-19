import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	authenticatedDownload,
	type DownloadRequest
} from './authenticated-download'
import {
	registerSessionTransport,
	type SessionTransportLease
} from './session-transport'

vi.mock('@/shared/config/runtime', () => ({
	getRuntimeConfig: () => ({ apiBaseUrl: 'http://localhost:4100/api/v1' })
}))
const request = (): DownloadRequest => ({
	accessToken: 'memory-token',
	path: '/example/export',
	params: { workspaceId: 'scope' },
	signal: new AbortController().signal,
	maxBytes: 16,
	inspectHeaders: () => 3
})
const response = (
	chunks: number[][],
	headers: Record<string, string> = {}
) =>
	new Response(
		new ReadableStream({
			start(controller) {
				chunks.forEach(value => controller.enqueue(new Uint8Array(value)))
				controller.close()
			}
		}),
		{ status: 200, headers }
	)
let releaseTransport: (() => void) | undefined
beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => {
	releaseTransport?.()
	releaseTransport = undefined
	vi.unstubAllGlobals()
})
describe('Bounded authenticated download', () => {
	it('uses only configured API origin, memory bearer and a bounded decoded stream', async () => {
		vi.mocked(fetch).mockResolvedValue(response([[1], [2, 3]]))
		expect(await authenticatedDownload(request())).toEqual(
			new Uint8Array([1, 2, 3])
		)
		const [url, init] = vi.mocked(fetch).mock.calls[0]
		expect(String(url)).toBe(
			'http://localhost:4100/api/v1/example/export?workspaceId=scope'
		)
		expect(init).toMatchObject({
			method: 'GET',
			cache: 'no-store',
			credentials: 'include',
			redirect: 'error',
			referrerPolicy: 'no-referrer',
			headers: { Authorization: 'Bearer memory-token' }
		})
		expect(String(url)).not.toContain('memory-token')
	})
	it.each([undefined, '1', '99999'])(
		'does not equate optional wire Content-Length=%s with decoded length',
		async length => {
			vi.mocked(fetch).mockResolvedValue(
				response([[1, 2, 3]], length ? { 'Content-Length': length } : {})
			)
			expect((await authenticatedDownload(request())).byteLength).toBe(3)
		}
	)
	it.each([{ bytes: [1, 2] }, { bytes: [1, 2, 3, 4] }])(
		'rejects incomplete or excess decoded bytes without a file',
		async ({ bytes }) => {
			vi.mocked(fetch).mockResolvedValue(response([bytes]))
			await expect(authenticatedDownload(request())).rejects.toMatchObject(
				{ kind: 'temporary' }
			)
		}
	)
	it('bounds a hung network request with a timeout and a safe error', async () => {
		vi.useFakeTimers()
		vi.mocked(fetch).mockImplementation(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					init!.signal!.addEventListener(
						'abort',
						() => reject(new Error('network details')),
						{ once: true }
					)
				})
		)
		const pending = authenticatedDownload(request())
		const assertion = expect(pending).rejects.toMatchObject({
			kind: 'temporary'
		})
		await vi.advanceTimersByTimeAsync(15000)
		await assertion
		vi.useRealTimers()
	})
	it('rejects invalid metadata before reading any body bytes', async () => {
		const getReader = vi.fn()
		vi.mocked(fetch).mockResolvedValue({
			status: 200,
			body: { getReader },
			headers: new Headers(),
			redirected: false
		} as unknown as Response)
		await expect(
			authenticatedDownload({ ...request(), inspectHeaders: () => 17 })
		).rejects.toThrow()
		expect(getReader).not.toHaveBeenCalled()
	})
	it.each([206, 302, 400, 401, 403, 413, 503])(
		'does not read status %d error/partial bodies',
		async status => {
			const getReader = vi.fn()
			vi.mocked(fetch).mockResolvedValue({
				status,
				body: { getReader }
			} as unknown as Response)
			await expect(authenticatedDownload(request())).rejects.toThrow()
			expect(getReader).not.toHaveBeenCalled()
		}
	)
	it('aborts a pending fetch without continuing to a redirected origin', async () => {
		const controller = new AbortController()
		vi.mocked(fetch).mockImplementation(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					init!.signal!.addEventListener(
						'abort',
						() => reject(new Error('private transport detail')),
						{ once: true }
					)
				})
		)
		const pending = authenticatedDownload({
			...request(),
			signal: controller.signal
		})
		controller.abort()
		await expect(pending).rejects.toMatchObject({
			message: 'Не удалось получить полную выгрузку. Повторите попытку.'
		})
	})
	it('refuses unsafe paths and pre-aborted requests before fetch', async () => {
		await expect(
			authenticatedDownload({ ...request(), path: '//other.test/export' })
		).rejects.toThrow()
		const controller = new AbortController()
		controller.abort()
		await expect(
			authenticatedDownload({ ...request(), signal: controller.signal })
		).rejects.toThrow()
		expect(fetch).not.toHaveBeenCalled()
	})
	it('uses the current session bearer and retries an unauthorized GET only once', async () => {
		const refresh = vi.fn(async () => ({
			accessToken: 'renewed-bearer',
			isCurrent: () => true
		}))
		releaseTransport = registerSessionTransport(async () => ({
			accessToken: 'current-bearer',
			isCurrent: () => true,
			refresh
		}))
		vi.mocked(fetch)
			.mockResolvedValueOnce(new Response(null, { status: 401 }))
			.mockResolvedValueOnce(response([[1, 2, 3]]))
		await expect(authenticatedDownload(request())).resolves.toEqual(
			new Uint8Array([1, 2, 3])
		)
		expect(refresh).toHaveBeenCalledOnce()
		expect(fetch).toHaveBeenCalledTimes(2)
		expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({
			Authorization: 'Bearer current-bearer'
		})
		expect(vi.mocked(fetch).mock.calls[1][1]?.headers).toMatchObject({
			Authorization: 'Bearer renewed-bearer'
		})
	})
	it('does not loop when the refreshed download bearer also receives 401', async () => {
		const refresh = vi.fn(async () => ({
			accessToken: 'renewed-bearer',
			isCurrent: () => true
		}))
		releaseTransport = registerSessionTransport(async () => ({
			accessToken: 'current-bearer',
			isCurrent: () => true,
			refresh
		}))
		vi.mocked(fetch).mockImplementation(
			async () => new Response(null, { status: 401 })
		)
		await expect(authenticatedDownload(request())).rejects.toMatchObject({
			kind: 'unauthorized'
		})
		expect(fetch).toHaveBeenCalledTimes(2)
		expect(refresh).toHaveBeenCalledOnce()
	})
	it('discards a response after its session lifetime ends', async () => {
		let current = true
		releaseTransport = registerSessionTransport(async () => ({
			accessToken: 'current-bearer',
			isCurrent: () => current
		}))
		vi.mocked(fetch).mockImplementation(async () => {
			current = false
			return response([[1, 2, 3]])
		})
		await expect(authenticatedDownload(request())).rejects.toMatchObject({
			kind: 'unauthorized'
		})
	})
	it('preserves cancellation while session resolution is pending', async () => {
		const controller = new AbortController()
		let complete!: (lease: SessionTransportLease) => void
		releaseTransport = registerSessionTransport(
			() =>
				new Promise(resolve => {
					complete = resolve
				})
		)
		const pending = authenticatedDownload({
			...request(),
			signal: controller.signal
		})
		controller.abort()
		await expect(pending).rejects.toMatchObject({ kind: 'temporary' })
		complete({ accessToken: 'late-bearer', isCurrent: () => true })
		await Promise.resolve()
		expect(fetch).not.toHaveBeenCalled()
	})
	it('bounds a pending session resolver with the existing download timeout', async () => {
		vi.useFakeTimers()
		try {
			releaseTransport = registerSessionTransport(
				() => new Promise(() => undefined)
			)
			const pending = authenticatedDownload(request())
			const assertion = expect(pending).rejects.toMatchObject({
				kind: 'temporary'
			})
			await vi.advanceTimersByTimeAsync(15_000)
			await assertion
			expect(fetch).not.toHaveBeenCalled()
		} finally {
			vi.useRealTimers()
		}
	})
})
