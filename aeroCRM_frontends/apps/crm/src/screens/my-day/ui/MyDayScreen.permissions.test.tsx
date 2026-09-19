import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import {
	forwardRef,
	useImperativeHandle,
	type PropsWithChildren
} from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import toast from 'react-hot-toast'
import type { CrmPermissions } from '@/entities/crm-access'
import type { WorkdayTask } from '@/entities/crm-workday'
import { resetSessionStore, useSessionStore } from '@/entities/session'
import {
	getWorkdayTask,
	listWorkdayTasks,
	listWorkdayTimeline,
	mutateWorkdayTask
} from '@/entities/crm-workday/api/workday.api'
import {
	entry,
	membershipId,
	page,
	task,
	workspaceId
} from '@/entities/crm-workday/model/workday.test-fixtures'
import {
	authenticatedRequest,
	AuthenticatedApiError
} from '@/shared/api/authenticated-http-client'
import {
	commandOwner,
	PendingCommandProvider
} from '@/shared/lib/pending-command'
import MyDayScreen from './MyDayScreen'
import PlannerPage, { metadata } from '@/app/(workspace)/planner/page'

let client: QueryClient
let permissions: CrmPermissions
const workspace = { workspaceId, canWrite: true }
// Deliberately keep the real permission hook AND its getter/parser. Mocking the
// getter's transport is necessary because the hook calls the module-local getter.
vi.mock('@/entities/crm-access', async () => ({
	...(await vi.importActual<typeof import('@/entities/crm-access')>(
		'@/entities/crm-access'
	)),
	useCrmWorkspaceAccess: () => workspace
}))
vi.mock('@/shared/api/authenticated-http-client', async () => ({
	...(await vi.importActual<
		typeof import('@/shared/api/authenticated-http-client')
	>('@/shared/api/authenticated-http-client')),
	authenticatedRequest: vi.fn()
}))
vi.mock('@/entities/crm-workday/api/workday.api', async () => ({
	...(await vi.importActual<
		typeof import('@/entities/crm-workday/api/workday.api')
	>('@/entities/crm-workday/api/workday.api')),
	getWorkdayTask: vi.fn(),
	listWorkdayTasks: vi.fn(),
	listWorkdayTimeline: vi.fn(),
	mutateWorkdayTask: vi.fn()
}))
vi.mock('@/entities/crm-team', async () => ({
	...(await vi.importActual<typeof import('@/entities/crm-team')>(
		'@/entities/crm-team'
	)),
	useAssigneeOptions: () => ({
		resolveBinding: () => ({
			subject: 'actor',
			membershipId,
			displayName: 'Иван',
			verifiedEmail: null,
			role: 'OWNER'
		}),
		loading: false
	}),
	useTeamOptions: () => ({ validSelection: true }),
	AssigneeSelect: () => null,
	TeamSelect: () => null
}))
vi.mock('./WorkdayPeopleFilters', () => ({
	WorkdayPeopleFilters: forwardRef(
		function PeopleFilterFixture(_props, ref) {
			useImperativeHandle(ref, () => ({ resolve: () => ({}) }))
			return null
		}
	)
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
const readOwner = () => {
	const state = useSessionStore.getState()
	return commandOwner(state.session?.userId, state.sessionRevision)
}
const Wrapper = ({ children }: PropsWithChildren) => {
	const state = useSessionStore()
	return (
		<QueryClientProvider client={client}>
			<PendingCommandProvider
				owner={commandOwner(state.session?.userId, state.sessionRevision)}
				readOwner={readOwner}
			>
				{children}
			</PendingCommandProvider>
		</QueryClientProvider>
	)
}
const deferred = <T,>() => {
	let resolve!: (value: T) => void
	let reject!: (error: Error) => void
	const promise = new Promise<T>((done, fail) => {
		resolve = done
		reject = fail
	})
	return { promise, resolve, reject }
}
const titleField = () => screen.getByLabelText('Название задачи')
const openTask = async () => {
	fireEvent.click(await screen.findByRole('button', { name: task.title }))
	await waitFor(() => {
		expect(titleField()).toHaveProperty('disabled', false)
		expect(titleField().closest('[hidden]')).toBeNull()
	})
}
const startRefresh = async () => {
	const response = deferred<CrmPermissions>()
	vi.mocked(authenticatedRequest).mockReturnValueOnce(response.promise)
	let pending!: Promise<void>
	await act(async () => {
		pending = client.refetchQueries({ queryKey: ['crm-permissions'] })
		await Promise.resolve()
	})
	await waitFor(() =>
		expect(titleField()).toHaveProperty('disabled', true)
	)
	return { ...response, pending }
}
beforeEach(() => {
	vi.resetAllMocks()
	workspace.workspaceId = workspaceId
	resetSessionStore()
	useSessionStore
		.getState()
		.setAuthenticated({ accessToken: 'token', userId: 'actor' })
	permissions = {
		schemaVersion: 1,
		workspaceId,
		subject: 'actor',
		role: 'OWNER',
		state: 'ACTIVE',
		dataScope: 'ALL',
		teamIds: [],
		permissions: ['sales:read', 'sales:write']
	}
	client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, refetchOnWindowFocus: false }
		}
	})
	Object.defineProperties(HTMLDialogElement.prototype, {
		showModal: {
			configurable: true,
			value: function (this: HTMLDialogElement) {
				this.open = true
			}
		},
		close: {
			configurable: true,
			value: function (this: HTMLDialogElement) {
				this.open = false
			}
		}
	})
	vi.mocked(authenticatedRequest).mockImplementation(async request => {
		if (request.url !== '/crm/access/permissions')
			throw new Error(`Unexpected test request ${request.url}`)
		return permissions
	})
	vi.mocked(listWorkdayTasks).mockImplementation(
		async (_token, request) => ({
			...page,
			page: request.page,
			pageSize: request.pageSize,
			items:
				!request.status || request.status === task.status ? [task] : [],
			total: !request.status || request.status === task.status ? 1 : 0
		})
	)
	vi.mocked(getWorkdayTask).mockResolvedValue(task)
	vi.mocked(listWorkdayTimeline).mockImplementation(
		async (_token, request) => ({
			schemaVersion: 1,
			page: request.page,
			pageSize: request.pageSize,
			total: 1,
			items: [entry]
		})
	)
})
afterEach(() => {
	cleanup()
	client.clear()
	resetSessionStore()
})

