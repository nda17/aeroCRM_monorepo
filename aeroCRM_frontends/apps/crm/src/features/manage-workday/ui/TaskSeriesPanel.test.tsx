import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionStore, useSessionStore } from '@/entities/session'
import {
	listTaskSeries,
	mutateTaskSeries
} from '@/entities/crm-task-series'
import {
	commandOwner,
	PendingCommandProvider
} from '@/shared/lib/pending-command'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import {
	page,
	row,
	membershipId,
	workspaceId
} from '@/entities/crm-task-series/model/task-series.test-fixtures'
import { TaskSeriesPanel } from './TaskSeriesPanel'

let canWrite = true
let client: QueryClient
const person = {
	subject: 'actor',
	membershipId,
	displayName: 'Иван Иванов',
	verifiedEmail: null,
	role: 'OWNER' as const
}
const deal = {
	id: membershipId,
	title: 'Встреча с клиентом',
	status: 'OPEN',
	archivedAt: null,
	teamId: null
}
vi.mock('@/entities/crm-workday', async () => ({
	...(await vi.importActual<typeof import('@/entities/crm-workday')>(
		'@/entities/crm-workday'
	)),
	useWorkdaySession: () => ({
		workspace: { workspaceId, canWrite },
		session: useSessionStore.getState().session,
		sessionRevision: useSessionStore.getState().sessionRevision,
		canRead: true,
		canWrite,
		key: ['series-test'],
		scopeKey: 'series-test',
		current: () => true,
		authorize: async () => 'token',
		permissions: {
			data: {
				workspaceId,
				subject: 'actor',
				role: 'OWNER',
				dataScope: 'ALL',
				state: canWrite ? 'ACTIVE' : 'READ_ONLY',
				teamIds: [],
				permissions: ['sales:read', 'sales:write']
			}
		}
	})
}))
vi.mock('@/entities/crm-task-series', async () => ({
	...(await vi.importActual<typeof import('@/entities/crm-task-series')>(
		'@/entities/crm-task-series'
	)),
	listTaskSeries: vi.fn(),
	mutateTaskSeries: vi.fn()
}))
vi.mock('@/entities/crm-team', async () => ({
	...(await vi.importActual<typeof import('@/entities/crm-team')>(
		'@/entities/crm-team'
	)),
	useAssigneeOptions: () => ({
		selected: person,
		resolveBinding: () => person,
		loading: false
	}),
	useTeamOptions: () => ({ validSelection: true }),
	useAssigneeLabels: () => ({
		loading: false,
		lookup: () => ({ employee: person })
	}),
	AssigneeSelect: () => <p>Ответственный: Иван Иванов</p>,
	TeamSelect: () => null
}))
vi.mock('@/entities/sales', async () => ({
	...(await vi.importActual<typeof import('@/entities/sales')>(
		'@/entities/sales'
	)),
	getSalesDeal: async () => deal
}))
vi.mock('./WorkdayCreateTaskDrawer', () => ({
	WorkdayDealChoice: ({
		onChange
	}: {
		onChange: (value: unknown) => void
	}) => <button onClick={() => onChange(deal)}>Выбрать сделку</button>
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
const owner = () => {
	const state = useSessionStore.getState()
	return commandOwner(state.session?.userId, state.sessionRevision)
}
const Wrapper = ({ children }: PropsWithChildren) => (
	<QueryClientProvider client={client}>
		<PendingCommandProvider owner={owner()} readOwner={owner}>
			{children}
		</PendingCommandProvider>
	</QueryClientProvider>
)
beforeEach(() => {
	Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
		configurable: true,
		value: function (this: HTMLDialogElement) {
			this.open = true
		}
	})
	Object.defineProperty(HTMLDialogElement.prototype, 'close', {
		configurable: true,
		value: function (this: HTMLDialogElement) {
			this.open = false
		}
	})
	vi.clearAllMocks()
	resetSessionStore()
	canWrite = true
	useSessionStore
		.getState()
		.setAuthenticated({ accessToken: 'token', userId: 'actor' })
	client = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	vi.mocked(listTaskSeries).mockResolvedValue(page as never)
	vi.mocked(mutateTaskSeries).mockImplementation(
		async (_token, command) => ({
			...row,
			...(command.mutation.kind === 'status'
				? { version: 2, status: command.mutation.status }
				: {})
		})
	)
})
afterEach(() => {
	cleanup()
	client.clear()
})
const open = async () => {
	render(<TaskSeriesPanel onClose={vi.fn()} />, { wrapper: Wrapper })
	await screen.findByRole('heading', { name: row.title })
}
describe('Planner recurring series workflow', () => {
	it('shows the real server next appearance and employee name, and requests server pages', async () => {
		vi.mocked(listTaskSeries).mockResolvedValueOnce({
			...page,
			total: 11
		} as never)
		await open()
		expect(screen.getByText('Иван Иванов')).toBeTruthy()
		expect(screen.getByText(/15 сент. 2026 г./)).toBeTruthy()
		fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
		await waitFor(() =>
			expect(listTaskSeries).toHaveBeenCalledWith(
				'token',
				expect.objectContaining({ page: 2, pageSize: 10 })
			)
		)
	})
	it('creates a standalone series with chosen frequency, timezone and confirmed owner binding', async () => {
		await open()
		fireEvent.click(screen.getByRole('button', { name: 'Новая серия' }))
		fireEvent.change(screen.getByLabelText('Название задачи'), {
			target: { value: 'Отчёт в конце месяца' }
		})
		fireEvent.change(screen.getByLabelText('Повторение'), {
			target: { value: 'MONTHLY' }
		})
		fireEvent.change(screen.getByLabelText('Дата первого повторения'), {
			target: { value: '2026-09-30' }
		})
		fireEvent.change(screen.getByLabelText('Часовой пояс'), {
			target: { value: 'Asia/Vladivostok' }
		})
		fireEvent.click(screen.getByRole('button', { name: 'Создать серию' }))
		await waitFor(() =>
			expect(mutateTaskSeries).toHaveBeenCalledWith(
				'token',
				expect.objectContaining({
					actorMembershipId: null,
					mutation: expect.objectContaining({
						kind: 'create',
						frequency: 'MONTHLY',
						startDate: '2026-09-30',
						dealId: null,
						content: expect.objectContaining({
							timeZone: 'Asia/Vladivostok',
							assignee: { subject: 'actor', membershipId: null }
						})
					})
				})
			)
		)
	})
	it('creates a linked series after a fresh deal check and does not accept a typed deal id', async () => {
		await open()
		fireEvent.click(screen.getByRole('button', { name: 'Новая серия' }))
		fireEvent.change(screen.getByLabelText('Название задачи'), {
			target: { value: 'Созвониться' }
		})
		fireEvent.change(screen.getByLabelText('Дата первого повторения'), {
			target: { value: '2026-09-09' }
		})
		fireEvent.change(screen.getByLabelText('Связь со сделкой'), {
			target: { value: 'deal' }
		})
		fireEvent.click(screen.getByRole('button', { name: 'Выбрать сделку' }))
		fireEvent.click(screen.getByRole('button', { name: 'Создать серию' }))
		await waitFor(() =>
			expect(mutateTaskSeries).toHaveBeenCalledWith(
				'token',
				expect.objectContaining({
					mutation: expect.objectContaining({
						dealId: membershipId,
						teamId: null
					})
				})
			)
		)
	})
	it('edits only future content and keeps the series calendar immutable', async () => {
		await open()
		fireEvent.click(screen.getByRole('button', { name: 'Изменить' }))
		expect(screen.getByLabelText('Повторение')).toHaveProperty(
			'disabled',
			true
		)
		expect(
			screen.getByLabelText('Дата первого повторения')
		).toHaveProperty('disabled', true)
		fireEvent.change(screen.getByLabelText('Название задачи'), {
			target: { value: 'Новый отчёт' }
		})
		fireEvent.click(
			screen.getByRole('button', { name: 'Сохранить будущие повторы' })
		)
		await waitFor(() => expect(mutateTaskSeries).toHaveBeenCalled())
		const mutation = vi.mocked(mutateTaskSeries).mock.calls[0][1].mutation
		expect(mutation).toMatchObject({
			kind: 'edit',
			id: row.id,
			expectedVersion: 1
		})
		expect(mutation).not.toHaveProperty('frequency')
	})
	it('confirms cancellation explicitly; pause uses a versioned command', async () => {
		await open()
		fireEvent.click(screen.getByRole('button', { name: 'Отменить серию' }))
		expect(mutateTaskSeries).not.toHaveBeenCalled()
		fireEvent.click(screen.getByRole('button', { name: 'Оставить серию' }))
		fireEvent.click(screen.getByRole('button', { name: 'Приостановить' }))
		await waitFor(() =>
			expect(mutateTaskSeries).toHaveBeenCalledWith(
				'token',
				expect.objectContaining({
					mutation: {
						kind: 'status',
						id: row.id,
						expectedVersion: 1,
						status: 'PAUSED'
					}
				})
			)
		)
	})
	it('keeps reading available in READ_ONLY but disables every mutation', async () => {
		canWrite = false
		await open()
		for (const name of [
			'Новая серия',
			'Изменить',
			'Приостановить',
			'Отменить серию'
		])
			expect(screen.getByRole('button', { name })).toHaveProperty(
				'disabled',
				true
			)
		expect(mutateTaskSeries).not.toHaveBeenCalled()
	})
	it('retries an uncertain save with the original UUID and payload', async () => {
		vi.mocked(mutateTaskSeries).mockRejectedValueOnce(
			new AuthenticatedApiError('temporary', 'Ответ временно недоступен')
		)
		await open()
		fireEvent.click(screen.getByRole('button', { name: 'Приостановить' }))
		const retry = await screen.findByRole('button', {
			name: 'Проверить результат'
		})
		fireEvent.click(retry)
		await waitFor(() => expect(mutateTaskSeries).toHaveBeenCalledTimes(2))
		expect(vi.mocked(mutateTaskSeries).mock.calls[1][1]).toEqual(
			vi.mocked(mutateTaskSeries).mock.calls[0][1]
		)
	})
})
