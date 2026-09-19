import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	getCrmPermissions,
	type CrmPermissions
} from '@/entities/crm-access'
import { resetSessionStore, useSessionStore } from '@/entities/session'
import {
	getWorkdayTask,
	listWorkdayTasks,
	listWorkdayTimeline
} from '../api/workday.api'
import {
	allowedWorkdayScopes,
	taskFitsWorkdayAuthority,
	useWorkdaySession,
	useWorkdayTask,
	useWorkdayTasks,
	useWorkdayTimeline
} from './use-workday'
import {
	binding,
	entry,
	filters,
	otherId,
	page,
	task,
	taskId,
	workspaceId
} from './workday.test-fixtures'
import type { WorkdayTaskPage } from './workday.types'

let workspace: { workspaceId: string; canWrite: boolean }
let permissions: CrmPermissions
let fetching = false
let permissionError = false
let client: QueryClient
vi.mock('@/entities/crm-access', async () => ({
	...(await vi.importActual<typeof import('@/entities/crm-access')>(
		'@/entities/crm-access'
	)),
	useCrmWorkspaceAccess: () => workspace,
	useCrmPermissions: () => ({
		data: permissions,
		isSuccess: !permissionError,
		isFetching: fetching,
		isError: permissionError
	}),
	getCrmPermissions: vi.fn()
}))
vi.mock('../api/workday.api', () => ({
	getWorkdayTask: vi.fn(),
	listWorkdayTasks: vi.fn(),
	listWorkdayTimeline: vi.fn()
}))
const Wrapper = ({ children }: PropsWithChildren) => (
	<QueryClientProvider client={client}>{children}</QueryClientProvider>
)
beforeEach(() => {
	vi.clearAllMocks()
	resetSessionStore()
	useSessionStore
		.getState()
		.setAuthenticated({ accessToken: 'captured', userId: 'actor' })
	workspace = { workspaceId, canWrite: true }
	permissions = {
		schemaVersion: 1,
		...binding,
		role: 'OWNER',
		state: 'ACTIVE',
		dataScope: 'ALL',
		teamIds: [otherId],
		permissions: ['sales:read', 'sales:write']
	}
	fetching = false
	permissionError = false
	client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, refetchOnWindowFocus: false }
		}
	})
	vi.mocked(listWorkdayTasks).mockResolvedValue(page)
	vi.mocked(getWorkdayTask).mockResolvedValue(task)
	vi.mocked(listWorkdayTimeline).mockResolvedValue({
		schemaVersion: 1,
		page: 1,
		pageSize: 25,
		total: 1,
		items: [entry]
	})
	vi.mocked(getCrmPermissions).mockImplementation(async () => permissions)
})
afterEach(() => {
	cleanup()
	client.clear()
	resetSessionStore()
})

