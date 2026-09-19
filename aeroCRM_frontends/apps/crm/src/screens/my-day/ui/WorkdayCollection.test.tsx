import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within
} from '@testing-library/react'
import type { ComponentProps } from 'react'
import {
	KeyboardSensor,
	type Active,
	type DndContext,
	type DragEndEvent,
	type DragOverlay
} from '@dnd-kit/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import toast from 'react-hot-toast'
import {
	useAssigneeLabels,
	type AssigneeBinding,
	type AssigneeLabels,
	type AssigneeOption
} from '@/entities/crm-team'
import {
	useWorkdayTasks,
	type WorkdayFilters,
	type WorkdayTask
} from '@/entities/crm-workday'
import { initialWorkdayFilters } from '../model/workday-view'
import { WorkdayCollection } from './WorkdayCollection'

vi.mock('@/entities/crm-workday', () => ({ useWorkdayTasks: vi.fn() }))
vi.mock('@/entities/crm-team', async original => ({
	...(await original<typeof import('@/entities/crm-team')>()),
	useAssigneeLabels: vi.fn()
}))
vi.mock('@/features/manage-workday', () => ({
	useWorkdayTaskCommandState: vi.fn(() => ({ unresolved: false }))
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
const adapter = vi.hoisted(() => ({
	props: null as ComponentProps<typeof DndContext> | null,
	duration: undefined as number | undefined,
	transition: undefined as ComponentProps<typeof DragOverlay>['transition']
}))
// Real sensors remain mounted; these captured application callbacks additionally
// exercise mid-flight data/permission changes independently of browser layout.
vi.mock('@dnd-kit/core', async original => {
	const kit = await original<typeof import('@dnd-kit/core')>()
	return {
		...kit,
		DndContext: (props: ComponentProps<typeof DndContext>) => {
			adapter.props = props
			return <kit.DndContext {...props} />
		},
		DragOverlay: (props: ComponentProps<typeof kit.DragOverlay>) => {
			adapter.transition = props.transition
			adapter.duration =
				typeof props.dropAnimation === 'object'
					? props.dropAnimation?.duration
					: undefined
			return <kit.DragOverlay {...props} />
		}
	}
})
const task: WorkdayTask = Object.freeze({
	id: 'task',
	workspaceId: 'workspace',
	dealId: null,
	version: 7,
	title: 'Позвонить клиенту',
	dueAt: '2026-09-07T09:00:00Z',
	status: 'OPEN',
	assignedToSubject: 'actor',
	assignedToMembershipId: null,
	teamId: null,
	completedAt: null,
	createdAt: '2026-09-06T09:00:00Z',
	updatedAt: '2026-09-06T09:00:00Z'
})
const onStatus = vi.fn()
const onOpen = vi.fn()
const onPage = vi.fn()
const refetch = vi.fn()
const namesRefetch = vi.fn()
const namesLookup = vi.fn()
const authority = {
	workspaceId: 'workspace',
	subject: 'actor',
	role: 'OWNER',
	state: 'ACTIVE',
	dataScope: 'ALL',
	teamIds: [],
	permissions: ['sales:read', 'sales:write']
} as const
const context = {
	workspace: { workspaceId: 'workspace' },
	session: { userId: 'actor', accessToken: 'test-token' },
	sessionRevision: 3,
	permissions: { data: authority },
	canRead: true,
	current: () => true
}
const employee: AssigneeOption = {
	subject: 'employee',
	membershipId: '00000000-0000-4000-8000-000000000001',
	displayName: 'Анна Петрова',
	verifiedEmail: 'anna@example.test',
	role: 'MANAGER'
}
const employeeTask: WorkdayTask = {
	...task,
	id: 'employee-task',
	title: 'Подготовить отчёт',
	assignedToSubject: employee.subject,
	assignedToMembershipId: employee.membershipId
}
let pageTasks: WorkdayTask[]
let namesRows: AssigneeLabels['items']
let namesError: boolean
let unavailable: 'IN_PROGRESS' | 'OPEN' | undefined
let fetching: 'IN_PROGRESS' | 'OPEN' | undefined
const element = (view: 'list' | 'board', canWrite = true) => (
	<WorkdayCollection
		filters={initialWorkdayFilters()}
		view={view}
		canWrite={canWrite}
		onOpen={onOpen}
		onStatus={onStatus}
		onPage={onPage}
	/>
)
const setup = (view: 'list' | 'board', canWrite = true) =>
	render(element(view, canWrite))
const rect = (left = 20, top = 80, width = 260, height = 160) =>
	new DOMRect(left, top, width, height)
const handle = () =>
	screen.getByRole('button', {
		name: 'Переместить задачу «Позвонить клиенту»'
	}) as HTMLButtonElement
const activeTask = (): Active => ({
	id: task.id,
	data: { current: { task } },
	rect: { current: { initial: rect(), translated: rect() } }
})
const dropEvent = (
	active: Active,
	target: string | null = 'IN_PROGRESS',
	ready = true
): DragEndEvent => ({
	activatorEvent: new Event('test-adapter'),
	active,
	collisions: [],
	delta: { x: 340, y: 0 },
	over: target
		? {
				id: target,
				data: { current: { ready } },
				rect: rect(340, 0, 300, 500),
				disabled: !ready
			}
		: null
})
const startAdapter = (active = activeTask()) => {
	act(() => {
		adapter.props!.onDragStart!({
			active,
			activatorEvent: new Event('test-adapter')
		})
	})
	return active
}
const keyboardStart = async () => {
	handle().focus()
	fireEvent.keyDown(handle(), { code: 'Space', key: ' ' })
	await waitFor(() =>
		expect(handle().getAttribute('aria-pressed')).toBe('true')
	)
	// KeyboardSensor intentionally subscribes to the next key after this turn.
	await act(async () => {
		await new Promise(resolve => setTimeout(resolve, 0))
	})
}
const pointer = (
	target: Element | Document,
	type: string,
	x: number,
	y: number
) =>
	fireEvent(
		target,
		Object.assign(
			new MouseEvent(type, {
				bubbles: true,
				button: 0,
				clientX: x,
				clientY: y
			}),
			{ isPrimary: true, pointerId: 1, pointerType: 'mouse' }
		)
	)
beforeEach(() => {
	vi.clearAllMocks()
	pageTasks = [task]
	namesRows = []
	namesError = false
	namesLookup.mockImplementation((binding: AssigneeBinding) =>
		namesRows.find(
			row =>
				row.binding.subject === binding.subject &&
				row.binding.membershipId === binding.membershipId
		)
	)
	vi.mocked(useAssigneeLabels).mockImplementation(() => ({
		loading: false,
		error: namesError,
		lookup: namesLookup,
		refetch: namesRefetch
	}))
	unavailable = undefined
	fetching = undefined
	vi.spyOn(
		HTMLElement.prototype,
		'getBoundingClientRect'
	).mockImplementation(function (this: HTMLElement) {
		const label = this.getAttribute('aria-label')
		if (label === 'К выполнению') return rect(0, 0, 300, 500)
		if (label === 'В работе') return rect(340, 0, 300, 500)
		if (label === 'Готово') return rect(680, 0, 300, 500)
		return rect()
	})
	vi.mocked(useWorkdayTasks).mockImplementation(
		(filters: WorkdayFilters) =>
			({
				context,
				query: {
					isError: !!unavailable && filters.status === unavailable,
					isFetching: !!fetching && filters.status === fetching,
					refetch
				},
				data:
					unavailable && filters.status === unavailable
						? undefined
						: {
								items:
									!filters.status || filters.status === 'OPEN'
										? pageTasks
										: [],
								total:
									!filters.status || filters.status === 'OPEN' ? 21 : 0,
								asOf: '2026-09-07T10:00:00Z',
								counts: {
									OPEN: 21,
									IN_PROGRESS: 0,
									COMPLETED: 0,
									CANCELLED: 3
								}
							}
			}) as never
	)
})
afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

describe('MyDay server-paged list and board', () => {
	it.each(['list', 'board'] as const)(
		'renders exact employee labels and self without per-task queries in %s',
		view => {
			pageTasks = [task, employeeTask]
			const binding = {
				subject: employee.subject,
				membershipId: employee.membershipId
			}
			namesRows = [{ binding, employee }]
			setup(view)
			expect(
				screen.getByText(
					view === 'board' ? 'Ответственный: Анна Петрова' : 'Анна Петрова'
				)
			).toBeTruthy()
			expect(
				screen.getByText(view === 'board' ? 'Ответственный: Вы' : 'Вы')
			).toBeTruthy()
			expect(namesLookup).toHaveBeenCalledExactlyOnceWith(binding)
			expect(useAssigneeLabels).toHaveBeenCalledWith(
				{
					workspaceId: 'workspace',
					subject: 'actor',
					accessToken: 'test-token',
					sessionRevision: 3,
					canRead: true,
					isCurrent: context.current,
					authority
				},
				[binding]
			)
			expect(useAssigneeLabels).toHaveBeenCalledTimes(
				view === 'list' ? 1 : 3
			)
			expect(screen.queryByText('employee')).toBeNull()
			expect(screen.queryByText('Имя загружается…')).toBeNull()
		}
	)
	it('keeps tasks actionable and shows an explicit retriable label outage', () => {
		pageTasks = [employeeTask]
		namesError = true
		setup('list')
		expect(screen.getByRole('alert').textContent).toContain(
			'Задачи остаются доступны.'
		)
		expect(screen.getByText('Имя временно недоступно')).toBeTruthy()
		fireEvent.click(
			screen.getByRole('button', { name: employeeTask.title })
		)
		expect(onOpen).toHaveBeenCalledExactlyOnceWith(employeeTask)
		fireEvent.change(
			screen.getByLabelText(`Статус задачи «${employeeTask.title}»`),
			{
				target: { value: 'IN_PROGRESS' }
			}
		)
		expect(onStatus).toHaveBeenCalledExactlyOnceWith(
			employeeTask,
			'IN_PROGRESS'
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Повторить загрузку имён' })
		)
		expect(namesRefetch).toHaveBeenCalledOnce()
		expect(
			screen.queryByText('Нет задач по выбранным условиям')
		).toBeNull()
	})
	it('distinguishes confirmed unavailable exact membership from a resolved historical null binding', () => {
		const oldTask = {
			...employeeTask,
			id: 'old-task',
			title: 'Архивное назначение',
			assignedToMembershipId: null
		}
		const currentBinding = {
			subject: employee.subject,
			membershipId: employee.membershipId
		}
		const historicalBinding = {
			subject: employee.subject,
			membershipId: null
		}
		pageTasks = [employeeTask, oldTask]
		namesRows = [
			{ binding: currentBinding, employee: null },
			{ binding: historicalBinding, employee }
		]
		setup('board')
		expect(
			screen.getByText('Ответственный: Ответственный недоступен')
		).toBeTruthy()
		expect(screen.getByText('Ответственный: Анна Петрова')).toBeTruthy()
		expect(screen.queryByRole('alert')).toBeNull()
		expect(screen.queryByText('Имя загружается…')).toBeNull()
		expect(namesLookup).toHaveBeenNthCalledWith(1, currentBinding)
		expect(namesLookup).toHaveBeenNthCalledWith(2, historicalBinding)
		expect(useAssigneeLabels).toHaveBeenCalledWith(expect.anything(), [
			currentBinding,
			historicalBinding
		])
		expect(oldTask.assignedToMembershipId).toBeNull()
		expect(onStatus).not.toHaveBeenCalled()
	})
	it('loads independent server status pages and changes only the chosen column page', () => {
		setup('board')
		expect(
			vi
				.mocked(useWorkdayTasks)
				.mock.calls.map(([filter]) => filter.status)
		).toEqual(['OPEN', 'IN_PROGRESS', 'COMPLETED'])
		vi.mocked(useWorkdayTasks).mockClear()
		fireEvent.click(
			within(
				screen.getByRole('navigation', {
					name: 'Страницы колонки «К выполнению»'
				})
			).getByRole('button', { name: 'Далее' })
		)
		expect(useWorkdayTasks).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ status: 'OPEN', page: 2, pageSize: 20 })
		)
		expect(onPage).not.toHaveBeenCalled()
		expect(screen.queryByRole('region', { name: 'Отменено' })).toBeNull()
	})
	it('preserves list server pagination and the no-drag status fallback snapshot', () => {
		setup('list')
		fireEvent.change(
			screen.getByLabelText('Статус задачи «Позвонить клиенту»'),
			{ target: { value: 'IN_PROGRESS' } }
		)
		expect(onStatus).toHaveBeenCalledExactlyOnceWith(task, 'IN_PROGRESS')
		expect(task.version).toBe(7)
		expect(task.dueAt).toBe('2026-09-07T09:00:00Z')
		fireEvent.click(
			within(
				screen.getByRole('navigation', { name: 'Страницы списка задач' })
			).getByRole('button', { name: 'Далее' })
		)
		expect(onPage).toHaveBeenCalledExactlyOnceWith(2)
	})
	it('read-only disables drag handles and status controls, but keeps details accessible', () => {
		setup('board', false)
		expect(handle().disabled).toBe(true)
		expect(handle().getAttribute('aria-disabled')).toBe('true')
		expect(
			(
				screen.getByLabelText(
					'Статус задачи «Позвонить клиенту»'
				) as HTMLSelectElement
			).disabled
		).toBe(true)
		fireEvent.keyDown(handle(), { code: 'Space', key: ' ' })
		expect(onStatus).not.toHaveBeenCalled()
		fireEvent.click(
			screen.getByRole('button', { name: 'Позвонить клиенту' })
		)
		expect(onOpen).toHaveBeenCalledExactlyOnceWith(task)
	})
	it('shows unavailable list data as an error rather than an empty result', () => {
		vi.mocked(useWorkdayTasks).mockReturnValue({
			query: { isError: true, refetch },
			context,
			data: undefined
		} as never)
		setup('list')
		expect(
			screen.getByText(
				'Не удалось загрузить задачи. Это не означает, что задач нет.'
			)
		).toBeTruthy()
		expect(
			screen.queryByText('Нет задач по выбранным условиям')
		).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
		expect(refetch).toHaveBeenCalledOnce()
	})
	it('shows an unavailable column count as unknown, not zero or empty', () => {
		unavailable = 'IN_PROGRESS'
		setup('board')
		const column = within(screen.getByRole('region', { name: 'В работе' }))
		expect(column.getByRole('heading').textContent).toBe('В работе —')
		expect(column.getByRole('alert').textContent).toContain(
			'Не удалось загрузить колонку.'
		)
		expect(column.queryByText('В этой колонке задач нет')).toBeNull()
		expect(column.queryByRole('navigation')).toBeNull()
		fireEvent.click(column.getByRole('button', { name: 'Повторить' }))
		expect(refetch).toHaveBeenCalledOnce()
	})
})

