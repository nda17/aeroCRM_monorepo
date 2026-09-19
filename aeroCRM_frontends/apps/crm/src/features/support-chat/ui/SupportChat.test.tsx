import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '@/entities/session'
import { supportApi } from '@/entities/support'
import { SupportChat } from './SupportChat'
import toast from 'react-hot-toast'

const navigation = vi.hoisted(() => ({
	replace: vi.fn(),
	search: new URLSearchParams()
}))
vi.mock('next/navigation', () => ({
	usePathname: () => '/inbox',
	useSearchParams: () => navigation.search,
	useRouter: () => ({ replace: navigation.replace })
}))
vi.mock('@/entities/support', async importOriginal => ({
	...(await importOriginal<typeof import('@/entities/support')>()),
	supportApi: {
		list: vi.fn(),
		unread: vi.fn(),
		detail: vi.fn(),
		history: vi.fn(),
		send: vi.fn(),
		read: vi.fn(),
		upload: vi.fn(),
		remove: vi.fn(),
		content: vi.fn()
	}
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
const id = '11111111-1111-4111-8111-111111111111'
const conversation = {
	id,
	number: 1,
	authorSubject: 'user-a',
	authorName: 'Клиент',
	workspaceId: null,
	companyName: null,
	subject: 'Подписка',
	status: 'NEW' as const,
	section: 'inbox',
	appVersion: '0.1.0',
	lastSequence: 1,
	version: 1,
	unreadCount: 0,
	createdAt: '2026-09-09T00:00:00.000Z',
	updatedAt: '2026-09-09T00:00:00.000Z',
	lastMessageAt: '2026-09-09T00:00:00.000Z'
}
const api = vi.mocked(supportApi)
const clients: QueryClient[] = []
const mount = () => {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false }
		}
	})
	clients.push(client)
	return render(
		<QueryClientProvider client={client}>
			<SupportChat />
		</QueryClientProvider>
	)
}
beforeEach(() => {
	vi.clearAllMocks()
	navigation.search = new URLSearchParams()
	useSessionStore.setState({
		status: 'authenticated',
		session: { userId: 'user-a', accessToken: 'session-anchor' },
		sessionRevision: 1
	})
	Object.defineProperty(window, 'matchMedia', {
		configurable: true,
		value: () => ({
			matches: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn()
		})
	})
	HTMLDialogElement.prototype.show = function () {
		this.setAttribute('open', '')
	}
	HTMLDialogElement.prototype.showModal = HTMLDialogElement.prototype.show
	HTMLDialogElement.prototype.close = function () {
		this.removeAttribute('open')
	}
	Element.prototype.scrollIntoView = vi.fn()
	URL.createObjectURL = vi.fn(() => 'blob:synthetic-screenshot')
	URL.revokeObjectURL = vi.fn()
	Object.defineProperty(document, 'visibilityState', {
		configurable: true,
		value: 'visible'
	})
	api.list.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0 })
	api.unread.mockResolvedValue(0)
	api.detail.mockResolvedValue(conversation)
	api.history.mockResolvedValue({
		items: [],
		hasMore: false,
		lastSequence: 0
	})
	api.read.mockResolvedValue({ throughSequence: 0 })
})
afterEach(() => {
	cleanup()
	clients.splice(0).forEach(client => client.clear())
	vi.useRealTimers()
})

