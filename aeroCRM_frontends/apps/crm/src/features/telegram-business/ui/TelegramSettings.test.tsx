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
	confirmTelegramConnectSession,
	createTelegramConnectSession,
	getTelegramConnectSession,
	listTelegramChannels
} from '@/entities/telegram-business'
import { TelegramSettings } from './TelegramSettings'

const mocks = vi.hoisted(() => ({
	context: {
		identity: 'workspace:owner',
		key: ['workspace-id', 'owner', 1, 'membership-id', 'OWNER'],
		binding: {
			workspaceId: '11111111-1111-4111-8111-111111111111',
			subject: 'owner@example.test'
		},
		workspace: { workspaceId: '11111111-1111-4111-8111-111111111111' },
		session: { accessToken: 'test-token' },
		ready: true,
		canWrite: true,
		current: () => true,
		permissions: { isError: false, refetch: vi.fn() }
	}
}))

vi.mock('@/entities/telegram-business', async importOriginal => ({
	...(await importOriginal<object>()),
	createTelegramConnectSession: vi.fn(),
	confirmTelegramConnectSession: vi.fn(),
	cancelTelegramConnectSession: vi.fn(),
	disconnectTelegramChannel: vi.fn(),
	getTelegramConnectSession: vi.fn(),
	listTelegramChannels: vi.fn()
}))
vi.mock('@/entities/crm-workspace-branding', () => ({
	useWorkspaceBranding: () => ({
		data: { branding: { displayName: 'Пространство Альфа' } }
	})
}))
vi.mock(
	'@/features/workspace-collaboration/model/use-collaboration',
	() => ({
		useCollaboration: () => mocks.context,
		useCollaborationCommand: (
			_context: unknown,
			_intent: string,
			send: (
				token: string,
				command: Record<string, unknown>
			) => Promise<unknown>,
			onSuccess: (result: never, command: never) => void
		) => ({
			locked: false,
			running: false,
			uncertain: false,
			reset: vi.fn(),
			execute: async (build: () => Record<string, unknown>) => {
				const command = build()
				const result = await send('test-token', command)
				onSuccess(result as never, command as never)
			}
		})
	})
)

const connectSession = {
	id: '22222222-2222-4222-8222-222222222222',
	version: 4,
	state: 'CONNECTION_READY',
	expiresAt: '2026-10-12T11:00:00.000Z',
	deepLink: 'https://t.me/service_bot?start=opaque',
	owner: {
		id: 'telegram-owner-id',
		displayName: 'Рабочий аккаунт',
		username: 'team_account'
	},
	channelId: null,
	errorCode: null
}
let queryClient: QueryClient

beforeEach(() => {
	vi.clearAllMocks()
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	vi.mocked(listTelegramChannels).mockResolvedValue({
		schemaVersion: 1,
		workspaceId: mocks.context.binding.workspaceId,
		subject: mocks.context.binding.subject,
		configured: true,
		botUsername: 'service_bot',
		canManage: true,
		items: []
	} as never)
	vi.mocked(createTelegramConnectSession).mockResolvedValue({
		schemaVersion: 1,
		workspaceId: mocks.context.binding.workspaceId,
		subject: mocks.context.binding.subject,
		item: connectSession
	} as never)
	vi.mocked(confirmTelegramConnectSession).mockResolvedValue({
		schemaVersion: 1,
		workspaceId: mocks.context.binding.workspaceId,
		subject: mocks.context.binding.subject,
		item: { ...connectSession, state: 'CONNECTED', version: 5 }
	} as never)
	vi.mocked(getTelegramConnectSession).mockResolvedValue({
		schemaVersion: 1,
		workspaceId: mocks.context.binding.workspaceId,
		subject: mocks.context.binding.subject,
		item: connectSession
	} as never)
})

afterEach(() => {
	cleanup()
	queryClient.clear()
})

describe('Telegram settings onboarding', () => {
	it('requires an explicit account and workspace confirmation before completing a ready connection', async () => {
		render(
			<QueryClientProvider client={queryClient}>
				<TelegramSettings />
			</QueryClientProvider>
		)
		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Подключить рабочий Telegram'
			})
		)
		await screen.findAllByText((_, node) =>
			Boolean(
				node?.textContent?.includes('Подтверждён аккаунт:') &&
				node.textContent.includes('Рабочий аккаунт')
			)
		)
		const confirm = screen.getByRole('button', {
			name: 'Подтвердить подключение'
		})
		expect((confirm as HTMLButtonElement).disabled).toBe(true)
		const consent = screen.getByRole('checkbox')
		expect(consent.parentElement?.textContent).toContain(
			'Пространство Альфа'
		)
		fireEvent.click(consent)
		expect((confirm as HTMLButtonElement).disabled).toBe(false)
		fireEvent.click(confirm)
		await waitFor(() =>
			expect(confirmTelegramConnectSession).toHaveBeenCalledTimes(1)
		)
		expect(
			vi.mocked(confirmTelegramConnectSession).mock.calls[0]?.[1]
		).toMatchObject({
			workspaceId: mocks.context.binding.workspaceId,
			subject: mocks.context.binding.subject,
			connectSessionId: connectSession.id,
			expectedVersion: 4
		})
		expect(
			vi.mocked(confirmTelegramConnectSession).mock.calls[0]?.[1].commandId
		).toEqual(expect.any(String))
	})
})