describe('real dnd-kit keyboard sensor with deterministic test rectangles', () => {
	it('lifts the dedicated handle, moves right and saves only the selected status on Space', async () => {
		setup('board')
		await keyboardStart()
		fireEvent.keyDown(document, { code: 'ArrowRight', key: 'ArrowRight' })
		await waitFor(() =>
			expect(screen.getByRole('status').textContent).toContain(
				'Колонка: В работе.'
			)
		)
		expect(onStatus).not.toHaveBeenCalled()
		fireEvent.keyDown(document, { code: 'Space', key: ' ' })
		await waitFor(() =>
			expect(onStatus).toHaveBeenCalledExactlyOnceWith(task, 'IN_PROGRESS')
		)
		expect(task).toMatchObject({
			version: 7,
			dueAt: '2026-09-07T09:00:00Z',
			assignedToMembershipId: null
		})
	})
	it('cancels on Escape without a write and announces the cancellation', async () => {
		setup('board')
		await keyboardStart()
		fireEvent.keyDown(document, { code: 'ArrowRight', key: 'ArrowRight' })
		fireEvent.keyDown(document, { code: 'Escape', key: 'Escape' })
		await waitFor(() =>
			expect(handle().getAttribute('aria-pressed')).not.toBe('true')
		)
		expect(onStatus).not.toHaveBeenCalled()
		expect(toast).toHaveBeenCalledWith('Перемещение отменено')
		expect(screen.getByRole('status').textContent).toContain(
			'Задача осталась на месте'
		)
	})
	it('does not start a drag from the task title or status select keyboard events', () => {
		setup('board')
		fireEvent.keyDown(screen.getByRole('button', { name: task.title }), {
			code: 'Space',
			key: ' '
		})
		fireEvent.keyDown(
			screen.getByLabelText(`Статус задачи «${task.title}»`),
			{ code: 'Space', key: ' ' }
		)
		expect(handle().getAttribute('aria-pressed')).not.toBe('true')
		expect(onStatus).not.toHaveBeenCalled()
	})
})

