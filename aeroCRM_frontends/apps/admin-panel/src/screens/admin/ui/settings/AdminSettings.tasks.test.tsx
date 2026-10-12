import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	getSiteSettings: vi.fn(),
	updateSiteSettings: vi.fn(),
	getAuthSettings: vi.fn(),
	updateAuthSettings: vi.fn(),
	runTask: vi.fn(),
	refresh: vi.fn()
}))

vi.mock('@/entities/site-settings', () => ({
	siteSettingsService: {
		get: mocks.getSiteSettings,
		update: mocks.updateSiteSettings
	}
}))
vi.mock('@/entities/site-settings/actions', () => ({
	revalidateSiteSettings: vi.fn()
}))
vi.mock('@/features/auth/api/auth.api', () => ({
	authSettingsService: {
		get: mocks.getAuthSettings,
		update: mocks.updateAuthSettings
	}
}))
vi.mock('@/features/run-admin-task', () => ({
	adminTasksService: { runTask: mocks.runTask }
}))
vi.mock('@/shared/lib/navigation/useZoneRouter', () => ({
	useZoneRouter: () => ({ refresh: mocks.refresh })
}))
vi.mock('@/screens/admin/model/navigation/AdminNavigationGuard', () => ({
	useAdminDirtyGuard: vi.fn()
}))
vi.mock('@/screens/admin/ui/common/admin-navigation/AdminNavigation', () => ({
	default: () => null
}))
vi.mock('@/screens/admin/ui/common/admin-section-heading/AdminSectionHeading', () => ({
	default: () => null
}))
vi.mock('@/screens/admin/ui/common/admin-tooltip/AdminTooltip', () => ({
	default: () => null
}))
vi.mock('@/shared/ui/heading/Heading', () => ({ default: () => null }))
vi.mock('@/shared/ui/skeleton-loader/SkeletonLoader', () => ({
	default: () => null
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), {
		promise: vi.fn(),
		success: vi.fn(),
		error: vi.fn()
	})
}))

import AdminSettings from './AdminSettings'

let queryClient: QueryClient

const renderSettings = () =>
	render(
		<QueryClientProvider client={queryClient}>
			<AdminSettings />
		</QueryClientProvider>
	)

beforeEach(() => {
	queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false, refetchInterval: false },
			mutations: { retry: false }
		}
	})
	mocks.getSiteSettings.mockResolvedValue({
		bannerText: '',
		bannerEnabled: false,
		snowflakeEnabled: false
	})
	mocks.getAuthSettings.mockResolvedValue({
		turnstileEnabled: true,
		googleAuthEnabled: true,
		yandexAuthEnabled: true,
		vkAuthEnabled: true
	})
	mocks.runTask.mockResolvedValue({
		taskId: 'verificationChallengeCleanup',
		message: 'Готово',
		executedAt: '2026-10-12T09:00:00.000Z'
	})
})

afterEach(() => {
	cleanup()
	queryClient.clear()
	vi.clearAllMocks()
})

describe('AdminSettings manual task inventory', () => {
	it('keeps verification cleanup and removes retired payment and expiry tasks', async () => {
		renderSettings()

		const verificationTask = await screen.findByText(
			'Очистка verification challenges'
		)
		expect(screen.queryByText('Очистка зависших платежей')).toBeNull()
		expect(screen.queryByText('Проверка истёкших подписок')).toBeNull()

		const taskRow = verificationTask.closest('div')?.parentElement
		if (!taskRow) throw new Error('Verification task row was not rendered')
		fireEvent.click(taskRow.querySelector('button')!)

		await waitFor(() =>
			expect(mocks.runTask).toHaveBeenCalledTimes(1)
		)
		expect(mocks.runTask.mock.calls[0][0]).toBe(
			'verificationChallengeCleanup'
		)
		expect(mocks.runTask.mock.calls.flat()).not.toContain('paymentCleanup')
		expect(mocks.runTask.mock.calls.flat()).not.toContain(
			'subscriptionExpiryCheck'
		)
	})
})
