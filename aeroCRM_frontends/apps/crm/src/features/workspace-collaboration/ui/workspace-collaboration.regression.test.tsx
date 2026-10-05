import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore, resetSessionStore } from '@/entities/session'
import {
	useCrmPermissions,
	useCrmWorkspaceAccess,
	getCrmPermissions
} from '@/entities/crm-access'
import {
	archiveDirectoryEntry,
	listChatMessages,
	listConversations,
	listDirectory,
	readChatConversation,
	sendChatMessage
} from '@/entities/workspace-collaboration'
import { DirectoryScreen } from './DirectoryScreen'
import { MessagesScreen } from './MessagesScreen'
import { PendingCommandProvider } from '@/shared/lib/pending-command'

vi.mock('@/entities/crm-access', async importOriginal => ({
	...(await importOriginal<object>()),
	useCrmPermissions: vi.fn(),
	useCrmWorkspaceAccess: vi.fn(),
	getCrmPermissions: vi.fn()
}))
vi.mock('@/entities/workspace-collaboration', async importOriginal => ({
	...(await importOriginal<object>()),
	archiveDirectoryEntry: vi.fn(),
	listChatMessages: vi.fn(),
	listConversations: vi.fn(),
	listDirectory: vi.fn(),
	readChatConversation: vi.fn(),
	sendChatMessage: vi.fn()
}))
vi.mock('@/shared/ui', async importOriginal => ({
	...(await importOriginal<object>()),
	Drawer: ({
		isOpen,
		title,
		children
	}: {
		isOpen: boolean
		title: unknown
		children: ReactNode
	}) =>
		isOpen ? (
			<section role="dialog" aria-label={String(title)}>
				{children}
			</section>
		) : null
}))

const workspaceId = '22222222-2222-4222-8222-222222222222'
const conversationId = '33333333-3333-4333-8333-333333333333'
const ownerEntryId = '44444444-4444-4444-8444-444444444444'
const teammateEntryId = '55555555-5555-4555-8555-555555555555'
const session = { accessToken: 'test-token', userId: 'member@example.org' }
const ownerScope = {
	workspaceId,
	subject: session.userId,
	role: 'TEAM_LEAD',
	state: 'ACTIVE',
	dataScope: 'TEAM',
	teamIds: [],
	permissions: ['customers:read', 'customers:write']
}

const emptyFields = {
	firstName: null,
	lastName: null,
	middleName: null,
	phone: null,
	email: null,
	position: null,
	department: null,
	extension: null,
	telegram: null
}
const entry = (overrides: Record<string, unknown> = {}) => ({
	id: teammateEntryId,
	subject: 'teammate@example.org',
	membershipId: '66666666-6666-4666-8666-666666666666',
	invitationId: null,
	status: 'ACTIVE',
	isOwner: false,
	displayName: 'Алексей Сотрудник',
	fields: { ...emptyFields, position: 'Менеджер' },
	version: 1,
	archivedAt: null,
	updatedAt: '2026-10-05T10:00:00.000Z',
	canEdit: true,
	canArchive: false,
	canMessage: true,
	...overrides
})
const conversation = {
	id: conversationId,
	kind: 'DIRECT' as const,
	title: 'Алексей Сотрудник',
	peer: {
		subject: 'teammate@example.org',
		membershipId: '66666666-6666-4666-8666-666666666666',
		displayName: 'Алексей Сотрудник',
		active: true
	},
	lastSequence: 1,
	readThroughSequence: 0,
	peerReadThroughSequence: 1,
	unreadCount: 0,
	lastMessageAt: '2026-10-05T10:00:00.000Z',
	lastMessage: {
		id: '77777777-7777-4777-8777-777777777777',
		sequence: 1,
		senderSubject: session.userId,
		text: 'Добрый день',
		createdAt: '2026-10-05T10:00:00.000Z'
	},
	canSend: true
}
const message = {
	id: conversation.lastMessage.id,
	conversationId,
	sequence: 1,
	senderSubject: session.userId,
	senderMembershipId: '88888888-8888-4888-8888-888888888888',
	senderName: 'Иван Иванов',
	text: 'Добрый день',
	createdAt: '2026-10-05T10:00:00.000Z'
}

