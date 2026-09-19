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
	getCrmPermissions,
	type CrmPermissions
} from '@/entities/crm-access'
import { useSessionStore } from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { downloadFile } from '@/shared/lib/download-file'
import { prepareRecordExport } from '../api/export.api'
import { ExportRecordsControl } from './ExportRecordsControl'

vi.mock('@/entities/crm-access', async original => ({
	...(await original<typeof import('@/entities/crm-access')>()),
	getCrmPermissions: vi.fn(),
	useCrmWorkspaceAccess: () => ({
		workspaceId: target,
		canWrite: initial.state !== 'READ_ONLY'
	}),
	useCrmPermissions: (
		workspaceId: string,
		session: { userId: string },
		revision: number
	) =>
		useQuery({
			queryKey: [
				'crm-permissions',
				workspaceId,
				session?.userId,
				revision
			],
			initialData: { ...initial, workspaceId, subject: session?.userId },
			queryFn: async () => initial,
			enabled: false
		})
}))
vi.mock('../api/export.api', () => ({ prepareRecordExport: vi.fn() }))
vi.mock('@/shared/lib/download-file', () => ({ downloadFile: vi.fn() }))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
const workspaceId = '11111111-1111-4111-8111-111111111111'
let target = workspaceId
let initial: CrmPermissions
let client: QueryClient
const result = {
	bytes: new Uint8Array([123, 125]),
	metadata: {
		entity: 'contacts' as const,
		format: 'json' as const,
		workspaceId,
		filename: 'wincrm-contacts.json',
		mediaType: 'application/json; charset=utf-8',
		bytes: 2,
		rowCount: 0,
		snapshotAt: '2026-09-05T00:00:00.000Z'
	}
}
const view = (visible = true) => (
	<QueryClientProvider client={client}>
		{visible ? (
			<ExportRecordsControl entity="contacts" />
		) : (
			<div>Other screen</div>
		)}
	</QueryClientProvider>
)
const open = () =>
	fireEvent.click(screen.getByRole('button', { name: 'Экспорт' }))
const start = () =>
	fireEvent.click(screen.getByRole('button', { name: 'Скачать файл' }))
