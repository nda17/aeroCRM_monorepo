import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminMailings from './AdminMailings'

const mocks = vi.hoisted(() => ({
	useAuthStore: vi.fn(),
	useUser: vi.fn(),
	createCampaign: vi.fn(),
	getCampaigns: vi.fn(),
	getCampaign: vi.fn(),
	cancelCampaign: vi.fn(),
	getDeliveries: vi.fn(),
	retryDelivery: vi.fn()
}))

vi.mock('@/entities/user', () => ({
	UserRole: { ADMIN: 'ADMIN', DEV: 'DEV' },
	useAuthStore: mocks.useAuthStore,
	useUser: mocks.useUser
}))

vi.mock('@/features/campaigns', () => ({
	campaignsService: {
		createCampaign: mocks.createCampaign,
		getCampaigns: mocks.getCampaigns,
		getCampaign: mocks.getCampaign,
		cancelCampaign: mocks.cancelCampaign,
		getDeliveries: mocks.getDeliveries,
		retryDelivery: mocks.retryDelivery
	}
}))

vi.mock('@/shared/api', () => ({ errorCatch: () => '' }))
vi.mock(
	'@/screens/admin/ui/common/admin-navigation/AdminNavigation',
	() => ({
		default: () => null
	})
)
vi.mock(
	'@/screens/admin/ui/common/admin-section-heading/AdminSectionHeading',
	() => ({
		default: () => null
	})
)
vi.mock('@/screens/admin/ui/common/admin-tooltip/AdminTooltip', () => ({
	default: () => null
}))
vi.mock('@/shared/ui/confirm-dialog/ConfirmDialog', () => ({
	default: () => null
}))
vi.mock('@/shared/ui/heading/Heading', () => ({ default: () => null }))
vi.mock('@/shared/ui/pagination/Pagination', () => ({
	default: () => null
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), {
		loading: vi.fn(),
		success: vi.fn(),
		error: vi.fn(),
		dismiss: vi.fn()
	})
}))

const firstCampaign = {
	id: 'campaign-one',
	subject: 'First campaign',
	audience: 'ALL' as const,
	requestedChannel: 'EMAIL' as const,
	status: 'COMPLETED' as const,
	recipientCount: 1,
	sentCount: 0,
	failedCount: 1,
	cancelledCount: 0,
	emailCount: 1,
	telegramCount: 0,
	createdAt: '2026-10-12T09:00:00.000Z',
	startedAt: '2026-10-12T09:00:00.000Z',
	completedAt: '2026-10-12T09:01:00.000Z',
	cancelRequestedAt: null
}

const secondCampaign = {
	...firstCampaign,
	id: 'campaign-two',
	subject: 'Second campaign',
	sentCount: 1,
	failedCount: 0
}

const campaignDetails = {
	'campaign-one': {
		...firstCampaign,
		message: 'First campaign message',
		snapshots: []
	},
	'campaign-two': {
		...secondCampaign,
		message: 'Second campaign message',
		snapshots: []
	}
}

const delivery = (status: 'FAILED' | 'PENDING' | 'SENT') => ({
	id: 'delivery-one',
	campaignId: 'campaign-one',
	channel: 'EMAIL' as const,
	status,
	dispatchGeneration: 1,
	attempts: status === 'FAILED' ? 1 : 2,
	failure:
		status === 'FAILED'
			? { code: 'TEMPORARY', reason: 'Provider response was lost' }
			: null,
	createdAt: '2026-10-12T09:00:00.000Z',
	sentAt: status === 'SENT' ? '2026-10-12T09:02:00.000Z' : null,
	cancelledAt: null
})

const response = (items: ReturnType<typeof delivery>[]) => ({
	items,
	total: items.length,
	page: 1,
	limit: 10,
	totalPages: 1
})

let client: QueryClient
let latestDelivery = delivery('FAILED')

const renderMailings = () =>
	render(
		<QueryClientProvider client={client}>
			<AdminMailings />
		</QueryClientProvider>
	)

const openFirstCampaign = async () => {
	const detailsButtons = await screen.findAllByRole('button', {
		name: 'Подробнее'
	})
	fireEvent.click(detailsButtons[0])
	await screen.findByText('First campaign message')
}

beforeEach(() => {
	client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, refetchInterval: false },
			mutations: { retry: false }
		}
	})
	latestDelivery = delivery('FAILED')
	mocks.useAuthStore.mockImplementation(
		(selector: (state: { auth: string }) => unknown) =>
			selector({ auth: 'test-auth' })
	)
	mocks.useUser.mockReturnValue({
		user: { rights: ['ADMIN', 'DEV'] },
		isLoading: false
	})
	mocks.getCampaigns.mockResolvedValue({
		items: [firstCampaign, secondCampaign],
		total: 2,
		page: 1,
		limit: 10,
		totalPages: 1
	})
	mocks.getCampaign.mockImplementation(
		async (id: keyof typeof campaignDetails) => campaignDetails[id]
	)
	mocks.getDeliveries.mockImplementation(
		async (
			campaignId: string,
			_page: number,
			_limit: number,
			status?: string
		) => {
			if (campaignId !== firstCampaign.id) return response([])
			if (status === 'FAILED' && latestDelivery.status !== 'FAILED') {
				return response([])
			}
			if (status === 'PENDING' && latestDelivery.status !== 'PENDING') {
				return response([])
			}
			if (status === 'SENT' && latestDelivery.status !== 'SENT') {
				return response([])
			}
			return response([latestDelivery])
		}
	)
	vi.stubGlobal('crypto', {
		randomUUID: vi.fn(() => 'retry-key-1')
	})
})

