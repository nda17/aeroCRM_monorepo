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
import {
	getInboxEntry,
	listIntakeActivities,
	mutateInbox,
	getInboxAcceptance,
	mutateInboxAcceptance,
	type InboxAcceptance,
	type InboxEntry
} from '@/entities/intake'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import type { IntakeAccess } from '../model/use-intake-access'
import { InboxEditor } from './InboxEditor'
import { InboxAcceptancePanel } from './InboxAcceptancePanel'
import type { InboxAcceptanceContext } from '../model/use-inbox-acceptance'
import { resetSessionStore, useSessionStore } from '@/entities/session'
import toast from 'react-hot-toast'
import { listSalesPipelines } from '@/entities/sales'
import { listCustomers } from '@/entities/customer'
import { listTeamOptions } from '@/entities/crm-team'
import {
	PendingCommandProvider,
	commandOwner
} from '@/shared/lib/pending-command'

vi.mock('@/entities/intake', async () => ({
	...(await vi.importActual('@/entities/intake')),
	getInboxEntry: vi.fn(),
	listIntakeActivities: vi.fn(),
	mutateInbox: vi.fn(),
	getInboxAcceptance: vi.fn(),
	mutateInboxAcceptance: vi.fn()
}))
vi.mock('@/entities/sales', () => ({ listSalesPipelines: vi.fn() }))
vi.mock('@/entities/customer', () => ({ listCustomers: vi.fn() }))
vi.mock('@/entities/crm-team/api/team.api', async original => ({
	...(await original<typeof import('@/entities/crm-team/api/team.api')>()),
	listTeamOptions: vi.fn()
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
const workspaceId = '11111111-1111-4111-8111-111111111111'
const entry: InboxEntry = {
	id: '22222222-2222-4222-8222-222222222222',
	workspaceId,
	title: 'Запрос QA',
	name: 'Клиент',
	phone: null,
	email: null,
	message: 'Комментарий',
	origin: 'MANUAL',
	sourceId: null,
	status: 'NEW',
	createdBySubject: 'owner',
	teamId: null,
	version: 4,
	contactId: null,
	dealId: null,
	rejectionReason: null,
	receivedAt: '2026-09-05T00:00:00.000Z',
	updatedAt: '2026-09-05T00:00:00.000Z',
	acceptedAt: null,
	rejectedAt: null
}
const access = (write = true) =>
	({
		workspaceId,
		canRead: true,
		canWrite: write,
		sourceManager: true,
		scopeKey: 'owner:all',
		online: true,
		session: { userId: 'owner', accessToken: 'session-token' },
		revision: 1,
		authorize: vi.fn().mockResolvedValue('session-token'),
		permissions: {
			isSuccess: true,
			isError: false,
			refetch: vi.fn(),
			data: {
				teamIds: [],
				role: 'OWNER',
				permissions: [
					'intake:read',
					'intake:write',
					'customers:read',
					'customers:write',
					'sales:read',
					'sales:write'
				]
			}
		}
	}) as unknown as IntakeAccess
let client: QueryClient
beforeEach(() => {
	vi.resetAllMocks()
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
	client = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	vi.mocked(getInboxEntry).mockResolvedValue(entry)
	vi.mocked(listIntakeActivities).mockResolvedValue({
		schemaVersion: 1,
		page: 1,
		pageSize: 25,
		total: 0,
		items: []
	})
	vi.mocked(mutateInbox).mockResolvedValue(entry)
	vi.mocked(getInboxAcceptance).mockResolvedValue({
		schemaVersion: 1,
		acceptance: null
	})
	vi.mocked(listSalesPipelines).mockResolvedValue([
		{
			id: workspaceId,
			workspaceId,
			name: 'Продажи',
			templateKey: 'sales',
			templateVersion: 1,
			stages: [
				{
					id: entry.id,
					key: 'new',
					name: 'Новая',
					position: 1,
					state: 'OPEN'
				}
			]
		}
	])
	vi.mocked(listCustomers).mockResolvedValue({
		schemaVersion: 1,
		items: [],
		page: 1,
		pageSize: 20,
		total: 0
	})
})
afterEach(() => {
	cleanup()
	client.clear()
})
const mount = (
	id?: string,
	write = true,
	overrides: Partial<IntakeAccess> = {}
) => {
	const onClose = vi.fn()
	render(
		<QueryClientProvider client={client}>
			<PendingCommandProvider owner={commandOwner('owner', 1)}>
				<InboxEditor
					access={{ ...access(write), ...overrides }}
					id={id}
					onClose={onClose}
					onSaved={vi.fn()}
				/>
			</PendingCommandProvider>
		</QueryClientProvider>
	)
	return onClose
}
describe('InboxEditor real command states', () => {
	it.each([
		['8 (999) 123-45-67', '+7 999 123 45 67', '+79991234567'],
		['+44 (20) 7946-0018', '+44 20 7946 0018', '+442079460018'],
		['', '', null]
	])(
		'submits the canonical optional phone from %s',
		async (input, display, phone) => {
			mount()
			fireEvent.change(
				screen.getByRole('textbox', { name: 'Тема обращения' }),
				{
					target: { value: 'Запрос' }
				}
			)
			fireEvent.change(
				screen.getByRole('textbox', { name: 'Имя клиента' }),
				{
					target: { value: 'Клиент' }
				}
			)
			const field = screen.getByRole('textbox', { name: 'Телефон' })
			fireEvent.change(field, { target: { value: input } })
			expect(field).toHaveProperty('value', display)
			fireEvent.click(
				screen.getByRole('button', { name: 'Создать обращение' })
			)
			await waitFor(() => expect(mutateInbox).toHaveBeenCalledOnce())
			expect(vi.mocked(mutateInbox).mock.calls[0][1]).toMatchObject({
				operation: 'create',
				phone
			})
		}
	)
	it('shows a safe not-found state for an inaccessible linked UUID without a create or acceptance action', async () => {
		vi.mocked(getInboxEntry).mockRejectedValue(
			new AuthenticatedApiError(
				'notFound',
				'Запись не найдена или недоступна.'
			)
		)
		mount(entry.id, false)
		await screen.findByText('Запись не найдена или недоступна.')
		expect(getInboxEntry).toHaveBeenCalledWith(
			'session-token',
			workspaceId,
			entry.id
		)
		expect(screen.queryByText(entry.title)).toBeNull()
		expect(
			screen.queryByRole('button', { name: 'Создать обращение' })
		).toBeNull()
		expect(
			screen.queryByRole('button', { name: 'Принять в работу' })
		).toBeNull()
		expect(mutateInbox).not.toHaveBeenCalled()
		expect(mutateInboxAcceptance).not.toHaveBeenCalled()
	})
	it('submits the authorized department UUID while displaying its name', async () => {
		const context = access()
		context.permissions.data!.teamIds = [entry.id]
		const item = { id: entry.id, name: 'Отдел продаж' }
		vi.mocked(listTeamOptions).mockImplementation(
			async (_token, request) => ({
				schemaVersion: 1,
				workspaceId,
				subject: 'owner',
				page: request.page,
				pageSize: request.pageSize,
				total: 1,
				items: [item],
				selected: request.selectedId ? item : null
			})
		)
		const onClose = mount(undefined, true, context)
		await screen.findByRole('option', { name: 'Отдел продаж' })
		fireEvent.change(screen.getByRole('combobox', { name: 'Отдел' }), {
			target: { value: entry.id }
		})
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Тема обращения' }),
			{ target: { value: 'Запрос QA' } }
		)
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Имя клиента' }),
			{ target: { value: 'Клиент' } }
		)
		await waitFor(() =>
			expect(
				(
					screen.getByRole('button', {
						name: 'Создать обращение'
					}) as HTMLButtonElement
				).disabled
			).toBe(false)
		)
		expect(document.body.textContent).not.toContain(entry.id)
		fireEvent.click(
			screen.getByRole('button', { name: 'Создать обращение' })
		)
		await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
		expect(vi.mocked(mutateInbox).mock.calls[0][1]).toMatchObject({
			operation: 'create',
			teamId: entry.id
		})
	})
	it('renders CSV provenance without inventing an API source identifier', async () => {
		vi.mocked(getInboxEntry).mockResolvedValue({ ...entry, origin: 'CSV' })
		mount(entry.id, false)
		expect(await screen.findByText('Импорт CSV')).toBeTruthy()
		expect(screen.queryByText('API · null')).toBeNull()
	})
	it('keeps read-only record/history visible and never offers fake acceptance', async () => {
		mount(entry.id, false)
		await screen.findByText('Запрос QA')
		expect(
			await screen.findByRole('button', { name: 'Принять в работу' })
		).toHaveProperty('disabled', true)
		expect(screen.queryByRole('button', { name: 'Отклонить' })).toBeNull()
		expect(mutateInbox).not.toHaveBeenCalled()
		await waitFor(() =>
			expect(listIntakeActivities).toHaveBeenCalledWith(
				'session-token',
				workspaceId,
				entry.id,
				1
			)
		)
	})
	it('validates and retries exact manual-create fields without generating another UUID', async () => {
		vi.mocked(mutateInbox)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', 'Временно недоступно')
			)
			.mockResolvedValueOnce(entry)
		const onClose = mount()
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Тема обращения' }),
			{ target: { value: 'Запрос QA' } }
		)
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Имя клиента' }),
			{ target: { value: 'Клиент' } }
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Создать обращение' })
		)
		await screen.findByRole('button', { name: 'Повторить тот же запрос' })
		const command = vi.mocked(mutateInbox).mock.calls[0][1]
		expect(command).toMatchObject({
			operation: 'create',
			workspaceId,
			title: 'Запрос QA',
			name: 'Клиент',
			teamId: null
		})
		expect(
			screen.getByRole('textbox', { name: 'Тема обращения' })
		).toHaveProperty('readOnly', true)
		fireEvent.click(
			screen.getByRole('button', { name: 'Повторить тот же запрос' })
		)
		await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
		expect(vi.mocked(mutateInbox).mock.calls[1][1]).toBe(command)
	})
	it('rejects with explicit reason and current version; conflicts cannot silently rebase', async () => {
		vi.mocked(mutateInbox).mockRejectedValue(
			new AuthenticatedApiError('conflict', 'Запись изменена')
		)
		const onClose = mount(entry.id)
		fireEvent.click(
			await screen.findByRole('button', { name: 'Отклонить' })
		)
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Причина отклонения' }),
			{ target: { value: 'Дубликат' } }
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Подтвердить отклонение' })
		)
		await screen.findByRole('button', { name: 'Перечитать карточку' })
		expect(vi.mocked(mutateInbox).mock.calls[0][1]).toMatchObject({
			operation: 'reject',
			workspaceId,
			id: entry.id,
			expectedVersion: 4,
			reason: 'Дубликат'
		})
		expect(
			screen.getByRole('button', { name: 'Подтвердить отклонение' })
		).toHaveProperty('disabled', true)
		expect(onClose).not.toHaveBeenCalled()
	})
})

