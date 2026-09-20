/* Only this neutral offline document is stored. CRM pages and API responses are never cached. */
const CACHE_PREFIX = 'aerocrm-offline-'
const CACHE_NAME = `${CACHE_PREFIX}v1`
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', event => {
	event.waitUntil(
		(async () => {
			const response = await fetch(OFFLINE_URL, {
				cache: 'no-store',
				credentials: 'omit'
			})
			if (
				!response.ok ||
				response.redirected ||
				!response.headers.get('content-type')?.includes('text/html')
			) {
				throw new Error('Offline document is unavailable')
			}
			const cache = await caches.open(CACHE_NAME)
			await cache.put(OFFLINE_URL, response)
			await self.skipWaiting()
		})()
	)
})

self.addEventListener('activate', event => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys()
			await Promise.all(
				keys
					.filter(
						key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME
					)
					.map(key => caches.delete(key))
			)
			await self.clients.claim()
		})()
	)
})

self.addEventListener('fetch', event => {
	const { request } = event
	const url = new URL(request.url)
	if (
		request.method !== 'GET' ||
		request.mode !== 'navigate' ||
		url.origin !== self.location.origin ||
		/^\/(?:api|_next|\.well-known)(?:\/|$)/.test(url.pathname)
	) {
		return
	}

	event.respondWith(
		fetch(request, { cache: 'no-store' }).catch(async () => {
			const cache = await caches.open(CACHE_NAME)
			const fallback = await cache.match(OFFLINE_URL)
			if (!fallback) return Response.error()
			return new Response(fallback.body, {
				status: 503,
				headers: {
					'Content-Type': 'text/html; charset=utf-8',
					'Cache-Control': 'no-store',
					'X-Robots-Tag': 'noindex, nofollow, noarchive'
				}
			})
		})
	)
})
