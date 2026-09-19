import { resetSessionStore, useSessionStore } from '@/entities/session'
import { BillingFlow } from '@/features/manage-crm-billing'
import { getRuntimeConfig } from '@/shared/config/runtime'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BillingScreen } from './BillingScreen'

vi.mock('@/shared/config/runtime', () => ({ getRuntimeConfig: vi.fn() }))
vi.mock('next/navigation', () => ({
	useRouter: vi.fn(),
	useSearchParams: vi.fn()
}))
vi.mock('@/features/manage-crm-billing', () => ({
	BillingFlow: vi.fn(() => <div>Confirmed billing flow</div>)
}))
const workspaceId = 'b531b13e-3624-4ec5-b66d-f24373b0b374'
const orderId = 'b1c1d3d9-dc5a-4a50-98ba-c79b3895db62'
const replace = vi.fn()
beforeEach(() => {
	vi.clearAllMocks()
	resetSessionStore()
	useSessionStore
		.getState()
		.setAuthenticated({ userId: 'owner', accessToken: 'synthetic-token' })
	vi.mocked(getRuntimeConfig).mockReturnValue({
		wincrmBillingEnabled: false
	} as never)
	vi.mocked(useSearchParams).mockReturnValue(
		new URLSearchParams({ workspaceId }) as never
	)
	vi.mocked(useRouter).mockReturnValue({ replace } as never)
})
afterEach(() => {
	cleanup()
	resetSessionStore()
	vi.restoreAllMocks()
})

describe('paid billing route release gate', () => {
	it.each([false, true])(
		'does not mount context/quote/poll/commands or redirect on disabled route (return=%s)',
		returning => {
			vi.mocked(useSearchParams).mockReturnValue(
				new URLSearchParams({ workspaceId, orderId }) as never
			)
			render(<BillingScreen returning={returning} />)
			expect(
				screen.getByText('Оплата WinCRM скоро будет доступна')
			).toBeTruthy()
			expect(BillingFlow).not.toHaveBeenCalled()
			expect(replace).not.toHaveBeenCalled()
			expect(
				screen.queryByRole('button', { name: /оплат|списан/ })
			).toBeNull()
		}
	)
	it('mounts the backend-authoritative flow only on explicit enable and validated workspace', () => {
		vi.mocked(getRuntimeConfig).mockReturnValue({
			wincrmBillingEnabled: true
		} as never)
		render(<BillingScreen />)
		expect(screen.getByText('Confirmed billing flow')).toBeTruthy()
		expect(vi.mocked(BillingFlow).mock.calls[0][0].route).toEqual({
			workspaceId,
			orderId: null,
			commandId: null
		})
	})
	it('validates a provider return then routes only to a local order-status reference', async () => {
		vi.mocked(getRuntimeConfig).mockReturnValue({
			wincrmBillingEnabled: true
		} as never)
		vi.mocked(useSearchParams).mockReturnValue(
			new URLSearchParams({ workspaceId, orderId }) as never
		)
		render(<BillingScreen returning />)
		await waitFor(() =>
			expect(replace).toHaveBeenCalledExactlyOnceWith(
				`/billing?workspaceId=${workspaceId}&orderId=${orderId}`,
				{ scroll: false }
			)
		)
		expect(BillingFlow).not.toHaveBeenCalled()
		expect(
			screen.getByText(/Возврат от провайдера не подтверждает оплату/)
		).toBeTruthy()
	})
	it('does not use an enabled flag to bypass ambiguous workspace validation', () => {
		vi.mocked(getRuntimeConfig).mockReturnValue({
			wincrmBillingEnabled: true
		} as never)
		vi.mocked(useSearchParams).mockReturnValue(
			new URLSearchParams(
				`workspaceId=${workspaceId}&workspaceId=${workspaceId}`
			) as never
		)
		render(<BillingScreen />)
		expect(screen.getByText('Некорректная ссылка оплаты')).toBeTruthy()
		expect(BillingFlow).not.toHaveBeenCalled()
	})
})