const acceptance = (
	patch: Partial<InboxAcceptance> = {}
): InboxAcceptance => ({
	id: '33333333-3333-4333-8333-333333333333',
	workspaceId,
	entryId: entry.id,
	actorSubject: 'owner',
	status: 'QUEUED',
	version: 1,
	mode: 'EXECUTE',
	contactId: null,
	dealId: null,
	firstTaskId: null,
	lastErrorCode: null,
	retryAt: null,
	completedAt: null,
	createdAt: entry.receivedAt,
	updatedAt: entry.receivedAt,
	...patch
})
const fillAcceptance = async () => {
	fireEvent.click(
		await screen.findByRole('button', { name: 'Принять в работу' })
	)
	fireEvent.change(screen.getByRole('combobox', { name: 'Контакт' }), {
		target: { value: 'CREATE_FROM_ENTRY' }
	})
	await screen.findByRole('option', { name: 'Продажи' })
	fireEvent.change(screen.getByRole('combobox', { name: 'Воронка' }), {
		target: { value: workspaceId }
	})
	fireEvent.change(
		screen.getByRole('combobox', { name: 'Начальный этап' }),
		{ target: { value: entry.id } }
	)
	fireEvent.change(screen.getByLabelText(/Срок первого действия/), {
		target: { value: '2026-09-06T14:30' }
	})
	fireEvent.change(
		screen.getByRole('textbox', { name: 'Сумма сделки, ₽' }),
		{ target: { value: '123,45' } }
	)
}
describe('Inbox acceptance workflow UI', () => {
	it('does not interpret a failed state read as absence; reject remains disabled', async () => {
		vi.mocked(getInboxAcceptance).mockRejectedValue(new Error('offline'))
		mount(entry.id)
		await screen.findByRole('button', { name: 'Проверить обработку' })
		expect(
			screen.getByRole('button', { name: 'Отклонить' })
		).toHaveProperty('disabled', true)
		expect(
			screen.queryByRole('button', { name: 'Принять в работу' })
		).toBeNull()
		expect(mutateInboxAcceptance).not.toHaveBeenCalled()
	})
	it('queues explicit create with exact version and task without claiming accepted status', async () => {
		vi.mocked(mutateInboxAcceptance).mockResolvedValue({
			schemaVersion: 1,
			acceptance: acceptance()
		})
		const close = mount(entry.id)
		await fillAcceptance()
		fireEvent.click(
			screen.getByRole('button', { name: 'Начать обработку' })
		)
		await screen.findByText('Ожидает обработки')
		const sent = vi.mocked(mutateInboxAcceptance).mock.calls[0][1]
		expect(sent).toMatchObject({
			operation: 'accept',
			entryId: entry.id,
			workspaceId,
			expectedVersion: 4,
			contact: { mode: 'CREATE_FROM_ENTRY' },
			deal: {
				title: entry.title,
				amountMinor: 12345,
				pipelineId: workspaceId,
				stageId: entry.id,
				nextTask: { title: 'Связаться с клиентом' }
			}
		})
		expect(sent).not.toHaveProperty('actorSubject')
		expect(
			screen.getByRole('button', { name: 'Отклонить' })
		).toHaveProperty('disabled', true)
		expect(screen.queryByText('Принято в работу')).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
		expect(close).toHaveBeenCalled()
	})
	it('keeps an unknown acceptance command frozen through a later forbidden reply', async () => {
		vi.mocked(mutateInboxAcceptance)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', 'Результат неизвестен')
			)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('forbidden', 'Нет прав')
			)
			.mockResolvedValueOnce({
				schemaVersion: 1,
				acceptance: acceptance()
			})
		const close = mount(entry.id)
		await fillAcceptance()
		fireEvent.click(
			screen.getByRole('button', { name: 'Начать обработку' })
		)
		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Повторить тот же запрос'
			})
		)
		await screen.findByText('Нет прав')
		expect(
			screen.getByRole('button', { name: 'Отклонить' })
		).toHaveProperty('disabled', true)
		fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
		expect(close).not.toHaveBeenCalled()
		fireEvent.click(
			screen.getByRole('button', { name: 'Повторить тот же запрос' })
		)
		await screen.findByText('Ожидает обработки')
		const calls = vi.mocked(mutateInboxAcceptance).mock.calls
		expect(calls).toHaveLength(3)
		expect(calls[1][1]).toBe(calls[0][1])
		expect(calls[2][1]).toBe(calls[0][1])
	})
	it('requires explicit admin confirmation to fence an in-flight operation', async () => {
		vi.mocked(getInboxAcceptance).mockResolvedValue({
			schemaVersion: 1,
			acceptance: acceptance({ status: 'RUNNING', version: 8 })
		})
		vi.mocked(mutateInboxAcceptance).mockResolvedValue({
			schemaVersion: 1,
			acceptance: acceptance({
				status: 'RECOVERING',
				mode: 'RECOVER',
				version: 9
			})
		})
		mount(entry.id)
		fireEvent.click(
			await screen.findByRole('button', { name: 'Безопасно остановить' })
		)
		expect(mutateInboxAcceptance).not.toHaveBeenCalled()
		fireEvent.click(
			screen.getByRole('button', { name: 'Подтвердить остановку' })
		)
		await waitFor(() =>
			expect(mutateInboxAcceptance).toHaveBeenCalledWith(
				'session-token',
				expect.objectContaining({
					operation: 'recover',
					expectedVersion: 8
				})
			)
		)
		await screen.findByText('Проверяем и останавливаем обработку')
	})
	it('manager can retry only their own workflow and cannot request recovery', async () => {
		vi.mocked(getInboxAcceptance).mockResolvedValue({
			schemaVersion: 1,
			acceptance: acceptance({
				actorSubject: 'another-manager',
				status: 'BLOCKED',
				lastErrorCode: 'WORKFLOW_ACCESS_BLOCKED'
			})
		})
		mount(entry.id, true, { sourceManager: false })
		await screen.findByText('Нужна проверка доступа')
		expect(
			screen.queryByRole('button', { name: 'Повторить обработку' })
		).toBeNull()
		expect(
			screen.queryByRole('button', { name: 'Безопасно остановить' })
		).toBeNull()
	})
	it('read-only permits state inspection but disables retry and recovery', async () => {
		vi.mocked(getInboxAcceptance).mockResolvedValue({
			schemaVersion: 1,
			acceptance: acceptance({ status: 'FAILED' })
		})
		mount(entry.id, false)
		expect(
			await screen.findByRole('button', { name: 'Повторить обработку' })
		).toHaveProperty('disabled', true)
		expect(
			screen.getByRole('button', { name: 'Безопасно остановить' })
		).toHaveProperty('disabled', true)
		expect(
			screen.getByRole('button', { name: 'Обновить состояние' })
		).toHaveProperty('disabled', false)
	})
	it('cancelled partial work keeps the contact visible and requires explicit selection for a new attempt', async () => {
		vi.mocked(getInboxAcceptance).mockResolvedValue({
			schemaVersion: 1,
			acceptance: acceptance({
				status: 'CANCELLED',
				contactId: workspaceId,
				completedAt: entry.receivedAt
			})
		})
		mount(entry.id)
		await screen.findByText('Обработка остановлена')
		await waitFor(() =>
			expect(
				screen.getByRole('button', { name: 'Принять в работу' })
			).toHaveProperty('disabled', false)
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Принять в работу' })
		)
		expect(
			screen.getByRole('combobox', { name: 'Контакт' })
		).toHaveProperty('value', 'EXISTING')
		expect(
			screen.getByRole('button', { name: 'Начать обработку' })
		).toHaveProperty('disabled', true)
		expect(mutateInboxAcceptance).not.toHaveBeenCalled()
	})
})

