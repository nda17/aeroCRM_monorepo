import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	getSalesAnalyticsOverview,
	type SalesAnalyticsOverview
} from '@/entities/sales'
import { useSalesSession } from '@/features/manage-sales'
import { resetSessionStore, useSessionStore } from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import AnalyticsScreen from './AnalyticsScreen'

vi.mock('@/entities/sales', () => ({ getSalesAnalyticsOverview: vi.fn() }))
vi.mock('@/entities/crm-team', () => ({
	useAssigneeLabels: () => ({
		loading: false,
		error: false,
		lookup: () => ({ employee: { displayName: 'Иван Петров' } })
	}),
	assigneeDisplayName: (employee: { displayName: string }) =>
		employee.displayName
}))
vi.mock('@/features/manage-sales', () => ({
	useSalesSession: vi.fn(),
	salesMoney: (amount: number) => `${amount / 100} ₽`
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))

const workspaceId = '11111111-1111-4111-8111-111111111111'
const response: SalesAnalyticsOverview = {
	schemaVersion: 1,
	currency: 'RUB',
	items: [
		{ status: 'OPEN', count: 2, amountMinor: 55000 },
		{ status: 'WON', count: 3, amountMinor: 200000 },
		{ status: 'LOST', count: 1, amountMinor: 15000 }
	],
	overview: {
		dateBasis: 'CREATED_AT',
		period: null,
		previous: null,
		asOf: '2026-09-14T09:00:00.000Z',
		attention: { open: 5, overdue: 2, withoutNextAction: 1 },
		assignees: null
	}
}
const makeContext = () => ({
	session: { userId: 'analyst', accessToken: 'local-session' },
	sessionRevision: 1,
	workspace: { workspaceId, canWrite: false },
	key: [workspaceId, 'analyst', 1],
	canRead: false,
	canWrite: false,
	permissions: {
		isPending: false,
		isError: false,
		isFetching: false,
		data: {
			workspaceId,
			subject: 'analyst',
			role: 'ANALYST',
			state: 'READ_ONLY',
			dataScope: 'ALL',
			teamIds: [],
			permissions: ['sales:analytics']
		},
		refetch: vi.fn()
	}
})
let context: ReturnType<typeof makeContext>
let client: QueryClient
beforeEach(() => {
	vi.clearAllMocks()
	context = makeContext()
	context.permissions.refetch.mockImplementation(async () => ({
		isError: false,
		data: context.permissions.data
	}))
	vi.mocked(useSalesSession).mockImplementation(
		() => context as unknown as ReturnType<typeof useSalesSession>
	)
	vi.mocked(getSalesAnalyticsOverview).mockResolvedValue(response)
	client = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	resetSessionStore()
})
afterEach(() => {
	cleanup()
	client.clear()
	resetSessionStore()
})
const mount = () =>
	render(
		<QueryClientProvider client={client}>
			<AnalyticsScreen />
		</QueryClientProvider>
	)

describe('AnalyticsScreen live scoped aggregates', () => {
	it('allows the aggregate-only ANALYST role in READ_ONLY without contact/deal permissions', async () => {
		mount()
		const won = await screen.findByRole('article', {
			name: 'Успешно закрыты'
		})
		expect(within(won).getByText('3')).toBeTruthy()
		expect(within(won).getByText('2000 ₽')).toBeTruthy()
		expect(screen.getByText('75%')).toBeTruthy()
		expect(screen.getByText('Без ограничения по дате')).toBeTruthy()
		expect(screen.queryByRole('link')).toBeNull()
		expect(
			screen.queryByText('Результаты и загрузка сотрудников')
		).toBeNull()
		expect(getSalesAnalyticsOverview).toHaveBeenCalledExactlyOnceWith(
			'local-session',
			workspaceId,
			expect.objectContaining({
				createdFrom: expect.any(String),
				createdTo: expect.any(String),
				assigneePage: 1
			})
		)
	})
	it('keeps current workload visible when the selected creation cohort is empty', async () => {
		vi.mocked(getSalesAnalyticsOverview).mockResolvedValue({
			...response,
			items: response.items.map(item => ({
				...item,
				count: 0,
				amountMinor: 0
			}))
		})
		mount()
		await screen.findByText(
			'За выбранный период сделок нет. Контроль текущей работы показан выше.'
		)
		expect(screen.getByText('Контроль работы сейчас')).toBeTruthy()
		expect(screen.getByText('5')).toBeTruthy()
	})
	it('does not invent a win percentage before any deal has closed', async () => {
		vi.mocked(getSalesAnalyticsOverview).mockResolvedValue({
			...response,
			items: response.items.map(item =>
				item.status === 'OPEN'
					? item
					: { ...item, count: 0, amountMinor: 0 }
			)
		})
		mount()
		await screen.findByText('Закрытых сделок пока нет')
		expect(screen.queryByText('0%')).toBeNull()
	})
	it('hides aggregates and sends no request if permission is missing', async () => {
		context.permissions.data.permissions = []
		mount()
		await screen.findByText('Аналитика недоступна')
		expect(getSalesAnalyticsOverview).not.toHaveBeenCalled()
	})
	it('hides data during permission revalidation', async () => {
		context.permissions.isFetching = true
		mount()
		await screen.findByText('Проверяем доступ к аналитике')
		expect(getSalesAnalyticsOverview).not.toHaveBeenCalled()
	})
	it('shows error, never fake zero values, and refreshes through authorization', async () => {
		vi.mocked(getSalesAnalyticsOverview).mockRejectedValueOnce(
			new AuthenticatedApiError('temporary', 'Unavailable')
		)
		mount()
		await screen.findByText('Отчёт временно недоступен')
		expect(screen.queryByRole('article')).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: 'Обновить' }))
		await screen.findByRole('article', { name: 'В работе' })
		expect(context.permissions.refetch).toHaveBeenCalledTimes(1)
	})
	it('does not sign out a newer session after an old request returns 401', async () => {
		useSessionStore.setState({
			status: 'authenticated',
			sessionRevision: 2,
			session: { userId: 'new-user', accessToken: 'new-session' }
		})
		vi.mocked(getSalesAnalyticsOverview).mockRejectedValue(
			new AuthenticatedApiError('unauthorized', 'Expired')
		)
		mount()
		await screen.findByText('Отчёт временно недоступен')
		expect(useSessionStore.getState().session?.accessToken).toBe(
			'new-session'
		)
	})
	it('does not reuse ALL aggregate data after scope changes to OWN', async () => {
		const view = mount()
		await screen.findByText('75%')
		vi.mocked(getSalesAnalyticsOverview).mockImplementation(
			() => new Promise(() => {})
		)
		context.permissions.data.dataScope = 'OWN'
		context.permissions.data.role = 'MANAGER'
		view.rerender(
			<QueryClientProvider client={client}>
				<AnalyticsScreen />
			</QueryClientProvider>
		)
		await waitFor(() =>
			expect(getSalesAnalyticsOverview).toHaveBeenCalledTimes(2)
		)
		expect(screen.queryByText('75%')).toBeNull()
	})
})

