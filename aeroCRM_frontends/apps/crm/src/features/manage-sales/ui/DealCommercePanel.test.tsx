import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import type { CommerceContext } from '../model/use-commerce-command'
import { DealCommercePanel } from './DealCommercePanel'

const panelMocks = vi.hoisted(() => ({
	getDealCommerce: vi.fn(),
	getDealPayments: vi.fn(),
	listDealQuotes: vi.fn(),
	listCommerceHistory: vi.fn(),
	listCatalogItems: vi.fn(),
	replaceDealLines: vi.fn(),
	onSuccess: undefined as ((result: unknown) => void) | undefined,
	autoConfirm: true,
	submitted: [] as unknown[],
	execute: vi.fn()
}))

vi.mock('@/entities/sales/api/commerce.api', () => ({
	getDealCommerce: panelMocks.getDealCommerce,
	getDealPayments: panelMocks.getDealPayments,
	listDealQuotes: panelMocks.listDealQuotes,
	listCommerceHistory: panelMocks.listCommerceHistory,
	listCatalogItems: panelMocks.listCatalogItems,
	replaceDealLines: panelMocks.replaceDealLines,
	saveDealLineToCatalog: vi.fn(),
	createDealPayment: vi.fn(),
	correctDealPayment: vi.fn(),
	createDealQuote: vi.fn(),
	downloadDealQuote: vi.fn()
}))

vi.mock('../model/use-commerce-command', () => ({
	useCommerceCommand: (
		_context: unknown,
		_intent: string,
		_send: unknown,
		onSuccess: (result: unknown) => void
	) => {
		panelMocks.onSuccess = onSuccess
		return {
			error: null,
			uncertain: false,
			running: false,
			blocked: false,
			enabled: true,
			locked: false,
			reset: () => false,
			execute: panelMocks.execute
		}
	}
}))

vi.mock('../model/use-sales-assignees', () => ({
	useSalesAssignees: () => () => 'Вы'
}))

const workspaceId = '11111111-1111-4111-8111-111111111111'
const dealId = '22222222-2222-4222-8222-222222222222'
const lineId = '33333333-3333-4333-8333-333333333333'
const lineData = (
	version: number,
	amountMinor: number,
	name = 'Монтаж'
) => ({
	schemaVersion: 1 as const,
	dealId,
	dealVersion: version,
	mode: 'LINES' as const,
	amountMinor,
	items: [
		{
			id: lineId,
			catalogItemId: null,
			kind: 'SERVICE' as const,
			name,
			unit: 'час',
			quantity: '1.000',
			unitPriceMinor: amountMinor,
			discountMinor: 0,
			totalMinor: amountMinor
		}
	]
})
const context = {
	workspace: { workspaceId, canWrite: true },
	session: { accessToken: 'token', userId: 'actor' },
	sessionRevision: 1,
	permissions: {
		data: {
			subject: 'actor',
			state: 'ACTIVE',
			permissions: ['sales:read', 'sales:write']
		},
		isError: false,
		isPending: false,
		isFetching: false,
		refetch: vi.fn().mockResolvedValue({ isError: false })
	},
	canRead: true,
	canWrite: true,
	key: [workspaceId, 'actor', 1],
	scopeKey: 'all'
} as unknown as CommerceContext

let client: QueryClient
let currentLines: ReturnType<typeof lineData>

const mountPanel = (customerDetailsSuggestion?: string) =>
	render(
		<QueryClientProvider client={client}>
			<DealCommercePanel
				context={context}
				dealId={dealId}
				customerDetailsSuggestion={customerDetailsSuggestion}
				onSaved={vi.fn()}
				onBusyChange={vi.fn()}
			/>
		</QueryClientProvider>
	)

