import {
	getCrmPermissions,
	type CrmPermissions
} from '@/entities/crm-access'
import { updateEmployeeProfile } from '@/entities/crm-team'
import { resetSessionStore, useSessionStore } from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import {
	commandOwner,
	PendingCommandProvider
} from '@/shared/lib/pending-command'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEmployeeProfileCommand } from './use-employee-profile-command'
import type { useTeamSession } from './use-team-session'

vi.mock('@/entities/crm-access', () => ({ getCrmPermissions: vi.fn() }))
vi.mock('@/entities/crm-team', () => ({ updateEmployeeProfile: vi.fn() }))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
const workspaceId = '11111111-1111-4111-8111-111111111111'
const value = {
	profile: { firstName: 'Анна', lastName: 'Иванова', middleName: null },
	expectedVersion: 0
}
let queryClient: QueryClient
let permissions: CrmPermissions
const context = () =>
	({
		...useSessionStore.getState(),
		workspace: { workspaceId },
		scopeKey: 'scope'
	}) as unknown as ReturnType<typeof useTeamSession>
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
beforeEach(() => {
	vi.clearAllMocks()
	resetSessionStore()
	useSessionStore
		.getState()
		.setAuthenticated({ accessToken: 'token', userId: 'actor' })
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	permissions = {
		schemaVersion: 1,
		workspaceId,
		subject: 'actor',
		role: 'OWNER',
		state: 'ACTIVE',
		dataScope: 'ALL',
		teamIds: [],
		permissions: ['access:manage-team']
	}
	vi.mocked(getCrmPermissions).mockImplementation(async () => permissions)
	vi.mocked(updateEmployeeProfile).mockImplementation(
		async (_token, command) => ({
			schemaVersion: 1,
			workspaceId,
			subject: 'actor',
			targetSubject: command.targetSubject,
			profile: {
				...command.profile,
				id: '22222222-2222-4222-8222-222222222222',
				version: command.expectedVersion + 1,
				updatedAt: '2026-09-07T10:00:00.000Z'
			}
		})
	)
})
afterEach(() => {
	cleanup()
	queryClient.clear()
	vi.restoreAllMocks()
	resetSessionStore()
})
describe('employee profile commands', () => {
	it.each([
		'OWNER',
		'CRM_ADMIN',
		'TEAM_LEAD',
		'MANAGER',
		'ANALYST'
	] as const)(
		'allows %s to edit their own name without team-management permission',
		async role => {
			permissions = { ...permissions, role, permissions: [] }
			const saved = vi.fn()
			const { result } = renderHook(
				() => useEmployeeProfileCommand(context(), 'actor', true, saved),
				{ wrapper }
			)
			await act(() => result.current.execute(value))
			expect(updateEmployeeProfile).toHaveBeenCalledWith(
				'token',
				expect.objectContaining({
					...value,
					workspaceId,
					subject: 'actor',
					targetSubject: 'actor'
				})
			)
			expect(saved).toHaveBeenCalledOnce()
		}
	)
	it.each(['OWNER', 'CRM_ADMIN'] as const)(
		'allows %s to submit another member profile with fresh manage-team permission',
		async role => {
			permissions = { ...permissions, role }
			const { result } = renderHook(
				() =>
					useEmployeeProfileCommand(context(), 'member', true, vi.fn()),
				{ wrapper }
			)
			await act(() => result.current.execute(value))
			expect(updateEmployeeProfile).toHaveBeenCalledWith(
				'token',
				expect.objectContaining({ targetSubject: 'member' })
			)
		}
	)
	it.each([
		'READ_ONLY',
		'MANAGER',
		'missing-permission',
		'wrong-actor',
		'wrong-workspace'
	])('does not dispatch under %s', async reason => {
		if (reason === 'READ_ONLY') permissions.state = 'READ_ONLY'
		if (reason === 'MANAGER') permissions.role = 'MANAGER'
		if (reason === 'missing-permission') permissions.permissions = []
		if (reason === 'wrong-actor') permissions.subject = 'other'
		if (reason === 'wrong-workspace') permissions.workspaceId = 'other'
		const { result } = renderHook(
			() => useEmployeeProfileCommand(context(), 'member', true, vi.fn()),
			{ wrapper }
		)
		await act(() => result.current.execute(value))
		expect(updateEmployeeProfile).not.toHaveBeenCalled()
	})
	it('does not dispatch a self edit after the subscription becomes read-only', async () => {
		permissions.state = 'READ_ONLY'
		const { result } = renderHook(
			() => useEmployeeProfileCommand(context(), 'actor', true, vi.fn()),
			{ wrapper }
		)
		await act(() => result.current.execute(value))
		expect(updateEmployeeProfile).not.toHaveBeenCalled()
	})
	it('replays the original UUID, target, expected version and names after an unknown result', async () => {
		vi.mocked(updateEmployeeProfile).mockRejectedValueOnce(
			new AuthenticatedApiError('temporary', 'Unknown')
		)
		const saved = vi.fn()
		const { result } = renderHook(
			() => useEmployeeProfileCommand(context(), 'actor', true, saved),
			{ wrapper }
		)
		await act(() => result.current.execute(value))
		const original = structuredClone(
			vi.mocked(updateEmployeeProfile).mock.calls[0][1]
		)
		expect(result.current.locked).toBe(true)
		expect(result.current.canClose()).toBe(false)
		await act(() =>
			result.current.execute({
				expectedVersion: 100,
				profile: { ...value.profile, firstName: 'Другое' }
			})
		)
		expect(vi.mocked(updateEmployeeProfile).mock.calls[1][1]).toEqual(
			original
		)
		expect(getCrmPermissions).toHaveBeenCalledTimes(2)
		expect(saved).toHaveBeenCalledOnce()
	})
	it('rejects a late permission response after account replacement without populating old authority', async () => {
		let resolve!: (value: CrmPermissions) => void
		vi.mocked(getCrmPermissions).mockReturnValue(
			new Promise(done => {
				resolve = done
			})
		)
		const original = context()
		const { result } = renderHook(
			() => useEmployeeProfileCommand(original, 'actor', true, vi.fn()),
			{ wrapper }
		)
		let request!: Promise<void>
		act(() => {
			request = result.current.execute(value)
		})
		act(() => {
			useSessionStore
				.getState()
				.setAuthenticated({ accessToken: 'new-token', userId: 'other' })
		})
		await act(async () => {
			resolve(permissions)
			await request
		})
		expect(updateEmployeeProfile).not.toHaveBeenCalled()
		expect(
			queryClient.getQueryData([
				'crm-permissions',
				workspaceId,
				'actor',
				original.sessionRevision
			])
		).toBeUndefined()
	})
	it('keeps a conflict blocked until explicit review', async () => {
		vi.mocked(updateEmployeeProfile).mockRejectedValueOnce(
			new AuthenticatedApiError('conflict', 'Version changed')
		)
		const { result } = renderHook(
			() => useEmployeeProfileCommand(context(), 'actor', true, vi.fn()),
			{ wrapper }
		)
		await act(() => result.current.execute(value))
		expect(result.current.blocked).toBe(true)
		await act(() => result.current.execute(value))
		expect(updateEmployeeProfile).toHaveBeenCalledOnce()
		act(() => {
			result.current.reset()
		})
		await act(() =>
			result.current.execute({ ...value, expectedVersion: 2 })
		)
		expect(updateEmployeeProfile).toHaveBeenCalledTimes(2)
	})
})
