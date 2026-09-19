import {
	getEmployeeProfile,
	type EmployeeProfileResponse
} from '@/entities/crm-team'
import { resetSessionStore, useSessionStore } from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
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
import type { useTeamSession } from '../model/use-team-session'
import { EmployeeProfileControl } from './EmployeeProfileControl'

const command = vi.hoisted(() => ({
	locked: false,
	running: false,
	enabled: true,
	uncertain: false,
	blocked: false,
	error: null as Error | null,
	execute: vi.fn(),
	canClose: vi.fn(() => true),
	reset: vi.fn(() => true)
}))
vi.mock('../model/use-employee-profile-command', () => ({
	useEmployeeProfileCommand: (
		_context: unknown,
		_target: string,
		enabled: boolean
	) => ({ ...command, enabled, locked: command.locked || !enabled })
}))
vi.mock('@/entities/crm-team', async original => ({
	...(await original<object>()),
	getEmployeeProfile: vi.fn()
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
const workspaceId = '11111111-1111-4111-8111-111111111111'
let context: ReturnType<typeof useTeamSession>
let queryClient: QueryClient
const response = (targetSubject = 'actor'): EmployeeProfileResponse => ({
	schemaVersion: 1,
	workspaceId,
	subject: 'actor',
	targetSubject,
	profile: {
		id: '22222222-2222-4222-8222-222222222222',
		firstName: 'Анна',
		lastName: 'Иванова',
		middleName: null,
		version: 3,
		updatedAt: '2026-09-07T10:00:00.000Z'
	}
})
const view = (
	targetSubject = 'actor',
	allowEdit = true,
	disabled = false
) => (
	<QueryClientProvider client={queryClient}>
		<EmployeeProfileControl
			context={context}
			targetSubject={targetSubject}
			allowEdit={allowEdit}
			disabled={disabled}
		/>
	</QueryClientProvider>
)
const open = async (targetSubject = 'actor', allowEdit = true) => {
	const mounted = render(view(targetSubject, allowEdit))
	activate(targetSubject)
	await screen.findByRole('textbox', { name: 'Имя' })
	return mounted
}
const activate = (targetSubject = 'actor') =>
	fireEvent.click(
		screen.getByRole('button', {
			name: targetSubject === 'actor' ? 'Моё ФИО' : 'ФИО'
		})
	)
const field = (name: string) =>
	screen.getByRole('textbox', { name }) as HTMLInputElement
beforeEach(() => {
	vi.clearAllMocks()
	Object.assign(command, {
		locked: false,
		running: false,
		uncertain: false,
		blocked: false,
		error: null
	})
	command.canClose.mockReturnValue(true)
	command.reset.mockReturnValue(true)
	resetSessionStore()
	useSessionStore
		.getState()
		.setAuthenticated({ accessToken: 'token', userId: 'actor' })
	const { session, sessionRevision } = useSessionStore.getState()
	context = {
		workspace: { workspaceId, canWrite: true },
		session,
		sessionRevision,
		confirmed: true,
		canRead: true,
		canManage: true,
		canRevoke: true,
		scopeKey: 'scope',
		key: [workspaceId, 'actor', sessionRevision, 'scope'],
		permissions: {
			data: {
				workspaceId,
				subject: 'actor',
				role: 'OWNER',
				state: 'ACTIVE'
			}
		}
	} as unknown as ReturnType<typeof useTeamSession>
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	vi.mocked(getEmployeeProfile).mockImplementation(
		async (_token, request) => response(request.targetSubject)
	)
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
	resetSessionStore()
	Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
	Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
})
describe('employee profile editor', () => {
	it.each(['unauthorized', 'forbidden', 'notFound'] as const)(
		'hides previously read names after a fresh %s response',
		async kind => {
			await open()
			vi.mocked(getEmployeeProfile).mockRejectedValue(
				new AuthenticatedApiError(kind, 'Профиль недоступен')
			)
			await act(() =>
				queryClient.invalidateQueries({
					queryKey: ['crm-employee-profile']
				})
			)
			await waitFor(() =>
				expect(screen.queryByRole('textbox', { name: 'Имя' })).toBeNull()
			)
			expect(screen.getByText('Профиль недоступен')).toBeTruthy()
		}
	)
	it('reads only when opened and saves separate normalized fields with the observed version', async () => {
		render(view())
		expect(getEmployeeProfile).not.toHaveBeenCalled()
		activate()
		await screen.findByRole('textbox', { name: 'Имя' })
		expect(getEmployeeProfile).toHaveBeenCalledWith('token', {
			workspaceId,
			subject: 'actor',
			targetSubject: 'actor'
		})
		expect(field('Фамилия').value).toBe('Иванова')
		fireEvent.change(field('Имя'), { target: { value: '  Мария ' } })
		fireEvent.submit(field('Имя').closest('form')!)
		expect(command.execute).toHaveBeenCalledWith({
			profile: {
				firstName: 'Мария',
				lastName: 'Иванова',
				middleName: null
			},
			expectedVersion: 3
		})
	})
	it('allows a manager to edit self but never reads another employee profile', async () => {
		context.canRead = false
		context.canManage = false
		context.permissions.data!.role = 'MANAGER'
		const mounted = await open()
		expect(
			screen.getByRole('button', { name: 'Сохранить ФИО' })
		).toHaveProperty('disabled', false)
		mounted.rerender(view('another'))
		expect(screen.queryByRole('textbox', { name: 'Имя' })).toBeNull()
		activate('another')
		expect(getEmployeeProfile).toHaveBeenCalledOnce()
	})
	it.each(['READ_ONLY', 'protected-peer'])(
		'keeps names readable but not editable for %s',
		async reason => {
			if (reason === 'READ_ONLY')
				context.permissions.data!.state = 'READ_ONLY'
			await open('member', reason !== 'protected-peer')
			expect(field('Имя')).toHaveProperty('disabled', true)
			expect(field('Имя').value).toBe('Анна')
			expect(
				screen.queryByRole('button', { name: 'Сохранить ФИО' })
			).toBeNull()
			fireEvent.submit(field('Имя').closest('form')!)
			expect(command.execute).not.toHaveBeenCalled()
		}
	)
	it.each([
		'unconfirmed',
		'wrong-actor',
		'wrong-workspace',
		'disabled-member'
	])('does not open or fetch for %s', reason => {
		if (reason === 'unconfirmed') context.confirmed = false
		if (reason === 'wrong-actor')
			context.permissions.data!.subject = 'another'
		if (reason === 'wrong-workspace')
			context.permissions.data!.workspaceId = 'another'
		render(view('member', true, reason === 'disabled-member'))
		activate('member')
		expect(getEmployeeProfile).not.toHaveBeenCalled()
	})
	it('starts an empty legacy profile at version zero without guessing first and last names', async () => {
		vi.mocked(getEmployeeProfile).mockResolvedValue({
			...response(),
			profile: null
		})
		await open()
		expect(field('Имя').value).toBe('')
		expect(field('Фамилия').value).toBe('')
		fireEvent.submit(field('Имя').closest('form')!)
		expect(command.execute).not.toHaveBeenCalled()
		fireEvent.change(field('Имя'), { target: { value: 'Анна' } })
		fireEvent.change(field('Фамилия'), { target: { value: 'Иванова' } })
		fireEvent.submit(field('Имя').closest('form')!)
		expect(command.execute).toHaveBeenCalledWith(
			expect.objectContaining({ expectedVersion: 0 })
		)
	})
	it('keeps a draft unchanged during a query refresh', async () => {
		await open()
		fireEvent.change(field('Имя'), { target: { value: 'Мой черновик' } })
		const updated = response()
		updated.profile!.firstName = 'Новое имя'
		updated.profile!.version = 4
		vi.mocked(getEmployeeProfile).mockResolvedValue(updated)
		await act(() =>
			queryClient.invalidateQueries({ queryKey: ['crm-employee-profile'] })
		)
		expect(field('Имя').value).toBe('Мой черновик')
	})
	it('locks unresolved names and close, and retries without creating new data', async () => {
		Object.assign(command, {
			locked: true,
			uncertain: true,
			error: new Error('Unknown')
		})
		command.canClose.mockReturnValue(false)
		await open()
		expect(field('Имя')).toHaveProperty('disabled', true)
		fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
		expect(screen.getByRole('dialog')).toBeTruthy()
		fireEvent.click(
			screen.getByRole('button', { name: 'Проверить результат' })
		)
		expect(command.execute).toHaveBeenCalledWith()
	})
	it('explicit review replaces a conflicting draft with current names and version', async () => {
		Object.assign(command, {
			locked: true,
			blocked: true,
			error: new Error('Version changed')
		})
		await open()
		const updated = response()
		updated.profile!.firstName = 'Мария'
		updated.profile!.version = 4
		vi.mocked(getEmployeeProfile).mockResolvedValue(updated)
		fireEvent.click(
			screen.getByRole('button', { name: 'Перечитать и проверить' })
		)
		await waitFor(() => expect(field('Имя').value).toBe('Мария'))
		expect(command.reset).toHaveBeenCalledOnce()
	})
})
