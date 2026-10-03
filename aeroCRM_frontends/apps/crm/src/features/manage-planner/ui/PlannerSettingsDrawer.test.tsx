import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionStore, useSessionStore } from '@/entities/session'
import { savePlannerSettings } from '@/entities/crm-planner/api/planner.api'
import { usePlannerSettings } from '@/entities/crm-planner/model/use-planner-settings'
import type { PlannerSettings } from '@/entities/crm-planner/model/planner.types'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import {
	commandOwner,
	PendingCommandProvider
} from '@/shared/lib/pending-command'
import { PlannerSettingsDrawer } from './PlannerSettingsDrawer'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const settings: PlannerSettings = {
	schemaVersion: 1,
	workspaceId,
	version: 4,
	templates: [
		{
			id: '22222222-2222-4222-8222-222222222222',
			title: 'Позвонить',
			archived: false
		},
		{
			id: '33333333-3333-4333-8333-333333333333',
			title: 'Назначить встречу',
			archived: false
		}
	],
	columns: [
		{
			id: 'OPEN',
			name: 'К выполнению',
			status: 'OPEN',
			isDefault: true,
			archived: false
		},
		{
			id: 'IN_PROGRESS',
			name: 'В работе',
			status: 'IN_PROGRESS',
			isDefault: true,
			archived: false
		},
		{
			id: 'COMPLETED',
			name: 'Готово',
			status: 'COMPLETED',
			isDefault: true,
			archived: false
		},
		{
			id: 'CANCELLED',
			name: 'Отменено',
			status: 'CANCELLED',
			isDefault: true,
			archived: false
		}
	]
}
let state: ReturnType<typeof usePlannerSettings>
let queryClient: QueryClient
vi.mock('@/entities/crm-planner/model/use-planner-settings', () => ({
	usePlannerSettings: () => state
}))
vi.mock('@/entities/crm-planner/api/planner.api', () => ({
	savePlannerSettings: vi.fn()
}))
const App = () => {
	const { session, sessionRevision } = useSessionStore()
	return (
		<QueryClientProvider client={queryClient}>
			<PendingCommandProvider
				owner={commandOwner(session?.userId, sessionRevision)}
			>
				<PlannerSettingsDrawer onClose={vi.fn()} />
			</PendingCommandProvider>
		</QueryClientProvider>
	)
}
const mount = () => render(<App />)
beforeEach(() => {
	vi.clearAllMocks()
	if (!HTMLDialogElement.prototype.showModal)
		HTMLDialogElement.prototype.showModal = function () {
			this.setAttribute('open', '')
		}
	if (!HTMLDialogElement.prototype.close)
		HTMLDialogElement.prototype.close = function () {
			this.removeAttribute('open')
		}
	resetSessionStore()
	useSessionStore
		.getState()
		.setAuthenticated({ accessToken: 'captured', userId: 'owner' })
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	state = {
		context: {
			key: [workspaceId, 'owner', 1],
			scopeKey: `${workspaceId}:owner`,
			workspace: { workspaceId },
			session: { accessToken: 'captured', userId: 'owner' },
			sessionRevision: 1,
			canRead: true,
			canWrite: true,
			current: () => true,
			authorize: vi.fn().mockResolvedValue(undefined),
			permissions: { data: { role: 'OWNER' }, isError: false }
		} as never,
		query: {
			data: settings,
			isError: false,
			refetch: vi
				.fn()
				.mockResolvedValue({ data: settings, isError: false })
		} as never,
		canManage: true,
		data: settings
	} as ReturnType<typeof usePlannerSettings>
	vi.mocked(savePlannerSettings).mockImplementation(
		async (_token, command) => ({
			...settings,
			version: command.expectedVersion + 1,
			templates: command.templates,
			columns: command.columns
		})
	)
})
afterEach(() => {
	cleanup()
	queryClient.clear()
	resetSessionStore()
	vi.restoreAllMocks()
})

describe('PlannerSettingsDrawer', () => {
	it('edits shared order/archive state and saves one workspace command', async () => {
		mount()
		fireEvent.click(
			screen.getByRole('button', { name: 'Опустить действие 1' })
		)
		fireEvent.click(screen.getAllByRole('button', { name: 'В архив' })[0])
		fireEvent.click(
			screen.getByRole('checkbox', { name: /Показывать архивные/ })
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Сохранить настройки' })
		)
		await waitFor(() => expect(savePlannerSettings).toHaveBeenCalledOnce())
		const sent = vi.mocked(savePlannerSettings).mock.calls[0][1]
		expect(sent).toMatchObject({
			schemaVersion: 1,
			workspaceId,
			expectedVersion: 4
		})
		expect(sent.templates.map(item => item.title)).toEqual([
			'Назначить встречу',
			'Позвонить'
		])
		expect(sent.templates[0].archived).toBe(true)
	})

	it('keeps settings read only for a non-owner even when workspace is writable', () => {
		state = { ...state, canManage: false }
		mount()
		expect(screen.getByRole('status').textContent).toContain(
			'Менять общие настройки могут владелец и администраторы.'
		)
		expect(
			(
				screen.getByRole('button', {
					name: 'Сохранить настройки'
				}) as HTMLButtonElement
			).disabled
		).toBe(true)
	})

	it('keeps the same command available for explicit retry after an unknown result', async () => {
		vi.mocked(savePlannerSettings).mockRejectedValueOnce(
			new AuthenticatedApiError(
				'temporary',
				'Сервис aeroCRM временно недоступен.'
			)
		)
		mount()
		fireEvent.click(
			screen.getByRole('button', { name: 'Опустить действие 1' })
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Сохранить настройки' })
		)
		await screen.findByRole('button', { name: 'Проверить сохранение' })
		const first = vi.mocked(savePlannerSettings).mock.calls[0][1]
		fireEvent.click(
			screen.getByRole('button', { name: 'Проверить сохранение' })
		)
		await waitFor(() =>
			expect(savePlannerSettings).toHaveBeenCalledTimes(2)
		)
		expect(vi.mocked(savePlannerSettings).mock.calls[1][1]).toEqual(first)
	})
})
