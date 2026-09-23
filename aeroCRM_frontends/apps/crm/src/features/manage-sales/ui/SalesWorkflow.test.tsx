import {
	getCustomer,
	listCustomers,
	type Customer
} from '@/entities/customer'
import { useSessionStore } from '@/entities/session'
import { getCrmPermissions } from '@/entities/crm-access'
import {
	PendingCommandProvider,
	commandOwner
} from '@/shared/lib/pending-command'
import {
	getSalesDeal,
	listSalesTimeline,
	mutateSales,
	type SalesDeal,
	type SalesPipeline
} from '@/entities/sales'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSalesSession } from '../model/use-sales-session'
import { CreateDealDrawer, parseRublesToMinor } from './CreateDealDrawer'
import { DealDetailsDrawer } from './DealDetailsDrawer'
import { CompleteTaskDrawer } from './CompleteTaskDrawer'

vi.mock('@/entities/customer', () => ({
	listCustomers: vi.fn(),
	getCustomer: vi.fn()
}))
vi.mock('@/features/edit-customer', () => ({
	CustomerEditor: ({
		initialName,
		onSaved,
		onClose
	}: {
		initialName: string
		onSaved: (record: Customer) => void
		onClose: () => void
	}) => (
		<section aria-label="Создание контакта внутри сделки">
			<span>{initialName}</span>
			<button
				onClick={() => {
					onSaved({
						...contact,
						id: '88888888-8888-4888-8888-888888888888',
						name: initialName
					})
					onClose()
				}}
			>
				Сохранить нового клиента
			</button>
		</section>
	)
}))
vi.mock('@/entities/crm-access', () => ({ getCrmPermissions: vi.fn() }))
vi.mock('@/entities/sales', () => ({
	getSalesDeal: vi.fn(),
	listSalesTimeline: vi.fn(),
	mutateSales: vi.fn()
}))
vi.mock('../model/use-sales-session', () => ({ useSalesSession: vi.fn() }))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), {
		success: vi.fn(),
		error: vi.fn(),
		dismiss: vi.fn()
	})
}))
const workspaceId = '11111111-1111-4111-8111-111111111111'
const date = '2026-09-05T10:00:00.000Z'
const contact: Customer = {
	kind: 'contacts',
	id: '22222222-2222-4222-8222-222222222222',
	workspaceId,
	name: 'Клиент для сделки',
	notes: null,
	phone: null,
	email: null,
	companyId: null,
	createdBySubject: 'actor',
	teamId: null,
	version: 1,
	archivedAt: null,
	createdAt: date,
	updatedAt: date
}
const pipeline: SalesPipeline = {
	id: '33333333-3333-4333-8333-333333333333',
	workspaceId,
	name: 'Продажи',
	templateKey: 'universal-sales',
	templateVersion: 1,
	stages: [
		{
			id: '44444444-4444-4444-8444-444444444444',
			key: 'new',
			name: 'Новая',
			position: 1,
			state: 'OPEN'
		},
		{
			id: '55555555-5555-4555-8555-555555555555',
			key: 'won',
			name: 'Успешно',
			position: 2,
			state: 'WON'
		}
	]
}
const deal: SalesDeal = {
	id: '66666666-6666-4666-8666-666666666666',
	workspaceId,
	version: 3,
	title: 'Заказ клиента',
	currency: 'RUB',
	amountMinor: 125050,
	pipelineId: pipeline.id,
	stageId: pipeline.stages[0].id,
	status: 'OPEN',
	contactId: contact.id,
	contactName: contact.name,
	assignedToSubject: 'actor',
	teamId: null,
	archivedAt: null,
	createdAt: date,
	updatedAt: date,
	nextTask: {
		id: '77777777-7777-4777-8777-777777777777',
		workspaceId,
		dealId: '66666666-6666-4666-8666-666666666666',
		version: 1,
		title: 'Позвонить клиенту',
		dueAt: date,
		status: 'OPEN',
		assignedToSubject: 'actor',
		completedAt: null,
		createdAt: date,
		updatedAt: date
	}
}
let client: QueryClient
let context: ReturnType<typeof useSalesSession>
beforeEach(() => {
	vi.clearAllMocks()
	useSessionStore.setState({
		status: 'authenticated',
		session: { accessToken: 'token', userId: 'actor' },
		sessionRevision: 1
	})
	vi.mocked(getCrmPermissions).mockResolvedValue({
		subject: 'actor',
		state: 'ACTIVE',
		permissions: ['sales:write']
	} as never)
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
	client = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false }
		}
	})
	context = {
		workspace: { workspaceId, canWrite: true },
		session: { accessToken: 'token', userId: 'actor' },
		sessionRevision: 1,
		permissions: {
			data: {
				subject: 'actor',
				state: 'ACTIVE',
				permissions: ['sales:read', 'sales:write', 'customers:read']
			},
			isError: false,
			isPending: false,
			isFetching: false,
			refetch: vi.fn().mockResolvedValue({ isError: false })
		},
		canRead: true,
		canWrite: true,
		key: [workspaceId, 'actor', 1]
	} as unknown as ReturnType<typeof useSalesSession>
	vi.mocked(useSalesSession).mockImplementation(() => context)
	vi.mocked(listCustomers).mockResolvedValue({
		schemaVersion: 1,
		page: 1,
		pageSize: 20,
		total: 1,
		items: [contact]
	})
	vi.mocked(getCustomer).mockResolvedValue(contact)
	vi.mocked(getSalesDeal).mockResolvedValue(deal)
	vi.mocked(listSalesTimeline).mockResolvedValue({
		schemaVersion: 1,
		page: 1,
		pageSize: 10,
		total: 0,
		items: []
	})
	vi.mocked(mutateSales).mockResolvedValue(deal)
})
afterEach(() => {
	cleanup()
	client.clear()
})
const mount = (children: ReactNode) =>
	render(
		<QueryClientProvider client={client}>
			<PendingCommandProvider owner={commandOwner('actor', 1)}>
				{children}
			</PendingCommandProvider>
		</QueryClientProvider>
	)

