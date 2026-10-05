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
import toast from 'react-hot-toast'
import { useSessionStore, resetSessionStore } from '@/entities/session'
import {
	listCrmNotifications,
	readCrmNotification,
	type NotificationPage
} from '../api/crm-notifications.api'
import { inspectNotificationHead } from './CombinedNotificationCenter'
import {
	listTaskNotifications,
	setTaskNotificationRead
} from '@/entities/crm-task-notifications'
import {
	useReminderSession,
	type ReminderContext
} from '../model/use-reminder-session'
import { useMailContext } from '@/features/manage-mail/model/use-mail-context'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import {
	TaskNotificationCenter,
	TaskNotificationPanel
} from './TaskNotificationCenter'
import type { DrawerProps } from '@/shared/ui/drawer/Drawer'
import {
	useCollaboration,
	useCollaborationCommand
} from '@/features/workspace-collaboration/model/use-collaboration'
import { listChatNotifications } from '@/entities/workspace-collaboration'
vi.mock('@/entities/crm-task-notifications', () => ({
	listTaskNotifications: vi.fn(),
	setTaskNotificationRead: vi.fn()
}))
vi.mock(
	'@/features/workspace-collaboration/model/use-collaboration',
	() => ({
		useCollaboration: vi.fn(),
		useCollaborationCommand: vi.fn()
	})
)
vi.mock('@/entities/workspace-collaboration', async importOriginal => ({
	...(await importOriginal<object>()),
	listChatNotifications: vi.fn().mockResolvedValue({
		page: 1,
		pageSize: 10,
		total: 0,
		unreadCount: 0,
		items: []
	}),
	readChatConversation: vi.fn()
}))
vi.mock('../model/use-reminder-session', () => ({
	useReminderSession: vi.fn()
}))
vi.mock(
	'@/features/manage-mail/model/use-mail-context',
	async importOriginal => ({
		...(await importOriginal<object>()),
		useMailContext: vi.fn()
	})
)
vi.mock('../api/crm-notifications.api', () => ({
	listCrmNotifications: vi.fn().mockResolvedValue({
		page: 1,
		pageSize: 10,
		total: 0,
		unreadCount: 0,
		items: []
	}),
	readCrmNotification: vi.fn()
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), {
		success: vi.fn(),
		error: vi.fn(),
		dismiss: vi.fn()
	})
}))
vi.mock('@/shared/ui', async original => ({
	...(await original<object>()),
	Drawer: ({ isOpen, title, children, onClose }: DrawerProps) =>
		isOpen ? (
			<section role="dialog" aria-label={String(title)}>
				<button onClick={onClose}>Закрыть панель</button>
				{children}
			</section>
		) : null
}))
const workspaceId = '22222222-2222-4222-8222-222222222222',
	id = '11111111-1111-4111-8111-111111111111'
