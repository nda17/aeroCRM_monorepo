import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	listIntakeSources,
	mutateIntakeSource,
	type IntakeSource
} from '@/entities/intake'
import {
	PendingCommandProvider,
	commandOwner
} from '@/shared/lib/pending-command'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import type { ReactNode } from 'react'
import type { IntakeAccess } from '../model/use-intake-access'
import { SourcesPanel } from './SourcesPanel'
import toast from 'react-hot-toast'

vi.mock('@/entities/intake', () => ({
	listIntakeSources: vi.fn(),
	mutateIntakeSource: vi.fn()
}))
vi.mock('@/shared/config/runtime', () => ({
	getRuntimeConfig: () => ({ apiBaseUrl: 'http://localhost:4100/api/v1' })
}))
vi.mock('./WidgetSourcesPanel', () => ({
	WidgetSourcesPanel: () => <div>Источники виджетов</div>
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
const workspaceId = '11111111-1111-4111-8111-111111111111'
const source: IntakeSource = {
	id: '22222222-2222-4222-8222-222222222222',
	workspaceId,
	name: 'Форма сайта',
	kind: 'API',
	tokenVersion: 1,
	createdBySubject: 'owner',
	teamId: null,
	version: 3,
	revokedAt: null,
	createdAt: '2026-09-05T00:00:00.000Z',
	updatedAt: '2026-09-05T00:00:00.000Z'
}
const access = (overrides: Partial<IntakeAccess> = {}) =>
	({
		workspaceId,
		scopeKey: 'owner',
		session: { userId: 'owner', accessToken: 'test-session' },
		revision: 1,
		confirmed: true,
		online: true,
		sourceManager: true,
		canRead: true,
		canManageSources: true,
		canWrite: true,
		authorize: vi.fn().mockResolvedValue('test-session'),
		permissions: { isSuccess: true, isError: false, refetch: vi.fn() },
		...overrides
	}) as unknown as IntakeAccess
let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => (
	<QueryClientProvider client={client}>
		<PendingCommandProvider owner={commandOwner('owner', 1)}>
			{children}
		</PendingCommandProvider>
	</QueryClientProvider>
)
beforeEach(() => {
	vi.clearAllMocks()
	client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } }
	})
	vi.mocked(listIntakeSources).mockResolvedValue({
		schemaVersion: 1,
		page: 1,
		pageSize: 25,
		total: 1,
		items: [source]
	})
	vi.mocked(mutateIntakeSource).mockResolvedValue(source)
	Object.defineProperties(HTMLDialogElement.prototype, {
		showModal: {
			configurable: true,
			value: function (this: HTMLDialogElement) {
				this.open = true
			}
		},
		close: {
			configurable: true,
			value: function (this: HTMLDialogElement) {
				this.open = false
			}
		}
	})
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: { writeText: vi.fn().mockResolvedValue(undefined) }
	})
})
afterEach(() => {
	cleanup()
	client.clear()
})