describe('DealCommercePanel version refreshes', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		panelMocks.autoConfirm = true
		panelMocks.submitted = []
		panelMocks.onSuccess = undefined
		client = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false }
			}
		})
		currentLines = lineData(1, 100)
		panelMocks.getDealCommerce.mockImplementation(async () => currentLines)
		panelMocks.getDealPayments.mockResolvedValue({
			schemaVersion: 1,
			dealId,
			dealVersion: 1,
			amountMinor: 100,
			netPaidMinor: 0,
			balanceMinor: 100,
			overpaidMinor: 0,
			items: []
		})
		panelMocks.listDealQuotes.mockResolvedValue([])
		panelMocks.listCommerceHistory.mockResolvedValue([])
		panelMocks.listCatalogItems.mockResolvedValue({
			schemaVersion: 1,
			workspaceId,
			total: 0,
			page: 1,
			pageSize: 100,
			items: []
		})
		panelMocks.execute.mockImplementation(async (input: unknown) => {
			panelMocks.submitted.push(input)
			if (!panelMocks.autoConfirm) return
			const saved = await panelMocks.replaceDealLines(
				'token',
				workspaceId,
				dealId,
				input
			)
			await panelMocks.onSuccess?.(saved)
		})
	})
	afterEach(() => {
		cleanup()
		client.clear()
	})

	it('keeps one editor and shows the saved amount after a successful version update', async () => {
		panelMocks.replaceDealLines.mockImplementation(async () => {
			currentLines = lineData(2, 200, 'Монтаж обновлён')
			return currentLines
		})
		mountPanel()

		const price = await screen.findByRole('textbox', {
			name: 'Цена за единицу, ₽'
		})
		fireEvent.change(price, { target: { value: '2,00' } })
		fireEvent.click(
			screen.getByRole('button', { name: 'Сохранить состав' })
		)

		await waitFor(() =>
			expect(
				screen.getAllByRole('heading', { name: 'Товары и услуги' })
			).toHaveLength(1)
		)
		expect(
			(
				screen.getByRole('textbox', {
					name: 'Название позиции'
				}) as HTMLInputElement
			).value
		).toBe('Монтаж обновлён')
		expect(
			screen.getByText('Сохранённая сумма сделки').parentElement
				?.textContent
		).toContain('2,00')
	})

	it('uses client-card details only after an explicit choice and adds them to the quote command', async () => {
		const suggestion =
			'ООО Ромашка\nИНН: 7707083893\nАнна Клиентова\nanna@example.ru'
		mountPanel(suggestion)
		const customerDetails = await screen.findByRole('textbox', {
			name: 'Реквизиты и контакты клиента'
		})
		expect(customerDetails).toHaveProperty('value', '')
		const fill = screen.getByRole('button', {
			name: 'Заполнить из карточки клиента'
		})
		expect(fill).toHaveProperty('disabled', false)
		fireEvent.click(fill)
		expect(customerDetails).toHaveProperty('value', suggestion)
		expect(panelMocks.execute).not.toHaveBeenCalled()
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Продавец / исполнитель' }),
			{ target: { value: 'ООО Исполнитель' } }
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Сформировать КП' })
		)
		await waitFor(() => expect(panelMocks.execute).toHaveBeenCalledOnce())
		expect(panelMocks.submitted[0]).toMatchObject({
			action: 'quote',
			customerDetails: suggestion
		})
	})

	it('leaves a manual customer entry alone and disables oversized card suggestions', async () => {
		mountPanel('Д'.repeat(1001))
		const customerDetails = await screen.findByRole('textbox', {
			name: 'Реквизиты и контакты клиента'
		})
		const fill = screen.getByRole('button', {
			name: 'Заполнить из карточки клиента'
		})
		expect(fill).toHaveProperty('disabled', true)
		fireEvent.change(customerDetails, {
			target: { value: 'Реквизиты, введённые вручную' }
		})
		fireEvent.click(fill)
		expect(customerDetails).toHaveProperty(
			'value',
			'Реквизиты, введённые вручную'
		)
		expect(panelMocks.execute).not.toHaveBeenCalled()
	})

	it('preserves a dirty draft against an external version refresh and saves its original base version', async () => {
		mountPanel()
		const name = await screen.findByRole('textbox', {
			name: 'Название позиции'
		})
		fireEvent.change(name, { target: { value: 'Черновой монтаж' } })
		const refreshed = lineData(2, 300, 'Внешнее изменение')
		const linesKey = ['sales', 'commerce-lines', ...context.key, dealId]
		act(() => client.setQueryData(linesKey, refreshed))

		await waitFor(() =>
			expect(
				(
					screen.getByRole('textbox', {
						name: 'Название позиции'
					}) as HTMLInputElement
				).value
			).toBe('Черновой монтаж')
		)
		expect(screen.getByText(/Сделка изменилась/)).not.toBeNull()
		panelMocks.autoConfirm = false
		fireEvent.click(
			screen.getByRole('button', { name: 'Сохранить состав' })
		)

		await waitFor(() => expect(panelMocks.submitted).toHaveLength(1))
		expect(panelMocks.submitted[0]).toMatchObject({
			action: 'lines',
			expectedVersion: 1,
			lines: [expect.objectContaining({ name: 'Черновой монтаж' })]
		})
	})

	it('keeps the unsaved lines draft and original CAS version after a transient refresh failure', async () => {
		mountPanel()
		const name = await screen.findByRole('textbox', {
			name: 'Название позиции'
		})
		fireEvent.change(name, { target: { value: 'Черновой монтаж' } })

		panelMocks.getDealCommerce.mockRejectedValueOnce(
			new AuthenticatedApiError('temporary', 'Network unavailable')
		)
		const linesKey = ['sales', 'commerce-lines', ...context.key, dealId]
		await act(async () => {
			await client.refetchQueries({ queryKey: linesKey, exact: true })
		})
		expect(client.getQueryState(linesKey)?.status).toBe('error')
		expect(client.getQueryState(linesKey)?.error).toBeInstanceOf(
			AuthenticatedApiError
		)

		const retainedName = screen.getByRole('textbox', {
			name: 'Название позиции'
		}) as HTMLInputElement
		expect(retainedName.value).toBe('Черновой монтаж')
		expect(panelMocks.getDealCommerce).toHaveBeenCalledTimes(2)
		await screen.findByRole('button', { name: 'Повторить' })
		expect(
			screen.getByRole('button', { name: 'Сохранить состав' })
		).toHaveProperty('disabled', true)

		fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
		await waitFor(() =>
			expect(
				screen.getByRole('button', { name: 'Сохранить состав' })
			).toHaveProperty('disabled', false)
		)

		panelMocks.autoConfirm = false
		fireEvent.click(
			screen.getByRole('button', { name: 'Сохранить состав' })
		)
		await waitFor(() => expect(panelMocks.submitted).toHaveLength(1))
		expect(panelMocks.submitted[0]).toMatchObject({
			action: 'lines',
			expectedVersion: 1,
			lines: [expect.objectContaining({ name: 'Черновой монтаж' })]
		})
	})

	it('drops cached draft fields when the server revokes access to the deal composition', async () => {
		mountPanel()
		fireEvent.change(
			await screen.findByRole('textbox', { name: 'Название позиции' }),
			{ target: { value: 'Не показывать после отзыва прав' } }
		)
		panelMocks.getDealCommerce.mockRejectedValueOnce(
			new AuthenticatedApiError('forbidden', 'Access revoked')
		)
		const linesKey = ['sales', 'commerce-lines', ...context.key, dealId]
		await act(async () => {
			await client.refetchQueries({ queryKey: linesKey, exact: true })
		})
		expect(client.getQueryState(linesKey)?.status).toBe('error')

		await waitFor(() =>
			expect(
				screen.queryByRole('textbox', { name: 'Название позиции' })
			).toBeNull()
		)
		expect(screen.getByText('Состав сделки недоступен')).toBeTruthy()
		expect(panelMocks.submitted).toHaveLength(0)
	})
})
