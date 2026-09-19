import {
	mutateSales,
	type SalesDeal,
	type SalesMutation
} from '@/entities/sales'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { resetSessionStore, useSessionStore } from '@/entities/session'
import {
	act,
	cleanup,
	waitFor,
	renderHook as baseRenderHook,
	type RenderHookOptions
} from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import {
	PendingCommandProvider,
	commandOwner
} from '@/shared/lib/pending-command'
import { getCrmPermissions } from '@/entities/crm-access'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSalesCommand } from './use-sales-command'

vi.mock('@/entities/sales', () => ({ mutateSales: vi.fn() }))
vi.mock('@/entities/crm-access', () => ({ getCrmPermissions: vi.fn() }))
const TestProvider = ({ children }: PropsWithChildren) => {
	const { session, sessionRevision } = useSessionStore()
	return (
		<PendingCommandProvider
			owner={
				session ? commandOwner(session.userId, sessionRevision) : null
			}
		>
			{children}
		</PendingCommandProvider>
	)
}
const renderHook = <Result, Props>(
	callback: (props: Props) => Result,
	options?: RenderHookOptions<Props>
) => baseRenderHook(callback, { ...options, wrapper: TestProvider })
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
const mutate = vi.mocked(mutateSales)
const workspaceId = '11111111-1111-4111-8111-111111111111'
const mutation: SalesMutation = {
	kind: 'archive',
	id: '22222222-2222-4222-8222-222222222222',
	expectedVersion: 1
}
const savedDeal = { id: mutation.id, workspaceId, version: 2 } as SalesDeal

describe('useSalesCommand durable retry within the active form', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		resetSessionStore()
		useSessionStore
			.getState()
			.setAuthenticated({ accessToken: 'token', userId: 'actor' })
		vi.mocked(getCrmPermissions).mockResolvedValue({
			subject: 'actor',
			state: 'ACTIVE',
			permissions: ['sales:write']
		} as never)
	})
	afterEach(cleanup)
	it('keeps the exact UUID and immutable request on an ambiguous response', async () => {
		mutate
			.mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', 'Не подтверждено')
			)
			.mockResolvedValueOnce(savedDeal)
		const onSuccess = vi.fn()
		const { result } = renderHook(() =>
			useSalesCommand(workspaceId, 'token', true, onSuccess)
		)
		const request = structuredClone(mutation)
		await act(() => result.current.execute(request))
		const original = structuredClone(mutate.mock.calls[0][1])
		request.expectedVersion = 99
		expect(result.current.locked).toBe(true)
		expect(result.current.canClose()).toBe(false)
		act(() => result.current.resetAfterReview())
		expect(result.current.ambiguous).toBe(true)
		await act(() => result.current.execute(request))
		expect(mutate.mock.calls[1][1]).toEqual(original)
		expect(onSuccess).toHaveBeenCalledExactlyOnceWith(savedDeal)
		expect(result.current.canClose()).toBe(true)
	})
	it('guards parallel double clicks before the first render', async () => {
		let resolve!: (deal: SalesDeal) => void
		mutate.mockImplementationOnce(
			() =>
				new Promise(done => {
					resolve = done
				})
		)
		const { result } = renderHook(() =>
			useSalesCommand(workspaceId, 'token', true, vi.fn())
		)
		let first!: Promise<void>
		act(() => {
			first = result.current.execute(mutation)
			void result.current.execute(mutation)
		})
		await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
		expect(result.current.pending).toBe(true)
		await act(async () => {
			resolve(savedDeal)
			await first
		})
	})
	it.each(['conflict', 'forbidden', 'notFound'] as const)(
		'requires explicit reread/review after %s',
		async kind => {
			mutate
				.mockRejectedValueOnce(
					new AuthenticatedApiError(kind, 'Проверьте данные')
				)
				.mockResolvedValueOnce(savedDeal)
			const { result } = renderHook(() =>
				useSalesCommand(workspaceId, 'token', true, vi.fn())
			)
			await act(() => result.current.execute(mutation))
			const firstId = mutate.mock.calls[0][1].commandId
			await act(() => result.current.execute(mutation))
			expect(mutate).toHaveBeenCalledTimes(1)
			expect(result.current.blocked).toBe(true)
			act(() => result.current.resetAfterReview())
			await act(() =>
				result.current.execute({ ...mutation, expectedVersion: 2 })
			)
			expect(mutate.mock.calls[1][1].commandId).not.toBe(firstId)
		}
	)
	it('allows correction after a definite validation rejection', async () => {
		mutate
			.mockRejectedValueOnce(
				new AuthenticatedApiError('validation', 'Поля')
			)
			.mockResolvedValueOnce(savedDeal)
		const { result } = renderHook(() =>
			useSalesCommand(workspaceId, 'token', true, vi.fn())
		)
		await act(() => result.current.execute(mutation))
		expect(result.current.locked).toBe(false)
		const first = mutate.mock.calls[0][1].commandId
		await act(() => result.current.execute(mutation))
		expect(mutate.mock.calls[1][1].commandId).not.toBe(first)
	})
	it('never retries while authorization is unavailable or read-only', async () => {
		mutate
			.mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', 'Не подтверждено')
			)
			.mockResolvedValueOnce(savedDeal)
		const { result, rerender } = renderHook(
			({ enabled }) =>
				useSalesCommand(workspaceId, 'token', enabled, vi.fn()),
			{ initialProps: { enabled: true } }
		)
		await act(() => result.current.execute(mutation))
		const original = mutate.mock.calls[0][1]
		rerender({ enabled: false })
		await act(() => result.current.execute())
		expect(mutate).toHaveBeenCalledTimes(1)
		expect(result.current.canRetry).toBe(false)
		rerender({ enabled: true })
		await act(() => result.current.execute())
		expect(mutate.mock.calls[1][1]).toEqual(original)
	})
	it('ignores an old 401 after another session was established', async () => {
		useSessionStore.setState({
			session: { accessToken: 'token', userId: 'actor' },
			status: 'authenticated',
			sessionRevision: 1
		})
		let reject!: (error: Error) => void
		mutate.mockImplementationOnce(
			() =>
				new Promise((_resolve, fail) => {
					reject = fail
				})
		)
		const { result } = renderHook(() =>
			useSalesCommand(workspaceId, 'token', true, vi.fn())
		)
		let pending!: Promise<void>
		act(() => {
			pending = result.current.execute(mutation)
		})
		await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
		act(() =>
			useSessionStore.setState({
				session: { accessToken: 'new-token', userId: 'new-actor' },
				status: 'authenticated',
				sessionRevision: 2
			})
		)
		await act(async () => {
			reject(
				new AuthenticatedApiError('unauthorized', 'Истекла старая сессия')
			)
			await pending
		})
		expect(useSessionStore.getState().session?.accessToken).toBe(
			'new-token'
		)
		expect(useSessionStore.getState().status).toBe('authenticated')
	})
	it('makes only the matching current session anonymous on 401', async () => {
		useSessionStore.setState({
			session: { accessToken: 'token', userId: 'actor' },
			status: 'authenticated',
			sessionRevision: 1
		})
		mutate.mockRejectedValueOnce(
			new AuthenticatedApiError('unauthorized', 'Сессия истекла')
		)
		const { result } = renderHook(() =>
			useSalesCommand(workspaceId, 'token', true, vi.fn())
		)
		await act(() => result.current.execute(mutation))
		expect(useSessionStore.getState().session).toBeNull()
		expect(useSessionStore.getState().status).toBe('anonymous')
	})
})