beforeEach(() => {
	vi.resetAllMocks()
	target = workspaceId
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
	initial = {
		schemaVersion: 1,
		workspaceId,
		subject: 'owner',
		role: 'OWNER',
		state: 'READ_ONLY',
		dataScope: 'ALL',
		teamIds: [],
		permissions: ['customers:read', 'customers:export']
	}
	useSessionStore.setState({
		status: 'authenticated',
		session: { userId: 'owner', accessToken: 'token' },
		sessionRevision: 1
	})
	vi.mocked(getCrmPermissions).mockImplementation(async () => ({
		...initial,
		workspaceId: target
	}))
	vi.mocked(prepareRecordExport).mockResolvedValue(result)
})
afterEach(() => {
	cleanup()
	client.clear()
})
describe('OWNER exports', () => {
	it('allows READ_ONLY OWNER and downloads only after two fresh authorizations', async () => {
		render(view())
		open()
		start()
		await screen.findByText(/Проверено записей: 0/)
		expect(getCrmPermissions).toHaveBeenCalledTimes(2)
		expect(prepareRecordExport).toHaveBeenCalledWith(
			'token',
			'contacts',
			workspaceId,
			'owner',
			'json',
			expect.any(AbortSignal),
			2
		)
		expect(downloadFile).toHaveBeenCalledWith(
			result.bytes,
			result.metadata.filename,
			result.metadata.mediaType
		)
		expect(client.getQueryCache().findAll()).toHaveLength(1)
		expect(
			JSON.stringify(
				client.getQueryData(['crm-permissions', workspaceId, 'owner', 1])
			)
		).not.toContain('wincrm-contacts')
	})
	it.each(['CRM_ADMIN', 'TEAM_LEAD', 'MANAGER', 'ANALYST'] as const)(
		'keeps the export action disabled for %s',
		role => {
			initial = { ...initial, role }
			render(view())
			expect(
				screen.getByRole('button', { name: 'Экспорт' })
			).toHaveProperty('disabled', true)
			expect(prepareRecordExport).not.toHaveBeenCalled()
		}
	)
	it('rejects missing export permission without blocking the rest of the screen', () => {
		initial = { ...initial, permissions: ['customers:read'] }
		render(
			<QueryClientProvider client={client}>
				<p>Readable content</p>
				<ExportRecordsControl entity="contacts" />
			</QueryClientProvider>
		)
		expect(screen.getByText('Readable content')).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Экспорт' })).toHaveProperty(
			'disabled',
			true
		)
	})
	it('supports CSV with an explicit warning about spreadsheet conversion', async () => {
		render(view())
		open()
		fireEvent.change(screen.getByLabelText('Формат файла'), {
			target: { value: 'csv' }
		})
		expect(screen.getByText(/Обратный импорт/i)).toBeTruthy()
		start()
		await waitFor(() =>
			expect(prepareRecordExport).toHaveBeenCalledWith(
				'token',
				'contacts',
				workspaceId,
				'owner',
				'csv',
				expect.any(AbortSignal),
				2
			)
		)
	})
	it('does not save the body if the final authorization is denied', async () => {
		vi.mocked(getCrmPermissions)
			.mockResolvedValueOnce(initial)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('forbidden', 'Export denied')
			)
		render(view())
		open()
		start()
		await screen.findByText('Export denied')
		expect(downloadFile).not.toHaveBeenCalled()
	})
	it('publishes narrowed permissions and does not retain a file or silently logout', async () => {
		vi.mocked(getCrmPermissions).mockResolvedValue({
			...initial,
			role: 'MANAGER',
			dataScope: 'OWN',
			permissions: ['customers:read']
		})
		render(view())
		open()
		start()
		await waitFor(() =>
			expect(
				screen.getByRole('button', { name: 'Экспорт' })
			).toHaveProperty('disabled', true)
		)
		expect(
			client.getQueryData(['crm-permissions', workspaceId, 'owner', 1])
		).toMatchObject({ dataScope: 'OWN' })
		expect(prepareRecordExport).not.toHaveBeenCalled()
		expect(useSessionStore.getState().status).toBe('authenticated')
	})
	it.each(['unmount', 'workspace', 'session', 'cancel'] as const)(
		'aborts and ignores late download bytes after %s',
		async boundary => {
			let resolve!: (value: typeof result) => void
			vi.mocked(prepareRecordExport).mockImplementationOnce(
				() =>
					new Promise(finish => {
						resolve = finish
					})
			)
			const rendered = render(view())
			open()
			start()
			await waitFor(() =>
				expect(prepareRecordExport).toHaveBeenCalledTimes(1)
			)
			const signal = vi.mocked(prepareRecordExport).mock.calls[0][5]
			if (boundary === 'unmount') rendered.rerender(view(false))
			else if (boundary === 'workspace') {
				target = '22222222-2222-4222-8222-222222222222'
				rendered.rerender(view())
			} else if (boundary === 'session')
				act(() =>
					useSessionStore.getState().setAuthenticated({
						userId: 'other',
						accessToken: 'other-token'
					})
				)
			else
				fireEvent.click(screen.getByRole('button', { name: 'Отменить' }))
			expect(signal.aborted).toBe(true)
			await act(async () => resolve(result))
			expect(downloadFile).not.toHaveBeenCalled()
			expect(toast.success).not.toHaveBeenCalled()
		}
	)
	it('retries a failed read as a new GET without idempotency mutations or session reset', async () => {
		vi.mocked(prepareRecordExport).mockRejectedValueOnce(
			new AuthenticatedApiError('unauthorized', 'Unauthorized export')
		)
		render(view())
		open()
		start()
		await screen.findByText('Unauthorized export')
		expect(useSessionStore.getState().status).toBe('authenticated')
		fireEvent.click(
			screen.getByRole('button', { name: 'Повторить экспорт' })
		)
		await screen.findByText(/Проверено записей: 0/)
		expect(prepareRecordExport).toHaveBeenCalledTimes(2)
		expect(downloadFile).toHaveBeenCalledTimes(1)
	})
})
