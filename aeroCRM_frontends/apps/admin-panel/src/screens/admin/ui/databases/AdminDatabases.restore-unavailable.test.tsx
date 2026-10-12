import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	useUser: vi.fn(),
	getAdminSettings: vi.fn(),
	getBackupOverview: vi.fn(),
	getRestoreSettings: vi.fn(),
	getRestoreJob: vi.fn(),
	createRestorePermit: vi.fn(),
	approveRestorePermit: vi.fn(),
	startRestore: vi.fn(),
	createRecoveryAction: vi.fn(),
	approveRecoveryAction: vi.fn()
}))

vi.mock('@/entities/user', () => ({
	UserRole: { DEV: 'DEV' },
	useUser: mocks.useUser
}))
vi.mock('@/features/manage-telegram-bot', () => ({
	adminTelegramBotService: {
		get: mocks.getAdminSettings,
		getDatabaseBackupOverview: mocks.getBackupOverview
	}
}))
vi.mock('@/features/run-admin-task', () => ({
	devToolsService: {
		getDatabaseRestoresSettings: mocks.getRestoreSettings,
		getDatabaseRestoreJob: mocks.getRestoreJob,
		createDatabaseRestorePermit: mocks.createRestorePermit,
		approveDatabaseRestorePermit: mocks.approveRestorePermit,
		startDatabaseRestore: mocks.startRestore,
		createDatabaseRestoreRecoveryAction: mocks.createRecoveryAction,
		approveDatabaseRestoreRecoveryAction: mocks.approveRecoveryAction
		}
}))
vi.mock('@/shared/api', () => ({ errorCatch: (error: Error) => error.message }))
vi.mock(
	'@/screens/admin/ui/common/admin-navigation/AdminNavigation',
	() => ({ default: () => null })
)
vi.mock(
	'@/screens/admin/ui/common/admin-section-heading/AdminSectionHeading',
	() => ({ default: () => null })
)
vi.mock('@/shared/ui/heading/Heading', () => ({ default: () => null }))
vi.mock('@/shared/ui/skeleton-loader/SkeletonLoader', () => ({
	default: () => null
}))
vi.mock('@/shared/ui/pagination/Pagination', () => ({ default: () => null }))
vi.mock('./DatabaseSections', () => ({
	default: ({ panels }: { panels: Record<string, React.ReactNode> }) =>
		panels.restore
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), {
		promise: vi.fn(),
		success: vi.fn(),
		error: vi.fn()
	})
}))

import { DatabaseRestorePanel } from './AdminDatabases'

const restoreSettings = {
	enabled: false,
	currentServicesSha: 'services-sha',
	approved: null,
	permitRequired: true as const,
	maxFileSizeBytes: 1000,
	allowedFileExtension: '.dump',
	targets: [
		{
			id: 'notification-delivery' as const,
			label: 'Notification Delivery',
			confirmation: 'RESTORE notification-delivery',
			migrationManifestSha: 'migration-sha'
		}
	]
}

const restoreJobId = '8735c256-d312-4b60-8c25-0d4dd796a5ca'
const restoreMarker = {
	jobId: restoreJobId,
	target: 'notification-delivery',
	recoveryStartedAt: null
}
const restoreStorageKey = 'aerocrm:admin:database-restore:latest:admin-1'

const axios404 = () =>
	Object.assign(new Error('Not found'), {
		isAxiosError: true,
		response: { status: 404 }
	})

let queryClient: QueryClient

const renderDatabases = () =>
	render(
		<QueryClientProvider client={queryClient}>
			<DatabaseRestorePanel
				isDev
				isUserLoading={false}
				userId="admin-1"
			/>
		</QueryClientProvider>
	)

beforeEach(() => {
	queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false, refetchInterval: false },
			mutations: { retry: false }
		}
	})
	mocks.useUser.mockReturnValue({
		user: { id: 'admin-1', rights: ['DEV'] },
		isLoading: false
	})
	mocks.getAdminSettings.mockResolvedValue({})
	mocks.getBackupOverview.mockResolvedValue({ items: [] })
	mocks.getRestoreSettings.mockRejectedValue(axios404())
	window.localStorage.clear()
	window.localStorage.setItem(restoreStorageKey, JSON.stringify(restoreMarker))
})

afterEach(() => {
	cleanup()
	queryClient.clear()
	vi.clearAllMocks()
	vi.useRealTimers()
})

describe('AdminDatabases restore settings availability', () => {
	it('keeps the saved actor marker visible and disables restore lookups when the settings endpoint is absent', async () => {
		await act(async () => {
			renderDatabases()
			await Promise.resolve()
			await Promise.resolve()
		})
		expect(mocks.getRestoreSettings).toHaveBeenCalled()
		expect(queryClient.getQueryState(['admin-database-restore-settings'])?.status).toBe('error')

		expect(
			await screen.findByText(/Восстановление недоступно в текущем окружении/)
		).toBeTruthy()
		expect(window.localStorage.getItem(restoreStorageKey)).toBe(
			JSON.stringify(restoreMarker)
		)
		expect(mocks.getRestoreSettings).toHaveBeenCalledTimes(1)
		expect(mocks.getRestoreJob).not.toHaveBeenCalled()
		expect(mocks.createRestorePermit).not.toHaveBeenCalled()
		expect(mocks.approveRestorePermit).not.toHaveBeenCalled()
		expect(mocks.startRestore).not.toHaveBeenCalled()
		expect(mocks.createRecoveryAction).not.toHaveBeenCalled()
		expect(mocks.approveRecoveryAction).not.toHaveBeenCalled()

		vi.useFakeTimers()
		await act(async () => {
			await vi.advanceTimersByTimeAsync(60_000)
		})
		expect(mocks.getRestoreSettings).toHaveBeenCalledTimes(1)
		expect(mocks.getRestoreJob).not.toHaveBeenCalled()
		expect(window.localStorage.getItem(restoreStorageKey)).toBe(
			JSON.stringify(restoreMarker)
		)
	})

	it('replaces stale cached settings with an unavailable state after a 404', async () => {
		queryClient.setQueryData(
			['admin-database-restore-settings'],
			restoreSettings
		)

		await act(async () => {
			renderDatabases()
			await Promise.resolve()
			await Promise.resolve()
		})
		expect(mocks.getRestoreSettings).toHaveBeenCalled()
		expect(queryClient.getQueryState(['admin-database-restore-settings'])?.status).toBe('error')

		expect(
			await screen.findByText(/Восстановление недоступно в текущем окружении/)
		).toBeTruthy()
		expect(screen.queryByText('Запросить разрешение на восстановление')).toBeNull()
		expect(mocks.getRestoreSettings).toHaveBeenCalledTimes(1)
		expect(mocks.getRestoreJob).not.toHaveBeenCalled()
	})
})
