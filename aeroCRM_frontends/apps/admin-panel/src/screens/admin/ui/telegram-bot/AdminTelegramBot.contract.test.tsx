import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	useAuthStore: vi.fn(),
	useUser: vi.fn(),
	apiGet: vi.fn(),
	apiPost: vi.fn(),
	getAdminSettings: vi.fn(),
	getAdminTelegramSettings: vi.fn(),
	updateAdminTelegramSettings: vi.fn(),
	getSupportRouting: vi.fn(),
	getSupportWebhook: vi.fn(),
	updateSupportRouting: vi.fn(),
	reinstallSupportWebhook: vi.fn(),
	getDailySummary: vi.fn(),
	updateDailySummary: vi.fn()
}))

vi.mock('@/shared/api', () => ({
	axiosInterceptorsRequest: { get: mocks.apiGet, post: mocks.apiPost },
	errorCatch: (error: Error) => error.message
}))
vi.mock('@/entities/user', () => ({
	UserRole: { ADMIN: 'ADMIN', DEV: 'DEV' },
	useAuthStore: mocks.useAuthStore,
	useUser: mocks.useUser
}))
vi.mock('@/features/manage-telegram-bot', () => ({
	adminTelegramBotService: {
		get: mocks.getAdminTelegramSettings,
		update: mocks.updateAdminTelegramSettings
	},
	supportTelegramService: {
		getRoutingSettings: mocks.getSupportRouting,
		getWebhookStatus: mocks.getSupportWebhook,
		updateRoutingSettings: mocks.updateSupportRouting,
		reinstallWebhook: mocks.reinstallSupportWebhook
	}
}))
vi.mock('@/features/admin-monitoring', () => ({
	reportingDailySummaryService: {
		get: mocks.getDailySummary,
		update: mocks.updateDailySummary
	}
}))
vi.mock('@/screens/admin/model/navigation/AdminNavigationGuard', () => ({
	useAdminDirtyGuard: vi.fn()
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

import AdminTelegramBot from './AdminTelegramBot'

const allTargets = [
	'notificationDelivery',
	'campaigns',
	'reporting',
	'billing',
	'identity',
	'platform',
	'support',
	'operations',
	'crmAccess',
	'crmIntake',
	'crmCustomers',
	'crmSales'
]
const settings = Object.fromEntries([
	['dailySummaryChatId', ''],
	['databaseBackupThreadId', null],
	['paymentsThreadId', null],
	['operationalAlertsThreadId', null],
	['databaseBackupEnabled', false],
	['databaseBackupTime', '00:00'],
	['databaseBackupTimeLabel', '00:00'],
	...allTargets.flatMap(target => [
		[`$${target}DatabaseBackupDelayMinutes`.replace('$', ''), 10],
		[`$${target}DatabaseBackupTime`.replace('$', ''), '00:00'],
		[`$${target}DatabaseBackupTimeLabel`.replace('$', ''), '00:00']
	]),
	['databaseBackupLastSentPeriodStart', null],
	['databaseBackupLastSentAt', null],
	['telegramBotTokenConfigured', false],
	['telegramBotUsernameConfigured', false],
	['updatedAt', '2026-10-12T09:00:00.000Z']
])

const infoSettings = (configured: boolean) => ({
	infoTelegramBotTokenConfigured: configured,
	infoTelegramBotUsernameConfigured: configured
})

const webhookStatus = (
	bot: 'info' | 'support',
	configured: boolean,
	secretConfigured: boolean,
	expectedWebhookUrl: string | null
) => ({
	bot,
	title: bot === 'info' ? 'INFO-бот' : 'SUPPORT-бот',
	configured,
	ok: configured,
	expectedWebhookUrl,
	webhookUrl: expectedWebhookUrl,
	webhookMatchesExpected: configured,
	pendingUpdateCount: 0,
	lastErrorAt: null,
	lastErrorMessage: null,
	allowedUpdates: [],
	secretConfigured,
	configuredUsername: null,
	actualUsername: null,
	usernameMatchesConfigured: true,
	error: null
})

const dailySummary = {
	id: 'daily-summary',
	enabled: false,
	destinationChatId: null,
	messageThreadId: null,
	operationalAlertsThreadId: null,
	scheduleTime: '10:00',
	timezone: 'Europe/Moscow',
	scheduleGeneration: 'generation-1',
	schedulePolicyConfirmationPending: false,
	lastSuccessfulDelivery: null,
	lastFailedDelivery: null,
	updatedAt: '2026-10-12T09:00:00.000Z'
}

const supportRouting = {
	schemaVersion: 1,
	adminChatId: '',
	supportThreadId: null,
	aggregateVersion: 'version-1',
	updatedAt: '2026-10-12T09:00:00.000Z'
}

let queryClient: QueryClient
let role: 'ADMIN' | 'DEV'
let infoConfigured: boolean
let infoStatus: ReturnType<typeof webhookStatus>
let supportStatus: ReturnType<typeof webhookStatus>

const renderTelegram = () =>
	render(
		<QueryClientProvider client={queryClient}>
			<AdminTelegramBot />
		</QueryClientProvider>
	)

const resolveInfoApi = () => {
	mocks.apiGet.mockImplementation((url: string) => {
		if (url === '/telegram-info/admin/settings') {
			return Promise.resolve({ data: infoSettings(infoConfigured) })
		}
		if (url === '/telegram-info/admin/info-webhook/status') {
			return Promise.resolve({ data: infoStatus })
		}
		return Promise.reject(new Error(`Unexpected GET ${url}`))
	})
	mocks.apiPost.mockResolvedValue({
		data: {
			bot: 'info',
			title: 'INFO-бот',
			webhookUrl: 'https://api.example.test/telegram-info/webhook',
			dropPendingUpdates: false,
			allowedUpdates: ['message'],
			secretConfigured: true,
			installedAt: '2026-10-12T09:00:00.000Z'
		}
	})
}

beforeEach(() => {
	queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false, refetchInterval: false },
			mutations: { retry: false }
		}
	})
	role = 'ADMIN'
	infoConfigured = false
	infoStatus = webhookStatus('info', false, false, null)
	supportStatus = webhookStatus(
		'support',
		true,
		true,
		'https://api.example.test/support/webhook'
	)
	mocks.useAuthStore.mockImplementation(
		(selector: (state: { auth: boolean }) => unknown) => selector({ auth: true })
	)
	mocks.useUser.mockImplementation(() => ({
		user: { id: 'operator-1', rights: [role] },
		isLoading: false
	}))
	mocks.getAdminTelegramSettings.mockResolvedValue(settings)
	mocks.getSupportRouting.mockResolvedValue(supportRouting)
	mocks.getSupportWebhook.mockImplementation(async () => supportStatus)
	mocks.updateAdminTelegramSettings.mockResolvedValue(settings)
	mocks.updateSupportRouting.mockResolvedValue(supportRouting)
	mocks.reinstallSupportWebhook.mockResolvedValue({ title: 'SUPPORT-бот' })
	mocks.getDailySummary.mockResolvedValue(dailySummary)
	mocks.updateDailySummary.mockResolvedValue(dailySummary)
	resolveInfoApi()
})

