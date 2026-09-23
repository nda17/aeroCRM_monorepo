import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listInbox, type InboxEntry } from '@/entities/intake'
import { useIntakeAccess } from '@/features/manage-intake'
import InboxScreen from './InboxScreen'
import { listInboxSla } from '@/entities/intake-sla'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import InboxPage from '@/app/(workspace)/inbox/page'

vi.mock('@/entities/intake-sla', async original => ({
	...(await original<object>()),
	listInboxSla: vi.fn()
}))

vi.mock('@/entities/intake', async original => ({
	...(await original<typeof import('@/entities/intake')>()),
	listInbox: vi.fn()
}))
vi.mock('@/features/manage-intake', () => ({
	useIntakeAccess: vi.fn(),
	InboxEditor: ({ id, onClose }: { id?: string; onClose: () => void }) => (
		<div>
			Inbox editor <span>{id}</span>
			<button onClick={onClose}>Закрыть тестовую карточку</button>
		</div>
	),
	SourcesPanel: () => <div>Sources panel</div>,
	CsvImportDrawer: ({
		onSaved,
		onClose
	}: {
		onSaved: () => void
		onClose: () => void
	}) => (
		<button
			onClick={() => {
				onSaved()
				onClose()
			}}
		>
			Подтвердить тестовый импорт
		</button>
	)
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), {
		success: vi.fn(),
		error: vi.fn(),
		dismiss: vi.fn()
	})
}))
vi.mock('@/features/export-records', () => ({
	ExportRecordsControl: () => <button>Экспорт</button>
}))
const workspaceId = '11111111-1111-4111-8111-111111111111'
const id = '22222222-2222-4222-8222-222222222222'
const entry: InboxEntry = {
	id,
	workspaceId,
	title: 'CSV обращение',
	name: 'Клиент',
	phone: null,
	email: null,
	message: null,
	origin: 'CSV',
	sourceId: null,
	status: 'NEW',
	createdBySubject: 'owner',
	teamId: null,
	version: 1,
	contactId: null,
	dealId: null,
	rejectionReason: null,
	receivedAt: '2026-09-05T00:00:00.000Z',
	updatedAt: '2026-09-05T00:00:00.000Z',
	acceptedAt: null,
	rejectedAt: null
}
let client: QueryClient
let access: ReturnType<typeof useIntakeAccess>
beforeEach(() => {
	vi.resetAllMocks()
	client = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	access = {
		workspaceId,
		session: { userId: 'owner', accessToken: 'token' },
		revision: 1,
		scopeKey: 'owner',
		canRead: true,
		canWrite: true,
		permissions: {
			isSuccess: true,
			data: { role: 'OWNER' },
			refetch: vi.fn()
		}
	} as unknown as ReturnType<typeof useIntakeAccess>
	vi.mocked(useIntakeAccess).mockImplementation(() => access)
	vi.mocked(listInbox).mockResolvedValue({
		schemaVersion: 1,
		page: 1,
		pageSize: 25,
		total: 1,
		items: [entry]
	})
	vi.mocked(listInboxSla).mockResolvedValue({
		schemaVersion: 1,
		workspaceId,
		deliveryEnabled: false,
		items: [{ entryId: id, state: 'NOT_TRACKED', dueAt: null }]
	})
})
afterEach(() => {
	cleanup()
	client.clear()
})
const view = (initialEntryId?: string | null) => (
	<QueryClientProvider client={client}>
		<InboxScreen initialEntryId={initialEntryId} />
	</QueryClientProvider>
)
describe('Inbox CSV integration', () => {
	it.each([
		undefined,
		'invalid',
		'11111111-1111-1111-8111-111111111111',
		[id, id]
	])('rejects invalid or repeated entry URL values: %j', async entry => {
		const route = await InboxPage({
			searchParams: Promise.resolve({ entry })
		})
		expect(route.props.initialEntryId).toBeNull()
	})
	it('passes only a strict UUID from the route and opens the existing drawer once', async () => {
		const route = await InboxPage({
			searchParams: Promise.resolve({ entry: id })
		})
		expect(route.props.initialEntryId).toBe(id)
		const mounted = render(view(id))
		expect(await screen.findByText(id)).toBeTruthy()
		fireEvent.click(
			screen.getByRole('button', { name: 'Закрыть тестовую карточку' })
		)
		mounted.rerender(view(id))
		expect(screen.queryByText('Inbox editor')).toBeNull()
	})
	it('waits for current read permission before opening a linked entry', async () => {
		access = { ...access, canRead: false }
		const mounted = render(view(id))
		expect(screen.queryByText(id)).toBeNull()
		access = { ...access, canRead: true }
		mounted.rerender(view(id))
		expect(await screen.findByText(id)).toBeTruthy()
	})
	it.each(['workspace', 'session', 'scope'] as const)(
		'never carries a linked entry across a %s change',
		async change => {
			const mounted = render(view(id))
			await screen.findByText(id)
			access = {
				...access,
				...(change === 'workspace'
					? { workspaceId: id }
					: change === 'session'
						? { revision: 2 }
						: { scopeKey: 'manager:own' })
			}
			mounted.rerender(view(id))
			expect(screen.queryByText('Inbox editor')).toBeNull()
			expect(screen.queryByText(id)).toBeNull()
		}
	)
	it('keeps SLA explicitly inactive without changing the business status', async () => {
		render(view())
		await screen.findByText('SLA не активирован')
		expect(screen.getByText('Новое')).toBeTruthy()
		expect(listInboxSla).toHaveBeenCalledWith('token', workspaceId, [id])
	})
	it('renders backend breach and never calculates it locally', async () => {
		vi.mocked(listInboxSla).mockResolvedValue({
			schemaVersion: 1,
			workspaceId,
			deliveryEnabled: true,
			items: [
				{
					entryId: id,
					state: 'BREACHED',
					dueAt: '2026-09-08T12:00:00.000Z'
				}
			]
		})
		render(view())
		await screen.findByText('SLA просрочен')
		expect(screen.getByText('Новое')).toBeTruthy()
	})
	it('keeps Inbox usable if SLA is not deployed', async () => {
		vi.mocked(listInboxSla).mockRejectedValue(
			new AuthenticatedApiError('notFound', 'not deployed')
		)
		render(view())
		await screen.findByText('SLA не активирован')
		expect(screen.getByText('CSV обращение')).toBeTruthy()
	})
	it('shows CSV as a distinct origin and refreshes the real server list after import', async () => {
		render(view())
		await screen.findByText('CSV обращение')
		expect(screen.getByText('CSV')).toBeTruthy()
		expect(listInbox).toHaveBeenCalledWith(
			'token',
			workspaceId,
			1,
			25,
			'',
			'NEW'
		)
		fireEvent.click(screen.getByRole('button', { name: 'Импорт CSV' }))
		fireEvent.click(
			screen.getByRole('button', { name: 'Подтвердить тестовый импорт' })
		)
		await waitFor(() => expect(listInbox).toHaveBeenCalledTimes(2))
		expect(
			screen.queryByRole('button', { name: 'Подтвердить тестовый импорт' })
		).toBeNull()
	})
	it('disables import for read-only users and the sources tab', async () => {
		access = { ...access, canWrite: false }
		const rendered = render(view())
		expect(
			screen.getByRole('button', { name: 'Импорт CSV' })
		).toHaveProperty('disabled', true)
		access = { ...access, canWrite: true }
		rendered.rerender(view())
		fireEvent.click(screen.getByRole('button', { name: 'Источники' }))
		expect(
			screen.getByRole('button', { name: 'Импорт CSV' })
		).toHaveProperty('disabled', true)
	})
	it('does not reuse the old ALL rows when permission scope changes', async () => {
		const rendered = render(view())
		await screen.findByText('CSV обращение')
		vi.mocked(listInbox).mockResolvedValue({
			schemaVersion: 1,
			page: 1,
			pageSize: 25,
			total: 0,
			items: []
		})
		access = { ...access, scopeKey: 'manager:own' }
		rendered.rerender(view())
		expect(screen.queryByText('CSV обращение')).toBeNull()
		await screen.findByText('Обращений с выбранным статусом пока нет')
		expect(listInbox).toHaveBeenCalledTimes(2)
	})
})