let client: QueryClient
let access: Record<string, unknown>
let permissions: Record<string, unknown>
const pendingOwner = JSON.stringify([session.userId, 1])
const view = (screenToRender: ReactNode) => (
	<QueryClientProvider client={client}>
		<MessagesProvider>{screenToRender}</MessagesProvider>
	</QueryClientProvider>
)

function MessagesProvider({ children }: { children: ReactNode }) {
	return (
		<PendingCommandProvider owner={pendingOwner}>
			{children}
		</PendingCommandProvider>
	)
}

class ImmediateObserver {
	callback: IntersectionObserverCallback
	constructor(callback: IntersectionObserverCallback) {
		this.callback = callback
	}
	observe(target: Element) {
		this.callback(
			[{ isIntersecting: true, target } as IntersectionObserverEntry],
			this as unknown as IntersectionObserver
		)
	}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return []
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	resetSessionStore()
	useSessionStore.setState({ session, sessionRevision: 1 })
	access = {
		workspaceId,
		membership: { membershipId: '88888888-8888-4888-8888-888888888888' },
		canWrite: true,
		isReadOnly: false
	}
	permissions = { ...ownerScope }
	vi.mocked(useCrmWorkspaceAccess).mockImplementation(
		() => access as never
	)
	vi.mocked(useCrmPermissions).mockReturnValue({
		data: permissions,
		isSuccess: true,
		isFetching: false,
		isError: false,
		refetch: vi.fn()
	} as never)
	vi.mocked(getCrmPermissions).mockImplementation(
		async () => permissions as never
	)
	vi.mocked(listDirectory).mockResolvedValue({
		schemaVersion: 1,
		workspaceId,
		subject: session.userId,
		page: 1,
		pageSize: 30,
		total: 2,
		items: [
			entry({
				id: ownerEntryId,
				isOwner: true,
				subject: null,
				canEdit: false,
				canArchive: true,
				canMessage: false,
				displayName: 'Владелец'
			}),
			entry()
		]
	} as never)
	vi.mocked(listConversations).mockResolvedValue({
		schemaVersion: 1,
		workspaceId,
		subject: session.userId,
		page: 1,
		pageSize: 30,
		total: 1,
		unreadCount: 0,
		items: [conversation]
	} as never)
	vi.mocked(listChatMessages).mockResolvedValue({
		schemaVersion: 1,
		workspaceId,
		subject: session.userId,
		conversation,
		items: [message],
		nextBeforeSequence: null
	} as never)
	vi.mocked(readChatConversation).mockResolvedValue({
		schemaVersion: 1,
		workspaceId,
		subject: session.userId,
		conversationId,
		throughSequence: 1,
		unreadCount: 0
	} as never)
	vi.mocked(archiveDirectoryEntry).mockResolvedValue({
		schemaVersion: 1,
		workspaceId,
		subject: session.userId,
		item: entry({
			id: ownerEntryId,
			isOwner: true,
			canEdit: false,
			canArchive: true,
			archivedAt: '2026-10-05T11:00:00.000Z'
		})
	} as never)
	client = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	window.history.replaceState({}, '', '/messages')
})
afterEach(() => {
	cleanup()
	client.clear()
	resetSessionStore()
	Reflect.deleteProperty(window, 'IntersectionObserver')
})

