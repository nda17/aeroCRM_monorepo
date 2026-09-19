import { getCrmPermissions } from '@/entities/crm-access'
import { mutateTeam, type TeamMutation } from '@/entities/crm-team'
import { resetSessionStore, useSessionStore } from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import {
	commandOwner,
	PendingCommandProvider
} from '@/shared/lib/pending-command'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTeamCommand } from './use-team-command'
import type { useTeamSession } from './use-team-session'

vi.mock('@/entities/crm-access', () => ({ getCrmPermissions: vi.fn() }))
vi.mock('@/entities/crm-team', () => ({ mutateTeam: vi.fn() }))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
let queryClient: QueryClient
const TestProvider = ({ children }: PropsWithChildren) => {
	const { session, sessionRevision } = useSessionStore()
	return (
		<QueryClientProvider client={queryClient}>
			<PendingCommandProvider
				owner={
					session ? commandOwner(session.userId, sessionRevision) : null
				}
			>
				{children}
			</PendingCommandProvider>
		</QueryClientProvider>
	)
}
const wrapper = TestProvider
const workspaceId = '11111111-1111-4111-8111-111111111111'
const mutation: TeamMutation = {
	kind: 'enable',
	id: '22222222-2222-4222-8222-222222222222',
	expectedVersion: 1
}
const context = () => {
	const { session, sessionRevision } = useSessionStore.getState()
	return {
		workspace: { workspaceId },
		session,
		sessionRevision,
		scopeKey: 'owner',
		canManage: true,
		canRevoke: true
	} as ReturnType<typeof useTeamSession>
}
beforeEach(() => {
	vi.clearAllMocks()
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	resetSessionStore()
	useSessionStore
		.getState()
		.setAuthenticated({ accessToken: 'token', userId: 'owner' })
	vi.mocked(getCrmPermissions).mockResolvedValue({
		subject: 'owner',
		role: 'OWNER',
		state: 'ACTIVE',
		permissions: ['access:manage-team', 'access:revoke-access']
	} as never)
})
afterEach(() => {
	cleanup()
	queryClient.clear()
	vi.restoreAllMocks()
	resetSessionStore()
})
describe('CRM team memory command coordinator', () => {
	it('replays immutable UUID/payload on unknown result and checks permissions again', async () => {
		vi.mocked(mutateTeam)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', 'Unknown')
			)
			.mockResolvedValueOnce({ kind: 'enable', id: mutation.id })
		const onSaved = vi.fn()
		const { result } = renderHook(
			() => useTeamCommand(context(), 'enable:member', false, onSaved),
			{ wrapper }
		)
		await act(() => result.current.execute(mutation))
		const original = structuredClone(
			vi.mocked(mutateTeam).mock.calls[0][1]
		)
		expect(result.current.locked).toBe(true)
		expect(result.current.canClose()).toBe(false)
		await act(() =>
			result.current.execute({ ...mutation, expectedVersion: 999 })
		)
		expect(vi.mocked(mutateTeam).mock.calls[1][1]).toEqual(original)
		expect(getCrmPermissions).toHaveBeenCalledTimes(2)
		expect(onSaved).toHaveBeenCalledTimes(1)
	})
	it('does not dispatch if fresh permissions are READ_ONLY', async () => {
		vi.mocked(getCrmPermissions).mockResolvedValue({
			subject: 'owner',
			role: 'OWNER',
			state: 'READ_ONLY',
			permissions: ['access:manage-team']
		} as never)
		const { result } = renderHook(
			() => useTeamCommand(context(), 'new', false, vi.fn()),
			{ wrapper }
		)
		await act(() => result.current.execute(mutation))
		expect(mutateTeam).not.toHaveBeenCalled()
		expect(result.current.blocked).toBe(true)
	})
	it('keeps an unknown command after retry 401 and retries its exact UUID and payload', async () => {
		vi.mocked(mutateTeam)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', 'Unknown')
			)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('unauthorized', 'Expired')
			)
			.mockResolvedValueOnce({ kind: 'enable', id: mutation.id })
		const logout = vi.spyOn(useSessionStore.getState(), 'setAnonymous')
		const onSaved = vi.fn()
		const { result } = renderHook(
			() => useTeamCommand(context(), 'enable:member', false, onSaved),
			{ wrapper }
		)
		await act(() => result.current.execute(mutation))
		const original = structuredClone(
			vi.mocked(mutateTeam).mock.calls[0][1]
		)
		await act(() => result.current.execute())
		expect(result.current.uncertain).toBe(true)
		expect(result.current.locked).toBe(true)
		expect(logout).not.toHaveBeenCalled()
		expect(useSessionStore.getState().session?.userId).toBe('owner')
		await act(() =>
			result.current.execute({ ...mutation, expectedVersion: 999 })
		)
		expect(
			vi.mocked(mutateTeam).mock.calls.map(([, command]) => command)
		).toEqual([original, original, original])
		expect(getCrmPermissions).toHaveBeenCalledTimes(3)
		expect(onSaved).toHaveBeenCalledTimes(1)
	})
	it('replaces narrowed permissions only for the current workspace and session', async () => {
		const current = context()
		const key = [
			'crm-permissions',
			workspaceId,
			'owner',
			current.sessionRevision
		]
		const otherSessionKey = [
			'crm-permissions',
			workspaceId,
			'owner',
			current.sessionRevision + 1
		]
		const otherWorkspaceKey = [
			'crm-permissions',
			'other-workspace',
			'owner',
			current.sessionRevision
		]
		const oldPermissions = {
			subject: 'owner',
			role: 'CRM_ADMIN',
			state: 'ACTIVE',
			permissions: ['access:read-team', 'access:manage-team']
		}
		const narrowPermissions = {
			subject: 'owner',
			role: 'MANAGER',
			state: 'ACTIVE',
			permissions: []
		}
		queryClient.setQueryData(key, oldPermissions)
		queryClient.setQueryData(otherSessionKey, oldPermissions)
		queryClient.setQueryData(otherWorkspaceKey, oldPermissions)
		vi.mocked(getCrmPermissions).mockResolvedValue(
			narrowPermissions as never
		)
		const { result } = renderHook(
			() => useTeamCommand(current, 'new', false, vi.fn()),
			{ wrapper }
		)
		await act(() => result.current.execute(mutation))
		expect(queryClient.getQueryData(key)).toEqual(narrowPermissions)
		expect(queryClient.getQueryData(otherSessionKey)).toEqual(
			oldPermissions
		)
		expect(queryClient.getQueryData(otherWorkspaceKey)).toEqual(
			oldPermissions
		)
		expect(mutateTeam).not.toHaveBeenCalled()
		expect(result.current.blocked).toBe(true)
	})
	it('does not write permissions when the session changes during cancellation', async () => {
		const captured = context()
		const key = [
			'crm-permissions',
			workspaceId,
			'owner',
			captured.sessionRevision
		]
		const oldPermissions = { role: 'CRM_ADMIN' }
		queryClient.setQueryData(key, oldPermissions)
		vi.spyOn(queryClient, 'cancelQueries').mockImplementationOnce(
			async () => {
				useSessionStore.getState().setAuthenticated({
					accessToken: 'new-token',
					userId: 'new-user'
				})
			}
		)
		const { result } = renderHook(
			() => useTeamCommand(captured, 'new', false, vi.fn()),
			{ wrapper }
		)
		await act(() => result.current.execute(mutation))
		expect(queryClient.getQueryData(key)).toEqual(oldPermissions)
		expect(mutateTeam).not.toHaveBeenCalled()
		expect(useSessionStore.getState().session?.userId).toBe('new-user')
	})
	it('cancels an older permissions request before applying a narrowed scope', async () => {
		const current = context()
		const key = [
			'crm-permissions',
			workspaceId,
			'owner',
			current.sessionRevision
		]
		let resolveOld!: (value: unknown) => void
		const oldRequest = queryClient
			.fetchQuery({
				queryKey: key,
				queryFn: () =>
					new Promise(resolve => {
						resolveOld = resolve
					})
			})
			.catch(() => undefined)
		const narrowed = {
			subject: 'owner',
			role: 'MANAGER',
			state: 'ACTIVE',
			permissions: []
		}
		vi.mocked(getCrmPermissions).mockResolvedValue(narrowed as never)
		const { result } = renderHook(
			() => useTeamCommand(current, 'new', false, vi.fn()),
			{ wrapper }
		)
		await act(() => result.current.execute(mutation))
		await act(async () => {
			resolveOld({
				subject: 'owner',
				role: 'CRM_ADMIN',
				permissions: ['access:read-team']
			})
			await oldRequest
		})
		expect(queryClient.getQueryData(key)).toEqual(narrowed)
		expect(mutateTeam).not.toHaveBeenCalled()
	})
	it('requires explicit review before creating a new UUID after CAS conflict', async () => {
		vi.mocked(mutateTeam)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('conflict', 'Version changed')
			)
			.mockResolvedValueOnce({ kind: 'enable', id: mutation.id })
		const { result } = renderHook(
			() => useTeamCommand(context(), 'new', false, vi.fn()),
			{ wrapper }
		)
		await act(() => result.current.execute(mutation))
		await act(() => result.current.execute(mutation))
		expect(mutateTeam).toHaveBeenCalledTimes(1)
		const old = vi.mocked(mutateTeam).mock.calls[0][1].commandId
		act(() => result.current.resetAfterReview())
		await act(() =>
			result.current.execute({ ...mutation, expectedVersion: 2 })
		)
		expect(vi.mocked(mutateTeam).mock.calls[1][1].commandId).not.toBe(old)
	})
	it('does not let a stale 401 response log out a newer session', async () => {
		let reject!: (error: Error) => void
		vi.mocked(mutateTeam).mockImplementation(
			() =>
				new Promise((_resolve, fail) => {
					reject = fail
				})
		)
		const captured = context()
		const { result } = renderHook(
			() => useTeamCommand(captured, 'new', false, vi.fn()),
			{ wrapper }
		)
		let pending!: Promise<void>
		act(() => {
			pending = result.current.execute(mutation)
		})
		await waitFor(() => expect(mutateTeam).toHaveBeenCalledTimes(1))
		act(() =>
			useSessionStore
				.getState()
				.setAuthenticated({ accessToken: 'new-token', userId: 'new-user' })
		)
		await act(async () => {
			reject(new AuthenticatedApiError('unauthorized', 'Expired'))
			await pending
		})
		expect(useSessionStore.getState().session?.userId).toBe('new-user')
	})
})
