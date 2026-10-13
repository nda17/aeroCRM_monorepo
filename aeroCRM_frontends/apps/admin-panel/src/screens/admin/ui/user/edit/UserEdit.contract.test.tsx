import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	useAuthStore: vi.fn(),
	useUser: vi.fn(),
	fetchUserById: vi.fn(),
	fetchUserOverview: vi.fn(),
	fetchAdminUserAutoRenewal: vi.fn(),
	pauseAdminUserAutoRenewal: vi.fn(),
	resumeAdminUserAutoRenewal: vi.fn(),
	revokeAdminUserAutoRenewal: vi.fn(),
	reconcileAdminUserAutoRenewal: vi.fn(),
	resumeTechnicalAdminUserAutoRenewal: vi.fn(),
	getOverviewApi: vi.fn(),
	push: vi.fn()
}))

vi.mock('@/entities/user', () => ({
	UserRole: { ADMIN: 'ADMIN', DEV: 'DEV', USER: 'USER' },
	UserLoginMethod: {},
	useAuthStore: mocks.useAuthStore,
	useUser: mocks.useUser,
	userService: {
		fetchUserById: mocks.fetchUserById,
		fetchUserOverview: mocks.fetchUserOverview,
		fetchAdminUserAutoRenewal: mocks.fetchAdminUserAutoRenewal,
		pauseAdminUserAutoRenewal: mocks.pauseAdminUserAutoRenewal,
		resumeAdminUserAutoRenewal: mocks.resumeAdminUserAutoRenewal,
		revokeAdminUserAutoRenewal: mocks.revokeAdminUserAutoRenewal,
		reconcileAdminUserAutoRenewal: mocks.reconcileAdminUserAutoRenewal,
		resumeTechnicalAdminUserAutoRenewal:
			mocks.resumeTechnicalAdminUserAutoRenewal
	},
	UserInfo: () => null
}))
vi.mock('@/shared/api', () => ({
	axiosInterceptorsRequest: { get: mocks.getOverviewApi }
}))
vi.mock('@/shared/lib/navigation/useZoneRouter', () => ({
	useZoneRouter: () => ({ push: mocks.push, refresh: vi.fn() })
}))
vi.mock('@/screens/admin/model/navigation/AdminNavigationGuard', () => ({
	useAdminDirtyGuard: () => ({ markClean: vi.fn() })
}))
vi.mock(
	'@/screens/admin/ui/common/admin-navigation/AdminNavigation',
	() => ({ default: () => null })
)
vi.mock(
	'@/screens/admin/ui/common/admin-section-heading/AdminSectionHeading',
	() => ({ default: () => null })
)
vi.mock('@/screens/admin/ui/common/admin-tooltip/AdminTooltip', () => ({
	default: () => null
}))
vi.mock('@/shared/ui/heading/Heading', () => ({ default: () => null }))
vi.mock('@/shared/ui/confirm-dialog/ConfirmDialog', () => ({
	default: () => null
}))
vi.mock('@/shared/lib/navigation/ZoneLink', () => ({
	default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a href={href} {...props}>{children}</a>
	)
}))
vi.mock('@/shared/ui/form-elements/admin-page/field-email/FieldEmail', () => ({
	default: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />
}))
vi.mock('@/shared/ui/form-elements/admin-page/field-id/FieldId', () => ({
	default: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />
}))
vi.mock('@/shared/ui/form-elements/admin-page/field-name/FieldName', () => ({
	default: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />
}))
vi.mock('@/shared/ui/form-elements/admin-page/field-password/FieldPassword', () => ({
	default: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />
}))
vi.mock('@/shared/ui/form-elements/admin-page/field-phone/FieldPhone', () => ({
	default: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />
}))
vi.mock('@/features/upload-file', () => ({
	FieldUploadFile: () => null
}))

import UserEdit from './UserEdit'

