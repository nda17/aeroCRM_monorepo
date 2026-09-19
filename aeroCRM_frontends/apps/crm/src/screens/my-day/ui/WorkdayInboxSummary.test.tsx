import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkdaySession } from '@/entities/crm-workday'
import { listInbox } from '@/entities/intake'
import { WorkdayInboxSummary } from './WorkdayInboxSummary'

vi.mock('@/entities/crm-workday', () => ({ useWorkdaySession: vi.fn() }))
vi.mock('@/entities/intake', () => ({ listInbox: vi.fn() }))
vi.mock('react-hot-toast', () => ({ default: vi.fn() }))
const current = vi.fn(() => true)
let allowed: boolean
let permission: boolean
let client: QueryClient
const element = (disabled = false) => (
	<QueryClientProvider client={client}>
		<WorkdayInboxSummary disabled={disabled} />
	</QueryClientProvider>
)

beforeEach(() => {
	vi.clearAllMocks()
	allowed = permission = true
	current.mockReturnValue(true)
	client = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	vi.mocked(useWorkdaySession).mockImplementation(
		() =>
			({
				canRead: allowed,
				current,
				key: ['workspace', 'actor', 1, 'scope'],
				workspace: { workspaceId: 'workspace' },
				session: { userId: 'actor', accessToken: 'memory-token' },
				permissions: {
					data: { permissions: permission ? ['intake:read'] : [] }
				}
			}) as unknown as ReturnType<typeof useWorkdaySession>
	)
	vi.mocked(listInbox).mockResolvedValue({
		schemaVersion: 1,
		page: 1,
		pageSize: 1,
		total: 27,
		items: []
	})
})
afterEach(() => {
	cleanup()
	client.clear()
})

describe('Workday Inbox summary', () => {
	it('uses the existing scoped server count, not a client-side task filter', async () => {
		render(element())
		await waitFor(() =>
			expect(
				screen.getByLabelText('Количество новых обращений').textContent
			).toBe('27')
		)
		expect(listInbox).toHaveBeenCalledExactlyOnceWith(
			'memory-token',
			'workspace',
			1,
			1,
			'',
			'NEW'
		)
		expect(screen.getByRole('link').getAttribute('href')).toBe('/inbox')
		expect(screen.getByText(/Не зависят от периода задач/)).toBeTruthy()
	})
	it('does not request or reveal an Inbox counter without intake:read', () => {
		permission = false
		render(element())
		expect(listInbox).not.toHaveBeenCalled()
		expect(screen.queryByLabelText('Новые обращения')).toBeNull()
	})
	it('distinguishes outage from zero and permits a bounded retry', async () => {
		vi.mocked(listInbox).mockRejectedValueOnce(new Error('Unavailable'))
		render(element())
		expect(await screen.findByRole('alert')).toBeTruthy()
		expect(
			screen.queryByLabelText('Количество новых обращений')
		).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
		await waitFor(() =>
			expect(
				screen.getByLabelText('Количество новых обращений').textContent
			).toBe('27')
		)
		expect(listInbox).toHaveBeenCalledTimes(2)
	})
	it('hides cached count and link while authority is refreshing', async () => {
		const view = render(element())
		await waitFor(() =>
			expect(
				screen.getByLabelText('Количество новых обращений').textContent
			).toBe('27')
		)
		allowed = false
		view.rerender(element())
		expect(
			screen.getByLabelText('Количество новых обращений').textContent
		).toBe('—')
		expect(screen.queryByRole('link')).toBeNull()
	})
	it('blocks outgoing navigation while a write result is unresolved', async () => {
		render(element(true))
		await waitFor(() =>
			expect(
				screen.getByLabelText('Количество новых обращений').textContent
			).toBe('27')
		)
		expect(screen.queryByRole('link')).toBeNull()
	})
	it('does not accept a response after the current session changed', async () => {
		vi.mocked(listInbox).mockImplementation(async () => {
			current.mockReturnValue(false)
			return {
				schemaVersion: 1,
				page: 1,
				pageSize: 1,
				total: 27,
				items: []
			}
		})
		render(element())
		expect(await screen.findByRole('alert')).toBeTruthy()
		expect(
			screen.queryByLabelText('Количество новых обращений')
		).toBeNull()
	})
})