const data = {
	schemaVersion: 1 as const,
	workspaceId,
	page: 1,
	pageSize: 10,
	total: 1,
	unreadCount: 1,
	items: [
		{
			id,
			taskId: id,
			kind: 'ASSIGNED' as const,
			title: 'Current task',
			dueAt: '2026-09-08T12:00:00.000Z',
			createdAt: '2026-09-08T11:00:00.000Z',
			readAt: null,
			href: `/planner?task=${id}`
		}
	]
}
let client: QueryClient, context: ReminderContext, mailContext: object
beforeEach(() => {
	vi.clearAllMocks()
	resetSessionStore()
	vi.mocked(listCrmNotifications).mockResolvedValue({
		page: 1,
		pageSize: 10,
		total: 0,
		unreadCount: 0,
		items: []
	})
	vi.mocked(listChatNotifications).mockResolvedValue({
		schemaVersion: 1,
		workspaceId,
		subject: 'owner',
		page: 1,
		pageSize: 10,
		total: 0,
		unreadCount: 0,
		items: []
	})
	client = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	context = {
		key: 'owner-key',
		canRead: true,
		canWrite: false,
		actorConfirmed: true,
		actor: { subject: 'owner', membershipId: null },
		session: { accessToken: 'token', userId: 'owner' },
		sessionRevision: 1,
		workspace: {
			workspaceId,
			membership: { membershipId: 'membership-1' }
		},
		permissions: {
			isSuccess: true,
			isFetching: false,
			isError: false,
			refetch: vi.fn()
		},
		self: {
			enabled: true,
			loading: false,
			error: false,
			refetch: vi.fn()
		},
		current: () => true
	} as unknown as ReminderContext
	useSessionStore.setState({
		session: context.session,
		sessionRevision: 1
	})
	mailContext = {
		workspace: {
			workspaceId,
			membership: { membershipId: 'membership-1' }
		},
		session: context.session,
		sessionRevision: 1,
		key: [workspaceId, 'owner', 1, 'membership-1'],
		current: () => true,
		capabilities: {
			data: {
				enabled: true,
				mailPermissions: ['mail:read']
			},
			isError: false,
			isFetching: false,
			isSuccess: true,
			refetch: vi.fn()
		}
	}
	vi.mocked(useReminderSession).mockImplementation(() => context)
	vi.mocked(useMailContext).mockImplementation(() => mailContext as never)
	vi.mocked(useCollaboration).mockReturnValue({
		ready: true,
		binding: { workspaceId, subject: 'owner' },
		session: context.session,
		workspace: {
			workspaceId,
			membership: { membershipId: 'membership-1' }
		},
		current: () => true
	} as never)
	vi.mocked(useCollaborationCommand).mockReturnValue({
		locked: false,
		execute: vi.fn()
	} as never)
	vi.mocked(listTaskNotifications).mockResolvedValue(data)
	vi.mocked(setTaskNotificationRead).mockResolvedValue({
		schemaVersion: 1,
		workspaceId,
		id,
		readAt: '2026-09-08T12:00:00.000Z'
	})
})
afterEach(() => {
	cleanup()
	client.clear()
	vi.useRealTimers()
	resetSessionStore()
})
const view = () => (
	<QueryClientProvider client={client}>
		<TaskNotificationPanel context={context} />
	</QueryClientProvider>
)
const center = () => (
	<QueryClientProvider client={client}>
		<TaskNotificationCenter />
	</QueryClientProvider>
)

