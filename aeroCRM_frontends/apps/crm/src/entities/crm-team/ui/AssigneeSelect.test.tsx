import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	act,
	cleanup,
	fireEvent,
	render,
	renderHook,
	screen,
	waitFor
} from '@testing-library/react'
import { useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import toast from 'react-hot-toast'
import { listAssigneeOptions } from '../api/assignee-options.api'
import {
	useAssigneeOptions,
	type AssigneeDirectoryContext
} from '../model/use-assignee-options'
import { AssigneeSelect } from './AssigneeSelect'
import type {
	AssigneeBinding,
	AssigneeOption,
	AssigneeOptionsPage,
	AssigneeOptionsRequest
} from '../model/assignee-options.contract'

vi.mock('../api/assignee-options.api', () => ({
	listAssigneeOptions: vi.fn()
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
const workspaceId = '11111111-1111-4111-8111-111111111111'
const otherWorkspace = '44444444-4444-4444-8444-444444444444'
const teamId = '55555555-5555-4555-8555-555555555555'
const employees: AssigneeOption[] = Array.from(
	{ length: 21 },
	(_, index) => ({
		subject: `employee-${index + 1}`,
		membershipId: `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`,
		displayName: `Сотрудник ${index + 1}`,
		verifiedEmail: `employee-${index + 1}@example.com`,
		role: 'MANAGER'
	})
)
const owner: AssigneeOption = {
	subject: 'owner',
	membershipId: '33333333-3333-4333-8333-333333333333',
	displayName: null,
	verifiedEmail: null,
	role: 'OWNER'
}
const authority = {
	workspaceId,
	subject: 'owner',
	role: 'OWNER',
	state: 'ACTIVE',
	dataScope: 'ALL' as const,
	teamIds: [teamId],
	permissions: ['sales:read', 'sales:manage']
}
const allItems = [...employees, owner]
const pageFor = (request: AssigneeOptionsRequest): AssigneeOptionsPage => {
	const visible =
		request.dataScope === 'OWN'
			? allItems.filter(item => item.subject === request.subject)
			: allItems
	const filtered = visible.filter(item =>
		`${item.displayName} ${item.verifiedEmail}`
			.toLowerCase()
			.includes(request.search?.toLowerCase() ?? '')
	)
	return {
		schemaVersion: 1,
		workspaceId: request.workspaceId,
		subject: request.subject,
		page: request.page,
		pageSize: request.pageSize,
		total: filtered.length,
		items: filtered.slice(
			(request.page - 1) * request.pageSize,
			request.page * request.pageSize
		),
		selected:
			visible.find(item => item.subject === request.selectedSubject) ??
			null
	}
}
let client: QueryClient
let live: boolean
let latest: ReturnType<typeof useAssigneeOptions>
const changed = vi.fn()
const submit = vi.fn()
const context = (): AssigneeDirectoryContext => ({
	workspaceId,
	subject: 'owner',
	accessToken: 'test-session-token',
	sessionRevision: 1,
	canRead: true,
	isCurrent: () => live,
	authority
})
type HarnessProps = {
	ctx?: AssigneeDirectoryContext
	initial?: AssigneeBinding | null
	selectedSubject?: string
	selectedTeam?: string
	disabled?: boolean
}
const Harness = ({
	ctx = context(),
	initial = null,
	selectedSubject = 'owner',
	selectedTeam,
	disabled
}: HarnessProps) => {
	const [value, setValue] = useState(initial)
	const options = useAssigneeOptions(ctx, {
		selectedSubject: value?.subject ?? selectedSubject,
		teamId: selectedTeam
	})
	useEffect(() => {
		latest = options
	}, [options])
	return (
		<form
			onSubmit={event => {
				event.preventDefault()
				submit()
			}}
		>
			<AssigneeSelect
				options={options}
				value={value}
				disabled={disabled}
				onChange={option => {
					changed(option)
					setValue(option)
				}}
			/>
			<button
				type="button"
				onClick={() =>
					changed(options.resolveBinding({ subject: ctx.subject! }))
				}
			>
				Выбрать создателя
			</button>
		</form>
	)
}
const view = (props: HarnessProps = {}) => (
	<QueryClientProvider client={client}>
		<Harness {...props} />
	</QueryClientProvider>
)
const select = () =>
	screen.getByRole('combobox', {
		name: 'Ответственный'
	}) as HTMLSelectElement
const ready = () =>
	screen.findByRole('option', {
		name: 'Сотрудник 1 · employee-1@example.com'
	})

beforeEach(() => {
	client = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	live = true
	vi.clearAllMocks()
	vi.mocked(listAssigneeOptions).mockImplementation(
		async (_token, request) => pageFor(request)
	)
})
afterEach(() => {
	cleanup()
	client.clear()
})

describe('scoped employee assignee selection', () => {
	it('confirms concurrent self lookups without sharing another consumer lifecycle', async () => {
		const wrapper = ({ children }: { children: React.ReactNode }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		)
		const first = renderHook(
			() => useAssigneeOptions(context(), { selectedSubject: 'owner' }),
			{ wrapper }
		)
		const second = renderHook(
			() => useAssigneeOptions(context(), { selectedSubject: 'owner' }),
			{ wrapper }
		)
		await waitFor(() => {
			expect(first.result.current.selected).toEqual(owner)
			expect(second.result.current.selected).toEqual(owner)
		})
		const oldFirst = first.result.current
		first.unmount()
		expect(oldFirst.resolveBinding(owner)).toBeNull()
		await act(async () => {
			expect(await second.result.current.refetch()).toBe(true)
		})
		expect(second.result.current.resolveBinding(owner)).toEqual(owner)
	})
	it('shows names, stores both bindings, pages on the server and preserves an out-of-page selected option', async () => {
		render(view())
		await ready()
		expect(changed).not.toHaveBeenCalled()
		expect(select().value).toBe('')
		fireEvent.change(select(), {
			target: { value: employees[0].membershipId }
		})
		await waitFor(() => expect(select().disabled).toBe(false))
		expect(changed).toHaveBeenLastCalledWith(employees[0])
		fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
		await screen.findByRole('option', {
			name: 'Сотрудник 21 · employee-21@example.com'
		})
		expect(select().value).toBe(employees[0].membershipId)
		expect(
			screen.queryByRole('option', {
				name: 'Сотрудник 2 · employee-2@example.com'
			})
		).toBeNull()
		expect(listAssigneeOptions).toHaveBeenLastCalledWith(
			'test-session-token',
			expect.objectContaining({
				page: 2,
				pageSize: 20,
				selectedSubject: employees[0].subject
			})
		)
		expect(document.body.textContent).not.toContain(
			employees[0].membershipId
		)
		expect(toast.success).toHaveBeenCalledWith('Ответственный выбран')
	})
	it('applies explicit search on the server, resets page and does not submit the enclosing task form', async () => {
		render(view())
		await ready()
		fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
		await screen.findByRole('option', {
			name: 'Сотрудник 21 · employee-21@example.com'
		})
		const calls = vi.mocked(listAssigneeOptions).mock.calls.length
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Поиск сотрудника' }),
			{ target: { value: ' Сотрудник 7 ' } }
		)
		expect(listAssigneeOptions).toHaveBeenCalledTimes(calls)
		fireEvent.keyDown(
			screen.getByRole('textbox', { name: 'Поиск сотрудника' }),
			{ key: 'Enter' }
		)
		await screen.findByRole('option', {
			name: 'Сотрудник 7 · employee-7@example.com'
		})
		expect(listAssigneeOptions).toHaveBeenLastCalledWith(
			'test-session-token',
			expect.objectContaining({ page: 1, search: 'Сотрудник 7' })
		)
		expect(
			screen.queryByRole('option', {
				name: 'Сотрудник 1 · employee-1@example.com'
			})
		).toBeNull()
		expect(submit).not.toHaveBeenCalled()
	})
	it('resolves the creator by exact subject, including an owner absent from the current page', async () => {
		render(view())
		await ready()
		fireEvent.click(
			screen.getByRole('button', { name: 'Выбрать создателя' })
		)
		expect(changed).toHaveBeenLastCalledWith(owner)
		expect(
			latest.resolveBinding({ subject: employees[0].subject })
		).toBeNull()
		expect(
			latest.resolveBinding({
				subject: owner.subject,
				membershipId: employees[0].membershipId
			})
		).toBeNull()
	})
	it('supports an owner-only workspace without inventing a CRM-member binding', async () => {
		vi.mocked(listAssigneeOptions).mockImplementation(
			async (_token, request) => ({
				...pageFor(request),
				total: 1,
				items: [owner],
				selected: owner
			})
		)
		render(view())
		await screen.findByRole('option', { name: 'Владелец пространства' })
		fireEvent.click(
			screen.getByRole('button', { name: 'Выбрать создателя' })
		)
		expect(changed).toHaveBeenLastCalledWith(owner)
		expect(screen.queryByRole('navigation')).toBeNull()
	})
	it('does not substitute the first result when an exact creator is unavailable', async () => {
		vi.mocked(listAssigneeOptions).mockImplementation(
			async (_token, request) => ({ ...pageFor(request), selected: null })
		)
		render(view())
		await ready()
		fireEvent.click(
			screen.getByRole('button', { name: 'Выбрать создателя' })
		)
		expect(changed).toHaveBeenLastCalledWith(null)
	})
	it.each([null, '66666666-6666-4666-8666-666666666666'])(
		'does not replace historical/changed membership %s until explicit selection',
		async membershipId => {
			render(
				view({ initial: { subject: employees[0].subject, membershipId } })
			)
			await ready()
			expect(select().value).toBe('current-unavailable')
			expect(screen.getByRole('alert').textContent).toContain(
				'Выберите сотрудника явно'
			)
			expect(changed).not.toHaveBeenCalled()
			expect(
				latest.resolveBinding({
					subject: employees[0].subject,
					membershipId
				})
			).toBeNull()
			fireEvent.change(select(), {
				target: { value: employees[0].membershipId }
			})
			expect(changed).toHaveBeenCalledExactlyOnceWith(employees[0])
		}
	)
	it('distinguishes directory errors from no results and allows retry without reassignment', async () => {
		vi.mocked(listAssigneeOptions).mockRejectedValueOnce(
			new Error('temporary private detail')
		)
		render(view())
		await screen.findByText(
			'Не удалось загрузить сотрудников. Текущий ответственный не изменён.'
		)
		expect(select().disabled).toBe(true)
		expect(
			screen.queryByText('Доступных сотрудников пока нет.')
		).toBeNull()
		expect(document.body.textContent).not.toContain('private detail')
		fireEvent.click(
			screen.getByRole('button', {
				name: 'Повторить загрузку сотрудников'
			})
		)
		await ready()
		expect(changed).not.toHaveBeenCalled()
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Поиск сотрудника' }),
			{ target: { value: 'не существует' } }
		)
		fireEvent.click(screen.getByRole('button', { name: 'Найти' }))
		await screen.findByText('По вашему запросу сотрудники не найдены.')
		expect(screen.queryByRole('alert')).toBeNull()
	})
	it('drops previously loaded names during a failed refresh', async () => {
		render(view())
		await ready()
		vi.mocked(listAssigneeOptions).mockRejectedValueOnce(
			new Error('refresh failed')
		)
		await act(async () => {
			await latest.refetch()
		})
		await screen.findByText(
			'Не удалось загрузить сотрудников. Текущий ответственный не изменён.'
		)
		expect(
			screen.queryByRole('option', {
				name: 'Сотрудник 1 · employee-1@example.com'
			})
		).toBeNull()
		expect(select().disabled).toBe(true)
		expect(latest.resolveBinding(employees[0])).toBeNull()
	})
	it('keeps READ_ONLY directory readable while the caller disables write controls', async () => {
		render(
			view({
				ctx: {
					...context(),
					authority: { ...authority, state: 'READ_ONLY' }
				},
				disabled: true
			})
		)
		await ready()
		expect(select().disabled).toBe(true)
		fireEvent.change(select(), {
			target: { value: employees[0].membershipId }
		})
		expect(changed).not.toHaveBeenCalled()
	})
	it.each([
		{ canRead: false },
		{ accessToken: undefined },
		{ subject: 'another' },
		{ sessionRevision: -1 },
		{ authority: undefined },
		{ authority: { ...authority, workspaceId: otherWorkspace } },
		{ authority: { ...authority, role: 'ANALYST' } },
		{ authority: { ...authority, state: 'PENDING' } },
		{ authority: { ...authority, permissions: [] } }
	])(
		'does not request the directory before confirmed matching authority %#',
		async override => {
			render(view({ ctx: { ...context(), ...override } }))
			expect(
				screen.getByText('Выбор доступен после подтверждения прав.')
			).toBeTruthy()
			expect(select().disabled).toBe(true)
			expect(listAssigneeOptions).not.toHaveBeenCalled()
		}
	)
	it('passes only an explicitly permitted team filter', async () => {
		const rendered = render(view({ selectedTeam: otherWorkspace }))
		expect(listAssigneeOptions).not.toHaveBeenCalled()
		rendered.rerender(view({ selectedTeam: teamId }))
		await ready()
		expect(listAssigneeOptions).toHaveBeenLastCalledWith(
			'test-session-token',
			expect.objectContaining({ teamId })
		)
	})
	it('blocks selection and creator callbacks immediately when the live authority guard changes', async () => {
		render(view())
		await ready()
		const oldOptions = latest
		live = false
		fireEvent.change(select(), {
			target: { value: employees[0].membershipId }
		})
		expect(changed).not.toHaveBeenCalled()
		expect(oldOptions.resolveBinding(owner)).toBeNull()
		expect(await oldOptions.refetch()).toBe(false)
		expect(listAssigneeOptions).toHaveBeenCalledTimes(1)
	})
	it.each(['revision', 'workspace', 'subject', 'permissions'] as const)(
		'discards late responses and loaded callbacks after a %s change',
		async field => {
			let complete!: (value: AssigneeOptionsPage) => void
			vi.mocked(listAssigneeOptions).mockReturnValueOnce(
				new Promise(resolve => {
					complete = resolve
				})
			)
			const rendered = render(view())
			const oldOptions = latest
			const initialRequest = vi.mocked(listAssigneeOptions).mock
				.calls[0][1]
			const next = context()
			if (field === 'revision') {
				next.sessionRevision = 2
				next.accessToken = 'new-token'
			}
			if (field === 'workspace') {
				next.workspaceId = otherWorkspace
				next.authority = { ...authority, workspaceId: otherWorkspace }
			}
			if (field === 'subject') {
				next.subject = 'new-actor'
				next.authority = { ...authority, subject: 'new-actor' }
			}
			if (field === 'permissions')
				next.authority = { ...authority, permissions: [] }
			vi.mocked(listAssigneeOptions).mockImplementation(
				async (_token, request) => ({
					...pageFor(request),
					total: 0,
					items: [],
					selected: null
				})
			)
			rendered.rerender(view({ ctx: next }))
			await act(async () => {
				complete(pageFor(initialRequest))
			})
			expect(
				screen.queryByRole('option', {
					name: 'Сотрудник 1 · employee-1@example.com'
				})
			).toBeNull()
			expect(oldOptions.isCurrent()).toBe(false)
			expect(oldOptions.resolveBinding(owner)).toBeNull()
			expect(changed).not.toHaveBeenCalled()
		}
	)
	it('does not reuse loaded names or a selected binding for a new session of the same actor', async () => {
		const rendered = render(view({ initial: owner }))
		await ready()
		const oldOptions = latest
		let complete!: (value: AssigneeOptionsPage) => void
		vi.mocked(listAssigneeOptions).mockReturnValueOnce(
			new Promise(resolve => {
				complete = resolve
			})
		)
		rendered.rerender(
			view({
				ctx: { ...context(), accessToken: 'new-token', sessionRevision: 2 }
			})
		)
		expect(
			screen.queryByRole('option', { name: 'Владелец пространства' })
		).toBeNull()
		expect(select().disabled).toBe(true)
		expect(oldOptions.resolveBinding(owner)).toBeNull()
		const request = vi.mocked(listAssigneeOptions).mock.calls.at(-1)![1]
		await act(async () => {
			complete({
				...pageFor(request),
				total: 0,
				items: [],
				selected: null
			})
		})
		await waitFor(() => expect(latest.loading).toBe(false))
		expect(changed).not.toHaveBeenCalled()
		expect(select().value).toBe('current-unavailable')
	})
	it('resolves a fresh reply after background authority revalidation with structural sharing', async () => {
		const rendered = render(view({ initial: owner }))
		await ready()
		const oldOptions = latest
		rendered.rerender(view({ ctx: { ...context(), canRead: false } }))
		expect(select().disabled).toBe(true)
		expect(oldOptions.resolveBinding(owner)).toBeNull()
		rendered.rerender(view())
		await ready()
		await waitFor(() => expect(select().disabled).toBe(false))
		expect(latest.resolveBinding(owner)).toEqual(owner)
		expect(oldOptions.resolveBinding(owner)).toBeNull()
		expect(listAssigneeOptions).toHaveBeenCalledTimes(2)
		expect(changed).not.toHaveBeenCalled()
	})
	it.each(['before', 'after'] as const)(
		'isolates an in-flight lookup when authority returns and the old reply arrives %s the fresh reply',
		async oldReplyOrder => {
			let completeOld!: (value: AssigneeOptionsPage) => void
			let completeFresh!: (value: AssigneeOptionsPage) => void
			vi.mocked(listAssigneeOptions)
				.mockReturnValueOnce(
					new Promise(resolve => {
						completeOld = resolve
					})
				)
				.mockReturnValueOnce(
					new Promise(resolve => {
						completeFresh = resolve
					})
				)
			const rendered = render(view({ initial: owner }))
			await waitFor(() =>
				expect(listAssigneeOptions).toHaveBeenCalledTimes(1)
			)
			const oldOptions = latest
			const oldRequest = vi.mocked(listAssigneeOptions).mock.calls[0][1]
			rendered.rerender(
				view({ initial: owner, ctx: { ...context(), canRead: false } })
			)
			expect(select().disabled).toBe(true)
			expect(oldOptions.isCurrent()).toBe(false)
			rendered.rerender(view({ initial: owner }))
			await waitFor(() =>
				expect(listAssigneeOptions).toHaveBeenCalledTimes(2)
			)
			const freshRequest = vi.mocked(listAssigneeOptions).mock.calls[1][1]
			expect(freshRequest).toEqual(oldRequest)
			const completeOldReply = async () => {
				await act(async () => {
					completeOld({
						...pageFor(oldRequest),
						selected: { ...owner, displayName: 'Устаревший владелец' }
					})
				})
			}
			if (oldReplyOrder === 'before') {
				await completeOldReply()
				expect(latest.loading).toBe(true)
				expect(latest.error).toBe(false)
				expect(latest.selected).toBeNull()
			}
			const freshOwner = { ...owner, displayName: 'Актуальный владелец' }
			await act(async () => {
				completeFresh({ ...pageFor(freshRequest), selected: freshOwner })
			})
			await waitFor(() =>
				expect(latest.resolveBinding(owner)).toEqual(freshOwner)
			)
			if (oldReplyOrder === 'after') await completeOldReply()
			expect(latest.resolveBinding(owner)).toEqual(freshOwner)
			expect(latest.error).toBe(false)
			expect(select().disabled).toBe(false)
			expect(screen.queryByText('Устаревший владелец')).toBeNull()
			expect(oldOptions.resolveBinding(owner)).toBeNull()
			expect(changed).not.toHaveBeenCalled()
		}
	)
	it('invalidates callbacks on unmount and ignores late completions', async () => {
		const rendered = render(view())
		await ready()
		const oldOptions = latest
		rendered.unmount()
		expect(oldOptions.resolveBinding(owner)).toBeNull()
		expect(await oldOptions.refetch()).toBe(false)
	})
	it('shows a confirmed empty directory separately from an unconfirmed authority frame', async () => {
		live = false
		const rendered = render(
			view({ ctx: { ...context(), canRead: false } })
		)
		expect(listAssigneeOptions).not.toHaveBeenCalled()
		expect(
			screen.getByText('Выбор доступен после подтверждения прав.')
		).toBeTruthy()
		live = true
		vi.mocked(listAssigneeOptions).mockImplementation(
			async (_token, request) => ({
				...pageFor(request),
				total: 0,
				items: [],
				selected: null
			})
		)
		rendered.rerender(view())
		await screen.findByText('Доступных сотрудников пока нет.')
		expect(screen.queryByRole('alert')).toBeNull()
		expect(changed).not.toHaveBeenCalled()
	})
	it('ignores an old page response after the server search changes', async () => {
		render(view())
		await ready()
		const oldPage = latest
		let complete!: (value: AssigneeOptionsPage) => void
		vi.mocked(listAssigneeOptions).mockReturnValueOnce(
			new Promise(resolve => {
				complete = resolve
			})
		)
		fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
		const oldRequest = vi.mocked(listAssigneeOptions).mock.calls.at(-1)![1]
		expect(oldPage.resolveBinding(owner)).toBeNull()
		act(() => {
			latest.setSearch('Сотрудник 7')
		})
		await screen.findByRole('option', {
			name: 'Сотрудник 7 · employee-7@example.com'
		})
		await act(async () => {
			complete(pageFor(oldRequest))
		})
		expect(
			screen.queryByRole('option', {
				name: 'Сотрудник 21 · employee-21@example.com'
			})
		).toBeNull()
		expect(latest.search).toBe('Сотрудник 7')
		expect(latest.page).toBe(1)
	})
	it('does not persist bearer credentials inside query keys and bounds pagination/search', async () => {
		render(view())
		await ready()
		expect(
			JSON.stringify(
				client
					.getQueryCache()
					.getAll()
					.map(query => query.queryKey)
			)
		).not.toContain('test-session-token')
		act(() => {
			latest.setPage(0)
			latest.setPage(3)
			latest.setPage(1.5)
			latest.setSearch('x'.repeat(201))
		})
		expect(listAssigneeOptions).toHaveBeenCalledTimes(1)
		expect(latest.page).toBe(1)
	})
	it('renders backend display names as plain text, with email fallback and a single shared native select', async () => {
		const unsafe = {
			...employees[0],
			displayName: '<img src=x onerror=alert(1)>'
		}
		const fallback = { ...employees[1], displayName: '  ' }
		vi.mocked(listAssigneeOptions).mockImplementation(
			async (_token, request) => ({
				...pageFor(request),
				total: 2,
				items: [unsafe, fallback]
			})
		)
		render(view())
		await screen.findByRole('option', {
			name: '<img src=x onerror=alert(1)> · employee-1@example.com'
		})
		expect(
			screen.getByRole('option', { name: 'employee-2@example.com' })
		).toBeTruthy()
		expect(document.querySelector('img')).toBeNull()
		expect(screen.getAllByRole('combobox')).toHaveLength(1)
	})
})
