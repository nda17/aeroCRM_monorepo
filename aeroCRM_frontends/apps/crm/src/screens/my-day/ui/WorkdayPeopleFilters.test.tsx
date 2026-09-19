import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within
} from '@testing-library/react'
import { createRef, useLayoutEffect, useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedRequest } from '@/shared/api/authenticated-http-client'
import type {
	AssigneeDirectoryContext,
	AssigneeOption
} from '@/entities/crm-team'
import type {
	WorkdayFilters as Filters,
	WorkdayScope
} from '@/entities/crm-workday'
import { initialWorkdayFilters } from '../model/workday-view'
import { WorkdayFilters } from './WorkdayFilters'
import {
	WorkdayPeopleFilters,
	type WorkdayPeopleFiltersHandle,
	type WorkdayPeopleFilterValue
} from './WorkdayPeopleFilters'

vi.mock('@/shared/api/authenticated-http-client', async original => ({
	...(await original<object>()),
	authenticatedRequest: vi.fn()
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
const workspaceId = '11111111-1111-4111-8111-111111111111'
const ids = Array.from(
	{ length: 21 },
	(_, index) =>
		`22222222-2222-4222-8222-${String(index).padStart(12, '0')}`
)
const teams = ids.map((id, index) => ({ id, name: `Отдел ${index + 1}` }))
const employees: AssigneeOption[] = ids.map((_id, index) => ({
	subject: `employee-${index + 1}`,
	membershipId: `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`,
	displayName: `Сотрудник ${index + 1}`,
	verifiedEmail: `employee-${index + 1}@example.com`,
	role: 'MANAGER'
}))
let live: boolean
let client: QueryClient
let reference: ReturnType<typeof createRef<WorkdayPeopleFiltersHandle>>
const changed = vi.fn()
const submitted = vi.fn()
const context = (): AssigneeDirectoryContext => ({
	workspaceId,
	subject: 'owner',
	accessToken: 'test-owner-token',
	sessionRevision: 1,
	canRead: true,
	isCurrent: () => live,
	authority: {
		workspaceId,
		subject: 'owner',
		role: 'OWNER',
		state: 'ACTIVE',
		dataScope: 'ALL',
		teamIds: ids,
		permissions: ['sales:read']
	}
})
type HttpRequest = Parameters<typeof authenticatedRequest>[0]
const responseFor = (request: HttpRequest) => {
	const params = request.params ?? {}
	const page = Number(params.page),
		pageSize = Number(params.pageSize)
	const metadata = {
		schemaVersion: 1,
		workspaceId: params.workspaceId,
		subject: 'owner',
		page,
		pageSize
	}
	if (request.url === '/crm/access/team/options')
		return {
			...metadata,
			total: teams.length,
			items: teams.slice((page - 1) * pageSize, page * pageSize),
			selected: teams.find(team => team.id === params.selectedId) ?? null
		}
	if (request.url === '/crm/access/team/assignees') {
		const eligible = params.teamId === ids[0] ? [employees[0]] : employees
		const matches = eligible.filter(employee =>
			`${employee.displayName} ${employee.verifiedEmail}`
				.toLowerCase()
				.includes(String(params.search ?? '').toLowerCase())
		)
		return {
			...metadata,
			total: matches.length,
			items: matches.slice((page - 1) * pageSize, page * pageSize),
			selected:
				eligible.find(
					employee => employee.subject === params.selectedSubject
				) ?? null
		}
	}
	throw new Error('Unexpected endpoint')
}
type Props = {
	ctx?: AssigneeDirectoryContext
	scope?: WorkdayScope
	initial?: WorkdayPeopleFilterValue
}
const Harness = ({
	ctx = context(),
	scope = 'ALL',
	initial = {}
}: Props) => {
	const [value, setValue] = useState(initial)
	return (
		<form
			onSubmit={event => {
				event.preventDefault()
				submitted(reference.current?.resolve())
			}}
		>
			<WorkdayPeopleFilters
				ref={reference}
				context={ctx}
				scope={scope}
				value={value}
				onChange={next => {
					changed(next)
					setValue(next)
				}}
			/>
			<button type="submit">Применить людей</button>
		</form>
	)
}
const view = (props: Props = {}) => (
	<QueryClientProvider client={client}>
		<Harness {...props} />
	</QueryClientProvider>
)
const teamSelect = () =>
	screen.getByRole('combobox', {
		name: 'Отдел задач'
	}) as HTMLSelectElement
const employeeSelect = () =>
	screen.getByRole('combobox', { name: 'Сотрудник' }) as HTMLSelectElement
const ready = () =>
	screen.findByRole('option', {
		name: 'Сотрудник 1 · employee-1@example.com'
	})
const apply = () =>
	fireEvent.click(screen.getByRole('button', { name: 'Применить людей' }))
const mainForm = (
	value: Filters = { ...initialWorkdayFilters(), scope: 'ALL' },
	ctx = context()
) => (
	<QueryClientProvider client={client}>
		<WorkdayFilters
			value={value}
			view="list"
			allowedScopes={['MINE', 'TEAM', 'ALL']}
			peopleContext={ctx}
			onChange={submitted}
			onViewChange={vi.fn()}
		/>
	</QueryClientProvider>
)
beforeEach(() => {
	live = true
	client = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	reference = createRef<WorkdayPeopleFiltersHandle>()
	vi.clearAllMocks()
	vi.mocked(authenticatedRequest).mockImplementation(
		async request => responseFor(request) as never
	)
})
afterEach(() => {
	cleanup()
	client.clear()
})

describe('Workday scoped people filters', () => {
	it('does not request directories or widen MINE, and clears a previous people draft only on explicit apply', () => {
		render(
			view({
				scope: 'MINE',
				initial: { teamId: ids[0], assigneeSubject: employees[0].subject }
			})
		)
		expect(screen.getByText(/В режиме «Мои задачи»/)).toBeTruthy()
		expect(screen.queryByRole('combobox')).toBeNull()
		expect(authenticatedRequest).not.toHaveBeenCalled()
		expect(changed).not.toHaveBeenCalled()
		expect(submitted).not.toHaveBeenCalled()
		apply()
		expect(submitted).toHaveBeenCalledExactlyOnceWith({})
	})
	it('uses two bounded public reads and explicit employee selection, with no automatic first result', async () => {
		render(view())
		await ready()
		expect(employeeSelect().value).toBe('')
		expect(changed).not.toHaveBeenCalled()
		expect(authenticatedRequest).toHaveBeenCalledTimes(2)
		expect(
			vi
				.mocked(authenticatedRequest)
				.mock.calls.every(
					([request]) =>
						request.method === 'GET' && request.params?.pageSize === '20'
				)
		).toBe(true)
		fireEvent.change(employeeSelect(), {
			target: { value: employees[0].membershipId }
		})
		await waitFor(() => expect(employeeSelect().disabled).toBe(false))
		apply()
		expect(submitted).toHaveBeenLastCalledWith({
			assigneeSubject: employees[0].subject
		})
		expect(screen.getByRole('option', { name: 'Все отделы' })).toBeTruthy()
		expect(screen.queryByRole('option', { name: 'Без отдела' })).toBeNull()
	})
	it('loads both selectors by server page and preserves the exact selected employee on other pages', async () => {
		render(view({ initial: { assigneeSubject: employees[0].subject } }))
		await ready()
		fireEvent.click(
			within(
				screen.getByRole('navigation', { name: 'Страницы сотрудников' })
			).getByRole('button', { name: 'Далее' })
		)
		await screen.findByRole('option', {
			name: 'Сотрудник 21 · employee-21@example.com'
		})
		expect(employeeSelect().value).toBe(employees[0].membershipId)
		fireEvent.click(
			within(
				screen.getByRole('navigation', { name: 'Страницы отделов' })
			).getByRole('button', { name: 'Далее' })
		)
		await screen.findByRole('option', { name: 'Отдел 21' })
		expect(authenticatedRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				url: '/crm/access/team/options',
				params: expect.objectContaining({ page: '2', pageSize: '20' })
			})
		)
		expect(authenticatedRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				url: '/crm/access/team/assignees',
				params: expect.objectContaining({
					page: '2',
					pageSize: '20',
					selectedSubject: employees[0].subject
				})
			})
		)
		apply()
		expect(submitted).toHaveBeenLastCalledWith({
			assigneeSubject: employees[0].subject
		})
	})
	it('searches employees on the server without submitting the surrounding form', async () => {
		render(view())
		await ready()
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Поиск сотрудника' }),
			{ target: { value: 'Сотрудник 21' } }
		)
		fireEvent.keyDown(
			screen.getByRole('textbox', { name: 'Поиск сотрудника' }),
			{ key: 'Enter' }
		)
		await screen.findByRole('option', {
			name: 'Сотрудник 21 · employee-21@example.com'
		})
		expect(submitted).not.toHaveBeenCalled()
		expect(authenticatedRequest).toHaveBeenLastCalledWith(
			expect.objectContaining({
				params: expect.objectContaining({
					search: 'Сотрудник 21',
					page: '1'
				})
			})
		)
	})
	it('keeps an unavailable selected employee until explicitly cleared instead of substituting the first row', async () => {
		render(view({ initial: { assigneeSubject: 'unavailable-employee' } }))
		await ready()
		expect(employeeSelect().value).toBe('current-unavailable')
		expect(screen.getByRole('alert').textContent).toContain('недоступен')
		expect(changed).not.toHaveBeenCalled()
		apply()
		expect(submitted).toHaveBeenLastCalledWith(null)
		fireEvent.click(
			screen.getByRole('button', {
				name: 'Все сотрудники выбранной области'
			})
		)
		apply()
		expect(submitted).toHaveBeenLastCalledWith({})
	})
	it('narrows employee options by a confirmed selected team and never resets a now-unavailable employee automatically', async () => {
		render(view({ initial: { assigneeSubject: employees[20].subject } }))
		await ready()
		fireEvent.change(teamSelect(), { target: { value: ids[0] } })
		await waitFor(() => expect(employeeSelect().disabled).toBe(false))
		await waitFor(() =>
			expect(employeeSelect().value).toBe('current-unavailable')
		)
		expect(authenticatedRequest).toHaveBeenLastCalledWith(
			expect.objectContaining({
				url: '/crm/access/team/assignees',
				params: expect.objectContaining({
					teamId: ids[0],
					selectedSubject: employees[20].subject
				})
			})
		)
		expect(changed).toHaveBeenLastCalledWith({
			teamId: ids[0],
			assigneeSubject: employees[20].subject
		})
		apply()
		expect(submitted).toHaveBeenLastCalledWith(null)
	})
	it('keeps errors distinct from an empty directory and still allows clearing an invalid filter', async () => {
		vi.mocked(authenticatedRequest).mockImplementation(async request => {
			if (request.url.endsWith('/assignees'))
				throw new Error('private upstream detail')
			return responseFor(request) as never
		})
		render(view({ initial: { assigneeSubject: employees[0].subject } }))
		await screen.findByText(
			'Не удалось загрузить сотрудников. Текущий ответственный не изменён.'
		)
		expect(
			screen.queryByText('Доступных сотрудников пока нет.')
		).toBeNull()
		expect(document.body.textContent).not.toContain(
			'private upstream detail'
		)
		apply()
		expect(submitted).toHaveBeenLastCalledWith(null)
		fireEvent.click(
			screen.getByRole('button', {
				name: 'Все сотрудники выбранной области'
			})
		)
		apply()
		expect(submitted).toHaveBeenLastCalledWith({})
	})
	it('preserves draft across background authority refresh without remount loops or auto-apply', async () => {
		const rendered = render(
			view({
				initial: { assigneeSubject: employees[0].subject, teamId: ids[1] }
			})
		)
		await ready()
		const selector = employeeSelect()
		rendered.rerender(view({ ctx: { ...context(), canRead: false } }))
		expect(employeeSelect()).toBe(selector)
		expect(employeeSelect().disabled).toBe(true)
		expect(changed).not.toHaveBeenCalled()
		apply()
		expect(submitted).toHaveBeenLastCalledWith(null)
		rendered.rerender(view())
		await ready()
		await waitFor(() => expect(employeeSelect().disabled).toBe(false))
		expect(employeeSelect()).toBe(selector)
		apply()
		expect(submitted).toHaveBeenLastCalledWith({
			assigneeSubject: employees[0].subject,
			teamId: ids[1]
		})
		expect(authenticatedRequest).toHaveBeenCalledTimes(4)
	})
	it('checks live authority immediately before a filter submission', async () => {
		render(view({ initial: { assigneeSubject: employees[0].subject } }))
		await ready()
		live = false
		apply()
		expect(submitted).toHaveBeenLastCalledWith(null)
		fireEvent.change(employeeSelect(), {
			target: { value: employees[1].membershipId }
		})
		fireEvent.change(screen.getByLabelText('Отдел задач'), {
			target: { value: ids[1] }
		})
		expect(changed).not.toHaveBeenCalled()
		expect(toast).not.toHaveBeenCalled()
	})
	it('resumes directory reads when the parent live guard catches up in a layout effect', async () => {
		const Parent = ({ canRead }: { canRead: boolean }) => {
			const committed = useRef(canRead)
			useLayoutEffect(() => {
				committed.current = canRead
			}, [canRead])
			return (
				<Harness
					ctx={{
						...context(),
						canRead,
						isCurrent: () => live && committed.current
					}}
					initial={{ assigneeSubject: employees[0].subject }}
				/>
			)
		}
		const renderParent = (canRead: boolean) => (
			<QueryClientProvider client={client}>
				<Parent canRead={canRead} />
			</QueryClientProvider>
		)
		const rendered = render(renderParent(true))
		await ready()
		rendered.rerender(renderParent(false))
		expect(employeeSelect().disabled).toBe(true)
		rendered.rerender(renderParent(true))
		await ready()
		expect(employeeSelect().disabled).toBe(false)
		apply()
		expect(submitted).toHaveBeenLastCalledWith({
			assigneeSubject: employees[0].subject
		})
	})
	it('does not display a late employee response from the previous session revision', async () => {
		let complete!: (value: unknown) => void
		let previousRequest!: HttpRequest
		vi.mocked(authenticatedRequest).mockImplementation(async request => {
			if (request.url.endsWith('/assignees')) {
				previousRequest = request
				return (await new Promise<unknown>(resolve => {
					complete = resolve
				})) as never
			}
			return responseFor(request) as never
		})
		const rendered = render(
			view({ initial: { assigneeSubject: employees[0].subject } })
		)
		await waitFor(() => expect(complete).toBeTypeOf('function'))
		rendered.rerender(
			view({
				ctx: {
					...context(),
					sessionRevision: 2,
					accessToken: 'new-session-token',
					canRead: false
				}
			})
		)
		await act(async () => {
			complete(responseFor(previousRequest))
		})
		expect(
			screen.queryByRole('option', {
				name: 'Сотрудник 1 · employee-1@example.com'
			})
		).toBeNull()
		expect(employeeSelect().disabled).toBe(true)
		expect(reference.current?.resolve()).toBeNull()
		expect(changed).not.toHaveBeenCalled()
		expect(authenticatedRequest).toHaveBeenCalledTimes(2)
	})
	it.each([
		'OWN',
		'ANALYST',
		'foreign actor',
		'foreign workspace'
	] as const)('does not widen or query against %s authority', reason => {
		const ctx = context()
		if (reason === 'OWN')
			ctx.authority = {
				...ctx.authority!,
				role: 'MANAGER',
				dataScope: 'OWN'
			}
		if (reason === 'ANALYST')
			ctx.authority = { ...ctx.authority!, role: 'ANALYST' }
		if (reason === 'foreign actor')
			ctx.authority = { ...ctx.authority!, subject: 'another' }
		if (reason === 'foreign workspace')
			ctx.authority = { ...ctx.authority!, workspaceId: ids[0] }
		render(view({ ctx, scope: 'ALL' }))
		expect(authenticatedRequest).not.toHaveBeenCalled()
		apply()
		expect(submitted).toHaveBeenLastCalledWith(null)
	})
	it('permits READ_ONLY filtering while never issuing writes', async () => {
		const ctx = context()
		ctx.authority = { ...ctx.authority!, state: 'READ_ONLY' }
		render(
			view({ ctx, initial: { assigneeSubject: employees[0].subject } })
		)
		await ready()
		expect(employeeSelect().disabled).toBe(false)
		apply()
		expect(submitted).toHaveBeenLastCalledWith({
			assigneeSubject: employees[0].subject
		})
		expect(
			vi
				.mocked(authenticatedRequest)
				.mock.calls.every(([request]) => request.method === 'GET')
		).toBe(true)
	})
})