describe('new event notice', () => {
	beforeEach(() => {
		context = {
			...context,
			session: { accessToken: 'token', userId: 'owner' },
			sessionRevision: 1,
			authority: {
				subject: 'owner',
				workspaceId,
				role: 'OWNER',
				permissions: ['sales:read', 'intake:read']
			}
		} as ReminderContext
		useSessionStore.setState({
			session: context.session,
			sessionRevision: 1
		})
		mailContext = { ...mailContext, session: context.session }
	})
	it.each(['intake', 'support', 'mail', 'tasks'] as const)(
		'announces a new %s event once for four seconds, without replaying initial history',
		async source => {
			render(center())
			await screen.findByRole('button', {
				name: 'Уведомления, непрочитанных: 1'
			})
			expect(screen.queryByText('Новое событие')).toBeNull()
			vi.useFakeTimers()
			const key =
				source === 'tasks'
					? [
							'crm-task-notifications',
							context.key,
							context.actor,
							1,
							false
						]
					: source === 'mail'
						? [
								'crm-mail-notifications',
								context.key,
								...(mailContext as { key: string[] }).key,
								1,
								false
							]
						: [`crm-${source}-notifications`, context.key, 1, false]
			const event =
				source === 'mail'
					? {
							id: 'new-event',
							title: 'New incoming email',
							createdAt: '2026-09-08T12:00:00.000Z',
							readAt: null,
							targetId: id,
							contactId: id
						}
					: {
							...data.items[0],
							id: 'new-event',
							targetId: id,
							createdAt: '2026-09-08T12:00:00.000Z'
						}
			const snapshot = { ...data, items: [event], unreadCount: 1 }
			await act(async () => {
				client.setQueryData(key, snapshot)
				await vi.advanceTimersByTimeAsync(1)
			})
			expect(screen.getByRole('status').textContent).toBe('Новое событие')
			await act(async () => {
				await vi.advanceTimersByTimeAsync(3998)
			})
			expect(screen.getByRole('status').textContent).toBe('Новое событие')
			await act(async () => {
				await vi.advanceTimersByTimeAsync(2)
			})
			expect(screen.queryByText('Новое событие')).toBeNull()
			await act(async () => {
				client.setQueryData(key, {
					...snapshot,
					items: [{ ...event, readAt: '2026-09-08T12:01:00.000Z' }]
				})
				await vi.advanceTimersByTimeAsync(1)
				client.setQueryData(key, snapshot)
				await vi.advanceTimersByTimeAsync(1)
			})
			expect(screen.queryByText('Новое событие')).toBeNull()
		}
	)

	it('keeps observing newest tasks while browsing older pages and clears the notice on open', async () => {
		vi.mocked(listTaskNotifications).mockImplementation(
			async (_token, query) => ({
				...data,
				page: query.page,
				total: 11,
				items: [
					{
						...data.items[0],
						title: query.page === 2 ? 'Older task' : 'Current task'
					}
				]
			})
		)
		render(center())
		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Уведомления, непрочитанных: 1'
			})
		)
		fireEvent.click(screen.getByRole('button', { name: 'Задачи' }))
		fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
		await screen.findByRole('link', { name: 'Older task' })
		fireEvent.click(screen.getByRole('button', { name: 'Закрыть панель' }))
		act(() => {
			client.setQueryData(
				['crm-task-notifications', context.key, context.actor, 1, false],
				{
					...data,
					total: 12,
					unreadCount: 2,
					items: [
						{
							...data.items[0],
							id: 'new-due',
							kind: 'DUE',
							createdAt: '2026-09-01T12:00:00.000Z'
						}
					]
				}
			)
		})
		await screen.findByText('Новое событие')
		fireEvent.click(
			screen.getByRole('button', { name: 'Уведомления, непрочитанных: 2' })
		)
		expect(screen.queryByText('Новое событие')).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: 'Закрыть панель' }))
		expect(screen.queryByText('Новое событие')).toBeNull()
	})

	it('ignores history and disappearing records, but detects distinct events at the same timestamp', () => {
		const first = inspectNotificationHead({ items: data.items })
		expect(first.newEvent).toBe(false)
		const read = inspectNotificationHead(
			{
				items: [{ ...data.items[0], readAt: '2026-09-08T12:00:00.000Z' }]
			},
			first.marker
		)
		expect(read.newEvent).toBe(false)
		const empty = inspectNotificationHead({ items: [] }, read.marker)
		expect(
			inspectNotificationHead({ items: data.items }, empty.marker).newEvent
		).toBe(false)
		expect(
			inspectNotificationHead(
				{
					items: [
						{
							...data.items[0],
							id: 'older',
							createdAt: '2026-09-01T12:00:00.000Z'
						}
					]
				},
				first.marker
			).newEvent
		).toBe(false)
		const sameTime = inspectNotificationHead(
			{ items: [{ ...data.items[0], id: 'second' }] },
			first.marker
		)
		expect(sameTime.newEvent).toBe(true)
		expect(
			inspectNotificationHead({ items: data.items }, sameTime.marker)
				.newEvent
		).toBe(false)
	})
})
describe('task notification center', () => {
	it('counts chat alerts persistently and includes chat with mail and tasks in the default all feed', async () => {
		const chatMessageId = '77777777-7777-4777-8777-777777777777'
		const conversationId = '88888888-8888-4888-8888-888888888888'
		vi.mocked(listChatNotifications).mockResolvedValue({
			schemaVersion: 1,
			workspaceId,
			subject: 'owner',
			page: 1,
			pageSize: 10,
			total: 1,
			unreadCount: 1,
			items: [
				{
					id: chatMessageId,
					messageId: chatMessageId,
					conversationId,
					sequence: 4,
					title: 'Алексей Сотрудник',
					text: 'Проверьте договор',
					senderName: 'Алексей Сотрудник',
					createdAt: '2026-09-08T12:03:00.000Z',
					readAt: null
				}
			]
		})
		vi.mocked(listCrmNotifications).mockImplementation(async source =>
			source === 'mail'
				? {
						page: 1,
						pageSize: 10,
						total: 1,
						unreadCount: 1,
						items: [
							{
								id: '99999999-9999-4999-8999-999999999999',
								title: 'Новое письмо',
								createdAt: '2026-09-08T12:02:00.000Z',
								readAt: null,
								targetId: id,
								contactId: id,
								mailboxId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
							}
						]
					}
				: { page: 1, pageSize: 10, total: 0, unreadCount: 0, items: [] }
		)
		vi.mocked(listTaskNotifications).mockResolvedValue({
			...data,
			items: [
				{
					...data.items[0],
					title: 'Моё назначение',
					createdAt: '2026-09-08T12:01:00.000Z'
				}
			]
		})
		render(center())
		expect(
			await screen.findByRole('button', {
				name: 'Уведомления, непрочитанных: 3'
			})
		).toBeTruthy()
		fireEvent.click(
			screen.getByRole('button', { name: 'Уведомления, непрочитанных: 3' })
		)
		expect(
			await screen.findByText('Всего непрочитанных во всех разделах: 3')
		).toBeTruthy()
		expect(
			screen
				.getByRole('link', {
					name: 'Алексей Сотрудник: Проверьте договор'
				})
				.getAttribute('href')
		).toBe(
			`/messages?workspaceId=${workspaceId}&conversationId=${conversationId}`
		)
		expect(screen.getByRole('link', { name: 'Новое письмо' })).toBeTruthy()
		expect(
			screen.getByRole('link', { name: 'Моё назначение' })
		).toBeTruthy()
		expect(listChatNotifications).toHaveBeenCalledWith(
			'token',
			expect.objectContaining({
				workspaceId,
				subject: 'owner',
				page: 1,
				pageSize: 10,
				unreadOnly: false
			})
		)
		fireEvent.click(screen.getByRole('button', { name: 'Закрыть панель' }))
		expect(
			screen.getByRole('button', { name: 'Уведомления, непрочитанных: 3' })
		).toBeTruthy()
	})

	it('shows incoming mail separately, links to its mailbox message, and does not auto-mark it read', async () => {
		const mailItem = {
			id: '33333333-3333-4333-8333-333333333333',
			title: 'Вопрос по заказу',
			createdAt: '2026-09-08T12:00:00.000Z',
			readAt: null,
			targetId: '44444444-4444-4444-8444-444444444444',
			contactId: '55555555-5555-4555-8555-555555555555',
			mailboxId: '66666666-6666-4666-8666-666666666666'
		}
		vi.mocked(listCrmNotifications).mockImplementation(async source =>
			source === 'mail'
				? {
						page: 1,
						pageSize: 10,
						total: 1,
						unreadCount: 1,
						items: [mailItem]
					}
				: { page: 1, pageSize: 10, total: 0, unreadCount: 0, items: [] }
		)
		render(center())
		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Уведомления, непрочитанных: 2'
			})
		)
		fireEvent.click(screen.getByRole('button', { name: 'Почта' }))
		const link = await screen.findByRole('link', {
			name: 'Вопрос по заказу'
		})
		expect(link.getAttribute('href')).toBe(
			`/mail?workspaceId=${workspaceId}&mailboxId=${mailItem.mailboxId}&messageId=${mailItem.targetId}`
		)
		expect(readCrmNotification).not.toHaveBeenCalled()
		expect(listCrmNotifications).toHaveBeenCalledWith(
			'mail',
			'token',
			workspaceId,
			1,
			false
		)
	})

	it('refreshes mail at 15 seconds while other notification sources retain their 60-second cadence', async () => {
		context = {
			...context,
			authority: {
				subject: 'owner',
				workspaceId,
				permissions: ['intake:read']
			}
		} as ReminderContext
		vi.useFakeTimers()
		render(center())
		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
			await vi.advanceTimersByTimeAsync(1)
		})
		expect(
			screen.getByRole('button', {
				name: 'Уведомления, непрочитанных: 1'
			})
		).toBeTruthy()
		const countBySource = () => {
			const calls = vi.mocked(listCrmNotifications).mock.calls
			return Object.fromEntries(
				(['intake', 'support', 'mail'] as const).map(source => [
					source,
					calls.filter(([calledSource]) => calledSource === source).length
				])
			)
		}
		const initial = countBySource()
		await act(async () => {
			await vi.advanceTimersByTimeAsync(15_000)
		})
		const afterMailInterval = countBySource()
		expect(afterMailInterval.mail).toBeGreaterThan(initial.mail)
		expect(afterMailInterval.intake).toBe(initial.intake)
		expect(afterMailInterval.support).toBe(initial.support)
		expect(readCrmNotification).not.toHaveBeenCalled()
		await act(async () => {
			await vi.advanceTimersByTimeAsync(45_000)
		})
		const afterOtherIntervals = countBySource()
		expect(afterOtherIntervals.intake).toBeGreaterThan(
			afterMailInterval.intake
		)
		expect(afterOtherIntervals.support).toBeGreaterThan(
			afterMailInterval.support
		)
	})

	it('hides a cached mail badge and rows when mail capability lookup fails', async () => {
		mailContext = {
			...mailContext,
			capabilities: {
				...(mailContext as { capabilities: object }).capabilities,
				isError: true,
				isSuccess: false,
				data: undefined
			}
		}
		const mailItem = {
			id,
			title: 'Private message',
			createdAt: '2026-09-08T12:00:00.000Z',
			readAt: null,
			targetId: id,
			contactId: id
		}
		for (const page of [1, 2]) {
			client.setQueryData(
				[
					'crm-mail-notifications',
					context.key,
					...(mailContext as { key: string[] }).key,
					page,
					false
				],
				{ page, pageSize: 10, total: 1, unreadCount: 1, items: [mailItem] }
			)
		}
		render(center())
		await waitFor(() =>
			expect(
				screen.getByRole('button', {
					name: 'Уведомления, часть счётчиков недоступна'
				})
			).toBeTruthy()
		)
		fireEvent.click(screen.getByRole('button', { name: /^Уведомления/ }))
		fireEvent.click(screen.getByRole('button', { name: 'Почта' }))
		expect(
			await screen.findByText(
				'Не удалось загрузить уведомления. Попробуйте обновить список.'
			)
		).toBeTruthy()
		expect(screen.queryByText('Private message')).toBeNull()
	})

	it('hides page-two mail after a mailbox denial even when the head page was cached', async () => {
		const mailItem = {
			id: '33333333-3333-4333-8333-333333333333',
			title: 'Private page-one mail',
			createdAt: '2026-09-08T12:00:00.000Z',
			readAt: null,
			targetId: '44444444-4444-4444-8444-444444444444',
			contactId: '55555555-5555-4555-8555-555555555555'
		}
		vi.mocked(listCrmNotifications).mockImplementation(
			async (source, _token, _workspace, page) => {
				if (source !== 'mail')
					return {
						page: 1,
						pageSize: 10,
						total: 0,
						unreadCount: 0,
						items: []
					}
				if (page === 2)
					throw new AuthenticatedApiError('forbidden', 'denied')
				return {
					page: 1,
					pageSize: 10,
					total: 11,
					unreadCount: 1,
					items: [mailItem]
				}
			}
		)
		render(center())
		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Уведомления, непрочитанных: 2'
			})
		)
		fireEvent.click(screen.getByRole('button', { name: 'Почта' }))
		await screen.findByRole('link', { name: 'Private page-one mail' })
		fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
		expect(
			await screen.findByText('Недостаточно прав для просмотра почты.')
		).toBeTruthy()
		expect(screen.queryByText('Private page-one mail')).toBeNull()
		expect(
			screen.getByRole('button', {
				name: 'Уведомления, непрочитанных: 1'
			})
		).toBeTruthy()
	})

	it('discards a late list result when workspace membership scope changes', async () => {
		let resolveList!: (value: NotificationPage) => void
		const current = vi.fn(() => true)
		mailContext = { ...mailContext, current }
		vi.mocked(listCrmNotifications).mockImplementation(source =>
			source === 'mail'
				? new Promise(resolve => {
						resolveList = resolve
					})
				: Promise.resolve({
						page: 1,
						pageSize: 10,
						total: 0,
						unreadCount: 0,
						items: []
					})
		)
		render(center())
		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Уведомления, часть счётчиков недоступна'
			})
		)
		fireEvent.click(screen.getByRole('button', { name: 'Почта' }))
		await waitFor(() => expect(resolveList).toBeTypeOf('function'))
		current.mockReturnValue(false)
		await act(async () => {
			resolveList!({
				page: 1,
				pageSize: 10,
				total: 1,
				unreadCount: 1,
				items: [
					{
						id: '33333333-3333-4333-8333-333333333333',
						title: 'Late private message',
						createdAt: '2026-09-08T12:00:00.000Z',
						readAt: null,
						targetId: '44444444-4444-4444-8444-444444444444',
						contactId: '55555555-5555-4555-8555-555555555555'
					}
				]
			})
		})
		expect(
			await screen.findByText(
				'Не удалось загрузить уведомления. Попробуйте обновить список.'
			)
		).toBeTruthy()
		expect(screen.queryByText('Late private message')).toBeNull()
		expect(readCrmNotification).not.toHaveBeenCalled()
	})

	it('clears cached private notifications immediately when the read mutation is denied', async () => {
		let listCalls = 0
		vi.mocked(listCrmNotifications).mockImplementation(async source => {
			if (source !== 'mail')
				return {
					page: 1,
					pageSize: 10,
					total: 0,
					unreadCount: 0,
					items: []
				}
			listCalls += 1
			if (listCalls > 1) return new Promise(() => {})
			return {
				page: 1,
				pageSize: 10,
				total: 1,
				unreadCount: 1,
				items: [
					{
						id: '33333333-3333-4333-8333-333333333333',
						title: 'Sensitive notification',
						createdAt: '2026-09-08T12:00:00.000Z',
						readAt: null,
						targetId: '44444444-4444-4444-8444-444444444444',
						contactId: '55555555-5555-4555-8555-555555555555'
					}
				]
			}
		})
		vi.mocked(readCrmNotification).mockRejectedValue(
			new AuthenticatedApiError('forbidden', 'revoked')
		)
		render(center())
		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Уведомления, непрочитанных: 2'
			})
		)
		fireEvent.click(screen.getByRole('button', { name: 'Почта' }))
		await screen.findByRole('link', { name: 'Sensitive notification' })
		fireEvent.click(
			screen.getByRole('button', { name: 'Отметить прочитанным' })
		)
		await waitFor(() => expect(listCalls).toBeGreaterThan(1))
		expect(screen.queryByText('Sensitive notification')).toBeNull()
	})

	it('shows server badge, safe task link and explicit read preference in READ_ONLY', async () => {
		render(view())
		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Уведомления, непрочитанных: 1'
			})
		)
		expect(
			screen
				.getByRole('link', { name: 'Current task' })
				.getAttribute('href')
		).toBe(`/planner?task=${id}`)
		fireEvent.click(
			screen.getByRole('button', { name: 'Отметить прочитанным' })
		)
		await waitFor(() =>
			expect(setTaskNotificationRead).toHaveBeenCalledWith('token', {
				workspaceId,
				actorMembershipId: null,
				id,
				read: true
			})
		)
	})
	it('filters on server and never treats the browser as durable storage', async () => {
		render(view())
		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Уведомления, непрочитанных: 1'
			})
		)
		fireEvent.click(
			screen.getByRole('checkbox', { name: 'Только непрочитанные' })
		)
		await waitFor(() =>
			expect(listTaskNotifications).toHaveBeenLastCalledWith('token', {
				workspaceId,
				actorMembershipId: null,
				page: 1,
				pageSize: 10,
				unreadOnly: true
			})
		)
	})
	it('hides old records and badge when exact actor proof is no longer available', async () => {
		const rendered = render(view())
		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Уведомления, непрочитанных: 1'
			})
		)
		context = { ...context, actorConfirmed: false, current: () => false }
		rendered.rerender(view())
		expect(screen.queryByRole('link', { name: 'Current task' })).toBeNull()
		expect(
			screen.getByRole('button', { name: 'Уведомления' })
		).toBeTruthy()
		expect(setTaskNotificationRead).not.toHaveBeenCalled()
	})
	it('offers permission recovery instead of an endless loading message after a failed check', () => {
		context = {
			...context,
			canRead: false,
			actorConfirmed: false,
			actor: null,
			permissions: {
				...context.permissions,
				isSuccess: false,
				isError: true
			},
			current: () => false
		} as ReminderContext
		render(view())
		fireEvent.click(screen.getByRole('button', { name: /^Уведомления/ }))
		expect(screen.getByRole('alert').textContent).toContain(
			'Не удалось проверить доступ'
		)
		expect(screen.queryByText(/Проверяем доступ/)).toBeNull()
		fireEvent.click(
			screen.getByRole('button', { name: 'Проверить доступ' })
		)
		expect(context.permissions.refetch).toHaveBeenCalledOnce()
		expect(listTaskNotifications).not.toHaveBeenCalled()
		expect(setTaskNotificationRead).not.toHaveBeenCalled()
	})
	it.each([true, false])(
		'offers actor recovery after lookup error=%s without guessing a membership',
		error => {
			context = {
				...context,
				actorConfirmed: false,
				actor: null,
				self: { ...context.self, error, loading: false },
				current: () => true
			}
			render(view())
			fireEvent.click(screen.getByRole('button', { name: /^Уведомления/ }))
			expect(screen.getByRole('alert').textContent).toContain(
				'Не удалось подтвердить текущего сотрудника'
			)
			expect(screen.queryByText(/Проверяем доступ/)).toBeNull()
			fireEvent.click(
				screen.getByRole('button', { name: 'Проверить сотрудника' })
			)
			expect(context.self.refetch).toHaveBeenCalledOnce()
			expect(listTaskNotifications).not.toHaveBeenCalled()
			expect(setTaskNotificationRead).not.toHaveBeenCalled()
		}
	)
	it('keeps an in-flight actor lookup pending with data controls disabled', () => {
		context = {
			...context,
			actorConfirmed: false,
			actor: null,
			self: { ...context.self, loading: true },
			current: () => true
		}
		render(view())
		fireEvent.click(screen.getByRole('button', { name: /^Уведомления/ }))
		expect(screen.getByRole('status').textContent).toContain(
			'Проверяем доступ'
		)
		expect(screen.queryByRole('alert')).toBeNull()
		expect(
			screen
				.getByRole('button', { name: 'Обновить' })
				.hasAttribute('disabled')
		).toBe(true)
		expect(
			screen
				.getByRole('checkbox', { name: 'Только непрочитанные' })
				.hasAttribute('disabled')
		).toBe(true)
		expect(listTaskNotifications).not.toHaveBeenCalled()
	})
	it('keeps the drawer open across actor recovery but closes it for another session scope', async () => {
		const confirmed = context
		context = {
			...context,
			actorConfirmed: false,
			actor: null,
			self: { ...context.self, loading: true }
		}
		const center = () => (
			<QueryClientProvider client={client}>
				<TaskNotificationCenter />
			</QueryClientProvider>
		)
		const rendered = render(center())
		fireEvent.click(screen.getByRole('button', { name: /^Уведомления/ }))
		expect(
			screen.getByRole('dialog', { name: 'Уведомления' })
		).toBeTruthy()
		fireEvent.click(screen.getByRole('button', { name: 'Задачи' }))
		vi.mocked(toast).mockClear()
		fireEvent.click(screen.getByRole('button', { name: 'Поддержка' }))
		fireEvent.click(screen.getByRole('button', { name: 'Заявки' }))
		fireEvent.click(screen.getByRole('button', { name: 'Задачи' }))
		expect(toast).not.toHaveBeenCalled()
		context = confirmed
		rendered.rerender(center())
		expect(
			await screen.findByRole('link', { name: 'Current task' })
		).toBeTruthy()
		expect(
			screen.getByRole('dialog', { name: 'Уведомления' })
		).toBeTruthy()
		context = {
			...context,
			key: 'another-session-scope',
			actorConfirmed: false,
			actor: null,
			self: { ...context.self, loading: true },
			current: () => false
		}
		rendered.rerender(center())
		expect(screen.queryByRole('dialog')).toBeNull()
		expect(screen.queryByRole('link', { name: 'Current task' })).toBeNull()
	})
	it.each([
		{ role: 'ANALYST', permissions: ['sales:read'] },
		{ role: 'MANAGER', permissions: [] }
	])(
		'shows permission denied for confirmed $role restrictions without requesting data',
		async authority => {
			context = {
				...context,
				canRead: false,
				actorConfirmed: false,
				actor: null,
				session: { ...context.session!, userId: 'owner' },
				authority: { ...authority, subject: 'owner', workspaceId },
				permissions: { isSuccess: true, isFetching: false },
				current: () => false
			} as ReminderContext
			render(view())
			fireEvent.click(screen.getByRole('button', { name: /^Уведомления/ }))
			expect(screen.getByRole('alert').textContent).toContain(
				'Недостаточно прав'
			)
			expect(screen.queryByText(/Проверяем доступ/)).toBeNull()
			expect(
				screen
					.getByRole('button', { name: 'Обновить' })
					.hasAttribute('disabled')
			).toBe(true)
			expect(listTaskNotifications).not.toHaveBeenCalled()
			expect(setTaskNotificationRead).not.toHaveBeenCalled()
		}
	)
	it('does not treat an old or still refreshing permission result as a confirmed denial', () => {
		context = {
			...context,
			canRead: false,
			actorConfirmed: false,
			session: { ...context.session!, userId: 'owner' },
			authority: {
				role: 'ANALYST',
				permissions: ['sales:read'],
				subject: 'owner',
				workspaceId
			},
			permissions: { isSuccess: true, isFetching: true },
			current: () => false
		} as ReminderContext
		const rendered = render(view())
		fireEvent.click(screen.getByRole('button', { name: /^Уведомления/ }))
		expect(screen.getByRole('status').textContent).toContain(
			'Проверяем доступ'
		)
		expect(screen.queryByRole('alert')).toBeNull()
		context = {
			...context,
			permissions: { ...context.permissions, isFetching: false },
			authority: { ...context.authority!, subject: 'other-session' }
		}
		rendered.rerender(view())
		expect(screen.getByRole('status').textContent).toContain(
			'Проверяем доступ'
		)
		expect(screen.queryByRole('alert')).toBeNull()
		expect(listTaskNotifications).not.toHaveBeenCalled()
	})
})
