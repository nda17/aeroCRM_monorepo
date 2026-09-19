import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listTeamRecords, type TeamPage } from '@/entities/crm-team'
import { useTeamSession } from '@/features/manage-team'
import { getRuntimeConfig } from '@/shared/config/runtime'
import SettingsScreen from './SettingsScreen'

vi.mock('@/shared/config/runtime', () => ({ getRuntimeConfig: vi.fn() }))

vi.mock('@/features/view-crm-commercial-policy', () => ({
	CrmCommercialPolicyCard: () => <div>Опубликованные условия WinCRM</div>
}))
vi.mock('@/features/manage-workspace-branding', () => ({
	WorkspaceBrandingSettings: () => <div>Название компании в CRM</div>
}))
vi.mock('@/features/manage-reminders', () => ({
	ReminderSettings: () => <div>Напоминания о задачах</div>
}))
vi.mock('@/features/manage-intake-sla', () => ({
	SlaSettings: () => <div>SLA входящих обращений</div>
}))
vi.mock('@/features/manage-crm-billing', () => ({
	BillingEntryCard: () => <div>Управление оплатой владельца</div>
}))
vi.mock('@/entities/crm-team', async original => ({
	...(await original<object>()),
	listTeamRecords: vi.fn()
}))
vi.mock('@/features/manage-team', () => ({
	useTeamSession: vi.fn(),
	EmployeeProfileControl: ({
		targetSubject
	}: {
		targetSubject: string
	}) => <button>ФИО: {targetSubject}</button>,
	TeamEditor: () => <div>Редактор команды</div>
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
const workspaceId = '11111111-1111-4111-8111-111111111111'
const id = '22222222-2222-4222-8222-222222222222'
const now = '2026-09-05T12:00:00.000Z'
const makeContext = () => ({
	workspace: {
		workspaceId,
		canWrite: true,
		membership: { role: 'OWNER' }
	},
	session: { userId: 'owner', accessToken: 'token' },
	sessionRevision: 1,
	confirmed: true,
	canRead: true,
	canManage: true,
	canRevoke: true,
	key: [workspaceId, 'owner', 1, 'owner'],
	scopeKey: 'owner',
	permissions: {
		data: { role: 'OWNER', state: 'ACTIVE' },
		isError: false,
		error: null,
		refetch: vi.fn()
	}
})
let context: ReturnType<typeof makeContext>
let queryClient: QueryClient
const roster = (page = 1, pageSize = 20): TeamPage => ({
	schemaVersion: 1,
	page,
	pageSize,
	total: 1,
	ownerSubject: 'owner',
	quota: { seatLimit: 5, usedSeats: 2, waitingCount: 2 },
	items: [
		{
			kind: 'member',
			id,
			workspaceId,
			subject: 'member',
			membershipId: id,
			displayName: 'Анна',
			verifiedEmail: 'anna@example.test',
			role: 'MANAGER',
			teamIds: [],
			disabledAt: null,
			version: 1,
			createdAt: now,
			updatedAt: now
		}
	]
})
beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(getRuntimeConfig).mockReturnValue({
		wincrmBillingEnabled: false
	} as never)
	context = makeContext()
	vi.mocked(useTeamSession).mockImplementation(() => context as never)
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	vi.mocked(listTeamRecords).mockImplementation(
		async (_token, _workspace, collection, page, pageSize = 20) =>
			collection === 'members'
				? roster(page, pageSize)
				: { schemaVersion: 1, page, pageSize, total: 0, items: [] }
	)
})
afterEach(() => {
	cleanup()
	queryClient.clear()
})
const view = () => (
	<QueryClientProvider client={queryClient}>
		<SettingsScreen />
	</QueryClientProvider>
)
describe('Real CRM team settings', () => {
	it.each([false, true])(
		'gates the owner billing card independently of the read-only commercial card (enabled=%s)',
		async enabled => {
			vi.mocked(getRuntimeConfig).mockReturnValue({
				wincrmBillingEnabled: enabled
			} as never)
			render(view())
			await screen.findByText('Анна')
			expect(
				screen.getByText('Опубликованные условия WinCRM')
			).toBeTruthy()
			expect(!!screen.queryByText('Управление оплатой владельца')).toBe(
				enabled
			)
		}
	)
	it('does not mount owner billing UI for a CRM administrator even when released', async () => {
		vi.mocked(getRuntimeConfig).mockReturnValue({
			wincrmBillingEnabled: true
		} as never)
		context.workspace.membership.role = 'MEMBER'
		context.permissions.data.role = 'CRM_ADMIN'
		render(view())
		await screen.findByText('Анна')
		expect(screen.queryByText('Управление оплатой владельца')).toBeNull()
	})
	it('renders actual quota and owner-inclusive explanation without demo workspace controls', async () => {
		render(view())
		await screen.findByText('Анна')
		expect(screen.getByText('2 / 5')).toBeTruthy()
		expect(screen.getByText('2 в очереди допуска')).toBeTruthy()
		expect(screen.queryByText('Демо состояний')).toBeNull()
		expect(screen.queryByLabelText('Часовой пояс')).toBeNull()
		expect(
			screen.getByRole('button', { name: 'Пригласить сотрудника' })
		).toHaveProperty('disabled', false)
	})
	it('keeps read-only structure visible but disables all mutations', async () => {
		context.canManage = false
		context.canRevoke = false
		context.permissions.data.state = 'READ_ONLY'
		render(view())
		await screen.findByText('Анна')
		for (const name of [
			'Новый отдел',
			'Пригласить сотрудника',
			'Роль',
			'Отключить'
		])
			expect(screen.getByRole('button', { name })).toHaveProperty(
				'disabled',
				true
			)
		expect(screen.getByText(/включая отключение доступа/)).toBeTruthy()
	})
	it('never requests the directory for a manager without read-team permission', async () => {
		context.canRead = false
		context.canManage = false
		context.canRevoke = false
		context.permissions.data.role = 'MANAGER'
		render(view())
		await screen.findByText(
			'Настройки команды доступны владельцу и администратору CRM'
		)
		expect(listTeamRecords).not.toHaveBeenCalled()
		expect(screen.queryByText('Анна')).toBeNull()
		expect(screen.getByText('Опубликованные условия WinCRM')).toBeTruthy()
	})
	it('hides previously loaded employees during fresh permission verification', async () => {
		const mounted = render(view())
		await screen.findByText('Анна')
		context.confirmed = false
		context.canRead = false
		context.canManage = false
		context.canRevoke = false
		mounted.rerender(view())
		expect(screen.queryByText('Анна')).toBeNull()
	})
	it('protects peer administrators with a disabled control and explicit explanation', async () => {
		context.permissions.data.role = 'CRM_ADMIN'
		vi.mocked(listTeamRecords).mockImplementation(
			async (_token, _workspace, _kind, page, size = 20) => {
				const result = roster(page, size)
				return {
					...result,
					items: result.items.map(item => ({ ...item, role: 'CRM_ADMIN' }))
				} as TeamPage
			}
		)
		render(view())
		await screen.findByText('Анна')
		const reason = screen.getByText(
			'Только владелец управляет администраторами CRM'
		)
		for (const name of ['Роль', 'Отделы', 'Отключить']) {
			const button = within(reason.parentElement!).getByRole('button', {
				name
			})
			expect(button).toHaveProperty('disabled', true)
			expect(button.getAttribute('aria-describedby')).toBe(reason.id)
			fireEvent.click(button)
		}
		expect(reason.hidden).toBe(false)
		expect(
			screen.getAllByText('Только владелец управляет администраторами CRM')
		).toHaveLength(1)
		expect(screen.queryByText('Редактор команды')).toBeNull()
	})
	it('associates the existing visible own-access explanation with every protected action', async () => {
		context.session.userId = 'member'
		render(view())
		await screen.findByText('Анна')
		const reason = screen.getByText(
			'Собственный доступ и владелец не редактируются'
		)
		for (const name of ['Роль', 'Отделы', 'Отключить']) {
			const button = within(reason.parentElement!).getByRole('button', {
				name
			})
			expect(button.getAttribute('aria-describedby')).toBe(reason.id)
			expect(button).toHaveProperty('disabled', true)
		}
		expect(reason.id).not.toBe('')
		expect(reason.hidden).toBe(false)
	})
	it('uses server paging and switches collections without loading all members', async () => {
		vi.mocked(listTeamRecords).mockImplementation(
			async (_token, _workspace, kind, page, size = 20) =>
				kind === 'members'
					? { ...roster(page, size), total: 45 }
					: { schemaVersion: 1, page, pageSize: size, total: 0, items: [] }
		)
		render(view())
		await screen.findByText('Анна')
		fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
		await waitFor(() =>
			expect(listTeamRecords).toHaveBeenCalledWith(
				'token',
				workspaceId,
				'members',
				2
			)
		)
		fireEvent.click(
			within(
				screen.getByRole('group', { name: 'Раздел настроек команды' })
			).getByRole('button', { name: 'Приглашения' })
		)
		await waitFor(() =>
			expect(listTeamRecords).toHaveBeenCalledWith(
				'token',
				workspaceId,
				'invitations',
				1
			)
		)
		expect(screen.queryByText('Анна')).toBeNull()
	})
	it('does not display synthetic zero seats after an Identity directory failure', async () => {
		vi.mocked(listTeamRecords).mockRejectedValue(
			new Error('Directory unavailable')
		)
		render(view())
		await screen.findByText(
			'Не удалось получить актуальную квоту сотрудников.'
		)
		expect(screen.queryByText('0 / 5')).toBeNull()
		expect(
			screen.queryByText('В CRM пока работает только владелец')
		).toBeNull()
	})
})