describe('Sales workflow forms', () => {
	it('converts rubles without floating point or negative / overflowing amounts', () => {
		expect(parseRublesToMinor('1250,50')).toBe(125050)
		expect(parseRublesToMinor('0.01')).toBe(1)
		expect(parseRublesToMinor('0')).toBe(0)
		for (const value of ['-1', '1e3', '1.001', '21474836.48', 'NaN'])
			expect(parseRublesToMinor(value)).toBeNull()
	})
	it('creates a contact-linked deal and first action using server contact paging', async () => {
		const onClose = vi.fn()
		mount(
			<CreateDealDrawer
				pipelines={[pipeline]}
				onClose={onClose}
				onSaved={vi.fn()}
			/>
		)
		fireEvent.click(
			await screen.findByRole('button', { name: contact.name })
		)
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Название сделки' }),
			{ target: { value: 'Новый заказ' } }
		)
		fireEvent.change(screen.getByRole('textbox', { name: 'Сумма, ₽' }), {
			target: { value: '1250,50' }
		})
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Первое действие' }),
			{ target: { value: 'Связаться' } }
		)
		fireEvent.change(screen.getByLabelText(/Срок действия/), {
			target: { value: '2026-09-07T12:30' }
		})
		fireEvent.submit(document.getElementById('create-sales-deal')!)
		await waitFor(() => expect(mutateSales).toHaveBeenCalledTimes(1))
		expect(listCustomers).toHaveBeenCalledWith(
			'token',
			'contacts',
			workspaceId,
			1,
			10,
			''
		)
		expect(vi.mocked(mutateSales).mock.calls[0][1]).toMatchObject({
			workspaceId,
			mutation: {
				kind: 'create',
				title: 'Новый заказ',
				amountMinor: 125050,
				contactId: contact.id,
				pipelineId: pipeline.id,
				stageId: pipeline.stages[0].id,
				nextTask: {
					title: 'Связаться',
					dueAt: new Date('2026-09-07T12:30').toISOString()
				}
			}
		})
		expect(onClose).toHaveBeenCalledTimes(1)
	})
	it('recovers a failed contact refresh after selection without losing the selected contact or deal draft', async () => {
		mount(
			<CreateDealDrawer
				pipelines={[pipeline]}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		fireEvent.click(
			await screen.findByRole('button', { name: contact.name })
		)
		fireEvent.change(screen.getByLabelText(/Название сделки/), {
			target: { value: 'Сохранённый черновик' }
		})
		vi.mocked(listCustomers).mockRejectedValue(
			new AuthenticatedApiError('temporary', 'Service unavailable')
		)
		await act(async () => {
			await client.invalidateQueries({
				queryKey: ['crm-customers', workspaceId]
			})
		})
		await screen.findByText(
			'Не удалось обновить контакты. Выбранный клиент и поля сделки сохранены. Повторите проверку, чтобы создать сделку.'
		)
		expect(
			(
				screen.getByRole('button', {
					name: 'Создать сделку'
				}) as HTMLButtonElement
			).disabled
		).toBe(true)
		expect(screen.getByText(contact.name)).toBeTruthy()
		vi.mocked(listCustomers).mockResolvedValue({
			schemaVersion: 1,
			page: 1,
			pageSize: 10,
			total: 1,
			items: [contact]
		})
		fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
		await waitFor(() =>
			expect(
				(
					screen.getByRole('button', {
						name: 'Создать сделку'
					}) as HTMLButtonElement
				).disabled
			).toBe(false)
		)
		expect(
			(screen.getByLabelText(/Название сделки/) as HTMLInputElement).value
		).toBe('Сохранённый черновик')
		expect(screen.getByText(contact.name)).toBeTruthy()
		expect(mutateSales).not.toHaveBeenCalled()
	})
	it('keeps the deal draft and selects the newly created contact without navigation', async () => {
		context.permissions.data!.permissions.push('customers:write')
		mount(
			<CreateDealDrawer
				pipelines={[pipeline]}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		await screen.findByRole('button', { name: contact.name })
		fireEvent.change(screen.getByLabelText(/^Название сделки/), {
			target: { value: 'Не потерять черновик' }
		})
		fireEvent.change(screen.getByLabelText(/^Сумма, ₽/), {
			target: { value: '100,50' }
		})
		fireEvent.change(screen.getByLabelText(/^Срок действия/), {
			target: { value: '2026-09-20T14:30' }
		})
		fireEvent.change(screen.getByLabelText('Поиск контакта'), {
			target: { value: 'Новый клиент' }
		})
		fireEvent.click(
			screen.getByRole('button', { name: 'Создать контакт' })
		)
		expect(
			screen.getByRole('region', {
				name: 'Создание контакта внутри сделки'
			}).textContent
		).toContain('Новый клиент')
		fireEvent.click(
			screen.getByRole('button', { name: 'Сохранить нового клиента' })
		)
		await waitFor(() =>
			expect(
				screen.getByRole('button', { name: 'Создать сделку' })
			).toHaveProperty('disabled', false)
		)
		expect(screen.getByLabelText(/^Название сделки/)).toHaveProperty(
			'value',
			'Не потерять черновик'
		)
		expect(screen.getByLabelText(/^Сумма, ₽/)).toHaveProperty(
			'value',
			'100,50'
		)
		fireEvent.submit(document.getElementById('create-sales-deal')!)
		await waitFor(() => expect(mutateSales).toHaveBeenCalledOnce())
		expect(vi.mocked(mutateSales).mock.calls[0][1].mutation).toMatchObject(
			{
				kind: 'create',
				title: 'Не потерять черновик',
				amountMinor: 10050,
				contactId: '88888888-8888-4888-8888-888888888888'
			}
		)
	})
	it('does not label an open deal without a next action as closed', async () => {
		vi.mocked(getSalesDeal).mockResolvedValue({ ...deal, nextTask: null })
		mount(
			<DealDetailsDrawer
				id={deal.id}
				pipelines={[pipeline]}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		expect(await screen.findByText('Нет следующего действия')).toBeTruthy()
		expect(screen.queryByText('Сделка закрыта')).toBeNull()
	})
	it('does not create without contacts permission', async () => {
		context.permissions.data!.permissions = ['sales:read', 'sales:write']
		mount(
			<CreateDealDrawer
				pipelines={[pipeline]}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		expect(
			await screen.findByText(
				'Нет доступа к контактам для создания сделки.'
			)
		).toBeTruthy()
		expect(listCustomers).not.toHaveBeenCalled()
		fireEvent.submit(document.getElementById('create-sales-deal')!)
		expect(mutateSales).not.toHaveBeenCalled()
	})
	it('preserves the opened version on background refresh and requires explicit conflict review', async () => {
		vi.mocked(mutateSales).mockRejectedValueOnce(
			new AuthenticatedApiError('conflict', 'Версия изменилась')
		)
		mount(
			<DealDetailsDrawer
				id={deal.id}
				pipelines={[pipeline]}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		fireEvent.change(
			await screen.findByRole('combobox', { name: 'Следующий этап' }),
			{ target: { value: pipeline.stages[1].id } }
		)
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Что сделано / результат' }),
			{ target: { value: 'Договорились' } }
		)
		act(() =>
			client.setQueryData(['sales', 'deal', ...context.key, deal.id], {
				...deal,
				version: 4
			})
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Сохранить результат' })
		)
		await waitFor(() => expect(mutateSales).toHaveBeenCalledTimes(1))
		expect(vi.mocked(mutateSales).mock.calls[0][1].mutation).toEqual({
			kind: 'transition',
			id: deal.id,
			expectedVersion: 3,
			targetStageId: pipeline.stages[1].id,
			outcome: 'Договорились'
		})
		expect(await screen.findByText('Версия изменилась')).toBeTruthy()
	})
	it('keeps read-only deal data visible but disables mutation fieldsets', async () => {
		context.canWrite = false
		context.workspace.canWrite = false
		mount(
			<DealDetailsDrawer
				id={deal.id}
				pipelines={[pipeline]}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		expect(await screen.findByText(contact.name)).toBeTruthy()
		expect(
			screen
				.getByRole('combobox', { name: 'Следующий этап' })
				.closest('fieldset')
		).toHaveProperty('disabled', true)
		fireEvent.click(
			screen.getByRole('button', { name: 'Архивировать сделку' })
		)
		expect(mutateSales).not.toHaveBeenCalled()
	})
	it('hides a previously selected task when fresh read authorization fails', () => {
		context.canRead = false
		context.canWrite = false
		mount(
			<CompleteTaskDrawer
				task={deal.nextTask!}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		expect(screen.queryByText(/Позвонить клиенту/)).toBeNull()
		expect(getSalesDeal).not.toHaveBeenCalled()
	})
})
