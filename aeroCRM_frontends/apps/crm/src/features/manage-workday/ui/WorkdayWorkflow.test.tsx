import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within
} from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import toast from 'react-hot-toast'
import {
	getCrmPermissions,
	type CrmPermissions
} from '@/entities/crm-access'
import {
	getWorkdayTask,
	listWorkdayTimeline,
	mutateWorkdayTask
} from '@/entities/crm-workday/api/workday.api'
import {
	entry,
	membershipId,
	otherId,
	task,
	taskId,
	workspaceId
} from '@/entities/crm-workday/model/workday.test-fixtures'
import type { WorkdayTask } from '@/entities/crm-workday'
import {
	useAssigneeOptions,
	useTeamOptions,
	type AssigneeOption
} from '@/entities/crm-team'
import {
	getSalesDeal,
	listSalesDeals,
	type SalesDeal
} from '@/entities/sales'
import { resetSessionStore, useSessionStore } from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import {
	commandOwner,
	PendingCommandProvider
} from '@/shared/lib/pending-command'
import { WorkdayTaskDrawer } from './WorkdayTaskDrawer'
import { WorkdayCreateTaskDrawer } from './WorkdayCreateTaskDrawer'
import { taskLocalDate } from '../model/workday-form'

let client: QueryClient
let workspace: { workspaceId: string; canWrite: boolean }
let permissions: CrmPermissions
let currentTask: WorkdayTask
let directory: AssigneeOption[]
const creator: AssigneeOption = {
	subject: 'actor',
	membershipId,
	displayName: 'Иван Иванов',
	verifiedEmail: null,
	role: 'OWNER'
}
const colleague: AssigneeOption = {
	subject: 'colleague',
	membershipId: otherId,
	displayName: 'Мария Петрова',
	verifiedEmail: null,
	role: 'MANAGER'
}
const deal: SalesDeal = {
	id: otherId,
	workspaceId,
	version: 2,
	title: 'Встреча по сделке',
	currency: 'RUB',
	amountMinor: 0,
	pipelineId: membershipId,
	stageId: taskId,
	status: 'OPEN',
	contactId: taskId,
	contactName: 'Клиент',
	assignedToSubject: 'actor',
	teamId: null,
	archivedAt: null,
	createdAt: task.createdAt,
	updatedAt: task.updatedAt,
	nextTask: null
}
vi.mock('@/entities/crm-access', async () => ({
	...(await vi.importActual<typeof import('@/entities/crm-access')>(
		'@/entities/crm-access'
	)),
	useCrmWorkspaceAccess: () => workspace,
	useCrmPermissions: () => ({
		data: permissions,
		isSuccess: true,
		isFetching: false,
		isError: false
	}),
	getCrmPermissions: vi.fn()
}))
vi.mock('@/entities/crm-workday/api/workday.api', async () => ({
	...(await vi.importActual<
		typeof import('@/entities/crm-workday/api/workday.api')
	>('@/entities/crm-workday/api/workday.api')),
	getWorkdayTask: vi.fn(),
	listWorkdayTimeline: vi.fn(),
	mutateWorkdayTask: vi.fn()
}))
vi.mock('@/entities/crm-team', async () => ({
	...(await vi.importActual<typeof import('@/entities/crm-team')>(
		'@/entities/crm-team'
	)),
	useAssigneeOptions: vi.fn(),
	useTeamOptions: vi.fn()
}))
vi.mock('@/entities/sales', async () => ({
	...(await vi.importActual<typeof import('@/entities/sales')>(
		'@/entities/sales'
	)),
	getSalesDeal: vi.fn(),
	listSalesDeals: vi.fn()
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))

const owner = () => {
	const state = useSessionStore.getState()
	return commandOwner(state.session?.userId, state.sessionRevision)
}
const Wrapper = ({ children }: PropsWithChildren) => {
	const state = useSessionStore()
	return (
		<QueryClientProvider client={client}>
			<PendingCommandProvider
				owner={commandOwner(state.session?.userId, state.sessionRevision)}
				readOwner={owner}
			>
				{children}
			</PendingCommandProvider>
		</QueryClientProvider>
	)
}
const deferred = <T,>() => {
	let resolve!: (value: T) => void
	const promise = new Promise<T>(done => {
		resolve = done
	})
	return { promise, resolve }
}
const refresh = async () => {
	await act(async () => {
		await client.invalidateQueries({ queryKey: ['crm-workday'] })
		// React Query schedules observer notifications after the fetch promise.
		await new Promise(resolve => setTimeout(resolve, 0))
	})
}
const titleField = () => screen.getByLabelText('Название задачи')
const editButton = () =>
	screen.getByRole('button', { name: 'Сохранить название и срок' })
const createButton = () =>
	screen.getByRole('button', { name: 'Создать задачу' })
const loadTask = async () => {
	await waitFor(() =>
		expect(titleField()).toHaveProperty('disabled', false)
	)
	return titleField()
}
const fillCreate = () => {
	fireEvent.change(titleField(), {
		target: { value: 'Подготовить встречу' }
	})
	fireEvent.change(screen.getByLabelText('Срок выполнения'), {
		target: { value: taskLocalDate(task.dueAt) }
	})
}
const selectDeal = async () => {
	fireEvent.change(screen.getByLabelText('Связь со сделкой'), {
		target: { value: 'deal' }
	})
	await waitFor(() =>
		expect(screen.getByLabelText('Связанная сделка')).toHaveProperty(
			'disabled',
			false
		)
	)
	fireEvent.change(screen.getByLabelText('Связанная сделка'), {
		target: { value: deal.id }
	})
}

beforeEach(() => {
	vi.resetAllMocks()
	resetSessionStore()
	useSessionStore
		.getState()
		.setAuthenticated({ accessToken: 'token', userId: 'actor' })
	workspace = { workspaceId, canWrite: true }
	permissions = {
		schemaVersion: 1,
		workspaceId,
		subject: 'actor',
		role: 'OWNER',
		state: 'ACTIVE',
		dataScope: 'ALL',
		teamIds: [otherId],
		permissions: ['sales:read', 'sales:write']
	}
	currentTask = { ...task, dueAt: '2026-09-07T12:00:42.123Z' }
	directory = [colleague, creator]
	client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, refetchOnWindowFocus: false },
			mutations: { retry: false }
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
	vi.mocked(getCrmPermissions).mockImplementation(async () => permissions)
	vi.mocked(getWorkdayTask).mockImplementation(async () => currentTask)
	vi.mocked(listWorkdayTimeline).mockImplementation(
		async (_token, { page, pageSize }) => ({
			schemaVersion: 1,
			page,
			pageSize,
			total: 1,
			items: page === 1 ? [entry] : []
		})
	)
	vi.mocked(mutateWorkdayTask).mockImplementation(
		async (_token, command) => {
			const m = command.mutation
			currentTask = {
				...currentTask,
				version: m.kind === 'create' ? 1 : m.expectedVersion + 1
			}
			if (m.kind === 'edit' || m.kind === 'create')
				currentTask = {
					...currentTask,
					title: m.title.trim(),
					dueAt: m.dueAt
				}
			if (m.kind === 'status')
				currentTask = {
					...currentTask,
					status: m.status,
					completedAt: ['COMPLETED', 'CANCELLED'].includes(m.status)
						? task.dueAt
						: null
				}
			if (m.kind === 'assignee' || m.kind === 'create')
				currentTask = {
					...currentTask,
					assignedToSubject: m.assignee.subject,
					assignedToMembershipId: m.assignee.membershipId
				}
			if (m.kind === 'create')
				currentTask = {
					...currentTask,
					dealId: m.dealId,
					teamId: m.dealId ? deal.teamId : m.teamId
				}
			return currentTask
		}
	)
	vi.mocked(useAssigneeOptions).mockImplementation((context, filters) => {
		const selected =
			directory.find(
				option => option.subject === filters?.selectedSubject
			) ?? null
		return {
			scopeKey: 'directory',
			data: {
				schemaVersion: 1,
				workspaceId,
				subject: context.subject!,
				page: 1,
				pageSize: 20,
				total: directory.length,
				items: directory,
				selected
			},
			page: 1,
			pageSize: 20,
			search: '',
			selected,
			loading: false,
			error: false,
			enabled: context.canRead,
			isCurrent: context.isCurrent,
			resolveBinding: binding => {
				if (
					!context.isCurrent() ||
					binding.membershipId === null ||
					(binding.membershipId === undefined &&
						binding.subject !== context.subject)
				)
					return null
				return (
					directory.find(
						item =>
							item.subject === binding.subject &&
							(binding.membershipId === undefined ||
								item.membershipId === binding.membershipId)
					) ?? null
				)
			},
			refetch: vi.fn(),
			setPage: vi.fn(),
			setSearch: vi.fn()
		}
	})
	vi.mocked(useTeamOptions).mockImplementation((_context, selectedId) => ({
		data: undefined,
		page: 1,
		loading: false,
		error: false,
		enabled: false,
		validSelection: !selectedId,
		refetch: vi.fn(),
		setPage: vi.fn()
	}))
	vi.mocked(listSalesDeals).mockImplementation(
		async (_token, _workspace, page, pageSize) => ({
			schemaVersion: 1,
			page,
			pageSize,
			total: 1,
			items: [deal]
		})
	)
	vi.mocked(getSalesDeal).mockResolvedValue(deal)
})
afterEach(() => {
	cleanup()
	client.clear()
	resetSessionStore()
})