describe('Inbox acceptance refresh owner boundary', () => {
	beforeEach(() => {
		useSessionStore.setState({
			status: 'authenticated',
			session: access().session,
			sessionRevision: 1
		})
		Object.defineProperty(navigator, 'onLine', {
			configurable: true,
			value: true
		})
	})
	afterEach(resetSessionStore)
	const setup = () => {
		let resolve!: (result: { isSuccess: boolean }) => void
		const refetch = vi.fn().mockReturnValue(
			new Promise<{ isSuccess: boolean }>(done => {
				resolve = done
			})
		)
		const resetError = vi.fn()
		const context = {
			query: {
				isError: true,
				isSuccess: false,
				isFetching: false,
				refetch
			},
			command: { resetError }
		} as unknown as InboxAcceptanceContext
		const view = (currentAccess = access(), id = entry.id) => (
			<InboxAcceptancePanel
				access={currentAccess}
				entry={{ ...entry, id, workspaceId: currentAccess.workspaceId }}
				context={context}
				competingCommand={false}
			/>
		)
		const rendered = render(view())
		const start = () =>
			fireEvent.click(
				screen.getByRole('button', { name: 'Проверить обработку' })
			)
		return { ...rendered, view, start, resolve, refetch, resetError }
	}
	it.each([true, false])(
		'handles a settled refresh only for its current owner (success=%s)',
		async isSuccess => {
			const test = setup()
			test.start()
			await act(async () => test.resolve({ isSuccess }))
			expect(test.refetch).toHaveBeenCalledOnce()
			if (isSuccess) {
				expect(test.resetError).toHaveBeenCalledOnce()
				expect(toast).toHaveBeenCalledWith(
					'Состояние обработки обновлено. Проверьте его перед новой командой.'
				)
				expect(toast.error).not.toHaveBeenCalled()
			} else {
				expect(test.resetError).not.toHaveBeenCalled()
				expect(toast.error).toHaveBeenCalledWith(
					'Не удалось обновить состояние обработки'
				)
			}
		}
	)
	it.each([
		'unmount',
		'session',
		'token',
		'revision',
		'workspace',
		'scope',
		'entry',
		'permissions'
	] as const)(
		'ignores a late refresh after %s changes',
		async boundary => {
			const test = setup()
			test.start()
			expect(test.refetch).toHaveBeenCalledOnce()
			if (boundary === 'unmount') test.unmount()
			else if (boundary === 'session')
				useSessionStore.getState().setAuthenticated({
					userId: 'another-user',
					accessToken: 'another-session'
				})
			else if (boundary === 'token')
				useSessionStore.setState({
					session: { userId: 'owner', accessToken: 'new-token' }
				})
			else if (boundary === 'revision')
				useSessionStore.setState({ sessionRevision: 2 })
			else if (boundary === 'workspace')
				test.rerender(test.view({ ...access(), workspaceId: entry.id }))
			else if (boundary === 'scope')
				test.rerender(test.view({ ...access(), scopeKey: 'manager:own' }))
			else if (boundary === 'entry')
				test.rerender(test.view(access(), workspaceId))
			else test.rerender(test.view({ ...access(), canRead: false }))
			await act(async () => test.resolve({ isSuccess: true }))
			expect(test.resetError).not.toHaveBeenCalled()
			expect(toast).not.toHaveBeenCalled()
			expect(toast.error).not.toHaveBeenCalled()
			expect(toast.success).not.toHaveBeenCalled()
		}
	)
	it('does not toast a failed refresh from an old session or log out its replacement', async () => {
		const test = setup()
		test.start()
		useSessionStore.getState().setAuthenticated({
			userId: 'another-user',
			accessToken: 'another-session'
		})
		await act(async () => test.resolve({ isSuccess: false }))
		expect(test.resetError).not.toHaveBeenCalled()
		expect(toast.error).not.toHaveBeenCalled()
		expect(useSessionStore.getState()).toMatchObject({
			status: 'authenticated',
			session: { userId: 'another-user', accessToken: 'another-session' }
		})
	})
	it('does not start a refresh after session ownership has already changed', () => {
		const test = setup()
		useSessionStore.getState().setAnonymous()
		test.start()
		expect(test.refetch).not.toHaveBeenCalled()
		expect(test.resetError).not.toHaveBeenCalled()
		expect(toast).not.toHaveBeenCalled()
	})
})