describe('CRM support conversation', () => {
	it('uses an anonymous specialist label and emits no chat action popups', async () => {
		navigation.search = new URLSearchParams({ supportConversation: id })
		api.history.mockResolvedValue({
			items: [
				{
					id,
					conversationId: id,
					senderKind: 'OPERATOR',
					senderName: 'Персональное имя оператора',
					text: 'Ответ поддержки',
					sequence: 1,
					createdAt: conversation.createdAt,
					attachments: []
				}
			],
			hasMore: false,
			lastSequence: 1
		})
		mount()
		await screen.findByText('Специалист поддержки')
		expect(screen.queryByText('Персональное имя оператора')).toBeNull()
		const dialog = screen.getByRole('dialog', { name: 'Поддержка' })
		fireEvent.click(
			screen.getByRole('button', { name: 'Свернуть поддержку' })
		)
		fireEvent.animationEnd(dialog)
		fireEvent.click(
			await screen.findByRole('button', { name: 'Поддержка' })
		)
		expect(toast).not.toHaveBeenCalled()
		expect(toast.success).not.toHaveBeenCalled()
		expect(screen.queryByRole('tooltip')).toBeNull()
	})
	it('keeps upload errors inline and never permits an attachment-only message', async () => {
		navigation.search = new URLSearchParams({ supportConversation: id })
		api.upload
			.mockRejectedValueOnce(new Error('Изображение не загрузилось'))
			.mockResolvedValueOnce({
				id,
				fileName: 'screen.png',
				mediaType: 'image/png',
				byteSize: 100,
				width: 10,
				height: 10
			})
		const view = mount()
		await screen.findByRole('textbox', { name: 'Сообщение' })
		const input = view.container.querySelector('input[type="file"]')!
		fireEvent.change(input, {
			target: {
				files: [new File(['image'], 'screen.png', { type: 'image/png' })]
			}
		})
		await screen.findByText('Изображение не загрузилось')
		expect(toast.error).not.toHaveBeenCalled()
		fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
		await screen.findByText('screen.png')
		expect(
			(
				screen.getByRole('button', {
					name: 'Отправить'
				}) as HTMLButtonElement
			).disabled
		).toBe(true)
		expect(api.send).not.toHaveBeenCalled()
		fireEvent.change(screen.getByRole('textbox', { name: 'Сообщение' }), {
			target: { value: 'Проблема на скриншоте' }
		})
		expect(
			(
				screen.getByRole('button', {
					name: 'Отправить'
				}) as HTMLButtonElement
			).disabled
		).toBe(false)
	})
	it('retains loaded history when polling rolls the latest page and resets safely across a gap', async () => {
		navigation.search = new URLSearchParams({ supportConversation: id })
		const message = (sequence: number) => ({
			id: String(sequence),
			conversationId: id,
			senderKind: 'CLIENT' as const,
			senderName: 'Клиент',
			text: 'Сообщение ' + sequence,
			sequence,
			createdAt: conversation.createdAt,
			attachments: []
		})
		api.history
			.mockResolvedValueOnce({
				items: [message(3), message(4)],
				hasMore: true,
				lastSequence: 4
			})
			.mockResolvedValueOnce({
				items: [message(1), message(2)],
				hasMore: false,
				lastSequence: 4
			})
		mount()
		await screen.findByText('Сообщение 3')
		fireEvent.click(
			screen.getByRole('button', { name: 'Предыдущие сообщения' })
		)
		await screen.findByText('Сообщение 1')
		act(() =>
			clients
				.at(-1)!
				.setQueryData(['support-chat', 'user-a:1', id, 'history'], {
					items: [message(4), message(5)],
					hasMore: true,
					lastSequence: 5
				})
		)
		await screen.findByText('Сообщение 5')
		expect(screen.getByText('Сообщение 3')).toBeTruthy()
		act(() =>
			clients
				.at(-1)!
				.setQueryData(['support-chat', 'user-a:1', id, 'history'], {
					items: [message(9), message(10)],
					hasMore: true,
					lastSequence: 10
				})
		)
		await waitFor(() =>
			expect(screen.queryByText('Сообщение 1')).toBeNull()
		)
		expect(
			screen.getByRole('button', { name: 'Предыдущие сообщения' })
		).toBeTruthy()
	})
	it('hides the launcher until exit completes, restores focus, and retains the unsent draft', async () => {
		mount()
		const launcher = screen.getByRole('button', {
			name: 'Поддержка'
		}) as HTMLButtonElement
		fireEvent.click(launcher)
		const dialog = screen.getByRole('dialog', {
			name: 'Поддержка'
		}) as HTMLDialogElement
		expect(launcher.hidden).toBe(true)
		expect(screen.queryByRole('button', { name: 'Поддержка' })).toBeNull()
		fireEvent.click(
			screen.getByRole('button', { name: /Новое обращение/ })
		)
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Тема обращения' }),
			{ target: { value: 'Подписка' } }
		)
		const message = screen.getByRole('textbox', { name: 'Сообщение' })
		message.focus()
		fireEvent.change(message, {
			target: { value: 'Помогите продлить доступ' }
		})
		fireEvent.click(
			screen.getByRole('button', { name: 'Свернуть поддержку' })
		)
		expect(dialog.open).toBe(true)
		expect(dialog.hasAttribute('inert')).toBe(true)
		expect(launcher.hidden).toBe(true)
		fireEvent.animationEnd(message)
		expect(dialog.open).toBe(true)
		expect(launcher.hidden).toBe(true)
		fireEvent.animationEnd(dialog)
		expect(dialog.open).toBe(false)
		expect(launcher.hidden).toBe(false)
		expect(document.activeElement).toBe(launcher)
		fireEvent.click(launcher)
		expect(
			(
				screen.getByRole('textbox', {
					name: 'Сообщение'
				}) as HTMLTextAreaElement
			).value
		).toBe('Помогите продлить доступ')
		expect(api.send).not.toHaveBeenCalled()
	})
	it('closes immediately with reduced motion and returns focus without an animation event', () => {
		Object.defineProperty(window, 'matchMedia', {
			configurable: true,
			value: (query: string) => ({
				matches: query === '(prefers-reduced-motion: reduce)',
				addEventListener: vi.fn(),
				removeEventListener: vi.fn()
			})
		})
		mount()
		const launcher = screen.getByRole('button', {
			name: 'Поддержка'
		}) as HTMLButtonElement
		fireEvent.click(launcher)
		const dialog = screen.getByRole('dialog', {
			name: 'Поддержка'
		}) as HTMLDialogElement
		expect(launcher.hidden).toBe(true)
		const close = screen.getByRole('button', {
			name: 'Свернуть поддержку'
		})
		close.focus()
		fireEvent.click(close)
		expect(dialog.open).toBe(false)
		expect(launcher.hidden).toBe(false)
		expect(document.activeElement).toBe(launcher)
		expect(api.send).not.toHaveBeenCalled()
	})
	it('retries an uncertain send with the exact command and ignores later editor changes', async () => {
		api.send
			.mockRejectedValueOnce(new Error('Связь прервана'))
			.mockImplementationOnce(async (_token, command) => ({
				commandId: command.commandId,
				conversation,
				message: {
					id,
					conversationId: id,
					senderKind: 'CLIENT',
					senderName: 'Клиент',
					text: command.text,
					sequence: 1,
					createdAt: conversation.createdAt,
					attachments: []
				}
			}))
		mount()
		fireEvent.click(screen.getByRole('button', { name: 'Поддержка' }))
		fireEvent.click(
			screen.getByRole('button', { name: /Новое обращение/ })
		)
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Тема обращения' }),
			{ target: { value: 'Подписка' } }
		)
		fireEvent.change(screen.getByRole('textbox', { name: 'Сообщение' }), {
			target: { value: 'Первое сообщение' }
		})
		fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
		await screen.findByRole('button', { name: 'Повторить отправку' })
		expect(
			(
				screen.getByRole('textbox', {
					name: 'Сообщение'
				}) as HTMLTextAreaElement
			).disabled
		).toBe(true)
		fireEvent.click(
			screen.getByRole('button', { name: 'Повторить отправку' })
		)
		await waitFor(() => expect(api.send).toHaveBeenCalledTimes(2))
		expect(api.send.mock.calls[1][1]).toBe(api.send.mock.calls[0][1])
		expect(api.send.mock.calls[0][1]).toMatchObject({
			expectedActorSubject: 'user-a',
			text: 'Первое сообщение',
			section: 'inbox'
		})
	})
	it('opens the saved deep link with HTTP reads and never creates another conversation', async () => {
		navigation.search = new URLSearchParams({ supportConversation: id })
		mount()
		await waitFor(() =>
			expect(api.history).toHaveBeenCalledWith('session-anchor', id)
		)
		expect(api.send).not.toHaveBeenCalled()
		expect(screen.getByText('№ 1 · Подписка')).toBeTruthy()
	})
	it("drops another account's draft after an account switch", async () => {
		mount()
		fireEvent.click(screen.getByRole('button', { name: 'Поддержка' }))
		fireEvent.click(
			screen.getByRole('button', { name: /Новое обращение/ })
		)
		fireEvent.change(screen.getByRole('textbox', { name: 'Сообщение' }), {
			target: { value: 'Личный вопрос' }
		})
		act(() =>
			useSessionStore.getState().setAuthenticated({
				userId: 'user-b',
				accessToken: 'other-anchor'
			})
		)
		fireEvent.click(screen.getByRole('button', { name: 'Поддержка' }))
		fireEvent.click(
			screen.getByRole('button', { name: /Новое обращение/ })
		)
		expect(
			(
				screen.getByRole('textbox', {
					name: 'Сообщение'
				}) as HTMLTextAreaElement
			).value
		).toBe('')
	})
	it('pauses hidden-tab HTTP polling and refetches after visibility returns', async () => {
		vi.useFakeTimers()
		mount()
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1)
		})
		const first = api.unread.mock.calls.length
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			value: 'hidden'
		})
		act(() => document.dispatchEvent(new Event('visibilitychange')))
		await act(async () => {
			await vi.advanceTimersByTimeAsync(120000)
		})
		expect(api.unread).toHaveBeenCalledTimes(first)
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			value: 'visible'
		})
		act(() => document.dispatchEvent(new Event('visibilitychange')))
		await act(async () => {
			await vi.advanceTimersByTimeAsync(10)
		})
		expect(api.unread.mock.calls.length).toBeGreaterThan(first)
	})
})
