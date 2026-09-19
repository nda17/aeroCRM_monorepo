import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	AuthenticatedApiError,
	authenticatedRequest,
	isSessionRecoveryReadError
} from './authenticated-http-client'
import {
	registerSessionTransport,
	resolveSessionTransport,
	type SessionTransportLease,
	type SessionTransportResolver
} from './session-transport'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@/shared/api/http-client', () => ({
	getPublicHttpClient: () => ({ request: send })
}))

const releases: (() => void)[] = []
const register = (resolver: SessionTransportResolver) => {
	const release = registerSessionTransport(resolver)
	releases.push(release)
	return release
}
const lease = (accessToken = 'current-bearer'): SessionTransportLease => ({
	accessToken,
	isCurrent: () => true
})
const unauthorized = () => ({
	isAxiosError: true,
	response: { status: 401 }
})
const request = () =>
	authenticatedRequest({
		accessToken: 'session-binding',
		method: 'GET',
		url: '/crm/example'
	})

beforeEach(() => {
	send.mockReset().mockResolvedValue({ data: { ok: true } })
})
afterEach(() => {
	while (releases.length) releases.pop()!()
})

describe('authenticated session transport', () => {
	it('preserves standalone direct-token consumers', async () => {
		await expect(request()).resolves.toEqual({ ok: true })
		expect(send).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				headers: { Authorization: 'Bearer session-binding' }
			})
		)
	})
	it('resolves the binding to the current bearer without exposing it in the URL', async () => {
		const resolve = vi.fn(async () => lease())
		register(resolve)
		await request()
		expect(resolve).toHaveBeenCalledExactlyOnceWith('session-binding')
		expect(send).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				url: '/crm/example',
				headers: { Authorization: 'Bearer current-bearer' }
			})
		)
	})
	it('uses registration identity for cleanup even when the same resolver is registered twice', async () => {
		const resolve = async () => lease()
		const releaseOld = register(resolve)
		const oldLease = await resolveSessionTransport('session-binding')
		const releaseNew = register(resolve)
		releaseOld()
		expect(oldLease.isCurrent()).toBe(false)
		const currentLease = await resolveSessionTransport('session-binding')
		expect(currentLease.accessToken).toBe('current-bearer')
		expect(currentLease.isCurrent()).toBe(true)
		releaseNew()
		expect(currentLease.isCurrent()).toBe(false)
	})
	it('never sends an unknown binding that the resolver rejects', async () => {
		register(async () => {
			throw new AuthenticatedApiError('unauthorized', 'Сессия завершена.')
		})
		await expect(request()).rejects.toMatchObject({ kind: 'unauthorized' })
		expect(send).not.toHaveBeenCalled()
	})
	it('rejects an invalid resolved bearer before HTTP', async () => {
		register(async () => lease('unsafe token'))
		await expect(request()).rejects.toMatchObject({ kind: 'temporary' })
		expect(send).not.toHaveBeenCalled()
	})
	it('discards a late response after the registered session is replaced', async () => {
		let complete!: (value: unknown) => void
		send.mockReturnValueOnce(
			new Promise(resolve => {
				complete = resolve
			})
		)
		register(async () => lease())
		const pending = request()
		await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
		register(async () => lease('another-session-bearer'))
		complete({ data: { mustNotLeak: true } })
		await expect(pending).rejects.toMatchObject({ kind: 'unauthorized' })
	})
	it('retries a GET only once with the refreshed bearer', async () => {
		const refresh = vi.fn(async () => lease('renewed-bearer'))
		register(async () => ({ ...lease(), refresh }))
		send.mockRejectedValueOnce(unauthorized())
		await expect(request()).resolves.toEqual({ ok: true })
		expect(refresh).toHaveBeenCalledOnce()
		expect(send).toHaveBeenCalledTimes(2)
		expect(send.mock.calls[0][0].headers.Authorization).toBe(
			'Bearer current-bearer'
		)
		expect(send.mock.calls[1][0].headers.Authorization).toBe(
			'Bearer renewed-bearer'
		)
	})
	it('does not loop after a second GET 401', async () => {
		const refresh = vi.fn(async () => lease('renewed-bearer'))
		register(async () => ({ ...lease(), refresh }))
		send.mockRejectedValue(unauthorized())
		await expect(request()).rejects.toMatchObject({ kind: 'unauthorized' })
		expect(send).toHaveBeenCalledTimes(2)
		expect(refresh).toHaveBeenCalledOnce()
	})
	it.each(['POST', 'PUT'] as const)(
		'refreshes credentials but never automatically replays a %s command',
		async method => {
			const refresh = vi.fn(async () => lease('renewed-bearer'))
			register(async () => ({ ...lease(), refresh }))
			send.mockRejectedValueOnce(unauthorized())
			await expect(
				authenticatedRequest({
					accessToken: 'session-binding',
					method,
					url: '/crm/example',
					data: { commandId: 'original-command', value: 1 }
				})
			).rejects.toMatchObject({
				kind: 'temporary',
				message: 'Сессия обновлена. Повторите действие.'
			})
			expect(send).toHaveBeenCalledOnce()
			expect(refresh).toHaveBeenCalledOnce()
		}
	)
	it.each(['unauthorized', 'temporary'] as const)(
		'preserves the %s refresh failure without replay',
		async kind => {
			register(async () => ({
				...lease(),
				refresh: async () => {
					throw new AuthenticatedApiError(kind, 'Безопасное сообщение.')
				}
			}))
			send.mockRejectedValueOnce(unauthorized())
			await expect(request()).rejects.toMatchObject({ kind })
			expect(send).toHaveBeenCalledOnce()
		}
	)
	it('does not retry with a refreshed lease that is no longer current', async () => {
		register(async () => ({
			...lease(),
			refresh: async () => ({ ...lease(), isCurrent: () => false })
		}))
		send.mockRejectedValueOnce(unauthorized())
		await expect(request()).rejects.toMatchObject({ kind: 'unauthorized' })
		expect(send).toHaveBeenCalledOnce()
	})
	it.each(['resolve', 'refresh'] as const)(
		'marks only the GET copy of a temporary shared %s failure for recovery',
		async phase => {
			const sharedError = new AuthenticatedApiError(
				'temporary',
				'Не удалось обновить сессию.'
			)
			register(async () => {
				if (phase === 'resolve') throw sharedError
				return {
					...lease(),
					refresh: async () => {
						throw sharedError
					}
				}
			})
			send.mockRejectedValue(unauthorized())
			const readError = await request().catch(error => error)
			expect(isSessionRecoveryReadError(readError)).toBe(true)
			expect(readError).not.toBe(sharedError)
			expect(readError).toMatchObject({
				kind: 'temporary',
				message: sharedError.message
			})
			const commandError = await authenticatedRequest({
				accessToken: 'session-binding',
				method: 'POST',
				url: '/crm/example',
				data: { commandId: 'original-command' }
			}).catch(error => error)
			expect(commandError).toBe(sharedError)
			expect(isSessionRecoveryReadError(commandError)).toBe(false)
			expect(isSessionRecoveryReadError(sharedError)).toBe(false)
		}
	)
	it('does not mark domain/network failures or confirmed logout for session recovery', async () => {
		send.mockRejectedValueOnce(new Error('network failure'))
		const networkError = await request().catch(error => error)
		expect(networkError).toMatchObject({ kind: 'temporary' })
		expect(isSessionRecoveryReadError(networkError)).toBe(false)
		register(async () => {
			throw new AuthenticatedApiError('unauthorized', 'Сессия завершена.')
		})
		const logoutError = await request().catch(error => error)
		expect(logoutError).toMatchObject({ kind: 'unauthorized' })
		expect(isSessionRecoveryReadError(logoutError)).toBe(false)
		expect(isSessionRecoveryReadError(null)).toBe(false)
	})
})