describe('Tilda source setup', () => {
	it('opens reusable read-only instructions for an API source and keeps its standard address unchanged', async () => {
		render(<SourcesPanel access={access()} />, { wrapper })
		await screen.findByText(source.name)
		fireEvent.click(screen.getByRole('button', { name: 'Адрес' }))
		await waitFor(() =>
			expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
				`http://localhost:4100/api/v1/crm/intake/ingest/${source.id}`
			)
		)
		fireEvent.click(screen.getByRole('button', { name: 'Tilda' }))
		const setup = within(
			screen.getByRole('dialog', { name: 'Подключение Tilda' })
		)
		expect(
			setup.getByLabelText('Адрес Webhook для Tilda').textContent
		).toBe(
			`http://localhost:4100/api/v1/crm/intake/ingest/${source.id}/tilda`
		)
		expect(setup.getByText('X-WinCRM-Source-Token')).toBeTruthy()
		expect(setup.getByText('в заголовке')).toBeTruthy()
		expect(
			setup.getByText(/не подтверждают доставку реальной заявки/)
		).toBeTruthy()
		expect(
			setup.getByText(/проверяет доступ, но не создаёт обращение/)
		).toBeTruthy()
		expect(
			setup.queryByRole('button', { name: 'Скопировать ключ' })
		).toBeNull()
		fireEvent.click(
			setup.getByRole('button', { name: 'Скопировать адрес Tilda' })
		)
		await waitFor(() =>
			expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
				`http://localhost:4100/api/v1/crm/intake/ingest/${source.id}/tilda`
			)
		)
		expect(mutateIntakeSource).not.toHaveBeenCalled()
	})
	it('opens named creation without sending a mutation before confirmation', async () => {
		render(<SourcesPanel access={access()} />, { wrapper })
		await screen.findByText(source.name)
		fireEvent.click(
			screen.getByRole('button', { name: 'Подключить Tilda' })
		)
		expect(
			screen.getByRole('dialog', { name: 'Подключить Tilda' })
		).toBeTruthy()
		expect(
			screen.getByRole('textbox', { name: 'Название источника' })
		).toHaveProperty('value', 'Tilda')
		expect(mutateIntakeSource).not.toHaveBeenCalled()
	})
	it('reuses explicit rotation and shows Tilda setup after a successful key change', async () => {
		render(<SourcesPanel access={access()} />, { wrapper })
		await screen.findByText(source.name)
		fireEvent.click(screen.getByRole('button', { name: 'Tilda' }))
		fireEvent.click(
			screen.getByRole('button', { name: 'Заменить ключ для Tilda' })
		)
		expect(
			screen.queryByRole('dialog', { name: 'Подключение Tilda' })
		).toBeNull()
		expect(mutateIntakeSource).not.toHaveBeenCalled()
		fireEvent.click(
			screen.getByRole('button', { name: 'Подтвердить замену ключа' })
		)
		await screen.findByRole('button', { name: 'Скопировать адрес Tilda' })
		expect(mutateIntakeSource).toHaveBeenCalledWith(
			'test-session',
			expect.objectContaining({
				operation: 'rotate',
				id: source.id,
				expectedVersion: source.version
			})
		)
	})
	it('keeps setup and address copying available for read-only source managers, but disables writes', async () => {
		render(
			<SourcesPanel
				access={access({ canWrite: false, canManageSources: false })}
			/>,
			{ wrapper }
		)
		await screen.findByText(source.name)
		expect(
			screen.getByRole('button', { name: 'Подключить Tilda' })
		).toHaveProperty('disabled', true)
		fireEvent.click(screen.getByRole('button', { name: 'Tilda' }))
		expect(
			screen.getByRole('button', { name: 'Заменить ключ для Tilda' })
		).toHaveProperty('disabled', true)
		expect(
			screen.getByRole('button', { name: 'Скопировать адрес Tilda' })
		).toHaveProperty('disabled', false)
		expect(mutateIntakeSource).not.toHaveBeenCalled()
	})
	it('hides an open setup when source-manager access is no longer confirmed', async () => {
		const current = access()
		const view = render(<SourcesPanel access={current} />, { wrapper })
		await screen.findByText(source.name)
		fireEvent.click(screen.getByRole('button', { name: 'Tilda' }))
		view.rerender(
			<SourcesPanel
				access={{
					...current,
					sourceManager: false,
					canManageSources: false
				}}
			/>
		)
		expect(
			screen.queryByRole('dialog', { name: 'Подключение Tilda' })
		).toBeNull()
		expect(screen.queryByLabelText('Адрес Webhook для Tilda')).toBeNull()
	})
	it('does not offer Tilda metadata or creation after server authorization denial', async () => {
		vi.mocked(listIntakeSources).mockRejectedValue(
			new AuthenticatedApiError('forbidden', 'Нет доступа')
		)
		render(<SourcesPanel access={access()} />, { wrapper })
		await screen.findByText(/Метаданные и настройки источников доступны/)
		expect(
			screen.getByRole('button', { name: 'Подключить Tilda' })
		).toHaveProperty('disabled', true)
		expect(screen.queryByRole('button', { name: 'Tilda' })).toBeNull()
	})
	it('keeps revoked source history without its address or connection actions', async () => {
		vi.mocked(listIntakeSources).mockResolvedValue({
			schemaVersion: 1,
			page: 1,
			pageSize: 25,
			total: 1,
			items: [{ ...source, revokedAt: source.updatedAt }]
		})
		render(<SourcesPanel access={access()} />, { wrapper })
		await screen.findByText(source.name)
		expect(screen.getByText('Отозван')).toBeTruthy()
		expect(screen.getByText('Сохранён для истории обращений')).toBeTruthy()
		expect(screen.getByText('Приём отключён')).toBeTruthy()
		expect(
			screen.queryByText(
				`http://localhost:4100/api/v1/crm/intake/ingest/${source.id}`
			)
		).toBeNull()
		for (const name of ['Адрес', 'Tilda', 'Заменить ключ', 'Отозвать'])
			expect(screen.queryByRole('button', { name })).toBeNull()
		expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
		expect(mutateIntakeSource).not.toHaveBeenCalled()
	})
	it('removes setup details when an open source is reported as revoked', async () => {
		render(<SourcesPanel access={access()} />, { wrapper })
		await screen.findByText(source.name)
		fireEvent.click(screen.getByRole('button', { name: 'Tilda' }))
		act(() => {
			client.setQueriesData(
				{ queryKey: ['crm-intake-sources'] },
				{
					schemaVersion: 1,
					page: 1,
					pageSize: 25,
					total: 1,
					items: [{ ...source, revokedAt: source.updatedAt }]
				}
			)
		})
		await screen.findByText(
			/Источник отозван и не принимает новые обращения/
		)
		expect(screen.queryByLabelText('Адрес Webhook для Tilda')).toBeNull()
		expect(
			screen.queryByRole('button', { name: 'Заменить ключ для Tilda' })
		).toBeNull()
		expect(
			screen.queryByRole('button', { name: 'Скопировать адрес Tilda' })
		).toBeNull()
		expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
		expect(mutateIntakeSource).not.toHaveBeenCalled()
	})
	it('reports a clipboard failure without claiming that an address was copied', async () => {
		vi.mocked(navigator.clipboard.writeText).mockRejectedValue(
			new Error('denied')
		)
		render(<SourcesPanel access={access()} />, { wrapper })
		await screen.findByText(source.name)
		fireEvent.click(screen.getByRole('button', { name: 'Tilda' }))
		fireEvent.click(
			screen.getByRole('button', { name: 'Скопировать адрес Tilda' })
		)
		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith(
				expect.stringContaining('Не удалось скопировать адрес')
			)
		)
		expect(toast.success).not.toHaveBeenCalled()
	})
})