afterEach(() => {
	cleanup()
	queryClient.clear()
	vi.clearAllMocks()
})

describe('AdminTelegramBot current INFO and SUPPORT contracts', () => {
	it('shows an unavailable state for request errors and does not call retired telegram-auth endpoints', async () => {
		mocks.apiGet.mockRejectedValue(new Error('service unavailable'))
		renderTelegram()

		expect((await screen.findAllByText('Проверить не удалось')).length).toBeGreaterThan(0)
		expect((await screen.findAllByText('Недоступен')).length).toBeGreaterThan(0)
		expect(mocks.apiGet.mock.calls.map(([url]) => url)).not.toContain(
			'/telegram-auth/admin/settings'
		)
		expect(mocks.apiGet.mock.calls.map(([url]) => url)).not.toContain(
			'/telegram-auth/admin/info-webhook/status'
		)
		expect(mocks.apiPost).not.toHaveBeenCalled()
	})

	it('keeps loading state until INFO token and URL status arrive, then disables an unconfigured bot', async () => {
		let resolveSettings!: (value: { data: ReturnType<typeof infoSettings> }) => void
		let resolveStatus!: (value: { data: ReturnType<typeof webhookStatus> }) => void
		mocks.apiGet.mockImplementation((url: string) => {
			if (url === '/telegram-info/admin/settings') {
				return new Promise(resolve => {
					resolveSettings = resolve
				})
			}
			if (url === '/telegram-info/admin/info-webhook/status') {
				return new Promise(resolve => {
					resolveStatus = resolve
				})
			}
			return Promise.reject(new Error(`Unexpected GET ${url}`))
		})
		renderTelegram()

		expect((await screen.findAllByText('Загрузка...')).length).toBeGreaterThan(0)
		const infoButton = await screen.findByRole('button', { name: 'INFO-бот' })
		expect(infoButton.hasAttribute('disabled')).toBe(true)

		await act(async () => {
			resolveSettings({ data: infoSettings(false) })
			resolveStatus({
				data: webhookStatus('info', false, false, null)
			})
		})

		expect(screen.getAllByText('Не настроен').length).toBeGreaterThan(0)
		expect(infoButton.hasAttribute('disabled')).toBe(true)
		expect(mocks.apiPost).not.toHaveBeenCalled()
	})

	it('allows ADMIN to reinstall configured INFO and reserves SUPPORT reinstall for DEV', async () => {
		infoConfigured = true
		infoStatus = webhookStatus(
			'info',
			true,
			true,
			'https://api.example.test/telegram-info/webhook'
		)
		renderTelegram()

		const infoButton = await screen.findByRole('button', { name: 'INFO-бот' })
		const supportButton = screen.getByRole('button', { name: 'SUPPORT-бот' })
		expect(infoButton.hasAttribute('disabled')).toBe(false)
		expect(supportButton.hasAttribute('disabled')).toBe(true)
		fireEvent.click(infoButton)
		await waitFor(() =>
			expect(mocks.apiPost).toHaveBeenCalledWith(
				'/telegram-info/admin/info-webhook/reinstall'
			)
		)
		expect(mocks.reinstallSupportWebhook).not.toHaveBeenCalled()

		cleanup()
		queryClient.clear()
		role = 'DEV'
		renderTelegram()
		const devSupportButton = await screen.findByRole('button', {
			name: 'SUPPORT-бот'
		})
		expect(screen.getByRole('button', { name: 'INFO-бот' }).hasAttribute('disabled')).toBe(false)
		expect(devSupportButton.hasAttribute('disabled')).toBe(false)
	})
})
