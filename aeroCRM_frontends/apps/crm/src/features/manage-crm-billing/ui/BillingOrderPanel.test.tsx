import {
	getBillingOrder,
	type BillingOrderResponse
} from '@/entities/crm-billing'
import { resetSessionStore, useSessionStore } from '@/entities/session'
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
import toast from 'react-hot-toast'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { useBillingContext } from '../model/use-billing-context'
import { BillingOrderPanel } from './BillingOrderPanel'

vi.mock('@/entities/crm-billing', async original => ({
	...(await original<object>()),
	getBillingOrder: vi.fn()
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
const workspaceId = 'b531b13e-3624-4ec5-b66d-f24373b0b374'
const id = 'b1c1d3d9-dc5a-4a50-98ba-c79b3895db62'
const safeUrl =
	'https://yoomoney.ru/checkout/payments/v2/contract?orderId=synthetic-provider:1'
const initial: BillingOrderResponse = {
	schemaVersion: 1,
	workspaceId,
	serverTime: '2026-09-05T12:00:00.000Z',
	order: {
		id,
		workspaceId,
		version: 1,
		kind: 'ONE_TIME',
		state: 'PENDING',
		cycle: 'MONTHLY',
		totalSeats: 2,
		amountMinor: '129900',
		currency: 'RUB',
		policyVersion: 2,
		confirmationUrl: safeUrl,
		canVerify: true,
		checkoutExpiresAt: '2026-09-05T13:00:00.000Z',
		createdAt: '2026-09-05T12:00:00.000Z',
		succeededAt: null,
		fulfillment: 'NONE',
		periodId: null,
		startsAt: null,
		expiresAt: null
	}
}
let client: QueryClient
let context: ReturnType<typeof useBillingContext>
const onVerify = vi.fn(async () => {})
const onRefreshContext = vi.fn()
beforeEach(() => {
	vi.clearAllMocks()
	resetSessionStore()
	useSessionStore
		.getState()
		.setAuthenticated({ userId: 'owner', accessToken: 'synthetic-token' })
	client = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	context = {
		ready: true,
		actor: { workspaceId },
		authorize: vi.fn(async () => 'synthetic-token')
	} as never
	vi.mocked(getBillingOrder).mockResolvedValue(initial)
})
afterEach(() => {
	cleanup()
	client.clear()
	resetSessionStore()
	vi.useRealTimers()
	vi.restoreAllMocks()
})
const view = (locked = false) => (
	<QueryClientProvider client={client}>
		<BillingOrderPanel
			context={context}
			orderId={id}
			locked={locked}
			onVerify={onVerify}
			onRefreshContext={onRefreshContext}
		/>
	</QueryClientProvider>
)

describe('read-only order polling and explicit provider verification', () => {
	it('separates paid confirmation from scheduled period and access admission', async () => {
		vi.mocked(getBillingOrder).mockResolvedValue({
			...initial,
			order: {
				...initial.order,
				state: 'SUCCEEDED',
				canVerify: false,
				succeededAt: initial.serverTime,
				fulfillment: 'SCHEDULED',
				periodId: id,
				startsAt: '2026-09-10T12:00:00.000Z',
				expiresAt: '2026-10-10T12:00:00.000Z'
			}
		})
		render(view())
		await screen.findByText('Оплата подтверждена')
		expect(screen.getByText('Оплаченный период запланирован')).toBeTruthy()
		expect(
			screen.getByText(/Допуск к разделам CRM проверяется отдельно/)
		).toBeTruthy()
		expect(
			screen.queryByRole('button', { name: 'Перейти к оплате в YooKassa' })
		).toBeNull()
	})
	it('uses only GET on ordinary refresh and requires an explicit provider verification action', async () => {
		render(view())
		await screen.findByText('Ожидает оплаты или подтверждения')
		fireEvent.click(
			screen.getByRole('button', { name: 'Проверить статус оплаты' })
		)
		await waitFor(() => expect(getBillingOrder).toHaveBeenCalledTimes(2))
		expect(onVerify).not.toHaveBeenCalled()
		fireEvent.click(
			screen.getByRole('button', {
				name: 'Запросить проверку у провайдера'
			})
		)
		expect(onVerify).toHaveBeenCalledExactlyOnceWith(initial.order)
	})
	it('does not offer provider verification without backend bound-provider evidence', async () => {
		vi.mocked(getBillingOrder).mockResolvedValue({
			...initial,
			order: {
				...initial.order,
				state: 'UNKNOWN',
				canVerify: false,
				confirmationUrl: null
			}
		})
		render(view())
		await screen.findByText('Результат платежа уточняется')
		expect(
			screen.queryByRole('button', {
				name: 'Запросить проверку у провайдера'
			})
		).toBeNull()
		expect(screen.getByText(/Не оплачивайте второй заказ/)).toBeTruthy()
	})
	it('bounds automatic GET polling to ten attempts and never invokes a charge command', async () => {
		vi.useFakeTimers()
		render(view())
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0)
		})
		for (let attempt = 0; attempt < 12; attempt++)
			await act(async () => {
				await vi.advanceTimersByTimeAsync(3000)
			})
		expect(getBillingOrder).toHaveBeenCalledTimes(11)
		expect(onVerify).not.toHaveBeenCalled()
		expect(
			screen.getByText(
				/Автоматическая проверка приостановлена после 10 попыток/
			)
		).toBeTruthy()
	})
	it('checks fresh owner and fresh order before using the allowed provider redirect', async () => {
		const popup = {
			opener: window,
			location: { replace: vi.fn() },
			close: vi.fn()
		}
		vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
		render(view())
		await screen.findByRole('button', {
			name: 'Перейти к оплате в YooKassa'
		})
		fireEvent.click(
			screen.getByRole('button', { name: 'Перейти к оплате в YooKassa' })
		)
		await waitFor(() =>
			expect(popup.location.replace).toHaveBeenCalledExactlyOnceWith(
				safeUrl
			)
		)
		expect(context.authorize).toHaveBeenCalledTimes(1)
		expect(getBillingOrder).toHaveBeenCalledTimes(2)
		expect(popup.opener).toBeNull()
		expect(popup.close).not.toHaveBeenCalled()
	})
	it('does not navigate an unsafe or expired replacement link from a fresh response', async () => {
		const popup = {
			opener: window,
			location: { replace: vi.fn() },
			close: vi.fn()
		}
		vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
		vi.mocked(getBillingOrder)
			.mockResolvedValueOnce(initial)
			.mockResolvedValueOnce({
				...initial,
				order: {
					...initial.order,
					confirmationUrl: 'https://evil.invalid/'
				}
			})
		render(view())
		await screen.findByRole('button', {
			name: 'Перейти к оплате в YooKassa'
		})
		fireEvent.click(
			screen.getByRole('button', { name: 'Перейти к оплате в YooKassa' })
		)
		await waitFor(() => expect(popup.close).toHaveBeenCalled())
		expect(popup.location.replace).not.toHaveBeenCalled()
	})
	it('closes its blank popup and suppresses late callbacks after owner/session changes', async () => {
		const popup = {
			opener: window,
			location: { replace: vi.fn() },
			close: vi.fn()
		}
		vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
		let finish!: (result: BillingOrderResponse) => void
		vi.mocked(getBillingOrder)
			.mockResolvedValueOnce(initial)
			.mockImplementationOnce(
				() =>
					new Promise(resolve => {
						finish = resolve
					})
			)
		const { unmount } = render(view())
		await screen.findByRole('button', {
			name: 'Перейти к оплате в YooKassa'
		})
		fireEvent.click(
			screen.getByRole('button', { name: 'Перейти к оплате в YooKassa' })
		)
		await waitFor(() => expect(getBillingOrder).toHaveBeenCalledTimes(2))
		unmount()
		vi.mocked(toast.error).mockClear()
		vi.mocked(toast.success).mockClear()
		await act(async () => finish(initial))
		expect(popup.close).toHaveBeenCalled()
		expect(popup.location.replace).not.toHaveBeenCalled()
		expect(toast.error).not.toHaveBeenCalled()
		expect(toast.success).not.toHaveBeenCalled()
	})
	it('does not claim cancellation or a refund after an unknown/unauthorized read', async () => {
		vi.mocked(getBillingOrder).mockRejectedValue(
			new AuthenticatedApiError('unauthorized', 'Unknown')
		)
		render(view())
		await screen.findByRole('alert')
		expect(
			screen.getByText(/Это не означает отмену или отсутствие списания/)
		).toBeTruthy()
		expect(useSessionStore.getState().status).toBe('authenticated')
	})
})
