import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	getClosedWorkspaceBilling,
	getClosedWorkspaceBillingHistory,
	getClosedWorkspaceBillingOrder,
	getWorkspaceClosure,
	getWorkspaceClosurePreview,
	listWorkspaceClosures,
	requestWorkspaceClosure
} from '@/entities/workspace-closure'
import { useSessionStore } from '@/entities/session'
import type { WorkspaceClosureView } from '@/entities/workspace-closure'
import { WorkspaceClosureList } from './WorkspaceClosureList'
import { WorkspaceClosureStatus } from './WorkspaceClosureStatus'

vi.mock('@/entities/workspace-closure', () => ({
	getClosedWorkspaceBilling: vi.fn(),
	getClosedWorkspaceBillingHistory: vi.fn(),
	getClosedWorkspaceBillingOrder: vi.fn(),
	getWorkspaceClosure: vi.fn(),
	getWorkspaceClosurePreview: vi.fn(),
	listWorkspaceClosures: vi.fn(),
	requestWorkspaceClosure: vi.fn()
}))

const workspaceId = '11111111-1111-4111-8111-111111111111'
const closureId = '22222222-2222-4222-8222-222222222222'
const closed = (): WorkspaceClosureView => ({
	id: closureId,
	workspaceId,
	displayName: 'Архивное рабочее пространство',
	state: 'CLOSED',
	version: '2',
	requestedAt: '2026-09-23T10:00:00.000Z',
	closedAt: '2026-09-23T10:05:00.000Z',
	steps: [
		{
			service: 'crm-access',
			state: 'SETTLED',
			lastErrorCode: null
		}
	],
	financialPendingCount: 1,
	priorDispatchCount: 2,
	lastErrorCode: null
})
const session = (userId = 'owner', accessToken = `${userId}-token`) => ({
	userId,
	accessToken,
	accessTokenExpiresAt: Date.now() + 60_000
})
let queryClient: QueryClient
const withClient = (children: React.ReactNode) => (
	<QueryClientProvider client={queryClient}>
		{children}
	</QueryClientProvider>
)

beforeEach(() => {
	vi.clearAllMocks()
	useSessionStore.getState().setAuthenticated(session())
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } }
	})
	vi.mocked(getWorkspaceClosure).mockResolvedValue(closed())
	vi.mocked(getClosedWorkspaceBilling).mockResolvedValue({
		period: null,
		renewal: { state: 'REVOKED' }
	} as never)
	vi.mocked(getClosedWorkspaceBillingHistory).mockResolvedValue({
		total: 0,
		items: []
	} as never)
	vi.mocked(getClosedWorkspaceBillingOrder).mockRejectedValue(
		new Error('unused')
	)
	vi.mocked(getWorkspaceClosurePreview).mockRejectedValue(
		new Error('unused')
	)
	vi.mocked(requestWorkspaceClosure).mockRejectedValue(new Error('unused'))
	vi.mocked(listWorkspaceClosures).mockResolvedValue({
		schemaVersion: 1,
		scope: { subject: 'owner' },
		items: [closed()]
	} as never)
})

afterEach(() => {
	cleanup()
	queryClient.clear()
	useSessionStore.getState().setAnonymous()
})

describe('WorkspaceClosureStatus', () => {
	it('does not retain financial results after a closed-history GET fails', async () => {
		vi.mocked(getClosedWorkspaceBilling).mockResolvedValue({
			period: null,
			renewal: { state: 'REVOKED' }
		} as never)
		vi.mocked(getClosedWorkspaceBillingHistory).mockResolvedValue({
			total: 1,
			items: [
				{
					id: '33333333-3333-4333-8333-333333333333',
					amountMinor: '987654',
					state: 'SUCCEEDED',
					createdAt: '2026-09-20T11:12:00.000Z'
				}
			]
		} as never)
		const rendered = render(
			withClient(<WorkspaceClosureStatus initial={closed()} />)
		)
		await screen.findByText(/9.?876,54 ₽/)
		vi.mocked(getClosedWorkspaceBilling).mockRejectedValueOnce(
			new Error('billing read unavailable')
		)
		vi.mocked(getClosedWorkspaceBillingHistory).mockRejectedValueOnce(
			new Error('history read unavailable')
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Обновить историю' })
		)
		await screen.findByRole('alert')
		expect(screen.queryByText(/9.?876,54 ₽/)).toBeNull()
		rendered.unmount()
	})

	it('ignores old closed-workspace billing reads after the session scope changes', async () => {
		let resolveOldSummary!: (value: unknown) => void
		let resolveOldHistory!: (value: unknown) => void
		const oldSummary = new Promise(resolve => {
			resolveOldSummary = resolve
		})
		const oldHistory = new Promise(resolve => {
			resolveOldHistory = resolve
		})
		const pendingRead = () => new Promise(() => {})
		vi.mocked(getClosedWorkspaceBilling).mockImplementation(
			token =>
				(token === 'owner-token' ? oldSummary : pendingRead()) as never
		)
		vi.mocked(getClosedWorkspaceBillingHistory).mockImplementation(
			token =>
				(token === 'owner-token' ? oldHistory : pendingRead()) as never
		)
		const rendered = render(
			withClient(<WorkspaceClosureStatus initial={closed()} />)
		)
		await waitFor(() =>
			expect(getClosedWorkspaceBilling).toHaveBeenCalledWith(
				'owner-token',
				closureId,
				workspaceId,
				'owner'
			)
		)
		useSessionStore.getState().setAuthenticated(session('owner-2'))
		rendered.rerender(
			withClient(<WorkspaceClosureStatus initial={closed()} />)
		)
		await waitFor(() =>
			expect(getClosedWorkspaceBilling).toHaveBeenCalledWith(
				'owner-2-token',
				closureId,
				workspaceId,
				'owner-2'
			)
		)
		resolveOldSummary({
			period: null,
			renewal: { state: 'REVOKED' }
		} as never)
		resolveOldHistory({
			total: 1,
			items: [
				{
					id: '33333333-3333-4333-8333-333333333333',
					amountMinor: '987654',
					state: 'SUCCEEDED',
					createdAt: '2026-09-20T11:12:00.000Z'
				}
			]
		} as never)
		await waitFor(() =>
			expect(screen.queryByText(/9.?876,54 ₽/)).toBeNull()
		)
	})
})

describe('WorkspaceClosureList', () => {
	it('hides previously loaded closure rows when refreshing the list fails', async () => {
		render(withClient(<WorkspaceClosureList />))
		await screen.findByText('Архивное рабочее пространство')
		vi.mocked(listWorkspaceClosures).mockRejectedValueOnce(
			new Error('closure list unavailable')
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Обновить список' })
		)
		await screen.findByRole('alert')
		expect(screen.queryByText('Архивное рабочее пространство')).toBeNull()
	})
})
