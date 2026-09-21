import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import toast from 'react-hot-toast'
import { listTeamRecords } from '@/entities/crm-team'
import type { CustomRolePermission } from '@/shared/lib/custom-role'
import { TeamEditor, type TeamEditorSelection } from './TeamEditor'
import type { useTeamSession } from '../model/use-team-session'

const command = vi.hoisted(() => ({
	locked: false,
	running: false,
	enabled: true,
	uncertain: false,
	blocked: false,
	error: null,
	execute: vi.fn(),
	canClose: vi.fn(() => true),
	resetAfterReview: vi.fn()
}))
vi.mock('../model/use-team-command', () => ({
	useTeamCommand: () => command
}))
vi.mock('@/entities/crm-team', async original => ({
	...(await original<object>()),
	listTeamRecords: vi.fn()
}))
vi.mock('./TeamPicker', () => ({
	TeamPicker: () => <div>Выбор отдела</div>
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { error: vi.fn() })
}))
const workspaceId = '11111111-1111-4111-8111-111111111111'
const context = {
	workspace: { workspaceId },
	session: { userId: 'owner', accessToken: 'session-token' },
	sessionRevision: 1,
	scopeKey: 'owner:all',
	key: [workspaceId, 'owner', 1, 'owner:all'] as const,
	confirmed: true,
	canRead: false,
	canManage: true,
	canRevoke: true,
	permissions: {
		isSuccess: true,
		isFetching: false,
		data: { role: 'OWNER' }
	}
} as unknown as ReturnType<typeof useTeamSession>
let queryClient: QueryClient
const customRole = {
	kind: 'role' as const,
	id: '44444444-4444-4444-8444-444444444444',
	workspaceId,
	name: 'Старший менеджер',
	permissions: ['customers:read'] as CustomRolePermission[],
	dataScope: 'OWN' as const,
	version: 2,
	archivedAt: null,
	createdAt: '2026-09-05T00:00:00.000Z',
	updatedAt: '2026-09-05T00:00:00.000Z',
	memberCount: 0,
	invitationCount: 0
}
const mount = (
	selection: TeamEditorSelection = { kind: 'invite' },
	currentContext = context
) =>
	render(
		<QueryClientProvider client={queryClient}>
			<TeamEditor
				context={currentContext}
				selection={selection}
				onClose={vi.fn()}
				onSaved={vi.fn()}
				onReview={async () => undefined}
			/>
		</QueryClientProvider>
	)
beforeEach(() => {
	vi.clearAllMocks()
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } }
	})
	vi.mocked(listTeamRecords).mockResolvedValue({
		schemaVersion: 1,
		page: 1,
		pageSize: 100,
		total: 1,
		items: [customRole]
	})
	command.locked = false
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
})
afterEach(() => {
	cleanup()
	queryClient.clear()
	Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
	Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
})
describe('employee invitation names', () => {
	it('uses separate name fields and sends normalized names in the same invitation command', () => {
		mount()
		fireEvent.change(screen.getByRole('textbox', { name: 'Фамилия' }), {
			target: { value: ' Петров ' }
		})
		fireEvent.change(screen.getByRole('textbox', { name: 'Имя' }), {
			target: { value: ' Иван ' }
		})
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Email сотрудника' }),
			{
				target: { value: 'employee@example.test' }
			}
		)
		fireEvent.submit(
			screen
				.getByRole('button', { name: 'Создать приглашение' })
				.closest('form')!
		)
		expect(command.execute).toHaveBeenCalledWith({
			kind: 'invite',
			email: 'employee@example.test',
			role: 'MANAGER',
			teamIds: [],
			ttlDays: 7,
			profile: { firstName: 'Иван', lastName: 'Петров', middleName: null }
		})
	})
	it('does not submit an incomplete name even when native validation is bypassed', () => {
		mount()
		fireEvent.submit(
			screen
				.getByRole('button', { name: 'Создать приглашение' })
				.closest('form')!
		)
		expect(command.execute).not.toHaveBeenCalled()
		expect(screen.getByRole('alert').textContent).toContain(
			'Проверьте имя и фамилию'
		)
		expect(toast.error).toHaveBeenCalledTimes(1)
	})
	it('locks all name fields while the original command is unresolved', () => {
		command.locked = true
		mount()
		for (const label of ['Фамилия', 'Имя', 'Отчество (необязательно)'])
			expect(
				(screen.getByRole('textbox', { name: label }) as HTMLInputElement)
					.disabled
			).toBe(true)
		fireEvent.submit(
			screen
				.getByRole('button', { name: 'Создать приглашение' })
				.closest('form')!
		)
		expect(command.execute).not.toHaveBeenCalled()
	})
	it('lets only the owner choose a current custom role and sends its version binding', async () => {
		const ownerContext = { ...context, canRead: true }
		mount({ kind: 'invite' }, ownerContext)
		await screen.findByRole('option', { name: 'Старший менеджер' })
		fireEvent.change(screen.getByRole('combobox', { name: 'CRM-роль' }), {
			target: { value: `custom:${customRole.id}` }
		})
		fireEvent.change(screen.getByRole('textbox', { name: 'Фамилия' }), {
			target: { value: 'Петров' }
		})
		fireEvent.change(screen.getByRole('textbox', { name: 'Имя' }), {
			target: { value: 'Иван' }
		})
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Email сотрудника' }),
			{ target: { value: 'employee@example.test' } }
		)
		fireEvent.submit(
			screen
				.getByRole('button', { name: 'Создать приглашение' })
				.closest('form')!
		)
		expect(command.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'invite',
				role: 'CUSTOM',
				customRoleId: customRole.id,
				expectedRoleVersion: customRole.version
			})
		)
	})
	it('does not expose custom or administrator roles to a non-owner', () => {
		const managerContext = {
			...context,
			permissions: { ...context.permissions, data: { role: 'MANAGER' } }
		} as unknown as ReturnType<typeof useTeamSession>
		mount({ kind: 'invite' }, managerContext)
		expect(
			screen.queryByRole('option', { name: 'Администратор CRM' })
		).toBeNull()
		expect(
			screen.queryByRole('option', { name: 'Старший менеджер' })
		).toBeNull()
	})
	it('requires owner confirmation before changing a role with current version and assignments', () => {
		mount({
			kind: 'update-role',
			record: { ...customRole, memberCount: 2, invitationCount: 1 }
		})
		fireEvent.submit(
			screen.getByRole('button', { name: 'Подтвердить' }).closest('form')!
		)
		expect(command.execute).not.toHaveBeenCalled()
		expect(toast.error).toHaveBeenCalledWith(
			'Подтвердите изменение прав сотрудников с этой ролью.'
		)
		fireEvent.click(
			screen.getByRole('checkbox', {
				name: /Изменить права всех сотрудников/
			})
		)
		fireEvent.submit(
			screen.getByRole('button', { name: 'Подтвердить' }).closest('form')!
		)
		expect(command.execute).toHaveBeenCalledWith({
			kind: 'update-role',
			id: customRole.id,
			expectedVersion: customRole.version,
			name: customRole.name,
			permissions: [...customRole.permissions],
			dataScope: customRole.dataScope
		})
	})
})