const userId = 'user-7001'
const user = {
	id: userId,
	name: 'Ирина Операторова',
	email: 'irina@example.test',
	phone: '+79990001122',
	isPhoneVerified: true,
	loginMethods: ['EMAIL'],
	avatarPath: null,
	status: 'ACTIVE',
	personalDataConsentRevokedAt: null,
	rights: ['USER'],
	createdAt: '2026-10-01T10:00:00.000Z',
	updatedAt: '2026-10-12T10:00:00.000Z'
}
const timestamp = '2026-10-12T09:00:00.000Z'
const overview = {
	schemaVersion: 2,
	subscriptions: {
		status: 'AVAILABLE',
		items: [
			{
				workspaceId: 'workspace-one',
				entitlement: {
					workspaceId: 'workspace-one',
					productCode: 'CRM',
					planCode: 'TRIAL',
					status: 'ACTIVE',
					seatLimit: 3,
					graceUntil: null,
					trialStartedAt: timestamp,
					effectiveFrom: timestamp,
					effectiveUntil: '2026-10-22T09:00:00.000Z',
					aggregateVersion: '2',
					sourceSequence: '4'
				}
			},
			{ workspaceId: 'workspace-two', entitlement: null }
		]
	},
	payments: {
		status: 'AVAILABLE',
		total: 6,
		counts: {
			PENDING: 1,
			SUCCEEDED: 2,
			CANCELLED: 0,
			EXPIRED: 0,
			UNKNOWN: 3
		},
		latest: [
			{
				id: 'payment-1',
				workspaceId: 'workspace-one',
				providerPaymentId: null,
				status: 'UNKNOWN',
				amountMinor: '9007199254740993123',
				kind: 'SUBSCRIPTION',
				cycle: 'MONTH',
				createdAt: timestamp,
				updatedAt: '2026-10-12T09:01:00.000Z'
			}
		]
	},
	activity: {
		status: 'AVAILABLE',
		latest: [
			{
				id: 'event-1',
				section: 'PROFILE',
				action: 'USER_UPDATED',
				createdAt: '2026-10-12T09:30:00.000Z',
				description: 'Оператор проверил профиль клиента'
			}
		]
	}
}

let queryClient: QueryClient

const renderUserEdit = () =>
	render(
		<QueryClientProvider client={queryClient}>
			<UserEdit params={{ id: userId }} />
		</QueryClientProvider>
	)

beforeEach(() => {
	queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false, refetchInterval: false },
			mutations: { retry: false }
		}
	})
	mocks.useAuthStore.mockImplementation(
		(selector: (state: { auth: string }) => unknown) =>
			selector({ auth: 'test-auth' })
	)
	mocks.useUser.mockReturnValue({
		user: { id: 'admin-1', rights: ['ADMIN', 'DEV'] },
		isLoading: false
	})
	mocks.fetchUserById.mockResolvedValue({ data: user })
	mocks.getOverviewApi.mockResolvedValue({ data: overview })
})

afterEach(() => {
	cleanup()
	queryClient.clear()
	vi.clearAllMocks()
})

describe('UserEdit admin overview contract', () => {
	it('shows each workspace, profile and activity while avoiding retired auto-renewal requests', async () => {
		renderUserEdit()

		expect(await screen.findByText('Ирина Операторова')).toBeTruthy()
		expect(await screen.findByText('Оператор проверил профиль клиента')).toBeTruthy()
		expect(screen.getByText('Пространство workspace-one')).toBeTruthy()
		expect(screen.getByText('Пространство workspace-two')).toBeTruthy()
		expect(screen.getByText('Подписка ещё не выдана.')).toBeTruthy()

		const subscriptionsLink = screen.getByRole('link', {
			name: 'Все подписки'
		})
		expect(subscriptionsLink.getAttribute('href')).toContain(
			'/admin/finance/subscriptions'
		)
		expect(screen.getByText('Неизвестный результат 3')).toBeTruthy()
		expect(
			screen.getByText(/90\s071\s992\s547\s409\s931,23\s₽/)
		).toBeTruthy()
		expect(screen.getByText(/Результат неизвестен/)).toBeTruthy()

		expect(mocks.fetchUserById).toHaveBeenCalledWith(userId)
		expect(mocks.getOverviewApi).toHaveBeenCalledWith(
			`/users/edit/${userId}/overview`
		)
		expect(mocks.fetchUserOverview).not.toHaveBeenCalled()
		expect(mocks.fetchAdminUserAutoRenewal).not.toHaveBeenCalled()
		expect(mocks.pauseAdminUserAutoRenewal).not.toHaveBeenCalled()
		expect(mocks.resumeAdminUserAutoRenewal).not.toHaveBeenCalled()
		expect(mocks.revokeAdminUserAutoRenewal).not.toHaveBeenCalled()
		expect(mocks.reconcileAdminUserAutoRenewal).not.toHaveBeenCalled()
		expect(mocks.resumeTechnicalAdminUserAutoRenewal).not.toHaveBeenCalled()
	})

	it('renders section outages as unavailable instead of showing empty or zero data', async () => {
		mocks.getOverviewApi.mockResolvedValue({
			data: {
				schemaVersion: 2,
				subscriptions: { status: 'UNAVAILABLE', items: null },
				payments: {
					status: 'UNAVAILABLE',
					total: null,
					counts: null,
					latest: null
				},
				activity: { status: 'UNAVAILABLE', latest: null }
			}
		})

		renderUserEdit()

		expect(await screen.findByText('Подписки сейчас недоступны.')).toBeTruthy()
		expect(screen.getByText('Платежи сейчас недоступны.')).toBeTruthy()
		expect(screen.getByText('История действий сейчас недоступна.')).toBeTruthy()
		expect(screen.queryByText('Всего: 0')).toBeNull()
		expect(screen.queryByText('Подписок рабочих пространств пока нет.')).toBeNull()
	})
})