afterEach(() => {
	cleanup()
	client.clear()
	vi.unstubAllGlobals()
	vi.clearAllMocks()
})

describe('AdminMailings delivery retry recovery', () => {
	it('replays the same delivery with the same key after polling changes its status', async () => {
		mocks.retryDelivery
			.mockRejectedValueOnce(new Error('response lost'))
			.mockResolvedValueOnce(delivery('SENT'))
		renderMailings()
		await openFirstCampaign()

		fireEvent.click(
			await screen.findByRole('button', { name: 'Повторить' })
		)
		await screen.findByText(
			'Результат повтора доставки пока не подтверждён'
		)
		const firstCall = mocks.retryDelivery.mock.calls[0]
		expect(firstCall).toEqual([
			'campaign-one',
			'delivery-one',
			'retry-key-1'
		])

		latestDelivery = delivery('PENDING')
		await act(async () => {
			await client.invalidateQueries({
				queryKey: ['admin-campaign-deliveries', firstCampaign.id]
			})
		})
		await waitFor(() =>
			expect(screen.getAllByText('Ожидает').length).toBeGreaterThan(1)
		)
		expect(
			screen.getByRole('button', {
				name: 'Проверить повтор доставки (Email)'
			})
		).toBeTruthy()

		latestDelivery = delivery('SENT')
		await act(async () => {
			await client.invalidateQueries({
				queryKey: ['admin-campaign-deliveries', firstCampaign.id]
			})
		})
		await waitFor(() =>
			expect(screen.getAllByText('Отправлена').length).toBeGreaterThan(1)
		)

		fireEvent.change(screen.getByLabelText('Статус'), {
			target: { value: 'SENT' }
		})
		expect(
			screen.getByRole('button', {
				name: 'Проверить повтор доставки (Email)'
			})
		).toBeTruthy()

		const detailsButtons = screen.getAllByRole('button', {
			name: 'Подробнее'
		})
		fireEvent.click(detailsButtons[1])
		await screen.findByText('Second campaign message')
		const replayButton = screen.getByRole('button', {
			name: 'Проверить повтор доставки (Email)'
		})
		fireEvent.click(replayButton)

		await waitFor(() =>
			expect(mocks.retryDelivery).toHaveBeenCalledTimes(2)
		)
		expect(mocks.retryDelivery.mock.calls[1]).toEqual(firstCall)
		await waitFor(() =>
			expect(
				screen.queryByText(
					'Результат повтора доставки пока не подтверждён'
				)
			).toBeNull()
		)
	})

	it('releases the unknown-retry lock after a definitive 409 response', async () => {
		const conflict = Object.assign(new Error('already retried'), {
			isAxiosError: true,
			response: { status: 409 }
		})
		mocks.retryDelivery.mockRejectedValueOnce(conflict)
		renderMailings()
		await openFirstCampaign()
		fireEvent.click(
			await screen.findByRole('button', { name: 'Повторить' })
		)

		await waitFor(() =>
			expect(
				screen.queryByText(
					'Результат повтора доставки пока не подтверждён'
				)
			).toBeNull()
		)
		expect(mocks.retryDelivery).toHaveBeenCalledOnce()
	})

	it('retains the same key after a 403 on an already-unknown retry', async () => {
		const forbidden = Object.assign(new Error('permission check failed'), {
			isAxiosError: true,
			response: { status: 403 }
		})
		mocks.retryDelivery
			.mockRejectedValueOnce(new Error('response lost'))
			.mockRejectedValueOnce(forbidden)
			.mockResolvedValueOnce(delivery('SENT'))
		renderMailings()
		await openFirstCampaign()
		fireEvent.click(
			await screen.findByRole('button', { name: 'Повторить' })
		)
		await screen.findByText(
			'Результат повтора доставки пока не подтверждён'
		)
		const firstCall = mocks.retryDelivery.mock.calls[0]

		fireEvent.click(
			screen.getByRole('button', {
				name: 'Проверить повтор доставки (Email)'
			})
		)
		await waitFor(() =>
			expect(mocks.retryDelivery).toHaveBeenCalledTimes(2)
		)
		expect(mocks.retryDelivery.mock.calls[1]).toEqual(firstCall)
		expect(
			screen.getByText('Результат повтора доставки пока не подтверждён')
		).toBeTruthy()

		fireEvent.click(
			screen.getByRole('button', {
				name: 'Проверить повтор доставки (Email)'
			})
		)
		await waitFor(() =>
			expect(mocks.retryDelivery).toHaveBeenCalledTimes(3)
		)
		expect(mocks.retryDelivery.mock.calls[2]).toEqual(firstCall)
		await waitFor(() =>
			expect(
				screen.queryByText(
					'Результат повтора доставки пока не подтверждён'
				)
			).toBeNull()
		)
	})
})