describe('Workday task detail and commands', () => {
	it('offers an optional follow-up only after confirmed completion, preserving the old assignment', async () => {
		currentTask = {
			...currentTask,
			dealId: deal.id,
			assignedToSubject: colleague.subject,
			assignedToMembershipId: colleague.membershipId
		}
		const onCreateNextTask = vi.fn()
		render(
			<WorkdayTaskDrawer
				taskId={taskId}
				onClose={vi.fn()}
				onCreateNextTask={onCreateNextTask}
			/>,
			{ wrapper: Wrapper }
		)
		await loadTask()
		fireEvent.click(screen.getByRole('button', { name: 'Готово' }))
		const next = await screen.findByRole('button', {
			name: 'Следующая задача'
		})
		await waitFor(() => expect(next).toHaveProperty('disabled', false))
		expect(mutateWorkdayTask).toHaveBeenCalledTimes(1)
		expect(vi.mocked(mutateWorkdayTask).mock.calls[0][1].mutation).toEqual(
			{
				kind: 'status',
				id: taskId,
				expectedVersion: 1,
				status: 'COMPLETED'
			}
		)
		expect(currentTask.assignedToSubject).toBe(colleague.subject)
		expect(currentTask.assignedToMembershipId).toBe(colleague.membershipId)
		expect(getSalesDeal).not.toHaveBeenCalled()
		expect(onCreateNextTask).not.toHaveBeenCalled()
		fireEvent.click(next)
		await waitFor(() =>
			expect(onCreateNextTask).toHaveBeenCalledWith(deal)
		)
		expect(getSalesDeal).toHaveBeenCalledWith(
			'token',
			workspaceId,
			deal.id
		)
		expect(mutateWorkdayTask).toHaveBeenCalledTimes(1)
	})
	it('does not propose another task for an unknown result; successful replay offers once and dismissal survives refresh', async () => {
		vi.mocked(mutateWorkdayTask).mockRejectedValueOnce(
			new AuthenticatedApiError('temporary', 'Результат неизвестен')
		)
		render(
			<WorkdayTaskDrawer
				taskId={taskId}
				onClose={vi.fn()}
				onCreateNextTask={vi.fn()}
			/>,
			{ wrapper: Wrapper }
		)
		await loadTask()
		fireEvent.click(screen.getByRole('button', { name: 'Готово' }))
		const retry = await screen.findByRole('button', {
			name: 'Проверить результат'
		})
		expect(
			screen.queryByRole('region', { name: 'Следующий шаг' })
		).toBeNull()
		const original = vi.mocked(mutateWorkdayTask).mock.calls[0][1]
		fireEvent.click(retry)
		await screen.findByRole('button', { name: 'Следующая задача' })
		expect(vi.mocked(mutateWorkdayTask).mock.calls[1][1]).toBe(original)
		fireEvent.click(screen.getByRole('button', { name: 'Не сейчас' }))
		await refresh()
		expect(
			screen.queryByRole('region', { name: 'Следующий шаг' })
		).toBeNull()
		expect(currentTask.status).toBe('COMPLETED')
		expect(mutateWorkdayTask).toHaveBeenCalledTimes(2)
	})
	it('does not infer a completion from viewing or editing an already completed task', async () => {
		currentTask = {
			...currentTask,
			status: 'COMPLETED',
			completedAt: task.dueAt
		}
		render(
			<WorkdayTaskDrawer
				taskId={taskId}
				onClose={vi.fn()}
				onCreateNextTask={vi.fn()}
			/>,
			{ wrapper: Wrapper }
		)
		await loadTask()
		expect(
			screen.queryByRole('region', { name: 'Следующий шаг' })
		).toBeNull()
		fireEvent.change(titleField(), {
			target: { value: 'Уточнение выполненной задачи' }
		})
		fireEvent.click(editButton())
		await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
		expect(
			screen.queryByRole('region', { name: 'Следующий шаг' })
		).toBeNull()
	})
	it('edits with current CAS and preserves unchanged original due precision and assignment', async () => {
		render(
			<WorkdayTaskDrawer
				taskId={taskId}
				onClose={vi.fn()}
				timeZone="Europe/Moscow"
			/>,
			{ wrapper: Wrapper }
		)
		await loadTask()
		expect(screen.getByText(/Часовой пояс устройства:/)).toBeTruthy()
		fireEvent.change(titleField(), { target: { value: 'Новое название' } })
		fireEvent.click(editButton())
		await waitFor(() => expect(mutateWorkdayTask).toHaveBeenCalledTimes(1))
		expect(vi.mocked(mutateWorkdayTask).mock.calls[0][1].mutation).toEqual(
			{
				kind: 'edit',
				id: taskId,
				expectedVersion: 1,
				title: 'Новое название',
				dueAt: '2026-09-07T12:00:42.123Z'
			}
		)
		await waitFor(() =>
			expect(editButton()).toHaveProperty('disabled', true)
		)
		expect(getCrmPermissions).toHaveBeenCalledWith('token', workspaceId)
		expect(currentTask.assignedToMembershipId).toBe(membershipId)
	})
	it('sends status as a separate CAS command without manufacturing title/date edits', async () => {
		render(<WorkdayTaskDrawer taskId={taskId} onClose={vi.fn()} />, {
			wrapper: Wrapper
		})
		await loadTask()
		fireEvent.click(screen.getByRole('button', { name: 'В работе' }))
		await waitFor(() => expect(mutateWorkdayTask).toHaveBeenCalledTimes(1))
		expect(vi.mocked(mutateWorkdayTask).mock.calls[0][1].mutation).toEqual(
			{
				kind: 'status',
				id: taskId,
				expectedVersion: 1,
				status: 'IN_PROGRESS'
			}
		)
	})
	it('keeps historical null membership until an explicit bound assignee is chosen', async () => {
		currentTask = { ...currentTask, assignedToMembershipId: null }
		render(<WorkdayTaskDrawer taskId={taskId} onClose={vi.fn()} />, {
			wrapper: Wrapper
		})
		await loadTask()
		expect(
			screen.getByRole('button', { name: 'Назначить ответственного' })
		).toHaveProperty('disabled', true)
		fireEvent.change(titleField(), {
			target: { value: 'Без смены сотрудника' }
		})
		fireEvent.click(editButton())
		await waitFor(() => expect(mutateWorkdayTask).toHaveBeenCalledTimes(1))
		await waitFor(() =>
			expect(titleField()).toHaveProperty('disabled', false)
		)
		expect(currentTask.assignedToMembershipId).toBeNull()
		fireEvent.change(screen.getByLabelText('Ответственный'), {
			target: { value: colleague.membershipId }
		})
		expect(
			screen.getByRole('button', { name: 'В работе' })
		).toHaveProperty('disabled', true)
		fireEvent.click(
			screen.getByRole('button', { name: 'Назначить ответственного' })
		)
		await waitFor(() => expect(mutateWorkdayTask).toHaveBeenCalledTimes(2))
		expect(vi.mocked(mutateWorkdayTask).mock.calls[1][1].mutation).toEqual(
			{
				kind: 'assignee',
				id: taskId,
				expectedVersion: 2,
				assignee: {
					subject: colleague.subject,
					membershipId: colleague.membershipId
				}
			}
		)
	})
	it('allows READ_ONLY task and server-paginated history, but no mutation', async () => {
		workspace.canWrite = false
		permissions = {
			...permissions,
			state: 'READ_ONLY',
			permissions: ['sales:read']
		}
		vi.mocked(listWorkdayTimeline).mockImplementation(
			async (_token, { page, pageSize }) => ({
				schemaVersion: 1,
				page,
				pageSize,
				total: 26,
				items: [entry]
			})
		)
		render(<WorkdayTaskDrawer taskId={taskId} onClose={vi.fn()} />, {
			wrapper: Wrapper
		})
		await screen.findByDisplayValue(currentTask.title)
		expect(titleField()).toHaveProperty('disabled', true)
		expect(editButton()).toHaveProperty('disabled', true)
		expect(screen.getByText(/Режим чтения/)).toBeTruthy()
		const pager = await screen.findByRole('navigation', {
			name: 'Страницы истории'
		})
		fireEvent.click(within(pager).getByRole('button', { name: 'Далее' }))
		await waitFor(() =>
			expect(listWorkdayTimeline).toHaveBeenLastCalledWith('token', {
				workspaceId,
				subject: 'actor',
				id: taskId,
				page: 2,
				pageSize: 25
			})
		)
		expect(mutateWorkdayTask).not.toHaveBeenCalled()
	})
	it('retains a dirty draft through a temporary read failure, then requires deliberate conflict reload', async () => {
		render(<WorkdayTaskDrawer taskId={taskId} onClose={vi.fn()} />, {
			wrapper: Wrapper
		})
		await loadTask()
		fireEvent.change(titleField(), {
			target: { value: 'Несохранённый текст' }
		})
		vi.mocked(getWorkdayTask).mockRejectedValueOnce(
			new AuthenticatedApiError('temporary', 'offline')
		)
		await refresh()
		expect(titleField()).toHaveProperty('value', 'Несохранённый текст')
		expect(editButton()).toHaveProperty('disabled', true)
		currentTask = {
			...currentTask,
			title: 'Изменение коллеги',
			version: 2
		}
		fireEvent.click(
			screen.getByRole('button', {
				name: 'Повторить загрузку'
			})
		)
		await screen.findByRole('button', {
			name: 'Загрузить актуальную задачу'
		})
		expect(titleField()).toHaveProperty('value', 'Несохранённый текст')
		expect(editButton()).toHaveProperty('disabled', true)
		fireEvent.click(
			screen.getByRole('button', { name: 'Загрузить актуальную задачу' })
		)
		await waitFor(() =>
			expect(titleField()).toHaveProperty('value', 'Изменение коллеги')
		)
		expect(mutateWorkdayTask).not.toHaveBeenCalled()
	})
	it('does not silently rebase an explicit assignee draft onto a newer CAS snapshot', async () => {
		render(<WorkdayTaskDrawer taskId={taskId} onClose={vi.fn()} />, {
			wrapper: Wrapper
		})
		await loadTask()
		fireEvent.change(screen.getByLabelText('Ответственный'), {
			target: { value: colleague.membershipId }
		})
		currentTask = {
			...currentTask,
			version: 2,
			title: 'Изменено на сервере'
		}
		await refresh()
		expect(
			screen.getByRole('button', { name: 'Назначить ответственного' })
		).toHaveProperty('disabled', true)
		expect(
			screen.getByRole('button', { name: 'Загрузить актуальную задачу' })
		).toHaveProperty('disabled', false)
	})
	it('adopts a newer pristine server snapshot without changing a dirty title', async () => {
		render(<WorkdayTaskDrawer taskId={taskId} onClose={vi.fn()} />, {
			wrapper: Wrapper
		})
		await loadTask()
		currentTask = {
			...currentTask,
			title: 'Актуальная задача',
			version: 3
		}
		await refresh()
		expect(titleField()).toHaveProperty('value', 'Актуальная задача')
		fireEvent.change(titleField(), { target: { value: 'Новый черновик' } })
		fireEvent.click(editButton())
		await waitFor(() => expect(mutateWorkdayTask).toHaveBeenCalledTimes(1))
		expect(
			vi.mocked(mutateWorkdayTask).mock.calls[0][1].mutation
		).toMatchObject({ expectedVersion: 3 })
	})
	it('locks unknown commands and retries exactly the original immutable command, including after drawer remount', async () => {
		vi.mocked(mutateWorkdayTask).mockRejectedValueOnce(
			new AuthenticatedApiError('temporary', 'Результат неизвестен')
		)
		const onClose = vi.fn()
		const view = render(
			<WorkdayTaskDrawer taskId={taskId} onClose={onClose} />,
			{ wrapper: Wrapper }
		)
		await loadTask()
		fireEvent.change(titleField(), {
			target: { value: 'Исходная команда' }
		})
		fireEvent.click(editButton())
		await screen.findByRole('button', { name: 'Проверить результат' })
		const captured = vi.mocked(mutateWorkdayTask).mock.calls[0][1]
		expect(titleField()).toHaveProperty('disabled', true)
		fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
		expect(onClose).not.toHaveBeenCalled()
		view.rerender(<></>)
		view.rerender(<WorkdayTaskDrawer taskId={taskId} onClose={onClose} />)
		fireEvent.click(
			await screen.findByRole('button', { name: 'Проверить результат' })
		)
		await waitFor(() => expect(mutateWorkdayTask).toHaveBeenCalledTimes(2))
		expect(vi.mocked(mutateWorkdayTask).mock.calls[1][1]).toBe(captured)
		expect(Object.isFrozen(captured.mutation)).toBe(true)
		await waitFor(() =>
			expect(titleField()).toHaveProperty('value', 'Исходная команда')
		)
	})
	it.each(['unauthorized', 'forbidden', 'notFound'] as const)(
		'hides the task/draft on %s instead of retaining a sensitive stale view',
		async kind => {
			render(<WorkdayTaskDrawer taskId={taskId} onClose={vi.fn()} />, {
				wrapper: Wrapper
			})
			await loadTask()
			fireEvent.change(titleField(), {
				target: { value: 'Приватный черновик' }
			})
			vi.mocked(getWorkdayTask).mockRejectedValueOnce(
				new AuthenticatedApiError(kind, 'denied')
			)
			await refresh()
			await waitFor(() =>
				expect(screen.queryByLabelText('Название задачи')).not.toBeTruthy()
			)
			expect(
				screen.queryByDisplayValue('Приватный черновик')
			).not.toBeTruthy()
		}
	)
	it('clears old draft immediately on task switch and does not carry it into the new detail', async () => {
		const view = render(
			<WorkdayTaskDrawer taskId={taskId} onClose={vi.fn()} />,
			{ wrapper: Wrapper }
		)
		await loadTask()
		fireEvent.change(titleField(), { target: { value: 'Старая задача' } })
		const delayed = deferred<WorkdayTask>()
		vi.mocked(getWorkdayTask).mockReturnValueOnce(delayed.promise)
		view.rerender(<WorkdayTaskDrawer taskId={otherId} onClose={vi.fn()} />)
		expect(screen.queryByLabelText('Название задачи')).not.toBeTruthy()
		await act(async () =>
			delayed.resolve({ ...task, id: otherId, title: 'Другая задача' })
		)
		await screen.findByDisplayValue('Другая задача')
	})
	it('drops same-user old-session drafts and never displays a late mutation response', async () => {
		const delayed = deferred<WorkdayTask>()
		vi.mocked(mutateWorkdayTask).mockReturnValueOnce(delayed.promise)
		render(<WorkdayTaskDrawer taskId={taskId} onClose={vi.fn()} />, {
			wrapper: Wrapper
		})
		await loadTask()
		fireEvent.change(titleField(), {
			target: { value: 'Секрет старой сессии' }
		})
		fireEvent.click(editButton())
		await waitFor(() => expect(mutateWorkdayTask).toHaveBeenCalledTimes(1))
		currentTask = { ...task, title: 'Свежая сессия' }
		act(() =>
			useSessionStore
				.getState()
				.setAuthenticated({ accessToken: 'fresh-token', userId: 'actor' })
		)
		await screen.findByDisplayValue('Свежая сессия')
		await act(async () =>
			delayed.resolve({
				...task,
				title: 'Секрет старой сессии',
				version: 2
			})
		)
		expect(titleField()).toHaveProperty('value', 'Свежая сессия')
		expect(toast.success).not.toHaveBeenCalled()
	})
})

