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
import {
	getCrmPermissions,
	type CrmPermissions
} from '@/entities/crm-access'
import {
	getWorkspaceBranding,
	updateWorkspaceBranding
} from '@/entities/crm-workspace-branding/api/branding.api'
import { resetSessionStore, useSessionStore } from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import {
	commandOwner,
	PendingCommandProvider
} from '@/shared/lib/pending-command'
import { WorkspaceBrandingSettings } from './WorkspaceBrandingSettings'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const anotherId = '22222222-2222-4222-8222-222222222222'
let workspace: {
	workspaceId: string
	canWrite: boolean
	isReadOnly: boolean
}
let permissions: CrmPermissions
let queryClient: QueryClient
let branding: {
	displayName: string | null
	version: number
	updatedAt: string | null
}
vi.mock('@/entities/crm-access', () => ({
	useCrmWorkspaceAccess: () => workspace,
	useCrmPermissions: () => ({
		data: permissions,
		isSuccess: true,
		isFetching: false
	}),
	getCrmPermissions: vi.fn()
}))
vi.mock('@/entities/crm-workspace-branding/api/branding.api', () => ({
	getWorkspaceBranding: vi.fn(),
	updateWorkspaceBranding: vi.fn()
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))

const App = () => {
	const { session, sessionRevision } = useSessionStore()
	return (
		<QueryClientProvider client={queryClient}>
			<PendingCommandProvider
				owner={commandOwner(session?.userId, sessionRevision)}
			>
				<WorkspaceBrandingSettings />
			</PendingCommandProvider>
		</QueryClientProvider>
	)
}
const input = () =>
	screen.getByRole('textbox', {
		name: 'Название компании или бренда'
	}) as HTMLInputElement
const save = () =>
	screen.getByRole('button', {
		name: 'Сохранить название'
	}) as HTMLButtonElement
const change = (value: string) =>
	fireEvent.change(input(), { target: { value } })
const mount = async () => {
	const view = render(<App />)
	await screen.findByRole('textbox')
	return view
}
beforeEach(() => {
	vi.clearAllMocks()
	resetSessionStore()
	useSessionStore
		.getState()
		.setAuthenticated({ accessToken: 'captured', userId: 'owner' })
	workspace = { workspaceId, canWrite: true, isReadOnly: false }
	permissions = {
		schemaVersion: 1,
		workspaceId,
		subject: 'owner',
		role: 'OWNER',
		state: 'ACTIVE',
		dataScope: 'ALL',
		teamIds: [],
		permissions: ['access:manage-team']
	}
	branding = { displayName: null, version: 0, updatedAt: null }
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	vi.mocked(getCrmPermissions).mockImplementation(async () => permissions)
	vi.mocked(getWorkspaceBranding).mockImplementation(
		async (_token, request) => ({ schemaVersion: 1, ...request, branding })
	)
	vi.mocked(updateWorkspaceBranding).mockImplementation(
		async (_token, command) => {
			branding = {
				displayName: command.displayName,
				version: command.expectedVersion + 1,
				updatedAt: '2026-09-07T10:00:00.000Z'
			}
			return {
				schemaVersion: 1,
				workspaceId: command.workspaceId,
				subject: command.subject,
				commandId: command.commandId,
				branding
			}
		}
	)
})
afterEach(() => {
	cleanup()
	queryClient.clear()
	resetSessionStore()
	vi.restoreAllMocks()
})

describe('workspace company settings', () => {
	it('preserves a dirty draft across a temporary background read failure and retry', async () => {
		await mount()
		change('Мой черновик')
		vi.mocked(getWorkspaceBranding).mockRejectedValueOnce(
			new AuthenticatedApiError('temporary', 'Offline')
		)
		await act(() =>
			queryClient.invalidateQueries({
				queryKey: ['crm-workspace-branding']
			})
		)
		expect(input().value).toBe('Мой черновик')
		expect(
			await screen.findByText(
				'Не удалось обновить название. Ваши изменения сохранены в форме.'
			)
		).toBeTruthy()
		fireEvent.click(
			screen.getByRole('button', { name: 'Повторить загрузку' })
		)
		await waitFor(() =>
			expect(
				screen.queryByText(
					'Не удалось обновить название. Ваши изменения сохранены в форме.'
				)
			).toBeNull()
		)
		expect(input().value).toBe('Мой черновик')
	})
	it.each(['OWNER', 'ANALYST'] as const)(
		'adopts a newer server name in pristine %s form',
		async role => {
			permissions.role = role
			await mount()
			branding = {
				displayName: 'Новое имя',
				version: 2,
				updatedAt: '2026-09-07T12:00:00.000Z'
			}
			await act(() =>
				queryClient.invalidateQueries({
					queryKey: ['crm-workspace-branding']
				})
			)
			await waitFor(() => expect(input().value).toBe('Новое имя'))
			expect(save().disabled).toBe(true)
		}
	)
	it('does not overwrite a draft when another admin saves; explicit reload adopts the new CAS version', async () => {
		await mount()
		change('Мой черновик')
		branding = {
			displayName: 'Другой администратор',
			version: 2,
			updatedAt: '2026-09-07T12:00:00.000Z'
		}
		await act(() =>
			queryClient.invalidateQueries({
				queryKey: ['crm-workspace-branding']
			})
		)
		expect(input().value).toBe('Мой черновик')
		await waitFor(() => expect(save().disabled).toBe(true))
		fireEvent.click(
			screen.getByRole('button', { name: 'Загрузить актуальное название' })
		)
		await waitFor(() => expect(input().value).toBe('Другой администратор'))
		change('Итоговое название')
		fireEvent.click(save())
		await waitFor(() =>
			expect(updateWorkspaceBranding).toHaveBeenCalledWith(
				'captured',
				expect.objectContaining({ expectedVersion: 2 })
			)
		)
	})
	it.each(['unauthorized', 'forbidden', 'notFound'] as const)(
		'hides the prior caption and draft on a fresh %s denial',
		async kind => {
			await mount()
			change('Мой черновик')
			vi.mocked(getWorkspaceBranding).mockRejectedValue(
				new AuthenticatedApiError(kind, 'Access denied')
			)
			await act(() =>
				queryClient.invalidateQueries({
					queryKey: ['crm-workspace-branding']
				})
			)
			await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
			expect(screen.queryByText('Мой черновик')).toBeNull()
		}
	)
	it('does not keep a stale immutable receipt as current branding after replay', async () => {
		vi.mocked(updateWorkspaceBranding).mockRejectedValueOnce(
			new AuthenticatedApiError('temporary', 'Unknown')
		)
		await mount()
		change('Первое имя')
		fireEvent.click(save())
		await screen.findByRole('button', { name: 'Проверить результат' })
		branding = {
			displayName: 'Более новое имя',
			version: 2,
			updatedAt: '2026-09-07T12:00:00.000Z'
		}
		await act(() =>
			queryClient.invalidateQueries({
				queryKey: ['crm-workspace-branding']
			})
		)
		vi.mocked(updateWorkspaceBranding).mockImplementationOnce(
			async (_token, command) => ({
				schemaVersion: 1,
				workspaceId,
				subject: 'owner',
				commandId: command.commandId,
				branding: {
					displayName: 'Первое имя',
					version: 1,
					updatedAt: '2026-09-07T11:00:00.000Z'
				}
			})
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Проверить результат' })
		)
		await waitFor(() => expect(input().value).toBe('Более новое имя'))
	})
	it('does not reuse a draft after the same subject receives a new authenticated session', async () => {
		await mount()
		change('Старый черновик')
		vi.mocked(getWorkspaceBranding).mockReturnValue(new Promise(() => {}))
		act(() =>
			useSessionStore
				.getState()
				.setAuthenticated({ accessToken: 'new-token', userId: 'owner' })
		)
		expect(screen.queryByRole('textbox')).toBeNull()
		expect(screen.queryByText('Старый черновик')).toBeNull()
	})
	it.each(['OWNER', 'CRM_ADMIN'] as const)(
		'allows %s to save a normalized company name',
		async role => {
			permissions.role = role
			await mount()
			change('  Студия Север  ')
			fireEvent.click(save())
			await waitFor(() =>
				expect(toast.success).toHaveBeenCalledWith(
					'Название компании сохранено'
				)
			)
			expect(updateWorkspaceBranding).toHaveBeenCalledWith(
				'captured',
				expect.objectContaining({
					workspaceId,
					subject: 'owner',
					expectedVersion: 0,
					displayName: 'Студия Север'
				})
			)
			expect(getCrmPermissions).toHaveBeenCalledOnce()
			expect(input().value).toBe('Студия Север')
		}
	)
	it('clears the caption without deleting its version history', async () => {
		branding = {
			displayName: 'Север',
			version: 4,
			updatedAt: '2026-09-07T10:00:00.000Z'
		}
		await mount()
		change('')
		fireEvent.click(save())
		await waitFor(() =>
			expect(toast.success).toHaveBeenCalledWith(
				'Название компании убрано'
			)
		)
		expect(updateWorkspaceBranding).toHaveBeenCalledWith(
			'captured',
			expect.objectContaining({ expectedVersion: 4, displayName: null })
		)
	})
	it('allows exactly 40 Unicode points and blocks 41 without silently truncating pasted text', async () => {
		await mount()
		change('😀'.repeat(40))
		expect(save().disabled).toBe(false)
		expect(screen.getByText('40/40')).toBeTruthy()
		change('Я'.repeat(41))
		expect(save().disabled).toBe(true)
		expect(input().value).toHaveLength(41)
		expect(
			screen.getByText('Сократите название до 40 символов.')
		).toBeTruthy()
		fireEvent.submit(input().closest('form')!)
		expect(updateWorkspaceBranding).not.toHaveBeenCalled()
	})
	it.each(['<script>bad</script>', 'a\u2028b', 'a\u2029b', 'a\u202Eb'])(
		'rejects HTML/hidden separator %#',
		async value => {
			await mount()
			change(value)
			expect(save().disabled).toBe(true)
			expect(
				screen.getByText(
					'Используйте обычный текст без HTML и скрытых символов.'
				)
			).toBeTruthy()
		}
	)
	it.each([
		'TEAM_LEAD',
		'MANAGER',
		'ANALYST',
		'READ_ONLY',
		'missing-permission'
	] as const)(
		'keeps the caption visible but prevents edits for %s',
		async reason => {
			branding = {
				displayName: 'Север',
				version: 1,
				updatedAt: '2026-09-07T10:00:00.000Z'
			}
			if (reason === 'READ_ONLY') {
				workspace.canWrite = false
				permissions.state = 'READ_ONLY'
			} else if (reason === 'missing-permission')
				permissions.permissions = []
			else permissions.role = reason
			await mount()
			expect(input().value).toBe('Север')
			expect(input().disabled).toBe(true)
			expect(save().disabled).toBe(true)
			expect(updateWorkspaceBranding).not.toHaveBeenCalled()
		}
	)
	it('does not replace a loading error with an empty editable name', async () => {
		vi.mocked(getWorkspaceBranding).mockRejectedValue(
			new Error('Unavailable')
		)
		render(<App />)
		await screen.findByText('Не удалось загрузить название компании.')
		expect(screen.queryByRole('textbox')).toBeNull()
		expect(
			screen.getByRole('button', { name: 'Повторить загрузку' })
		).toBeTruthy()
	})
	it('rechecks rights before POST and rejects a revoked manager', async () => {
		await mount()
		change('Север')
		vi.mocked(getCrmPermissions).mockResolvedValue({
			...permissions,
			role: 'MANAGER',
			permissions: []
		})
		fireEvent.click(save())
		await waitFor(() => expect(getCrmPermissions).toHaveBeenCalled())
		expect(updateWorkspaceBranding).not.toHaveBeenCalled()
	})
	it('replays the same immutable command after a timeout', async () => {
		vi.mocked(updateWorkspaceBranding).mockRejectedValueOnce(
			new AuthenticatedApiError('temporary', 'Неизвестный результат')
		)
		await mount()
		change('Север')
		fireEvent.click(save())
		const retry = await screen.findByRole('button', {
			name: 'Проверить результат'
		})
		expect(input().disabled).toBe(true)
		const first = vi.mocked(updateWorkspaceBranding).mock.calls[0][1]
		fireEvent.click(retry)
		await waitFor(() => expect(toast.success).toHaveBeenCalled())
		expect(vi.mocked(updateWorkspaceBranding).mock.calls[1][1]).toEqual(
			first
		)
	})
	it('prevents dispatch when the actor changes during permission verification', async () => {
		let resolve!: (value: CrmPermissions) => void
		vi.mocked(getCrmPermissions).mockReturnValue(
			new Promise(done => {
				resolve = done
			})
		)
		await mount()
		change('Север')
		fireEvent.click(save())
		await waitFor(() => expect(getCrmPermissions).toHaveBeenCalled())
		act(() =>
			useSessionStore
				.getState()
				.setAuthenticated({ accessToken: 'other-token', userId: 'other' })
		)
		await act(async () => resolve(permissions))
		expect(updateWorkspaceBranding).not.toHaveBeenCalled()
		expect(toast.success).not.toHaveBeenCalled()
	})
	it('does not reuse a previous workspace caption while the new workspace loads', async () => {
		branding = {
			displayName: 'Север',
			version: 1,
			updatedAt: '2026-09-07T10:00:00.000Z'
		}
		const view = await mount()
		vi.mocked(getWorkspaceBranding).mockReturnValue(new Promise(() => {}))
		workspace = { ...workspace, workspaceId: anotherId }
		view.rerender(<App />)
		expect(screen.queryByDisplayValue('Север')).toBeNull()
		expect(screen.queryByText('Север')).toBeNull()
	})
})