describe('Analytics period controls and exact drilldown', () => {
	it('sends Moscow calendar bounds for an inclusive custom date range and can reset to all time', async () => {
		mount()
		await screen.findByRole('article', { name: 'В работе' })
		fireEvent.change(screen.getByLabelText('Создание сделок'), {
			target: { value: 'custom' }
		})
		fireEvent.change(screen.getByLabelText('С'), {
			target: { value: '2026-09-01' }
		})
		fireEvent.change(screen.getByLabelText('По'), {
			target: { value: '2026-09-07' }
		})
		fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
		await waitFor(() =>
			expect(getSalesAnalyticsOverview).toHaveBeenLastCalledWith(
				'local-session',
				workspaceId,
				{
					createdFrom: '2026-08-31T21:00:00.000Z',
					createdTo: '2026-09-07T21:00:00.000Z',
					assigneePage: 1
				}
			)
		)
		fireEvent.change(screen.getByLabelText('Создание сделок'), {
			target: { value: 'all' }
		})
		await waitFor(() =>
			expect(getSalesAnalyticsOverview).toHaveBeenLastCalledWith(
				'local-session',
				workspaceId,
				{ assigneePage: 1 }
			)
		)
	})
	it('links period status counts to that exact creation cohort and workload to all-time open deals', async () => {
		context.canRead = true
		context.permissions.data.role = 'OWNER'
		context.permissions.data.permissions.push('sales:read')
		const period = {
			createdFrom: '2026-09-01T00:00:00.000Z',
			createdTo: '2026-09-08T00:00:00.000Z'
		}
		vi.mocked(getSalesAnalyticsOverview).mockResolvedValue({
			...response,
			overview: {
				...response.overview,
				period,
				previous: {
					period: {
						createdFrom: '2026-08-25T00:00:00.000Z',
						createdTo: period.createdFrom
					},
					items: response.items.map(item => ({
						...item,
						count: item.count - 1,
						amountMinor: item.count === 1 ? 0 : item.amountMinor
					}))
				},
				assignees: {
					page: 1,
					pageSize: 20,
					hasMore: false,
					items: [
						{
							assignedToSubject: 'employee-1',
							items: response.items,
							open: 3,
							overdue: 2,
							withoutNextAction: 1
						}
					]
				}
			}
		})
		mount()
		const won = await screen.findByRole('link', {
			name: 'Успешно закрыты: 3, открыть сделки'
		})
		const wonParams = new URL(won.getAttribute('href')!, 'http://local')
			.searchParams
		expect(Object.fromEntries(wonParams)).toEqual({
			status: 'WON',
			...period
		})
		const overdue = screen.getByRole('link', {
			name: 'С просроченными действиями: 2, открыть сделки'
		})
		expect(
			Object.fromEntries(
				new URL(overdue.getAttribute('href')!, 'http://local').searchParams
			)
		).toEqual({
			status: 'OPEN',
			overdue: 'true',
			overdueBefore: response.overview.asOf
		})
		const employee = screen.getByRole('link', {
			name: 'Иван Петров, создано: 6, открыть сделки'
		})
		expect(
			Object.fromEntries(
				new URL(employee.getAttribute('href')!, 'http://local')
					.searchParams
			)
		).toEqual({ assignedToSubject: 'employee-1', ...period })
		expect(screen.getByText('+1 к прошлому периоду (+50%)')).toBeTruthy()
	})
	it('rejects inverted custom periods without fetching an unfiltered report', async () => {
		mount()
		await screen.findByRole('article', { name: 'В работе' })
		fireEvent.change(screen.getByLabelText('Создание сделок'), {
			target: { value: 'custom' }
		})
		fireEvent.change(screen.getByLabelText('С'), {
			target: { value: '2026-09-08' }
		})
		fireEvent.change(screen.getByLabelText('По'), {
			target: { value: '2026-09-01' }
		})
		fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
		expect(getSalesAnalyticsOverview).toHaveBeenCalledTimes(1)
	})
})