describe('people filters inside the Workday apply form', () => {
	it('preserves draft on scope switches and includes people filters only after explicit apply', async () => {
		render(
			mainForm({
				...initialWorkdayFilters(),
				scope: 'ALL',
				assigneeSubject: employees[0].subject,
				teamId: ids[1]
			})
		)
		fireEvent.click(screen.getByText('Поиск и дополнительные фильтры'))
		await ready()
		fireEvent.change(screen.getByLabelText('Чьи задачи'), {
			target: { value: 'MINE' }
		})
		expect(submitted).not.toHaveBeenCalled()
		fireEvent.change(screen.getByLabelText('Чьи задачи'), {
			target: { value: 'ALL' }
		})
		await ready()
		expect(employeeSelect().value).toBe(employees[0].membershipId)
		fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
		expect(submitted).toHaveBeenLastCalledWith({
			...initialWorkdayFilters(),
			scope: 'ALL',
			assigneeSubject: employees[0].subject,
			teamId: ids[1]
		})
		fireEvent.change(screen.getByLabelText('Чьи задачи'), {
			target: { value: 'MINE' }
		})
		fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
		expect(submitted).toHaveBeenLastCalledWith(initialWorkdayFilters())
	})
	it('blocks submit when a chosen department no longer belongs to the confirmed authority', async () => {
		const ctx = context()
		ctx.authority = { ...ctx.authority!, teamIds: [] }
		render(
			mainForm(
				{ ...initialWorkdayFilters(), scope: 'TEAM', teamId: ids[0] },
				ctx
			)
		)
		fireEvent.click(screen.getByText('Поиск и дополнительные фильтры'))
		fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
		expect(submitted).not.toHaveBeenCalled()
		expect(authenticatedRequest).not.toHaveBeenCalled()
		fireEvent.change(teamSelect(), { target: { value: '' } })
		fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
		expect(submitted).toHaveBeenLastCalledWith({
			...initialWorkdayFilters(),
			scope: 'TEAM'
		})
	})
})