describe('Workday session and server-scoped read hooks', () => {
	it('loads read-only data but forbids changes after expiry', async () => {
		permissions = {
			...permissions,
			state: 'READ_ONLY',
			permissions: ['sales:read']
		}
		workspace.canWrite = false
		const view = renderHook(() => useWorkdayTasks(filters), {
			wrapper: Wrapper
		})
		await waitFor(() => expect(view.result.current.data).toEqual(page))
		expect(view.result.current.context.canWrite).toBe(false)
		await expect(
			view.result.current.context.authorize()
		).rejects.toMatchObject({ kind: 'forbidden' })
		expect(getCrmPermissions).not.toHaveBeenCalled()
	})
	it.each([
		'ANALYST',
		'error',
		'fetching',
		'other-actor',
		'other-workspace',
		'anonymous'
	] as const)(
		'does not issue task requests with %s authority',
		async reason => {
			if (reason === 'ANALYST') permissions.role = 'ANALYST'
			if (reason === 'error') permissionError = true
			if (reason === 'fetching') fetching = true
			if (reason === 'other-actor') permissions.subject = 'other'
			if (reason === 'other-workspace') permissions.workspaceId = otherId
			if (reason === 'anonymous') useSessionStore.getState().setAnonymous()
			const view = renderHook(() => useWorkdayTasks(filters), {
				wrapper: Wrapper
			})
			expect(view.result.current.context.canRead).toBe(false)
			await act(async () => {})
			expect(listWorkdayTasks).not.toHaveBeenCalled()
		}
	)
	it('does not request hidden list/board/detail/timeline queries', async () => {
		const view = renderHook(
			() => ({
				list: useWorkdayTasks(filters, false),
				detail: useWorkdayTask(taskId, false),
				timeline: useWorkdayTimeline(taskId, 1, 25, false)
			}),
			{ wrapper: Wrapper }
		)
		await act(async () => {
			await view.result.current.list.query.refetch()
		})
		expect(listWorkdayTasks).not.toHaveBeenCalled()
		expect(getWorkdayTask).not.toHaveBeenCalled()
		expect(listWorkdayTimeline).not.toHaveBeenCalled()
	})
	it('limits manager filters to MINE and rejects unavailable explicit team', async () => {
		permissions = {
			...permissions,
			role: 'MANAGER',
			dataScope: 'OWN',
			teamIds: []
		}
		const view = renderHook(
			() => useWorkdayTasks({ ...filters, scope: 'ALL' }),
			{ wrapper: Wrapper }
		)
		expect(view.result.current.context.scopes).toEqual(['MINE'])
		expect(view.result.current.permitted).toBe(false)
		await act(async () => {})
		expect(listWorkdayTasks).not.toHaveBeenCalled()
	})
	it('does not retain previous page/filter records while the new server page loads', async () => {
		const view = renderHook(({ selected }) => useWorkdayTasks(selected), {
			wrapper: Wrapper,
			initialProps: { selected: filters }
		})
		await waitFor(() => expect(view.result.current.data).toEqual(page))
		vi.mocked(listWorkdayTasks).mockReturnValue(new Promise(() => {}))
		view.rerender({ selected: { ...filters, page: 2 } })
		expect(view.result.current.data).toBeUndefined()
		await waitFor(() => expect(listWorkdayTasks).toHaveBeenCalledTimes(2))
		expect(vi.mocked(listWorkdayTasks).mock.calls[1][1].page).toBe(2)
	})
	it('discards same-user old-session results and starts a fresh permission/session-scoped key', async () => {
		let resolve!: (value: WorkdayTaskPage) => void
		vi.mocked(listWorkdayTasks).mockReturnValueOnce(
			new Promise(done => {
				resolve = done
			})
		)
		const view = renderHook(() => useWorkdayTasks(filters), {
			wrapper: Wrapper
		})
		await waitFor(() => expect(listWorkdayTasks).toHaveBeenCalledTimes(1))
		const firstKey = view.result.current.key
		vi.mocked(listWorkdayTasks).mockResolvedValue({
			...page,
			items: [{ ...task, title: 'Новая сессия' }]
		})
		act(() =>
			useSessionStore
				.getState()
				.setAuthenticated({ accessToken: 'new-token', userId: 'actor' })
		)
		await waitFor(() =>
			expect(view.result.current.data?.items[0].title).toBe('Новая сессия')
		)
		await act(async () => resolve(page))
		expect(view.result.current.data?.items[0].title).toBe('Новая сессия')
		expect(view.result.current.key).not.toEqual(firstKey)
	})
	it('hides the old workspace immediately and does not reuse its data', async () => {
		const view = renderHook(() => useWorkdayTasks(filters), {
			wrapper: Wrapper
		})
		await waitFor(() => expect(view.result.current.data).toEqual(page))
		workspace = { ...workspace, workspaceId: otherId }
		view.rerender()
		expect(view.result.current.data).toBeUndefined()
		expect(listWorkdayTasks).toHaveBeenCalledTimes(1)
	})
	it('includes changed permission scope/state in keys and rejects standalone cross-scope results', async () => {
		const view = renderHook(() => useWorkdayTasks(filters), {
			wrapper: Wrapper
		})
		await waitFor(() => expect(view.result.current.data).toEqual(page))
		const firstKey = view.result.current.key
		permissions = {
			...permissions,
			role: 'MANAGER',
			dataScope: 'OWN',
			teamIds: []
		}
		vi.mocked(listWorkdayTasks).mockResolvedValue({
			...page,
			items: [{ ...task, assignedToSubject: 'other' }]
		})
		view.rerender()
		await waitFor(() =>
			expect(view.result.current.query.isError).toBe(true)
		)
		expect(view.result.current.data).toBeUndefined()
		expect(view.result.current.key).not.toEqual(firstKey)
	})
	it('loads detail and paginated history without filtering historic assignees by the current owner', async () => {
		const view = renderHook(
			() => ({
				detail: useWorkdayTask(taskId),
				timeline: useWorkdayTimeline(taskId, 1)
			}),
			{ wrapper: Wrapper }
		)
		await waitFor(() =>
			expect(view.result.current.detail.data).toEqual(task)
		)
		await waitFor(() =>
			expect(view.result.current.timeline.data?.items).toEqual([entry])
		)
		expect(listWorkdayTimeline).toHaveBeenCalledExactlyOnceWith(
			'captured',
			{ ...binding, id: taskId, page: 1, pageSize: 25 }
		)
	})
	it('checks fresh authority before returning a token for a mutation', async () => {
		const view = renderHook(() => useWorkdaySession(), {
			wrapper: Wrapper
		})
		await expect(view.result.current.authorize()).resolves.toBe('captured')
		vi.mocked(getCrmPermissions).mockResolvedValue({
			...permissions,
			role: 'MANAGER',
			dataScope: 'OWN',
			teamIds: []
		})
		await expect(view.result.current.authorize()).rejects.toMatchObject({
			kind: 'forbidden'
		})
	})
	it('rejects authorization that completes after a session change', async () => {
		let resolve!: (value: CrmPermissions) => void
		vi.mocked(getCrmPermissions).mockReturnValue(
			new Promise(done => {
				resolve = done
			})
		)
		const view = renderHook(() => useWorkdaySession(), {
			wrapper: Wrapper
		})
		const pending = view.result.current.authorize()
		const assertion = expect(pending).rejects.toMatchObject({
			kind: 'unauthorized'
		})
		act(() =>
			useSessionStore
				.getState()
				.setAuthenticated({ accessToken: 'new-token', userId: 'actor' })
		)
		await act(async () => {
			resolve(permissions)
			await assertion
		})
	})
	it('never infers deal visibility from linked-task assignee', () => {
		const manager = {
			...permissions,
			role: 'MANAGER' as const,
			dataScope: 'OWN' as const
		}
		expect(
			taskFitsWorkdayAuthority(
				{ ...task, assignedToSubject: 'other' },
				manager
			)
		).toBe(false)
		expect(
			taskFitsWorkdayAuthority(
				{ ...task, assignedToSubject: 'other', dealId: otherId },
				manager
			)
		).toBe(true)
		expect(
			taskFitsWorkdayAuthority({ ...task, workspaceId: otherId }, manager)
		).toBe(false)
		expect(
			allowedWorkdayScopes({
				...permissions,
				role: 'TEAM_LEAD',
				dataScope: 'TEAM'
			})
		).toEqual(['MINE', 'TEAM'])
	})
})
