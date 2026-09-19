import {
	QueryClient,
	QueryClientProvider,
	useQuery
} from '@tanstack/react-query'
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
	crmPermissionScope,
	getCrmPermissions,
	type CrmPermissions
} from '@/entities/crm-access'
import { importInboxCsv } from '@/entities/intake'
import { listTeamOptions } from '@/entities/crm-team'
import { useSessionStore } from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import {
	commandOwner,
	PendingCommandProvider
} from '@/shared/lib/pending-command'
import type { IntakeAccess } from '../model/use-intake-access'
import { CsvImportDrawer } from './CsvImportDrawer'

vi.mock('@/entities/crm-access', async original => ({
	...(await original<typeof import('@/entities/crm-access')>()),
	getCrmPermissions: vi.fn()
}))
vi.mock('@/entities/intake', async original => ({
	...(await original<typeof import('@/entities/intake')>()),
	importInboxCsv: vi.fn()
}))
vi.mock('@/entities/crm-team/api/team.api', async original => ({
	...(await original<typeof import('@/entities/crm-team/api/team.api')>()),
	listTeamOptions: vi.fn()
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
const workspaceId = '11111111-1111-4111-8111-111111111111'
const secondWorkspace = '22222222-2222-4222-8222-222222222222'
const permissions: CrmPermissions = {
	schemaVersion: 1,
	workspaceId,
	subject: 'owner',
	role: 'OWNER',
	state: 'ACTIVE',
	dataScope: 'ALL',
	teamIds: [],
	permissions: ['intake:read', 'intake:write']
}
const csv = 'title,name,email\nТема,Иван,ivan@example.com\n'
let client: QueryClient
const onClose = vi.fn()
const onSaved = vi.fn()
const file = (text = csv) => {
	const bytes = new TextEncoder().encode(text)
	const result = new File([bytes], 'private-customer-list.csv', {
		type: 'text/csv'
	})
	Object.defineProperty(result, 'arrayBuffer', {
		configurable: true,
		value: vi.fn(async () => bytes.buffer)
	})
	return result
}
const selectFile = (input = file()) =>
	fireEvent.change(screen.getByLabelText('Файл CSV'), {
		target: { files: [input] }
	})
const confirmFile = async () => {
	selectFile()
	await screen.findByText('Проверено обращений: 1')
}
const submit = () =>
	fireEvent.click(
		screen.getByRole('button', { name: 'Импортировать обращения' })
	)
const TestPanel = ({
	target = workspaceId,
	initial = permissions,
	visible = true,
	online = true
}: {
	target?: string
	initial?: CrmPermissions
	visible?: boolean
	online?: boolean
}) => {
	const { session, sessionRevision } = useSessionStore()
	const query = useQuery({
		queryKey: [
			'crm-permissions',
			target,
			session?.userId,
			sessionRevision
		],
		initialData: {
			...initial,
			workspaceId: target,
			subject: session?.userId ?? 'owner'
		},
		queryFn: async () => initial,
		enabled: false
	})
	const value = query.data
	const access = {
		workspaceId: target,
		session,
		revision: sessionRevision,
		scopeKey: crmPermissionScope(value),
		permissions: query,
		online,
		canRead: value.permissions.includes('intake:read'),
		canWrite:
			online &&
			value.state !== 'READ_ONLY' &&
			value.permissions.includes('intake:write'),
		confirmed: true
	} as IntakeAccess
	return (
		<PendingCommandProvider
			owner={commandOwner(session?.userId, sessionRevision)}
		>
			{visible ? (
				<CsvImportDrawer
					access={access}
					onClose={onClose}
					onSaved={onSaved}
				/>
			) : (
				<div>Another screen</div>
			)}
		</PendingCommandProvider>
	)
}
const view = (props: Parameters<typeof TestPanel>[0] = {}) => (
	<QueryClientProvider client={client}>
		<TestPanel {...props} />
	</QueryClientProvider>
)
beforeEach(() => {
	vi.resetAllMocks()
	Object.defineProperty(navigator, 'onLine', {
		configurable: true,
		value: true
	})
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
	useSessionStore.setState({
		status: 'authenticated',
		session: { userId: 'owner', accessToken: 'token' },
		sessionRevision: 1,
		errorMessage: null
	})
	vi.mocked(getCrmPermissions).mockResolvedValue(permissions)
	vi.mocked(importInboxCsv).mockImplementation(
		async (_token, command) => ({
			id: command.commandId,
			workspaceId: command.workspaceId,
			createdBySubject: 'owner',
			teamId: command.teamId,
			label: command.label,
			rowCount: command.rows.length,
			createdAt: '2026-09-05T00:00:00.000Z'
		})
	)
})
afterEach(() => {
	cleanup()
	client.clear()
})
describe('CsvImportDrawer', () => {
	it('previews locally, requires an explicit import, and shows only a confirmed receipt', async () => {
		render(view())
		await confirmFile()
		expect(getCrmPermissions).not.toHaveBeenCalled()
		expect(importInboxCsv).not.toHaveBeenCalled()
		expect(screen.getByText('ivan@example.com')).toBeTruthy()
		submit()
		await screen.findByText('Импорт подтверждён сервером')
		expect(importInboxCsv).toHaveBeenCalledWith(
			'token',
			expect.objectContaining({
				label: 'Импорт CSV',
				teamId: null,
				rows: [
					{
						title: 'Тема',
						name: 'Иван',
						phone: null,
						email: 'ivan@example.com',
						message: null
					}
				]
			}),
			'owner'
		)
		expect(onSaved).toHaveBeenCalledTimes(1)
		expect(
			JSON.stringify(vi.mocked(toast.success).mock.calls)
		).not.toContain('private-customer-list.csv')
		expect(screen.queryByText('ivan@example.com')).toBeNull()
	})
	it('rejects any invalid row and oversized files before a command; oversized files are never read', async () => {
		render(view())
		selectFile(
			file(
				'title,name,email\nТема,Иван,valid@example.com\nТема,Имя,private-invalid\n'
			)
		)
		await screen.findByText('Строка 3: Проверьте email.')
		expect(
			screen.getByRole('button', { name: 'Импортировать обращения' })
		).toHaveProperty('disabled', true)
		const oversized = file()
		Object.defineProperty(oversized, 'size', { value: 1024 * 1024 + 1 })
		selectFile(oversized)
		await screen.findByText('Размер файла не должен превышать 1 МБ.')
		expect(oversized.arrayBuffer).not.toHaveBeenCalled()
		expect(importInboxCsv).not.toHaveBeenCalled()
	})
	it('keeps exact UUID/body after unknown 503, view remount, mutation 401, and successful retry', async () => {
		vi.mocked(importInboxCsv)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', '503 unknown')
			)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('unauthorized', '401 pending')
			)
		const rendered = render(view())
		await confirmFile()
		submit()
		await screen.findByText('503 unknown')
		const original = vi.mocked(importInboxCsv).mock.calls[0][1]
		rendered.rerender(view({ visible: false }))
		rendered.rerender(view())
		expect(screen.queryByText('ivan@example.com')).toBeNull()
		fireEvent.click(
			screen.getByRole('button', { name: 'Повторить тот же импорт' })
		)
		await screen.findByText('401 pending')
		expect(useSessionStore.getState().sessionRevision).toBe(1)
		expect(useSessionStore.getState().status).toBe('authenticated')
		fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
		expect(onClose).not.toHaveBeenCalled()
		fireEvent.click(
			screen.getByRole('button', { name: 'Повторить тот же импорт' })
		)
		await screen.findByText('Импорт подтверждён сервером')
		for (const call of vi.mocked(importInboxCsv).mock.calls)
			expect(call[1]).toEqual(original)
	})
	it('keeps UNKNOWN locked when fresh authorization returns 401, with no extra mutation', async () => {
		vi.mocked(importInboxCsv).mockRejectedValueOnce(
			new AuthenticatedApiError('temporary', '503 unknown')
		)
		render(view())
		await confirmFile()
		submit()
		await screen.findByText('503 unknown')
		vi.mocked(getCrmPermissions).mockRejectedValueOnce(
			new AuthenticatedApiError('unauthorized', 'authorization 401')
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Повторить тот же импорт' })
		)
		await screen.findByText('authorization 401')
		expect(importInboxCsv).toHaveBeenCalledTimes(1)
		expect(useSessionStore.getState().status).toBe('authenticated')
		expect(
			screen.queryByRole('button', { name: 'Импортировать обращения' })
		).toBeNull()
	})
	it.each(['workspace', 'unmount', 'session'] as const)(
		'ignores a late file read after %s changes',
		async boundary => {
			let resolve!: (value: ArrayBuffer) => void
			const pending = file()
			Object.defineProperty(pending, 'arrayBuffer', {
				value: vi.fn(
					() =>
						new Promise<ArrayBuffer>(finish => {
							resolve = finish
						})
				),
				configurable: true
			})
			const rendered = render(view())
			selectFile(pending)
			await screen.findByText('Проверяем файл…')
			if (boundary === 'workspace')
				rendered.rerender(view({ target: secondWorkspace }))
			else if (boundary === 'unmount')
				rendered.rerender(view({ visible: false }))
			else
				act(() =>
					useSessionStore.getState().setAuthenticated({
						userId: 'other',
						accessToken: 'other-token'
					})
				)
			await act(async () => resolve(new TextEncoder().encode(csv).buffer))
			expect(screen.queryByText('ivan@example.com')).toBeNull()
			expect(toast.success).not.toHaveBeenCalled()
			expect(importInboxCsv).not.toHaveBeenCalled()
		}
	)
	it('does not close during file processing or a dispatched request', async () => {
		let resolve!: (value: ArrayBuffer) => void
		const pending = file()
		Object.defineProperty(pending, 'arrayBuffer', {
			value: () =>
				new Promise<ArrayBuffer>(finish => {
					resolve = finish
				}),
			configurable: true
		})
		vi.mocked(importInboxCsv).mockImplementationOnce(
			() => new Promise(() => {})
		)
		render(view())
		selectFile(pending)
		fireEvent.click(screen.getByRole('button', { name: 'Закрыть панель' }))
		expect(onClose).not.toHaveBeenCalled()
		await act(async () => resolve(new TextEncoder().encode(csv).buffer))
		submit()
		await waitFor(() => expect(importInboxCsv).toHaveBeenCalledTimes(1))
		fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
		expect(onClose).not.toHaveBeenCalled()
	})
	it('suppresses a file read error after the drawer unmounts without leaking the path', async () => {
		let reject!: (error: Error) => void
		const pending = file()
		Object.defineProperty(pending, 'arrayBuffer', {
			value: () =>
				new Promise<ArrayBuffer>((_resolve, fail) => {
					reject = fail
				}),
			configurable: true
		})
		const rendered = render(view())
		selectFile(pending)
		await screen.findByText('Проверяем файл…')
		rendered.rerender(view({ visible: false }))
		await act(async () => reject(new Error('/private/customers.csv')))
		expect(toast.error).not.toHaveBeenCalled()
		expect(importInboxCsv).not.toHaveBeenCalled()
	})
	it.each(['READ_ONLY', 'ANALYST', 'offline'] as const)(
		'denies local import actions for %s',
		mode => {
			const initial =
				mode === 'READ_ONLY'
					? {
							...permissions,
							state: 'READ_ONLY' as const,
							permissions: ['intake:read']
						}
					: mode === 'ANALYST'
						? {
								...permissions,
								role: 'ANALYST' as const,
								permissions: ['sales:analytics']
							}
						: permissions
			render(view({ initial, online: mode !== 'offline' }))
			expect(screen.getByText('Импорт недоступен')).toBeTruthy()
			expect(screen.queryByLabelText('Файл CSV')).toBeNull()
			expect(importInboxCsv).not.toHaveBeenCalled()
		}
	)
	it('publishes fresh narrowed permissions before sending and removes the previous ALL preview', async () => {
		vi.mocked(getCrmPermissions).mockResolvedValue({
			...permissions,
			state: 'READ_ONLY',
			permissions: ['intake:read']
		})
		render(view())
		await confirmFile()
		submit()
		await screen.findByText('Импорт недоступен')
		expect(
			client.getQueryData(['crm-permissions', workspaceId, 'owner', 1])
		).toMatchObject({ state: 'READ_ONLY' })
		expect(screen.queryByText('ivan@example.com')).toBeNull()
		expect(importInboxCsv).not.toHaveBeenCalled()
	})
	it('never applies a late permissions response to a different account', async () => {
		let resolve!: (value: CrmPermissions) => void
		vi.mocked(getCrmPermissions).mockImplementationOnce(
			() =>
				new Promise(finish => {
					resolve = finish
				})
		)
		render(view())
		await confirmFile()
		submit()
		await waitFor(() => expect(getCrmPermissions).toHaveBeenCalledTimes(1))
		act(() =>
			useSessionStore
				.getState()
				.setAuthenticated({ userId: 'other', accessToken: 'other-token' })
		)
		await act(async () =>
			resolve({
				...permissions,
				state: 'READ_ONLY',
				permissions: ['intake:read']
			})
		)
		expect(
			client.getQueryData(['crm-permissions', workspaceId, 'owner', 1])
		).toMatchObject({ state: 'ACTIVE' })
		expect(importInboxCsv).not.toHaveBeenCalled()
		expect(toast.error).not.toHaveBeenCalled()
	})
	it('does not restore the old ALL preview after a fresh role narrows to OWN', async () => {
		vi.mocked(getCrmPermissions).mockResolvedValue({
			...permissions,
			role: 'MANAGER',
			dataScope: 'OWN'
		})
		render(view())
		await confirmFile()
		submit()
		await waitFor(() =>
			expect(
				client.getQueryData(['crm-permissions', workspaceId, 'owner', 1])
			).toMatchObject({ role: 'MANAGER', dataScope: 'OWN' })
		)
		await waitFor(() =>
			expect(screen.queryByText('ivan@example.com')).toBeNull()
		)
		expect(importInboxCsv).not.toHaveBeenCalled()
	})
	it('ignores late authorization after a workspace switch without updating the old cache', async () => {
		let resolve!: (value: CrmPermissions) => void
		vi.mocked(getCrmPermissions).mockImplementationOnce(
			() =>
				new Promise(finish => {
					resolve = finish
				})
		)
		const rendered = render(view())
		await confirmFile()
		submit()
		await waitFor(() => expect(getCrmPermissions).toHaveBeenCalledTimes(1))
		rendered.rerender(view({ target: secondWorkspace }))
		await act(async () =>
			resolve({
				...permissions,
				state: 'READ_ONLY',
				permissions: ['intake:read']
			})
		)
		expect(
			client.getQueryData(['crm-permissions', workspaceId, 'owner', 1])
		).toMatchObject({ state: 'ACTIVE' })
		expect(importInboxCsv).not.toHaveBeenCalled()
		expect(toast.error).not.toHaveBeenCalled()
	})
	it('takes team assignment only from current authorized choices', async () => {
		const withTeam = { ...permissions, teamIds: [secondWorkspace] }
		vi.mocked(getCrmPermissions).mockResolvedValue(withTeam)
		const item = { id: secondWorkspace, name: 'Отдел продаж' }
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
		render(view({ initial: withTeam }))
		await confirmFile()
		await screen.findByRole('option', { name: 'Отдел продаж' })
		fireEvent.change(screen.getByLabelText('Отдел импорта'), {
			target: { value: secondWorkspace }
		})
		await waitFor(() =>
			expect(
				(
					screen.getByRole('button', {
						name: 'Импортировать обращения'
					}) as HTMLButtonElement
				).disabled
			).toBe(false)
		)
		submit()
		await screen.findByText('Импорт подтверждён сервером')
		expect(vi.mocked(importInboxCsv).mock.calls[0][1].teamId).toBe(
			secondWorkspace
		)
	})
	it('downloads only the fixed local template without sending a request', async () => {
		const create = vi.fn(() => 'blob:local-template')
		const revoke = vi.fn()
		Object.defineProperty(URL, 'createObjectURL', {
			configurable: true,
			value: create
		})
		Object.defineProperty(URL, 'revokeObjectURL', {
			configurable: true,
			value: revoke
		})
		const click = vi
			.spyOn(HTMLAnchorElement.prototype, 'click')
			.mockImplementation(() => {})
		render(view())
		fireEvent.click(
			screen.getByRole('button', { name: 'Скачать шаблон CSV' })
		)
		expect(create).toHaveBeenCalledWith(expect.any(Blob))
		expect(click.mock.instances[0]).toHaveProperty(
			'download',
			'wincrm-inbox-template.csv'
		)
		await waitFor(() =>
			expect(revoke).toHaveBeenCalledWith('blob:local-template')
		)
		expect(importInboxCsv).not.toHaveBeenCalled()
		click.mockRestore()
	})
})
