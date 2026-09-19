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
	listReminderRules,
	type ReminderItem,
	type ReminderRule
} from '@/entities/crm-reminders'
import { useAssigneeOptions, useAssigneeLabels } from '@/entities/crm-team'
import type { ReminderContext } from '../model/use-reminder-session'
import { ReminderSettingsBody } from './ReminderSettings'

const command = vi.hoisted(() => ({
	locked: false,
	uncertain: false,
	running: false,
	error: null as Error | null,
	execute: vi.fn(),
	reset: vi.fn()
}))
vi.mock('../model/use-reminder-command', () => ({
	useReminderCommand: () => command
}))
vi.mock('@/entities/crm-reminders', async original => ({
	...(await original<object>()),
	listReminderRules: vi.fn()
}))
vi.mock('@/entities/crm-team', async original => ({
	...(await original<object>()),
	useAssigneeOptions: vi.fn(),
	useAssigneeLabels: vi.fn()
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
const workspaceId = '22222222-2222-4222-8222-222222222222'
const id = '11111111-1111-4111-8111-111111111111'
const actor = { subject: 'owner', membershipId: null }
const rule: ReminderRule = {
	schemaVersion: 1,
	id,
	scope: 'PERSONAL',
	ownerBinding: actor,
	title: 'Контроль срока',
	enabled: false,
	channels: ['EMAIL'],
	trigger: { kind: 'BEFORE_DUE', offsetMinutes: 60 },
	repeats: null,
	timeZone: 'Asia/Vladivostok',
	quietHours: null,
	recipients: { kind: 'SELF' }
}
const item: ReminderItem = {
	workspaceId,
	rule,
	version: 1,
	archivedAt: null,
	createdAt: '2026-09-07T00:00:00.000Z',
	updatedAt: '2026-09-07T00:00:00.000Z'
}
let client: QueryClient
let context: ReminderContext
const pageResult = (
	page = 1,
	total = 1,
	scope: 'PERSONAL' | 'WORKSPACE' = 'PERSONAL'
) => ({
	schemaVersion: 1 as const,
	workspaceId,
	page,
	pageSize: 10,
	total,
	items:
		page > 1
			? []
			: [
					{
						...item,
						rule: {
							...rule,
							scope,
							recipients: {
								kind: scope === 'PERSONAL' ? 'SELF' : 'ASSIGNEE'
							}
						} as ReminderRule
					}
				],
	limits: { PERSONAL: 10, WORKSPACE: 20 },
	deliveryReady: false
})
const view = () => (
	<QueryClientProvider client={client}>
		<ReminderSettingsBody context={context} />
	</QueryClientProvider>
)
beforeEach(() => {
	vi.clearAllMocks()
	Object.assign(command, {
		locked: false,
		uncertain: false,
		running: false,
		error: null
	})
	client = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	context = {
		workspace: { workspaceId, canWrite: true },
		session: { accessToken: 'token', userId: actor.subject },
		sessionRevision: 1,
		key: 'owner',
		scopeKey: 'owner',
		canRead: true,
		canWrite: true,
		current: () => true,
		actor,
		actorConfirmed: true,
		authority: { role: 'OWNER', state: 'ACTIVE' },
		permissions: { isError: false, refetch: vi.fn() },
		self: { refetch: vi.fn(), loading: false, error: false },
		directory: { canRead: true }
	} as unknown as ReminderContext
	vi.mocked(listReminderRules).mockImplementation(
		async (_token, request) => pageResult(request.page, 1, request.scope)
	)
	vi.mocked(useAssigneeOptions).mockReturnValue({
		scopeKey: 'scope',
		search: '',
		page: 1,
		pageSize: 20,
		enabled: true,
		loading: false,
		error: false,
		data: { items: [], selected: null, total: 0 },
		resolveBinding: () => null,
		isCurrent: () => true,
		refetch: vi.fn(),
		setPage: vi.fn(),
		setSearch: vi.fn()
	} as never)
	vi.mocked(useAssigneeLabels).mockReturnValue({
		error: false,
		loading: false,
		lookup: () => undefined,
		refetch: vi.fn()
	})
})
afterEach(() => {
	cleanup()
	client.clear()
})
const open = async () => {
	render(view())
	fireEvent.click(
		await screen.findByRole('button', { name: 'Открыть правило' })
	)
}
describe('reminder settings UI', () => {
	it('selects assignment without offset/repeats, preserves opt-in and restores due controls', async () => {
		await open()
		fireEvent.click(
			screen.getByRole('checkbox', { name: 'Повторять напоминание' })
		)
		const trigger = screen.getByRole('combobox', {
			name: 'Когда напоминать'
		})
		fireEvent.change(trigger, { target: { value: 'ASSIGNED' } })
		expect(
			screen.queryByRole('spinbutton', { name: 'Отступ, минут' })
		).toBeNull()
		expect(
			screen.queryByRole('checkbox', { name: 'Повторять напоминание' })
		).toBeNull()
		expect(
			screen.queryByRole('spinbutton', { name: 'Интервал повтора, минут' })
		).toBeNull()
		expect(
			screen.getByText(/Старые назначения не рассылаются/)
		).toBeTruthy()
		expect(command.execute).not.toHaveBeenCalled()
		fireEvent.submit(
			screen.getByRole('form', { name: 'Правило напоминания' })
		)
		expect(command.execute.mock.calls[0][0]()).toMatchObject({
			rule: {
				enabled: false,
				trigger: { kind: 'ASSIGNED', offsetMinutes: 0 },
				repeats: null,
				channels: ['EMAIL'],
				timeZone: 'Asia/Vladivostok',
				recipients: { kind: 'SELF' }
			}
		})
		fireEvent.change(trigger, { target: { value: 'BEFORE_DUE' } })
		expect(
			screen.getByRole('spinbutton', { name: 'Отступ, минут' })
		).toHaveProperty('value', '60')
		expect(
			screen.getByRole('checkbox', { name: 'Повторять напоминание' })
		).toHaveProperty('checked', false)
	})
	it('allows explicit enabling only after deliveryReady=true, without saving on checkbox change', async () => {
		vi.mocked(listReminderRules).mockResolvedValue({
			...pageResult(),
			deliveryReady: true
		})
		await open()
		const enable = screen.getByRole('checkbox', {
			name: 'Включить отправку'
		})
		expect(enable).toHaveProperty('disabled', false)
		fireEvent.click(enable)
		expect(command.execute).not.toHaveBeenCalled()
		fireEvent.submit(
			screen.getByRole('form', { name: 'Правило напоминания' })
		)
		expect(command.execute.mock.calls[0][0]()).toMatchObject({
			rule: { enabled: true, ownerBinding: actor, channels: ['EMAIL'] }
		})
	})
	it('shows delivery as unavailable, preserves explicit fields and does not autosave', async () => {
		await open()
		expect(
			screen.getByRole('checkbox', { name: 'Включить отправку' })
		).toHaveProperty('disabled', true)
		expect(
			screen.getByRole('combobox', { name: 'Часовой пояс напоминания' })
		).toHaveProperty('value', 'Asia/Vladivostok')
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Название правила' }),
			{
				target: { value: 'Моё правило' }
			}
		)
		expect(command.execute).not.toHaveBeenCalled()
		fireEvent.submit(
			screen.getByRole('form', { name: 'Правило напоминания' })
		)
		expect(command.execute).toHaveBeenCalledOnce()
		const request = command.execute.mock.calls[0][0]()
		expect(request).toMatchObject({
			action: 'edit',
			expectedVersion: 1,
			actor,
			rule: {
				title: 'Моё правило',
				enabled: false,
				recipients: { kind: 'SELF' }
			}
		})
	})
	it('keeps read-only viewing and server archive/scope filters without exposing writes', async () => {
		context = {
			...context,
			canWrite: false,
			authority: { ...context.authority!, state: 'READ_ONLY' }
		}
		await open()
		expect(
			screen.getByRole('button', { name: 'Сохранить правило' })
		).toHaveProperty('disabled', true)
		expect(
			screen.getByRole('button', { name: 'Добавить правило' })
		).toHaveProperty('disabled', true)
		fireEvent.change(screen.getByLabelText('Правила'), {
			target: { value: 'WORKSPACE' }
		})
		await waitFor(() =>
			expect(listReminderRules).toHaveBeenLastCalledWith(
				'token',
				expect.objectContaining({ scope: 'WORKSPACE', page: 1 })
			)
		)
		expect(command.execute).not.toHaveBeenCalled()
	})
	it('does not use an unconfirmed actor or silently choose the first employee', () => {
		context = { ...context, actor: null, actorConfirmed: false }
		render(view())
		expect(listReminderRules).not.toHaveBeenCalled()
		expect(
			screen.getByText(/Чужая или первая запись не используется/)
		).toBeTruthy()
	})
	it('does not present a network error as an empty rule list', async () => {
		vi.mocked(listReminderRules).mockRejectedValue(new Error('offline'))
		render(view())
		await screen.findByText(
			'Не удалось загрузить правила. Это не означает, что правил нет.'
		)
		expect(screen.queryByText('Правил пока нет.')).toBeNull()
	})
	it('uses server page two and blocks tab changes while result is uncertain', async () => {
		vi.mocked(listReminderRules).mockImplementation(
			async (_token, request) => pageResult(request.page, 11)
		)
		const mounted = render(view())
		await screen.findByText('1 / 2')
		fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
		await waitFor(() =>
			expect(listReminderRules).toHaveBeenLastCalledWith(
				'token',
				expect.objectContaining({ page: 2 })
			)
		)
		command.locked = true
		command.uncertain = true
		mounted.rerender(view())
		expect(screen.getByLabelText('Правила')).toHaveProperty(
			'disabled',
			true
		)
		fireEvent.click(
			screen.getByRole('button', {
				name: 'Проверить результат сохранения'
			})
		)
		expect(command.execute).toHaveBeenCalledWith()
	})
	it('preserves the draft, hidden and disabled, across background authority refresh', async () => {
		const mounted = render(view())
		fireEvent.click(
			await screen.findByRole('button', { name: 'Открыть правило' })
		)
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Название правила' }),
			{
				target: { value: 'Не потерять' }
			}
		)
		context = { ...context, canRead: false, actorConfirmed: false }
		mounted.rerender(view())
		expect(screen.queryByRole('form')).toBeNull()
		context = { ...context, canRead: true, actorConfirmed: true }
		mounted.rerender(view())
		await waitFor(() =>
			expect(
				screen.getByRole('textbox', { name: 'Название правила' })
			).toHaveProperty('value', 'Не потерять')
		)
		expect(command.execute).not.toHaveBeenCalled()
	})
	it('does not allow a manager to change common rules but permits personal settings', async () => {
		context = {
			...context,
			authority: { ...context.authority!, role: 'MANAGER' }
		}
		render(view())
		await screen.findByRole('button', { name: 'Открыть правило' })
		expect(
			screen.getByRole('button', { name: 'Добавить правило' })
		).toHaveProperty('disabled', false)
		fireEvent.change(screen.getByLabelText('Правила'), {
			target: { value: 'WORKSPACE' }
		})
		await screen.findByText(
			'Общие правила меняют владелец и администратор CRM.'
		)
		expect(
			screen.getByRole('button', { name: 'Добавить правило' })
		).toHaveProperty('disabled', true)
	})
})
