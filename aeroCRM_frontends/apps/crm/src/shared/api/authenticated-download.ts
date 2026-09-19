import { getRuntimeConfig } from '@/shared/config/runtime'
import {
	AuthenticatedApiError,
	invalidContractError
} from './authenticated-http-client'
import {
	resolveSessionTransport,
	type SessionTransportLease
} from './session-transport'

export type DownloadFormat = 'json' | 'csv'
export interface DownloadRequest {
	accessToken: string
	path: string
	params: Record<string, string>
	signal: AbortSignal
	maxBytes: number
	accept?: string
	inspectHeaders: (headers: Headers) => number
}
const failure = (status: number) => {
	if (status === 401)
		return new AuthenticatedApiError(
			'unauthorized',
			'Сессия больше не действует. Файл не сохранён.'
		)
	if (status === 403)
		return new AuthenticatedApiError(
			'forbidden',
			'Право на экспорт не подтверждено. Файл не сохранён.'
		)
	if (status === 413)
		return new AuthenticatedApiError(
			'validation',
			'Выгрузка превышает допустимое число записей или размер. Частичный файл не создаётся.'
		)
	if (status === 400)
		return new AuthenticatedApiError(
			'validation',
			'Не удалось подтвердить параметры экспорта.'
		)
	return new AuthenticatedApiError(
		'temporary',
		'Не удалось получить полную выгрузку. Повторите попытку.'
	)
}

// A separate bounded stream, not an Axios blob response that buffers an
// unbounded body first. No token/body enters query caches or browser storage.
export const authenticatedDownload = async ({
	accessToken,
	path,
	params,
	signal,
	maxBytes,
	accept = 'application/json, text/csv',
	inspectHeaders
}: DownloadRequest) => {
	if (
		!/^[^\s,]{1,16384}$/.test(accessToken) ||
		!/^\/[a-z0-9/-]+$/.test(path) ||
		path.includes('//') ||
		!Number.isSafeInteger(maxBytes) ||
		maxBytes < 1
	)
		throw invalidContractError()
	const controller = new AbortController()
	const abort = () => controller.abort()
	if (signal.aborted) abort()
	else signal.addEventListener('abort', abort, { once: true })
	const timeout = setTimeout(abort, 15_000)
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
	const waitForLease = (pending: Promise<SessionTransportLease>) =>
		new Promise<SessionTransportLease>((resolve, reject) => {
			const onAbort = () => reject(failure(503))
			if (controller.signal.aborted) onAbort()
			else
				controller.signal.addEventListener('abort', onAbort, {
					once: true
				})
			pending.then(
				lease => {
					controller.signal.removeEventListener('abort', onAbort)
					if (controller.signal.aborted) onAbort()
					else resolve(lease)
				},
				error => {
					controller.signal.removeEventListener('abort', onAbort)
					reject(error)
				}
			)
		})
	try {
		const base = getRuntimeConfig().apiBaseUrl
		const url = new URL(`${base}${path}`)
		url.search = new URLSearchParams(params).toString()
		if (controller.signal.aborted) throw failure(503)
		let lease = await waitForLease(resolveSessionTransport(accessToken))
		const ensureCurrent = () => {
			if (controller.signal.aborted) throw failure(503)
			if (!lease.isCurrent()) throw failure(401)
			if (!/^[^\s,]{1,16384}$/.test(lease.accessToken))
				throw invalidContractError()
		}
		const send = () => {
			ensureCurrent()
			return fetch(url, {
				method: 'GET',
				credentials: 'include',
				cache: 'no-store',
				redirect: 'error',
				referrerPolicy: 'no-referrer',
				signal: controller.signal,
				headers: {
					Authorization: `Bearer ${lease.accessToken}`,
					Accept: accept
				}
			})
		}
		let response = await send()
		ensureCurrent()
		if (response.status === 401 && lease.refresh) {
			try {
				void response.body?.cancel().catch(() => undefined)
			} catch {
				/* The unauthorized body is never read or exposed. */
			}
			ensureCurrent()
			lease = await waitForLease(lease.refresh())
			response = await send()
			ensureCurrent()
		}
		if (response.status !== 200) throw failure(response.status)
		if (response.redirected || !response.body) throw invalidContractError()
		const expectedBytes = inspectHeaders(response.headers)
		if (
			!Number.isSafeInteger(expectedBytes) ||
			expectedBytes < 1 ||
			expectedBytes > maxBytes
		)
			throw invalidContractError()
		// Content-Length may be compressed on the wire. The caller supplies the
		// validated logical byte length; Fetch exposes decoded response chunks.
		reader = response.body.getReader()
		const chunks: Uint8Array[] = []
		let size = 0
		while (true) {
			ensureCurrent()
			const chunk = await reader.read()
			ensureCurrent()
			if (chunk.done) break
			size += chunk.value.byteLength
			if (size > maxBytes || size > expectedBytes)
				throw invalidContractError()
			chunks.push(chunk.value)
		}
		if (size !== expectedBytes) throw invalidContractError()
		const bytes = new Uint8Array(size)
		let offset = 0
		for (const chunk of chunks) {
			bytes.set(chunk, offset)
			offset += chunk.byteLength
		}
		ensureCurrent()
		return bytes
	} catch (error) {
		if (error instanceof AuthenticatedApiError) throw error
		throw failure(503)
	} finally {
		clearTimeout(timeout)
		signal.removeEventListener('abort', abort)
		controller.abort()
		try {
			await reader?.cancel()
		} catch {
			/* Best-effort stream release. */
		}
		reader?.releaseLock()
	}
}
