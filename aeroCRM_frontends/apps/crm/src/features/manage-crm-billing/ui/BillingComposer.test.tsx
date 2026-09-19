import {
	getBillingQuote,
	type BillingContext,
	type BillingMutation,
	type BillingQuote
} from '@/entities/crm-billing'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
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
import { BillingComposer } from './BillingComposer'

vi.mock('@/entities/crm-billing', async original => ({
	...(await original<object>()),
	getBillingQuote: vi.fn()
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
const workspaceId = 'b531b13e-3624-4ec5-b66d-f24373b0b374'
const id = 'b1c1d3d9-dc5a-4a50-98ba-c79b3895db62'
const policy = {
	policyVersion: 2,
	monthlyPriceMinor: 129900,
	yearlyPriceMinor: 1200000,
	additionalSeatMonthlyPriceMinor: 20000,
	additionalSeatYearlyPriceMinor: 200000,
	includedSeats: 2,
	graceDays: 3
}
const quote: BillingQuote = {
	schemaVersion: 1,
	workspaceId,
	billingVersion: '0',
	serverTime: '2026-09-05T12:00:00.000Z',
	validUntil: '2026-09-05T12:05:00.000Z',
	intent: 'CHECKOUT',
	cycle: 'MONTHLY',
	totalSeats: 2,
	amountMinor: '129900',
	currency: 'RUB',
	priceSnapshot: policy,
	startsAt: '2026-09-10T12:00:00.000Z',
	expiresAt: '2026-10-10T12:00:00.000Z',
	period: null,
	consent: {
		version: 'wincrm-v1',
		text: '<script>not executable</script> exact server consent'
	}
}
let current: boolean
let context: ReturnType<typeof useBillingContext>
let data: BillingContext
const onSubmit = vi
	.fn<(build: (commandId: string) => BillingMutation) => Promise<void>>()
	.mockResolvedValue(undefined)
beforeEach(() => {
	vi.clearAllMocks()
	current = true
	context = {
		ready: true,
		actor: {
			workspaceId,
			session: { userId: 'owner', accessToken: 'token' },
			current: () => current
		},
		authorize: vi.fn(async () => 'token')
	} as never
	data = {
		billing: {
			billingVersion: '0',
			policy,
			period: null,
			renewal: { version: 1 }
		},
		capacity: { usedSeats: 1 },
		capabilities: {
			quote: true,
			checkout: true,
			changeSeats: true,
			confirmRenewalPrice: true
		}
	} as never
	vi.mocked(getBillingQuote).mockResolvedValue(quote)
})
afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
})
const view = (
	intent: BillingQuote['intent'] = 'CHECKOUT',
	locked = false
) => (
	<BillingComposer
		context={context}
		data={data}
		intent={intent}
		locked={locked}
		onSubmit={onSubmit}
	/>
)
const calculate = async () => {
	fireEvent.click(
		screen.getByRole('button', { name: 'Рассчитать на сервере' })
	)
	await screen.findByRole('region', { name: 'Расчёт сервера' })
}

describe('server-authoritative CRM checkout composer', () => {
	it('has no payment action before a real quote and leaves consent unchecked', async () => {
		render(view())
		expect(
			screen.queryByRole('button', { name: 'Создать заказ на оплату' })
		).toBeNull()
		expect(screen.getByLabelText('Всего мест')).toHaveProperty(
			'value',
			'2'
		)
		await calculate()
		expect(screen.getByRole('checkbox')).toHaveProperty('checked', false)
		expect(screen.getByText(quote.consent.text)).toBeTruthy()
		expect(document.querySelector('script')).toBeNull()
		expect(getBillingQuote).toHaveBeenCalledExactlyOnceWith('token', {
			schemaVersion: 1,
			workspaceId,
			intent: 'CHECKOUT',
			cycle: 'MONTHLY',
			totalSeats: 2
		})
		fireEvent.click(
			screen.getByRole('button', { name: 'Создать заказ на оплату' })
		)
		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
		const build = vi.mocked(onSubmit).mock.calls[0][0] as unknown as (
			commandId: string
		) => unknown
		expect(build(id)).toEqual({
			action: 'checkout',
			body: {
				schemaVersion: 1,
				workspaceId,
				commandId: id,
				expectedBillingVersion: '0',
				expectedPolicyVersion: 2,
				cycle: 'MONTHLY',
				totalSeats: 2,
				autoRenew: false,
				consentVersion: null
			}
		})
	})
	it('captures exact opt-in consent and clears it when period/quantity changes', async () => {
		render(view())
		await calculate()
		fireEvent.click(screen.getByRole('checkbox'))
		fireEvent.click(
			screen.getByRole('button', { name: 'Создать заказ на оплату' })
		)
		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
		const build = vi.mocked(onSubmit).mock.calls[0][0] as unknown as (
			commandId: string
		) => unknown
		expect(build(id)).toMatchObject({
			body: { autoRenew: true, consentVersion: 'wincrm-v1' }
		})
		fireEvent.change(screen.getByLabelText('Период'), {
			target: { value: 'YEARLY' }
		})
		expect(screen.queryByRole('checkbox')).toBeNull()
		expect(
			screen.queryByRole('button', { name: 'Создать заказ на оплату' })
		).toBeNull()
	})
	it('does not submit a quote that no longer matches the server billing version', async () => {
		const { rerender } = render(view())
		await calculate()
		data = { ...data, billing: { ...data.billing, billingVersion: '2' } }
		rerender(view())
		expect(
			screen.getByRole('button', { name: 'Создать заказ на оплату' })
		).toHaveProperty('disabled', true)
		expect(screen.getByText(/Расчёт устарел/)).toBeTruthy()
	})
	it('hides the quote when fresh authority is no longer confirmed', async () => {
		const { rerender } = render(view())
		await calculate()
		context = { ...context, ready: false }
		rerender(view())
		expect(
			screen.queryByRole('region', { name: 'Расчёт сервера' })
		).toBeNull()
		expect(screen.getByLabelText('Всего мест')).toHaveProperty(
			'disabled',
			true
		)
	})
	it('does not offer a charge for seat conversion and requires the exact period version', async () => {
		const conversion = {
			...quote,
			intent: 'SEAT_CHANGE' as const,
			period: {
				id,
				version: 3,
				oldTotalSeats: 2,
				oldExpiresAt: quote.expiresAt,
				oldPeriodPriceMinor: '129900',
				newPeriodPriceMinor: quote.amountMinor
			}
		}
		vi.mocked(getBillingQuote).mockResolvedValue(conversion)
		render(view('SEAT_CHANGE'))
		await calculate()
		expect(screen.queryByRole('checkbox')).toBeNull()
		expect(
			screen.getByText(/Дополнительного списания или возврата нет/)
		).toBeTruthy()
		fireEvent.click(
			screen.getByRole('button', {
				name: 'Изменить места и срок без списания'
			})
		)
		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
		const build = vi.mocked(onSubmit).mock.calls[0][0] as unknown as (
			commandId: string
		) => unknown
		expect(build(id)).toEqual({
			action: 'seats',
			body: {
				schemaVersion: 1,
				workspaceId,
				commandId: id,
				expectedBillingVersion: '0',
				expectedPeriodId: id,
				expectedPeriodVersion: 3,
				newTotalSeats: 2
			}
		})
	})
	it('requires a separate unselected consent for the next renewal price', async () => {
		vi.mocked(getBillingQuote).mockResolvedValue({
			...quote,
			intent: 'RENEWAL'
		})
		render(view('RENEWAL'))
		await calculate()
		const button = screen.getByRole('button', {
			name: 'Подтвердить новую цену автопродления'
		})
		expect(button).toHaveProperty('disabled', true)
		fireEvent.click(screen.getByRole('checkbox'))
		expect(button).toHaveProperty('disabled', false)
		expect(
			screen.getByText(
				/Уже оплаченный период и его сохранённые цены не изменяются/
			)
		).toBeTruthy()
	})
	it('preserves locked drafts while an existing command is unresolved', async () => {
		render(view('CHECKOUT', true))
		expect(screen.getByLabelText('Всего мест')).toHaveProperty(
			'disabled',
			true
		)
		expect(
			screen.getByRole('button', { name: 'Рассчитать на сервере' })
		).toHaveProperty('disabled', true)
		expect(getBillingQuote).not.toHaveBeenCalled()
	})
	it.each(['unmount', 'session'] as const)(
		'does not show a late quote or toast after %s boundary',
		async boundary => {
			let finish!: (value: BillingQuote) => void
			vi.mocked(getBillingQuote).mockImplementation(
				() =>
					new Promise(resolve => {
						finish = resolve
					})
			)
			const { unmount } = render(view())
			fireEvent.click(
				screen.getByRole('button', { name: 'Рассчитать на сервере' })
			)
			await waitFor(() => expect(getBillingQuote).toHaveBeenCalledTimes(1))
			if (boundary === 'unmount') unmount()
			else current = false
			vi.mocked(toast.success).mockClear()
			vi.mocked(toast.error).mockClear()
			await act(async () => finish(quote))
			expect(toast.success).not.toHaveBeenCalled()
			expect(toast.error).not.toHaveBeenCalled()
			expect(
				screen.queryByRole('region', { name: 'Расчёт сервера' })
			).toBeNull()
		}
	)
	it('reports quote failure without inventing a fallback price', async () => {
		vi.mocked(getBillingQuote).mockRejectedValue(
			new AuthenticatedApiError('temporary', 'Расчёт недоступен')
		)
		render(view())
		fireEvent.click(
			screen.getByRole('button', { name: 'Рассчитать на сервере' })
		)
		await screen.findByRole('alert')
		expect(
			screen.queryByRole('button', { name: 'Создать заказ на оплату' })
		).toBeNull()
		expect(toast.error).toHaveBeenCalledWith('Расчёт недоступен')
	})
})