describe('real dnd-kit PointerSensor with synthetic DOM pointer events', () => {
	it('does not activate before the eight-pixel threshold and saves after a valid pointer drop', async () => {
		setup('board')
		pointer(handle(), 'pointerdown', 250, 100)
		pointer(document, 'pointermove', 254, 100)
		expect(handle().getAttribute('aria-pressed')).not.toBe('true')
		expect(onStatus).not.toHaveBeenCalled()
		pointer(document, 'pointermove', 260, 100)
		await waitFor(() =>
			expect(handle().getAttribute('aria-pressed')).toBe('true')
		)
		pointer(document, 'pointermove', 450, 100)
		await waitFor(() =>
			expect(screen.getByRole('status').textContent).toContain(
				'Колонка: В работе.'
			)
		)
		expect(onStatus).not.toHaveBeenCalled()
		pointer(document, 'pointerup', 450, 100)
		await waitFor(() =>
			expect(onStatus).toHaveBeenCalledExactlyOnceWith(task, 'IN_PROGRESS')
		)
	})
	it('cancels a pointer drag without any write on pointercancel', async () => {
		setup('board')
		pointer(handle(), 'pointerdown', 250, 100)
		pointer(document, 'pointermove', 260, 100)
		await waitFor(() =>
			expect(handle().getAttribute('aria-pressed')).toBe('true')
		)
		pointer(document, 'pointercancel', 260, 100)
		await waitFor(() =>
			expect(handle().getAttribute('aria-pressed')).not.toBe('true')
		)
		expect(onStatus).not.toHaveBeenCalled()
	})
	it('keyboard skips an unavailable intermediate column and drops into the next available column', async () => {
		unavailable = 'IN_PROGRESS'
		setup('board')
		await keyboardStart()
		fireEvent.keyDown(document, { code: 'ArrowRight', key: 'ArrowRight' })
		await waitFor(() =>
			expect(screen.getByRole('status').textContent).toContain(
				'Колонка: Готово.'
			)
		)
		fireEvent.keyDown(document, { code: 'Space', key: ' ' })
		await waitFor(() =>
			expect(onStatus).toHaveBeenCalledExactlyOnceWith(task, 'COMPLETED')
		)
	})
})

