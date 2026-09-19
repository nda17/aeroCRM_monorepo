import {
	mutateBilling,
	recoverBillingOperation,
	type BillingMutation,
	type BillingOperation
} from '@/entities/crm-billing'
import { resetSessionStore, useSessionStore } from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import {
	commandOwner,
	PendingCommandProvider
} from '@/shared/lib/pending-command'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { useBillingContext } from './use-billing-context'
import { useBillingCommand } from './use-billing-command'

vi.mock('@/entities/crm-billing', async original => ({
	...(await original<object>()),
	mutateBilling: vi.fn(),
	recoverBillingOperation: vi.fn()
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
const workspaceId = 'b531b13e-3624-4ec5-b66d-f24373b0b374'
const referenceId = 'b1c1d3d9-dc5a-4a50-98ba-c79b3895db62'
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
const authorize = vi.fn(async () => 'synthetic-token')
const context = (workspace = workspaceId) => {
	const { session, sessionRevision } = useSessionStore.getState()
	return {
		actor: {
			workspaceId: workspace,
			session,
			sessionRevision,
			scope: `${session?.userId}:${sessionRevision}:${workspace}`,
			enabled: !!session,
			current: () => {
				const now = useSessionStore.getState()
				return (
					now.status === 'authenticated' &&
					now.session?.userId === session?.userId &&
					now.session?.accessToken === session?.accessToken &&
					now.sessionRevision === sessionRevision
				)
			}
		},
		authorize
	} as unknown as ReturnType<typeof useBillingContext>
}
const checkout = (commandId: string): BillingMutation => ({
	action: 'checkout',
	body: {
		schemaVersion: 1,
		workspaceId,
		commandId,
		expectedBillingVersion: '0',
		expectedPolicyVersion: 2,
		cycle: 'MONTHLY',
		totalSeats: 2,
		autoRenew: true,
		consentVersion: 'exact-consent-v1'
	}
})
const closed = (commandId: string): BillingOperation => ({
	schemaVersion: 1,
	workspaceId,
	commandId,
	state: 'NOT_STARTED',
	requestHash: null,
	billing: null
})
beforeEach(() => {
	vi.clearAllMocks()
	resetSessionStore()
	useSessionStore
		.getState()
		.setAuthenticated({ userId: 'owner', accessToken: 'synthetic-token' })
	authorize.mockResolvedValue('synthetic-token')
})
afterEach(() => {
	cleanup()
	resetSessionStore()
	vi.restoreAllMocks()
})

describe('CRM billing immutable command and recovery lifecycle', () => {
	it('keeps the exact body, UUID and consent through 503 then 401 and does not log out', async () => {
		vi.mocked(mutateBilling)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', 'Unknown')
			)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('unauthorized', 'Unauthorized')
			)
			.mockImplementationOnce(async (_token, mutation) =>
				closed(mutation.body.commandId)
			)
		const onReference = vi.fn()
		const onConfirmed = vi.fn()
		const { result } = renderHook(
			() => useBillingCommand(context(), onReference, onConfirmed),
			{ wrapper: TestProvider }
		)
		await act(() => result.current.submit(checkout))
		const original = structuredClone(
			vi.mocked(mutateBilling).mock.calls[0][1]
		)
		expect(result.current.uncertain).toBe(true)
		await act(() =>
			result.current.submit(
				id =>
					({
						...checkout(id),
						body: { ...checkout(id).body, totalSeats: 9 }
					}) as BillingMutation
			)
		)
		expect(vi.mocked(mutateBilling).mock.calls[1][1]).toEqual(original)
		expect(useSessionStore.getState().status).toBe('authenticated')
		expect(result.current.uncertain).toBe(true)
		await act(() => result.current.execute())
		expect(vi.mocked(mutateBilling).mock.calls[2][1]).toEqual(original)
		expect(onReference).toHaveBeenCalledTimes(1)
		expect(onConfirmed).toHaveBeenCalledTimes(1)
		expect(authorize).toHaveBeenCalledTimes(3)
	})
	it('does not release pending evidence and explicitly recovers the original UUID', async () => {
		vi.mocked(mutateBilling).mockImplementation(
			async (_token, mutation) => ({
				...closed(mutation.body.commandId),
				state: 'PENDING',
				requestHash: 'a'.repeat(64)
			})
		)
		vi.mocked(recoverBillingOperation).mockImplementation(
			async (_token, _workspace, id) => closed(id)
		)
		const onConfirmed = vi.fn()
		const { result } = renderHook(
			() => useBillingCommand(context(), vi.fn(), onConfirmed),
			{ wrapper: TestProvider }
		)
		await act(() => result.current.submit(checkout))
		const id = result.current.snapshot.commandId!
		expect(result.current.uncertain).toBe(true)
		expect(onConfirmed).not.toHaveBeenCalled()
		await act(() => result.current.recoverReference(id))
		expect(recoverBillingOperation).toHaveBeenCalledExactlyOnceWith(
			'synthetic-token',
			workspaceId,
			id
		)
		expect(onConfirmed).toHaveBeenCalledWith(closed(id))
		expect(result.current.uncertain).toBe(false)
	})
	it('cannot substitute a foreign command reference for an in-memory unknown operation', async () => {
		vi.mocked(mutateBilling).mockRejectedValue(
			new AuthenticatedApiError('temporary', 'Unknown')
		)
		const { result } = renderHook(
			() => useBillingCommand(context(), vi.fn(), vi.fn()),
			{ wrapper: TestProvider }
		)
		await act(() => result.current.submit(checkout))
		await act(() => result.current.recoverReference(referenceId))
		expect(recoverBillingOperation).not.toHaveBeenCalled()
		expect(result.current.uncertain).toBe(true)
	})
	it('after reload recovers only the bounded reference without reconstructing a checkout body', async () => {
		vi.mocked(recoverBillingOperation).mockResolvedValue(
			closed(referenceId)
		)
		const onConfirmed = vi.fn()
		const { result } = renderHook(
			() => useBillingCommand(context(), vi.fn(), onConfirmed),
			{ wrapper: TestProvider }
		)
		await act(() => result.current.recoverReference(referenceId))
		expect(mutateBilling).not.toHaveBeenCalled()
		expect(recoverBillingOperation).toHaveBeenCalledExactlyOnceWith(
			'synthetic-token',
			workspaceId,
			referenceId
		)
		expect(onConfirmed).toHaveBeenCalledTimes(1)
	})
	it('preserves an unknown capsule through a subsequent fresh authority denial', async () => {
		vi.mocked(mutateBilling).mockRejectedValue(
			new AuthenticatedApiError('temporary', 'Unknown')
		)
		const { result } = renderHook(
			() => useBillingCommand(context(), vi.fn(), vi.fn()),
			{ wrapper: TestProvider }
		)
		await act(() => result.current.submit(checkout))
		authorize.mockRejectedValueOnce(
			new AuthenticatedApiError('forbidden', 'Denied')
		)
		await act(() =>
			result.current.recoverReference(result.current.snapshot.commandId!)
		)
		expect(recoverBillingOperation).not.toHaveBeenCalled()
		expect(result.current.uncertain).toBe(true)
	})
	it('does not send or write a URL reference for a command bound to another workspace', async () => {
		const onReference = vi.fn()
		const { result } = renderHook(
			() => useBillingCommand(context(), onReference, vi.fn()),
			{ wrapper: TestProvider }
		)
		await act(() =>
			result.current.submit(
				id =>
					({
						action: 'checkout',
						body: { ...checkout(id).body, workspaceId: referenceId }
					}) as BillingMutation
			)
		)
		expect(mutateBilling).not.toHaveBeenCalled()
		expect(onReference).not.toHaveBeenCalled()
	})
	it('ignores a late confirmed result after unmount', async () => {
		let finish!: (value: BillingOperation) => void
		vi.mocked(mutateBilling).mockImplementation(
			() =>
				new Promise(resolve => {
					finish = resolve
				})
		)
		const onConfirmed = vi.fn()
		const { result, unmount } = renderHook(
			() => useBillingCommand(context(), vi.fn(), onConfirmed),
			{ wrapper: TestProvider }
		)
		let pending!: Promise<void>
		await act(async () => {
			pending = result.current.submit(checkout)
			await Promise.resolve()
		})
		const id = result.current.snapshot.commandId!
		unmount()
		await act(async () => {
			finish(closed(id))
			await pending
		})
		expect(onConfirmed).not.toHaveBeenCalled()
	})
	it('does not expose an old owner result or mutate a new authenticated session', async () => {
		let finish!: (value: BillingOperation) => void
		vi.mocked(mutateBilling).mockImplementation(
			() =>
				new Promise(resolve => {
					finish = resolve
				})
		)
		const onConfirmed = vi.fn()
		const { result } = renderHook(
			() => useBillingCommand(context(), vi.fn(), onConfirmed),
			{ wrapper: TestProvider }
		)
		let pending!: Promise<void>
		await act(async () => {
			pending = result.current.submit(checkout)
			await Promise.resolve()
		})
		const id = result.current.snapshot.commandId!
		await act(async () => {
			useSessionStore
				.getState()
				.setAuthenticated({ userId: 'other', accessToken: 'new-token' })
			finish(closed(id))
			await pending
		})
		expect(onConfirmed).not.toHaveBeenCalled()
		expect(useSessionStore.getState().session?.userId).toBe('other')
	})
})