describe('workspace collaboration regression behavior', () => {
	it('retains the exact chat command and text when the first send outcome is unknown', async () => {
		vi.mocked(sendChatMessage)
			.mockRejectedValueOnce(new Error('connection lost after dispatch'))
			.mockResolvedValueOnce({
				schemaVersion: 1,
				workspaceId,
				subject: session.userId,
				item: message
			} as never)
		render(view(<MessagesScreen />))
		fireEvent.click(
			(await screen.findByText('Алексей Сотрудник')).closest('button')!
		)
		const composer = await screen.findByRole('textbox', {
			name: 'Сообщение'
		})
		fireEvent.change(composer, {
			target: { value: '  Повторить тот же текст  ' }
		})
		fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
		await screen.findByRole('button', { name: 'Проверить результат' })
		const firstCommand = vi.mocked(sendChatMessage).mock.calls[0]?.[1]
		expect(firstCommand).toMatchObject({ text: 'Повторить тот же текст' })
		fireEvent.click(
			screen.getByRole('button', { name: 'Проверить результат' })
		)
		await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(2))
		expect(vi.mocked(sendChatMessage).mock.calls[1]?.[1]).toEqual(
			firstCommand
		)
	})

	it('keeps a draft across message query invalidation and exposes the peer read receipt', async () => {
		window.IntersectionObserver =
			ImmediateObserver as unknown as typeof IntersectionObserver
		render(view(<MessagesScreen />))
		fireEvent.click(
			(await screen.findByText('Алексей Сотрудник')).closest('button')!
		)
		expect(await screen.findByText('Прочитано')).toBeTruthy()
		await waitFor(() =>
			expect(readChatConversation).toHaveBeenCalledWith(
				'test-token',
				expect.objectContaining({ conversationId, throughSequence: 1 })
			)
		)
		const composer = await screen.findByRole('textbox', {
			name: 'Сообщение'
		})
		fireEvent.change(composer, { target: { value: 'Черновик останется' } })
		await act(async () => {
			await client.invalidateQueries({
				queryKey: ['workspace-chat-messages']
			})
		})
		expect(
			(
				screen.getByRole('textbox', {
					name: 'Сообщение'
				}) as HTMLTextAreaElement
			).value
		).toBe('Черновик останется')
	})

	it('keeps archive authority on the owner entry while team lead edits remain available without team-wide grants', async () => {
		render(view(<DirectoryScreen />))
		await screen.findByText('Владелец')
		const editButtons = screen.getAllByRole('button', {
			name: 'Редактировать'
		})
		expect(editButtons).toHaveLength(2)
		expect(vi.mocked(listDirectory)).toHaveBeenCalled()
		fireEvent.click(editButtons[0]!)
		fireEvent.click(screen.getByRole('button', { name: 'Убрать в архив' }))
		await waitFor(() =>
			expect(archiveDirectoryEntry).toHaveBeenCalledWith(
				'test-token',
				expect.objectContaining({
					entryId: ownerEntryId,
					action: 'archive'
				})
			)
		)
	})

	it('locks edits and chat sends when workspace access is read only', async () => {
		access = { ...access, canWrite: false, isReadOnly: true }
		vi.mocked(listDirectory).mockResolvedValueOnce({
			schemaVersion: 1,
			workspaceId,
			subject: session.userId,
			page: 1,
			pageSize: 30,
			total: 2,
			items: [
				entry({
					id: ownerEntryId,
					isOwner: true,
					subject: null,
					canEdit: false,
					canArchive: false,
					canMessage: false,
					displayName: 'Владелец'
				}),
				entry({ canEdit: false, canArchive: false })
			]
		} as never)
		render(view(<DirectoryScreen />))
		await screen.findByText('Владелец')
		expect(
			screen.queryByRole('button', { name: 'Редактировать' })
		).toBeNull()
		expect(
			screen.queryByRole('button', { name: 'Убрать в архив' })
		).toBeNull()
		cleanup()
		window.history.replaceState(
			{},
			'',
			`/messages?conversationId=${conversationId}`
		)
		render(view(<MessagesScreen />))
		fireEvent.click(
			(await screen.findByText('Алексей Сотрудник')).closest('button')!
		)
		const composer = await screen.findByRole('textbox', {
			name: 'Сообщение'
		})
		expect((composer as HTMLTextAreaElement).disabled).toBe(true)
		expect(
			(
				screen.getByRole('button', {
					name: 'Отправить'
				}) as HTMLButtonElement
			).disabled
		).toBe(true)
		expect(sendChatMessage).not.toHaveBeenCalled()
	})
})