describe('DndContext application callback contract (not browser pointer simulation)', () => {
	it('does not accept a foreign drop without a local drag start', () => {
		setup('board')
		act(() => {
			adapter.props!.onDragEnd!(dropEvent(activeTask()))
		})
		expect(onStatus).not.toHaveBeenCalled()
	})
	it.each([null, 'OPEN', 'CANCELLED', 'unknown'])(
		'does not save outside/unchanged/unsupported target %s',
		target => {
			setup('board')
			const active = startAdapter()
			act(() => {
				adapter.props!.onDragEnd!(dropEvent(active, target))
			})
			expect(onStatus).not.toHaveBeenCalled()
		}
	)
	it('does not save when the target is unavailable or still refreshing', () => {
		setup('board')
		const active = startAdapter()
		act(() => {
			adapter.props!.onDragEnd!(dropEvent(active, 'IN_PROGRESS', false))
		})
		expect(onStatus).not.toHaveBeenCalled()
	})
	it('does not save after write permission is revoked during the drag', () => {
		const rendered = setup('board')
		const active = startAdapter()
		rendered.rerender(element('board', false))
		act(() => {
			adapter.props!.onDragEnd!(dropEvent(active))
		})
		expect(onStatus).not.toHaveBeenCalled()
	})
	it('invalidates a cancelled drag before a later stray end callback', () => {
		setup('board')
		const active = startAdapter()
		act(() => {
			adapter.props!.onDragCancel!(dropEvent(active, null))
		})
		act(() => {
			adapter.props!.onDragEnd!(dropEvent(active))
		})
		expect(onStatus).not.toHaveBeenCalled()
	})
	it('preserves the lifted task snapshot if draggable data refreshes before drop', () => {
		setup('board')
		const active = startAdapter()
		active.data.current = {
			task: {
				...task,
				version: 8,
				dueAt: '2026-09-08T09:00:00Z',
				assignedToSubject: 'someone-else'
			}
		}
		act(() => {
			adapter.props!.onDragEnd!(dropEvent(active))
		})
		expect(onStatus).toHaveBeenCalledExactlyOnceWith(task, 'IN_PROGRESS')
		expect(Object.isFrozen(onStatus.mock.calls[0][0])).toBe(true)
	})
	it.each([true, false])(
		'sets drop-animation duration from reduced motion %s',
		matches => {
			vi.stubGlobal('matchMedia', () => ({
				matches,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn()
			}))
			setup('board')
			expect(adapter.duration).toBe(matches ? 0 : 240)
			expect(
				adapter.props?.sensors?.find(
					sensor => sensor.sensor === KeyboardSensor
				)?.options
			).toMatchObject({ scrollBehavior: matches ? 'auto' : 'smooth' })
			expect(typeof adapter.transition).toBe('function')
			if (typeof adapter.transition !== 'function')
				throw new Error('Expected motion-aware overlay transition')
			expect(adapter.transition(new KeyboardEvent('keydown'))).toBe(
				matches ? 'none' : 'transform 200ms ease'
			)
			expect(adapter.transition(new MouseEvent('pointerdown'))).toBe(
				matches ? 'none' : undefined
			)
		}
	)
})