describe('Workday create form', () => {
	it('preselects a freshly checked follow-up deal without copying its assignee or guessing a title/date', async () => {
		const initialDeal = { ...deal, assignedToSubject: colleague.subject }
		render(
			<WorkdayCreateTaskDrawer
				onClose={vi.fn()}
				initialDeal={initialDeal}
			/>,
			{ wrapper: Wrapper }
		)
		await waitFor(() =>
			expect(screen.getByLabelText('Связанная сделка')).toHaveProperty(
				'value',
				deal.id
			)
		)
		expect(titleField()).toHaveProperty('value', '')
		expect(screen.getByLabelText('Срок выполнения')).toHaveProperty(
			'value',
			''
		)
		expect(screen.getByLabelText('Ответственный')).toHaveProperty(
			'value',
			creator.membershipId
		)
		expect(createButton()).toHaveProperty('disabled', true)
		expect(mutateWorkdayTask).not.toHaveBeenCalled()
		fillCreate()
		fireEvent.click(createButton())
		await waitFor(() => expect(mutateWorkdayTask).toHaveBeenCalledTimes(1))
		expect(
			vi.mocked(mutateWorkdayTask).mock.calls[0][1].mutation
		).toMatchObject({
			kind: 'create',
			dealId: deal.id,
			teamId: null,
			assignee: {
				subject: creator.subject,
				membershipId: creator.membershipId
			}
		})
		expect(getSalesDeal).toHaveBeenCalledWith(
			'token',
			workspaceId,
			deal.id
		)
	})
	it('defaults to standalone and resolves the creator explicitly, not the directory first item', async () => {
		const onSaved = vi.fn(),
			onClose = vi.fn()
		render(
			<WorkdayCreateTaskDrawer onClose={onClose} onSaved={onSaved} />,
			{ wrapper: Wrapper }
		)
		fillCreate()
		expect(screen.getByLabelText('Связь со сделкой')).toHaveProperty(
			'value',
			'standalone'
		)
		expect(screen.getByLabelText('Ответственный')).toHaveProperty(
			'value',
			membershipId
		)
		fireEvent.click(createButton())
		await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
		expect(
			vi.mocked(mutateWorkdayTask).mock.calls[0][1].mutation
		).toMatchObject({
			kind: 'create',
			title: 'Подготовить встречу',
			dealId: null,
			teamId: null,
			assignee: { subject: 'actor', membershipId }
		})
		expect(onClose).toHaveBeenCalledTimes(1)
		expect(listSalesDeals).not.toHaveBeenCalled()
	})
	it('does not invent a creator membership or choose another employee automatically', () => {
		directory = [colleague]
		render(<WorkdayCreateTaskDrawer onClose={vi.fn()} />, {
			wrapper: Wrapper
		})
		fillCreate()
		expect(createButton()).toHaveProperty('disabled', true)
		expect(screen.getByLabelText('Ответственный')).toHaveProperty(
			'value',
			''
		)
		fireEvent.change(screen.getByLabelText('Ответственный'), {
			target: { value: colleague.membershipId }
		})
		expect(createButton()).toHaveProperty('disabled', false)
	})
	it('searches server-paged open deals and revalidates a selected deal before creation', async () => {
		vi.mocked(listSalesDeals).mockImplementation(
			async (_token, _workspace, page, pageSize) => ({
				schemaVersion: 1,
				page,
				pageSize,
				total: 21,
				items: [deal]
			})
		)
		render(<WorkdayCreateTaskDrawer onClose={vi.fn()} />, {
			wrapper: Wrapper
		})
		fillCreate()
		await selectDeal()
		const pager = screen.getByRole('navigation', {
			name: 'Страницы сделок'
		})
		fireEvent.click(within(pager).getByRole('button', { name: 'Далее' }))
		await waitFor(() =>
			expect(listSalesDeals).toHaveBeenLastCalledWith(
				'token',
				workspaceId,
				2,
				20,
				'',
				'',
				'OPEN'
			)
		)
		fireEvent.change(screen.getByLabelText('Поиск сделки'), {
			target: { value: 'Встреча' }
		})
		fireEvent.click(screen.getByRole('button', { name: 'Найти сделку' }))
		await waitFor(() =>
			expect(listSalesDeals).toHaveBeenLastCalledWith(
				'token',
				workspaceId,
				1,
				20,
				'Встреча',
				'',
				'OPEN'
			)
		)
		fireEvent.click(createButton())
		await waitFor(() => expect(mutateWorkdayTask).toHaveBeenCalledTimes(1))
		expect(getSalesDeal).toHaveBeenCalledWith(
			'token',
			workspaceId,
			deal.id
		)
		expect(
			vi.mocked(mutateWorkdayTask).mock.calls[0][1].mutation
		).toMatchObject({ kind: 'create', dealId: deal.id, teamId: null })
	})
	it.each([
		{ status: 'WON' as const },
		{ archivedAt: task.dueAt },
		{ teamId: otherId }
	])('refuses a deal that changed during selection: %s', async changed => {
		vi.mocked(getSalesDeal).mockResolvedValue({ ...deal, ...changed })
		render(<WorkdayCreateTaskDrawer onClose={vi.fn()} />, {
			wrapper: Wrapper
		})
		fillCreate()
		await selectDeal()
		fireEvent.click(createButton())
		await screen.findByText(/Связанная сделка изменилась/)
		expect(mutateWorkdayTask).not.toHaveBeenCalled()
	})
	it.each(['close', 'unmount', 'session', 'workspace'] as const)(
		'does not dispatch a late create after deal preflight and %s',
		async change => {
			const delayed = deferred<SalesDeal>()
			vi.mocked(getSalesDeal).mockReturnValueOnce(delayed.promise)
			const onClose = vi.fn()
			const view = render(<WorkdayCreateTaskDrawer onClose={onClose} />, {
				wrapper: Wrapper
			})
			fillCreate()
			await selectDeal()
			fireEvent.click(createButton())
			await waitFor(() => expect(getSalesDeal).toHaveBeenCalledTimes(1))
			if (change === 'close')
				fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
			if (change === 'unmount') view.unmount()
			if (change === 'session')
				act(() =>
					useSessionStore.getState().setAuthenticated({
						accessToken: 'new-token',
						userId: 'actor'
					})
				)
			if (change === 'workspace') {
				workspace = { ...workspace, workspaceId: otherId }
				permissions = { ...permissions, workspaceId: otherId }
				view.rerender(<WorkdayCreateTaskDrawer onClose={onClose} />)
			}
			await act(async () => delayed.resolve(deal))
			expect(mutateWorkdayTask).not.toHaveBeenCalled()
		}
	)
	it('replays an unknown create instead of issuing a new UUID or modified body', async () => {
		vi.mocked(mutateWorkdayTask).mockRejectedValueOnce(
			new AuthenticatedApiError('temporary', 'Неизвестный результат')
		)
		render(<WorkdayCreateTaskDrawer onClose={vi.fn()} />, {
			wrapper: Wrapper
		})
		fillCreate()
		fireEvent.click(createButton())
		fireEvent.click(
			await screen.findByRole('button', { name: 'Проверить результат' })
		)
		await waitFor(() => expect(mutateWorkdayTask).toHaveBeenCalledTimes(2))
		expect(vi.mocked(mutateWorkdayTask).mock.calls[1][1]).toBe(
			vi.mocked(mutateWorkdayTask).mock.calls[0][1]
		)
	})
	it('refuses a create after fresh authority becomes read-only before transport', async () => {
		vi.mocked(getCrmPermissions).mockResolvedValue({
			...permissions,
			state: 'READ_ONLY',
			permissions: ['sales:read']
		})
		render(<WorkdayCreateTaskDrawer onClose={vi.fn()} />, {
			wrapper: Wrapper
		})
		fillCreate()
		fireEvent.click(createButton())
		await screen.findByText(/Права изменились/)
		expect(mutateWorkdayTask).not.toHaveBeenCalled()
	})
})
