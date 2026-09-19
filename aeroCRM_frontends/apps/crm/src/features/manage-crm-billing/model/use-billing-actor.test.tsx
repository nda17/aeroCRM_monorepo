import { resetSessionStore, useSessionStore } from '@/entities/session'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBillingActor } from './use-billing-actor'

const workspaceId = 'b531b13e-3624-4ec5-b66d-f24373b0b374'
const otherWorkspaceId = 'b1c1d3d9-dc5a-4a50-98ba-c79b3895db62'
const authenticate = (userId = 'owner', accessToken = 'synthetic-token') =>
	useSessionStore.getState().setAuthenticated({ userId, accessToken })

beforeEach(() => {
	resetSessionStore()
	authenticate()
})
afterEach(() => {
	cleanup()
	resetSessionStore()
	vi.restoreAllMocks()
})

describe('standalone billing request ownership', () => {
	it('does not need workspace write access to check billing', () => {
		const { result } = renderHook(() => useBillingActor(workspaceId))
		expect(result.current.enabled).toBe(true)
		expect(result.current.current()).toBe(true)
	})
	it('rejects an old workspace observer even for the same user and token', () => {
		const { result, rerender } = renderHook(
			({ id }) => useBillingActor(id),
			{ initialProps: { id: workspaceId } }
		)
		const previous = result.current.current
		rerender({ id: otherWorkspaceId })
		expect(previous()).toBe(false)
		expect(result.current.current()).toBe(true)
	})
	it.each([
		['other-user', 'synthetic-token'],
		['owner', 'other-token'],
		['owner', 'synthetic-token']
	])(
		'rejects late responses after authentication revision changes',
		(userId, token) => {
			const { result } = renderHook(() => useBillingActor(workspaceId))
			const previous = result.current.current
			act(() => authenticate(userId, token))
			expect(previous()).toBe(false)
			expect(result.current.current()).toBe(true)
		}
	)
	it('rejects late responses after unmount', () => {
		const { result, unmount } = renderHook(() =>
			useBillingActor(workspaceId)
		)
		const previous = result.current.current
		unmount()
		expect(previous()).toBe(false)
	})
	it('fails closed while logged out or offline and leaves session policy unchanged', () => {
		const { result } = renderHook(() => useBillingActor(workspaceId))
		vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
		act(() => window.dispatchEvent(new Event('offline')))
		expect(result.current.enabled).toBe(false)
		expect(useSessionStore.getState().status).toBe('authenticated')
		const previous = result.current.current
		act(() => useSessionStore.getState().setAnonymous())
		expect(previous()).toBe(false)
		expect(result.current.enabled).toBe(false)
	})

	it('cannot request a malformed workspace', () => {
		const { result } = renderHook(() => useBillingActor('invalid'))
		expect(result.current.enabled).toBe(false)
	})
})