describe('MyDay actual permission query lifecycle', () => {
	it.each(['ACTIVE', 'READ_ONLY'] as const)(
		'opens a planner deep link with a current server-bound task read under %s access',
		async state => {
			permissions = {
				...permissions,
				state,
				permissions:
					state === 'READ_ONLY' ? ['sales:read'] : permissions.permissions
			}
			render(
				await PlannerPage({
					searchParams: Promise.resolve({
						task: task.id,
						workspaceId: 'untrusted-workspace'
					})
				}),
				{ wrapper: Wrapper }
			)
			await waitFor(() =>
				expect(titleField()).toHaveProperty('value', task.title)
			)
			await waitFor(() =>
				expect(titleField().closest('[hidden]')).toBeNull()
			)
			expect(titleField()).toHaveProperty(
				'disabled',
				state === 'READ_ONLY'
			)
			expect(getWorkdayTask).toHaveBeenCalledWith('token', {
				workspaceId,
				subject: 'actor',
				id: task.id
			})
			expect(mutateWorkdayTask).not.toHaveBeenCalled()
		}
	)
	it.each([
		undefined,
		'',
		'../private',
		'not-a-uuid',
		[task.id],
		[task.id, task.id]
	])(
		'ignores malformed or repeated deep-link task parameters: %s',
		async value => {
			render(
				await PlannerPage({
					searchParams: Promise.resolve({ task: value })
				}),
				{ wrapper: Wrapper }
			)
			await screen.findByRole('button', { name: task.title })
			expect(getWorkdayTask).not.toHaveBeenCalled()
			expect(screen.queryByLabelText('Название задачи')).toBeNull()
		}
	)
	it('does not read a linked task before permission verification or after a denied scope', async () => {
		const response = deferred<CrmPermissions>()
		vi.mocked(authenticatedRequest).mockReturnValue(response.promise)
		render(<MyDayScreen initialTaskId={task.id} />, { wrapper: Wrapper })
		expect(getWorkdayTask).not.toHaveBeenCalled()
		await act(async () =>
			response.resolve({ ...permissions, permissions: [] })
		)
		await screen.findByText(
			'Ваша роль не даёт доступа к задачам сотрудников.'
		)
		expect(getWorkdayTask).not.toHaveBeenCalled()
	})
	it('keeps a linked draft through same-scope refresh and does not reopen it after close', async () => {
		render(<MyDayScreen initialTaskId={task.id} />, { wrapper: Wrapper })
		await waitFor(() =>
			expect(titleField()).toHaveProperty('disabled', false)
		)
		fireEvent.change(titleField(), {
			target: { value: 'Черновик из напоминания' }
		})
		const before = titleField()
		const response = await startRefresh()
		await act(async () => {
			response.resolve(permissions)
			await response.pending
		})
		await waitFor(() =>
			expect(titleField()).toHaveProperty('disabled', false)
		)
		expect(titleField()).toBe(before)
		expect(titleField()).toHaveProperty('value', 'Черновик из напоминания')
		fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
		await waitFor(() =>
			expect(screen.queryByLabelText('Название задачи')).toBeNull()
		)
		await act(async () => {
			await client.refetchQueries({ queryKey: ['crm-permissions'] })
		})
		expect(screen.queryByLabelText('Название задачи')).toBeNull()
	})
	it.each(['session', 'workspace', 'scope'] as const)(
		'discards a linked task on a confirmed %s boundary without reopening it',
		async boundary => {
			const view = render(<MyDayScreen initialTaskId={task.id} />, {
				wrapper: Wrapper
			})
			await waitFor(() =>
				expect(titleField()).toHaveProperty('disabled', false)
			)
			fireEvent.change(titleField(), {
				target: { value: 'Приватный черновик ссылки' }
			})
			await act(async () => {
				if (boundary === 'session')
					useSessionStore.getState().setAuthenticated({
						accessToken: 'new-token',
						userId: 'actor'
					})
				else if (boundary === 'workspace') {
					workspace.workspaceId = '55555555-5555-4555-8555-555555555555'
					permissions = {
						...permissions,
						workspaceId: workspace.workspaceId
					}
					view.rerender(<MyDayScreen initialTaskId={task.id} />)
				} else {
					permissions = {
						...permissions,
						state: 'READ_ONLY',
						permissions: ['sales:read']
					}
					await client.refetchQueries({ queryKey: ['crm-permissions'] })
				}
			})
			await waitFor(() => expect(client.isFetching()).toBe(0))
			expect(screen.queryByLabelText('Название задачи')).toBeNull()
			expect(mutateWorkdayTask).not.toHaveBeenCalled()
		}
	)
	it('never displays a task outside the current workspace from a linked read', async () => {
		vi.mocked(getWorkdayTask).mockResolvedValue({
			...task,
			workspaceId: '55555555-5555-4555-8555-555555555555',
			title: 'Чужая задача'
		})
		render(<MyDayScreen initialTaskId={task.id} />, { wrapper: Wrapper })
		await screen.findByRole('button', { name: 'Повторить загрузку' })
		expect(screen.queryByLabelText('Название задачи')).toBeNull()
		expect(screen.queryByText('Чужая задача')).toBeNull()
	})
	it('shows the planner heading and metadata on the existing workday page', async () => {
		expect(metadata.title).toBe('Планировщик')
		render(<MyDayScreen />, { wrapper: Wrapper })
		expect(
			await screen.findByRole('heading', { level: 1, name: 'Планировщик' })
		).toBeTruthy()
		expect(screen.queryByRole('heading', { name: 'Мой день' })).toBeNull()
	})
	it('allows timezone filtering with READ_ONLY access without a task mutation', async () => {
		permissions = {
			...permissions,
			state: 'READ_ONLY',
			permissions: ['sales:read']
		}
		render(<MyDayScreen />, { wrapper: Wrapper })
		await screen.findByRole('button', { name: task.title })
		fireEvent.click(screen.getByText('Поиск и дополнительные фильтры'))
		const select = screen.getByRole('combobox', { name: 'Часовой пояс' })
		expect(select).toHaveProperty('disabled', false)
		fireEvent.change(select, { target: { value: 'Asia/Vladivostok' } })
		fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
		await waitFor(() =>
			expect(listWorkdayTasks).toHaveBeenCalledWith(
				'token',
				expect.objectContaining({ timeZone: 'Asia/Vladivostok' })
			)
		)
		expect(mutateWorkdayTask).not.toHaveBeenCalled()
		expect(
			screen.getByRole('button', { name: 'Новая задача' })
		).toHaveProperty('disabled', true)
	})
	it.each(['list', 'board', 'drawer'] as const)(
		'reopens completed tasks and repeats status changes from %s with a fresh command and current version',
		async surface => {
			let current: WorkdayTask = { ...task }
			const commands = new Set<string>()
			vi.mocked(getWorkdayTask).mockImplementation(async () => current)
			vi.mocked(listWorkdayTasks).mockImplementation(
				async (_token, request) => {
					const visible =
						!request.status || request.status === current.status
					return {
						...page,
						page: request.page,
						pageSize: request.pageSize,
						items: visible ? [current] : [],
						total: visible ? 1 : 0,
						counts: {
							OPEN: 0,
							IN_PROGRESS: 0,
							COMPLETED: 0,
							CANCELLED: 0,
							[current.status]: 1
						}
					}
				}
			)
			vi.mocked(mutateWorkdayTask).mockImplementation(
				async (_token, command) => {
					const mutation = command.mutation
					expect(mutation.kind).toBe('status')
					if (mutation.kind !== 'status')
						throw new Error('Expected status command')
					expect(commands.has(command.commandId)).toBe(false)
					expect(mutation.expectedVersion).toBe(current.version)
					commands.add(command.commandId)
					current = {
						...current,
						status: mutation.status,
						version: current.version + 1,
						completedAt: ['COMPLETED', 'CANCELLED'].includes(
							mutation.status
						)
							? task.dueAt
							: null
					}
					return current
				}
			)
			render(<MyDayScreen />, { wrapper: Wrapper })
			await screen.findByRole('button', { name: task.title })
			if (surface === 'board')
				fireEvent.click(screen.getByRole('button', { name: 'Доска' }))
			if (surface === 'drawer') await openTask()
			const changes = [
				['IN_PROGRESS', 'В работе'],
				['COMPLETED', 'Готово'],
				['OPEN', 'К выполнению'],
				['COMPLETED', 'Готово'],
				['IN_PROGRESS', 'В работе'],
				['COMPLETED', 'Готово'],
				['OPEN', 'К выполнению']
			] as const
			for (const [index, [status, label]] of changes.entries()) {
				const control =
					surface === 'drawer'
						? screen.getByRole('button', { name: label })
						: await screen.findByLabelText(`Статус задачи «${task.title}»`)
				await waitFor(() =>
					expect(control).toHaveProperty('disabled', false)
				)
				if (surface === 'drawer') fireEvent.click(control)
				else fireEvent.change(control, { target: { value: status } })
				await waitFor(() =>
					expect(toast.success).toHaveBeenCalledTimes(index + 1)
				)
				await waitFor(() => expect(client.isFetching()).toBe(0))
				expect(current.status).toBe(status)
				expect(current.dueAt).toBe(task.dueAt)
				expect(current.assignedToSubject).toBe(task.assignedToSubject)
				expect(current.assignedToMembershipId).toBe(
					task.assignedToMembershipId
				)
			}
			expect(commands.size).toBe(changes.length)
			expect(toast.error).not.toHaveBeenCalled()
		}
	)
	it.each(['list', 'board', 'drawer'] as const)(
		'offers a blank new draft only after confirmed completion from %s with real permission observers',
		async surface => {
			const completed = {
				...task,
				status: 'COMPLETED' as const,
				version: 2,
				completedAt: task.dueAt
			}
			vi.mocked(mutateWorkdayTask).mockResolvedValue(completed)
			render(<MyDayScreen />, { wrapper: Wrapper })
			await screen.findByRole('button', { name: task.title })
			if (surface === 'board')
				fireEvent.click(screen.getByRole('button', { name: 'Доска' }))
			if (surface === 'drawer') {
				await openTask()
				fireEvent.click(screen.getByRole('button', { name: 'Готово' }))
			} else {
				const status = await screen.findByLabelText(
					`Статус задачи «${task.title}»`
				)
				await waitFor(() =>
					expect(status).toHaveProperty('disabled', false)
				)
				fireEvent.change(status, { target: { value: 'COMPLETED' } })
			}
			const next = await screen.findByRole('button', {
				name: 'Следующая задача'
			})
			await waitFor(() => expect(next).toHaveProperty('disabled', false))
			expect(mutateWorkdayTask).toHaveBeenCalledTimes(1)
			fireEvent.click(next)
			await waitFor(() => expect(titleField()).toHaveProperty('value', ''))
			expect(screen.getByLabelText('Срок выполнения')).toHaveProperty(
				'value',
				''
			)
			expect(screen.getByLabelText('Связь со сделкой')).toHaveProperty(
				'value',
				'standalone'
			)
			await waitFor(() => expect(client.isFetching()).toBe(0))
			await waitFor(() =>
				expect(screen.getAllByRole('dialog')).toHaveLength(1)
			)
			expect(mutateWorkdayTask).toHaveBeenCalledTimes(1)
			const requests = vi.mocked(authenticatedRequest).mock.calls.length
			await act(async () => {
				await new Promise(resolve => setTimeout(resolve, 50))
			})
			expect(authenticatedRequest).toHaveBeenCalledTimes(requests)
		}
	)
	it('does not offer a follow-up for an unknown quick completion until replay confirms that same command', async () => {
		vi.mocked(mutateWorkdayTask).mockRejectedValueOnce(
			new AuthenticatedApiError('temporary', 'Unknown result')
		)
		vi.mocked(mutateWorkdayTask).mockResolvedValue({
			...task,
			status: 'COMPLETED',
			version: 2,
			completedAt: task.dueAt
		})
		render(<MyDayScreen />, { wrapper: Wrapper })
		await screen.findByRole('button', { name: task.title })
		fireEvent.change(
			screen.getByLabelText(`Статус задачи «${task.title}»`),
			{ target: { value: 'COMPLETED' } }
		)
		const retry = await screen.findByRole('button', {
			name: 'Проверить сохранение'
		})
		expect(
			screen.queryByRole('region', { name: 'Следующий шаг' })
		).toBeNull()
		const original = vi.mocked(mutateWorkdayTask).mock.calls[0][1]
		fireEvent.click(retry)
		await screen.findByRole('button', { name: 'Следующая задача' })
		expect(vi.mocked(mutateWorkdayTask).mock.calls[1][1]).toBe(original)
	})
	it('settles real stale permission observers without a collection mount/refetch loop', async () => {
		render(<MyDayScreen />, { wrapper: Wrapper })
		await screen.findByRole('button', { name: task.title })
		await waitFor(() => expect(client.isFetching()).toBe(0))
		const calls = vi.mocked(authenticatedRequest).mock.calls.length
		expect(calls).toBeLessThan(12)
		await act(async () => {
			await new Promise(resolve => setTimeout(resolve, 80))
		})
		expect(authenticatedRequest).toHaveBeenCalledTimes(calls)
		expect(screen.getByRole('button', { name: task.title })).toBeTruthy()
		expect(screen.getByText(/^Данные на /).textContent).toContain(
			'Europe/Moscow'
		)
		expect(screen.getByText(/^Данные на /).textContent).toContain(
			'Обновить'
		)
	})
	it.each(['list', 'board'] as const)(
		'recovers an existing task drawer command from %s after route navigation instead of allowing a competing quick command',
		async viewMode => {
			vi.mocked(mutateWorkdayTask).mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', 'Unknown result')
			)
			vi.mocked(mutateWorkdayTask).mockResolvedValue({
				...task,
				title: 'Исходное сохранение',
				version: 2
			})
			const view = render(<MyDayScreen />, { wrapper: Wrapper })
			await openTask()
			fireEvent.change(titleField(), {
				target: { value: 'Исходное сохранение' }
			})
			fireEvent.click(
				screen.getByRole('button', { name: 'Сохранить название и срок' })
			)
			await screen.findByRole('button', { name: 'Проверить результат' })
			const original = vi.mocked(mutateWorkdayTask).mock.calls[0][1]
			view.rerender(<></>)
			view.rerender(<MyDayScreen />)
			await screen.findByRole('button', { name: task.title })
			if (viewMode === 'board')
				fireEvent.click(screen.getByRole('button', { name: 'Доска' }))
			const recover = await screen.findByRole('button', {
				name: 'Проверить сохранение'
			})
			const status = screen.getByLabelText(`Статус задачи «${task.title}»`)
			expect(status).toHaveProperty('disabled', true)
			fireEvent.change(status, { target: { value: 'IN_PROGRESS' } })
			expect(mutateWorkdayTask).toHaveBeenCalledTimes(1)
			if (viewMode === 'board')
				expect(
					screen.getByRole('button', {
						name: `Переместить задачу «${task.title}»`
					})
				).toHaveProperty('disabled', true)
			fireEvent.click(recover)
			fireEvent.click(
				await screen.findByRole('button', { name: 'Проверить результат' })
			)
			await waitFor(() =>
				expect(mutateWorkdayTask).toHaveBeenCalledTimes(2)
			)
			expect(vi.mocked(mutateWorkdayTask).mock.calls[1][1]).toBe(original)
		}
	)
	it('does not announce a view switch that an unresolved quick command refused', async () => {
		vi.mocked(mutateWorkdayTask).mockRejectedValue(
			new AuthenticatedApiError('temporary', 'Unknown result')
		)
		render(<MyDayScreen />, { wrapper: Wrapper })
		await screen.findByRole('button', { name: task.title })
		fireEvent.change(
			screen.getByLabelText(`Статус задачи «${task.title}»`),
			{ target: { value: 'IN_PROGRESS' } }
		)
		await screen.findByRole('button', { name: 'Проверить сохранение' })
		vi.mocked(toast).mockClear()
		fireEvent.click(screen.getByRole('button', { name: 'Доска' }))
		expect(toast).not.toHaveBeenCalledWith('Доска задач')
		expect(
			screen.queryByRole('region', { name: 'Доска задач' })
		).toBeNull()
	})
	it('keeps a task editor mounted but concealed/inert during refresh, retaining its exact draft', async () => {
		render(<MyDayScreen />, { wrapper: Wrapper })
		await openTask()
		fireEvent.change(titleField(), {
			target: { value: 'Несохранённый результат встречи' }
		})
		const before = titleField()
		const response = await startRefresh()
		expect(titleField()).toBe(before)
		expect(titleField().closest('[hidden]')).not.toBeNull()
		expect(titleField().closest('[inert]')).not.toBeNull()
		expect(mutateWorkdayTask).not.toHaveBeenCalled()
		await act(async () => {
			response.resolve(permissions)
			await response.pending
		})
		await waitFor(() =>
			expect(titleField()).toHaveProperty('disabled', false)
		)
		expect(titleField()).toBe(before)
		expect(titleField()).toHaveProperty(
			'value',
			'Несохранённый результат встречи'
		)
		expect(titleField().closest('[hidden]')).toBeNull()
	})
	it('keeps a creation draft mounted through the real background permission refresh', async () => {
		render(<MyDayScreen />, { wrapper: Wrapper })
		await screen.findByRole('button', { name: task.title })
		fireEvent.click(screen.getByRole('button', { name: 'Новая задача' }))
		await waitFor(() =>
			expect(titleField()).toHaveProperty('disabled', false)
		)
		fireEvent.change(titleField(), {
			target: { value: 'Черновик новой задачи' }
		})
		const before = titleField()
		const response = await startRefresh()
		expect(titleField()).toBe(before)
		await act(async () => {
			response.resolve(permissions)
			await response.pending
		})
		await waitFor(() =>
			expect(titleField()).toHaveProperty('disabled', false)
		)
		expect(titleField()).toHaveProperty('value', 'Черновик новой задачи')
	})
	it.each(['forbidden', 'unauthorized'] as const)(
		'discards private data after a real %s permission response',
		async kind => {
			render(<MyDayScreen />, { wrapper: Wrapper })
			await openTask()
			fireEvent.change(titleField(), {
				target: { value: 'Приватный черновик' }
			})
			const response = await startRefresh()
			await act(async () => {
				response.reject(new AuthenticatedApiError(kind, 'Access revoked'))
				await response.pending
			})
			await screen.findByText('Не удалось проверить права на задачи.')
			expect(screen.queryByLabelText('Название задачи')).toBeNull()
			expect(screen.queryByRole('button', { name: task.title })).toBeNull()
		}
	)
	it('does not carry a draft through a confirmed scope change to READ_ONLY', async () => {
		render(<MyDayScreen />, { wrapper: Wrapper })
		await openTask()
		fireEvent.change(titleField(), { target: { value: 'До смены прав' } })
		const response = await startRefresh()
		permissions = {
			...permissions,
			state: 'READ_ONLY',
			permissions: ['sales:read']
		}
		await act(async () => {
			response.resolve(permissions)
			await response.pending
		})
		await screen.findByRole('button', { name: task.title })
		expect(screen.queryByLabelText('Название задачи')).toBeNull()
		expect(
			screen.getByRole('button', { name: 'Новая задача' })
		).toHaveProperty('disabled', true)
		await openTaskReadonly()
		expect(titleField()).toHaveProperty('value', task.title)
		expect(titleField()).toHaveProperty('disabled', true)
	})
	it('refreshes tasks and the workspace-scoped Inbox summary using confirmed access', async () => {
		render(<MyDayScreen />, { wrapper: Wrapper })
		await screen.findByRole('button', { name: task.title })
		const invalidate = vi.spyOn(client, 'invalidateQueries')
		fireEvent.click(screen.getByRole('button', { name: 'Обновить' }))
		await waitFor(() =>
			expect(invalidate).toHaveBeenCalledWith(
				{ queryKey: ['crm-inbox', workspaceId], refetchType: 'active' },
				{ throwOnError: true }
			)
		)
	})
})
const openTaskReadonly = async () => {
	fireEvent.click(screen.getByRole('button', { name: task.title }))
	await waitFor(() => expect(titleField().closest('[hidden]')).toBeNull())
}
