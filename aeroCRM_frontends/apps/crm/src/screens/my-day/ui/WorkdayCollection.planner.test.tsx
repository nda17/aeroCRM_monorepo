import {
	cleanup,
	fireEvent,
	render,
	screen,
	within
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWorkdayTasks } from '@/entities/crm-workday'
import type { PlannerSettings } from '@/entities/crm-planner/model/planner.types'
import type { WorkdayTaskPage } from '@/entities/crm-workday'
import { WorkdayCollection } from './WorkdayCollection'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const taskId = '22222222-2222-4222-8222-222222222222'
const customId = '33333333-3333-4333-8333-333333333333'
const task = {
	id: taskId,
	workspaceId,
	dealId: null,
	version: 1,
	title: 'Позвонить клиенту',
	dueAt: '2026-10-04T12:00:00.000Z',
	status: 'IN_PROGRESS' as const,
	assignedToSubject: 'actor',
	assignedToMembershipId: null,
	teamId: null,
	completedAt: null,
	createdAt: '2026-10-04T10:00:00.000Z',
	updatedAt: '2026-10-04T10:00:00.000Z'
}
const settings: PlannerSettings = {
	schemaVersion: 1,
	workspaceId,
	version: 7,
	templates: [],
	columns: [
		{
			id: 'OPEN',
			name: 'К выполнению',
			status: 'OPEN',
			isDefault: true,
			archived: false
		},
		{
			id: 'IN_PROGRESS',
			name: 'В работе',
			status: 'IN_PROGRESS',
			isDefault: true,
			archived: false
		},
		{
			id: customId,
			name: 'На проверке',
			status: 'IN_PROGRESS',
			isDefault: false,
			archived: false
		},
		{
			id: 'COMPLETED',
			name: 'Готово',
			status: 'COMPLETED',
			isDefault: true,
			archived: false
		},
		{
			id: 'CANCELLED',
			name: 'Отменена',
			status: 'CANCELLED',
			isDefault: true,
			archived: false
		}
	]
}
const requests: unknown[] = []
let data: WorkdayTaskPage
vi.mock('@/entities/crm-workday', async () => ({
	...(await vi.importActual<typeof import('@/entities/crm-workday')>(
		'@/entities/crm-workday'
	)),
	useWorkdayTasks: vi.fn()
}))
vi.mock('@/entities/crm-team', async () => ({
	...(await vi.importActual<typeof import('@/entities/crm-team')>(
		'@/entities/crm-team'
	)),
	useAssigneeLabels: () => ({
		error: false,
		lookup: () => undefined,
		refetch: vi.fn()
	}),
	assigneeDisplayName: () => 'Actor'
}))
vi.mock('@/features/manage-workday', async () => ({
	...(await vi.importActual<typeof import('@/features/manage-workday')>(
		'@/features/manage-workday'
	)),
	useWorkdayTaskCommandState: () => ({ unresolved: false })
}))

describe('WorkdayCollection planner columns', () => {
	const filters = {
		page: 1,
		pageSize: 20,
		period: 'ALL',
		timeZone: 'Europe/Moscow',
		scope: 'ALL'
	} as const
	const context = {
		workspace: { workspaceId },
		session: { userId: 'actor', accessToken: 'captured' },
		sessionRevision: 1,
		permissions: {
			data: {
				workspaceId,
				subject: 'actor',
				permissions: ['sales:read', 'sales:write']
			}
		},
		canRead: true,
		current: () => true
	}
	const page = (): WorkdayTaskPage => ({
		schemaVersion: 1,
		workspaceId,
		subject: 'actor',
		page: 1,
		pageSize: 20,
		total: 21,
		items: [task],
		counts: { OPEN: 0, IN_PROGRESS: 21, COMPLETED: 0, CANCELLED: 0 },
		overdueCount: 0,
		asOf: '2026-10-04T12:00:00.000Z',
		timeZone: 'Europe/Moscow',
		range: null
	})
	it('filters each column with settings version, keeps pagination local, and allows a same-status move', () => {
		requests.length = 0
		data = page()
		vi.mocked(useWorkdayTasks).mockImplementation(request => {
			requests.push(request)
			return {
				data:
					request.columnId === customId
						? { ...data, page: request.page, items: [task] }
						: { ...data, page: request.page, total: 0, items: [] },
				query: { isFetching: false, isError: false, refetch: vi.fn() },
				context
			} as never
		})
		const onColumn = vi.fn()
		const onStatus = vi.fn()
		render(
			<WorkdayCollection
				planner={settings}
				filters={filters as never}
				view="board"
				canWrite
				onColumn={onColumn}
				onStatus={onStatus}
				onOpen={vi.fn()}
				onPage={vi.fn()}
			/>
		)
		expect(requests).toContainEqual(
			expect.objectContaining({
				columnId: customId,
				settingsVersion: 7,
				status: 'IN_PROGRESS',
				page: 1
			})
		)
		fireEvent.change(
			screen.getByRole('combobox', {
				name: 'Колонка задачи «Позвонить клиенту»'
			}),
			{ target: { value: customId } }
		)
		expect(onColumn).toHaveBeenCalledExactlyOnceWith(
			task,
			settings.columns[2]
		)
		expect(onStatus).not.toHaveBeenCalled()
		const customPagination = screen.getByRole('navigation', {
			name: 'Страницы колонки «На проверке»'
		})
		fireEvent.click(
			within(customPagination).getByRole('button', {
				name: 'Далее'
			})
		)
		expect(requests).toContainEqual(
			expect.objectContaining({
				columnId: customId,
				settingsVersion: 7,
				page: 2
			})
		)
	})

	it('disables moves after permission is revoked', () => {
		data = page()
		vi.mocked(useWorkdayTasks).mockImplementation(
			() =>
				({
					data: { ...data, total: 1, items: [task] },
					query: { isFetching: false, isError: false },
					context
				}) as never
		)
		const { rerender } = render(
			<WorkdayCollection
				planner={settings}
				filters={filters as never}
				view="board"
				canWrite
				onColumn={vi.fn()}
				onStatus={vi.fn()}
				onOpen={vi.fn()}
				onPage={vi.fn()}
			/>
		)
		const boardProps = {
			planner: settings,
			filters: filters as never,
			view: 'board' as const,
			onStatus: vi.fn(),
			onOpen: vi.fn(),
			onPage: vi.fn(),
			onColumn: vi.fn()
		}
		rerender(<WorkdayCollection {...boardProps} canWrite={false} />)
		expect(
			screen
				.getAllByRole('combobox', {
					name: 'Колонка задачи «Позвонить клиенту»'
				})
				.every(select => (select as HTMLSelectElement).disabled)
		).toBe(true)
	})
})

afterEach(() => cleanup())
