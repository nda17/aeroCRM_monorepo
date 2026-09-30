import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '@/entities/session'
import {
	getInboxEntry,
	getInboxEntrySource,
	listIntakeActivities,
	readInboxNotificationForEntry
} from '@/entities/intake'
import type { IntakeAccess } from '../model/use-intake-access'
import { InboxEditor } from './InboxEditor'

vi.mock('@/entities/intake', () => ({
	getInboxEntry: vi.fn(),
	getInboxEntrySource: vi.fn(),
	listIntakeActivities: vi.fn(),
	mutateInbox: vi.fn(),
	readInboxNotificationForEntry: vi.fn()
}))
vi.mock('@/entities/crm-team', () => ({
	TeamSelect: () => null,
	useTeamOptions: () => ({ validSelection: true })
}))
vi.mock('@/shared/lib/dirty-form', () => ({
	useDirtyForm: () => ({
		id: 'dirty-form',
		confirmDiscard: (close: () => void) => close()
	})
}))
vi.mock('../model/use-intake-command', () => ({
	useIntakeCommand: () => ({
		uncertain: false,
		error: null,
		locked: false,
		running: false,
		run: vi.fn(),
		retry: vi.fn(),
		resetError: vi.fn()
	})
}))
vi.mock('../model/use-inbox-acceptance', () => ({
	useInboxAcceptance: () => ({
		blocksEntry: false,
		command: { locked: false, running: false }
	})
}))
vi.mock('./InboxAcceptancePanel', () => ({
	InboxAcceptancePanel: () => null
}))
vi.mock('@/shared/ui', () => ({
	Button: ({
		children,
		...props
	}: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
		<button {...props}>{children}</button>
	),
	Drawer: ({
		children,
		title
	}: {
		children: React.ReactNode
		title: string
	}) => <div aria-label={title}>{children}</div>,
	ScreenState: () => <div role="status">Состояние</div>,
	TextField: () => null,
	TextareaField: () => null
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))

const workspaceId = '11111111-1111-4111-8111-111111111111'
const secondWorkspace = '22222222-2222-4222-8222-222222222222'
const entryId = '33333333-3333-4333-8333-333333333333'
const date = '2026-09-05T00:00:00.000Z'
const entry = {
	id: entryId,
	workspaceId,
	title: 'Тема',
	name: 'Клиент',
	phone: null,
	email: null,
	message: null,
	origin: 'MANUAL',
	sourceId: null,
	status: 'NEW',
	createdBySubject: 'owner',
	teamId: null,
	version: 1,
	contactId: null,
	dealId: null,
	rejectionReason: null,
	receivedAt: date,
	updatedAt: date,
	acceptedAt: null,
	rejectedAt: null
}
let client: QueryClient
const accessFor = (target = workspaceId, canRead = true) =>
	({
		workspaceId: target,
		session: { userId: 'owner', accessToken: 'token' },
		revision: 1,
		scopeKey: 'scope',
		permissions: {
			data: { teamIds: [] },
			isError: false,
			refetch: vi.fn()
		},
		online: true,
		canRead,
		canWrite: false,
		confirmed: true
	}) as unknown as IntakeAccess
const view = (target = workspaceId, canRead = true) =>
	render(
		<QueryClientProvider client={client}>
			<InboxEditor
				access={accessFor(target, canRead)}
				id={entryId}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		</QueryClientProvider>
	)
const deferred = <T,>() => {
	let resolve!: (value: T) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

beforeEach(() => {
	vi.resetAllMocks()
	client = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	useSessionStore.setState({
		status: 'authenticated',
		session: { userId: 'owner', accessToken: 'token' },
		sessionRevision: 1,
		errorMessage: null
	})
	vi.mocked(getInboxEntry).mockResolvedValue(entry as never)
	vi.mocked(getInboxEntrySource).mockResolvedValue(null)
	vi.mocked(listIntakeActivities).mockResolvedValue({
		items: [],
		total: 0,
		page: 1,
		pageSize: 25
	} as never)
	vi.mocked(readInboxNotificationForEntry).mockResolvedValue({} as never)
})
afterEach(() => {
	cleanup()
	client.clear()
})

describe('InboxEditor notification read lifecycle', () => {
	it('marks the notification after the authorized entry has loaded', async () => {
		view()
		await screen.findAllByText('Тема')
		await waitFor(() =>
			expect(readInboxNotificationForEntry).toHaveBeenCalledWith(
				'token',
				workspaceId,
				entryId
			)
		)
	})

	it('requests source details only for an authorized API-origin entry', async () => {
		vi.mocked(getInboxEntry).mockResolvedValueOnce({
			...entry,
			origin: 'API',
			sourceId: '44444444-4444-4444-8444-444444444444'
		} as never)
		vi.mocked(getInboxEntrySource).mockResolvedValueOnce({
			id: '44444444-4444-4444-8444-444444444444',
			name: 'Форма сайта',
			kind: 'API'
		} as never)
		view()
		await screen.findByText('API · Форма сайта')
		expect(getInboxEntrySource).toHaveBeenCalledWith(
			'token',
			workspaceId,
			entryId
		)
		expect(readInboxNotificationForEntry).toHaveBeenCalledWith(
			'token',
			workspaceId,
			entryId
		)
	})

	it('keeps an API entry readable when source metadata cannot be loaded', async () => {
		vi.mocked(getInboxEntry).mockResolvedValueOnce({
			...entry,
			origin: 'API',
			sourceId: '44444444-4444-4444-8444-444444444444'
		} as never)
		vi.mocked(getInboxEntrySource).mockRejectedValueOnce(
			new Error('unavailable')
		)
		view()
		await screen.findByText('API · имя источника недоступно')
		expect(screen.getAllByText('Тема')).toHaveLength(2)
		await waitFor(() =>
			expect(readInboxNotificationForEntry).toHaveBeenCalledWith(
				'token',
				workspaceId,
				entryId
			)
		)
	})

	it('does not mark a forbidden or failed entry read', async () => {
		view(workspaceId, false)
		await waitFor(() => expect(getInboxEntry).not.toHaveBeenCalled())
		expect(readInboxNotificationForEntry).not.toHaveBeenCalled()
		cleanup()
		client.clear()
		client = new QueryClient({
			defaultOptions: { queries: { retry: false } }
		})
		vi.mocked(getInboxEntry).mockRejectedValueOnce(new Error('forbidden'))
		view()
		await screen.findByText('Состояние')
		expect(readInboxNotificationForEntry).not.toHaveBeenCalled()
	})

	it('shows one manual retry after failure and does not retry in a loop', async () => {
		vi.mocked(readInboxNotificationForEntry)
			.mockRejectedValueOnce(new Error('temporary'))
			.mockResolvedValueOnce({} as never)
		view()
		await screen.findByRole('alert')
		await new Promise(resolve => setTimeout(resolve, 0))
		expect(readInboxNotificationForEntry).toHaveBeenCalledTimes(1)
		fireEvent.click(
			screen.getByRole('button', { name: 'Повторить отметку' })
		)
		await waitFor(() =>
			expect(readInboxNotificationForEntry).toHaveBeenCalledTimes(2)
		)
	})

	it('ignores a mark response after the session revision changes', async () => {
		const pending = deferred<unknown>()
		vi.mocked(readInboxNotificationForEntry).mockReturnValueOnce(
			pending.promise as never
		)
		const invalidate = vi.spyOn(client, 'invalidateQueries')
		view()
		await waitFor(() =>
			expect(readInboxNotificationForEntry).toHaveBeenCalledTimes(1)
		)
		act(() => {
			useSessionStore.setState({
				status: 'authenticated',
				session: { userId: 'new-user', accessToken: 'new-token' },
				sessionRevision: 2,
				errorMessage: null
			})
		})
		await act(async () => pending.resolve({}))
		expect(invalidate).not.toHaveBeenCalled()
	})

	it('does not mark an entry from a different workspace', async () => {
		vi.mocked(getInboxEntry).mockResolvedValueOnce({
			...entry,
			workspaceId: secondWorkspace
		} as never)
		view()
		await screen.findAllByText('Тема')
		await act(async () => Promise.resolve())
		expect(readInboxNotificationForEntry).not.toHaveBeenCalled()
		expect(getInboxEntrySource).not.toHaveBeenCalled()
	})
})
