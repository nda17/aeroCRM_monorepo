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
import { resetSessionStore, useSessionStore } from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { downloadFile } from '@/shared/lib/download-file'
import { prepareRecordExport } from '../api/export.api'
import { prepareWorkdayExport } from '../api/workday-export.api'
import {
	date,
	otherId,
	workspaceId
} from '../model/workday-export.test-fixtures'
import { WorkdayExportControl } from './ExportRecordsControl'

let target = workspaceId
let initial: CrmPermissions
let client: QueryClient
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
vi.mock('../api/workday-export.api', () => ({
	prepareWorkdayExport: vi.fn()
}))
vi.mock('@/shared/lib/download-file', () => ({ downloadFile: vi.fn() }))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
const result = {
	bytes: new Uint8Array([123, 125]),
	metadata: {
		schemaVersion: 2 as const,
		entity: 'tasks' as const,
		format: 'json' as const,
		workspaceId,
		filename: 'wincrm-tasks-v2.json',
		mediaType: 'application/json; charset=utf-8',
		bytes: 2,
		rowCount: 0,
		snapshotAt: date
	}
}
const view = (visible = true, disabled = false) => (
	<QueryClientProvider client={client}>
		{visible ? (
			<WorkdayExportControl disabled={disabled} />
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
	resetSessionStore()
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
		permissions: ['sales:read', 'sales:export']
	}
	useSessionStore
		.getState()
		.setAuthenticated({ userId: 'owner', accessToken: 'captured' })
	vi.mocked(getCrmPermissions).mockImplementation(async () => ({
		...initial,
		workspaceId: target
	}))
	vi.mocked(prepareWorkdayExport).mockResolvedValue(result)
})
afterEach(() => {
	cleanup()
	client.clear()
	resetSessionStore()
})

describe('Workday v2 export UI', () => {
	it('allows READ_ONLY OWNER, explains unfiltered full snapshot and authorizes before and after download', async () => {
		render(view())
		open()
		expect(
			screen.getByText(
				/выбранные период, статус и фильтры «Планировщика» не применяются/
			)
		).toBeTruthy()
		expect(
			screen.getByText(
				/Самостоятельные задачи и задачи доступных неархивных сделок/
			)
		).toBeTruthy()
		start()
		await screen.findByText(/Проверено записей: 0/)
		expect(getCrmPermissions).toHaveBeenCalledTimes(2)
		expect(prepareWorkdayExport).toHaveBeenCalledExactlyOnceWith(
			'captured',
			workspaceId,
			'owner',
			'json',
			expect.any(AbortSignal)
		)
		expect(prepareRecordExport).not.toHaveBeenCalled()
		expect(downloadFile).toHaveBeenCalledExactlyOnceWith(
			result.bytes,
			result.metadata.filename,
			result.metadata.mediaType
		)
		expect(client.getQueryCache().findAll()).toHaveLength(1)
		expect(
			JSON.stringify(
				client.getQueryData(['crm-permissions', workspaceId, 'owner', 1])
			)
		).not.toContain('wincrm-tasks')
	})
	it.each(['CRM_ADMIN', 'TEAM_LEAD', 'MANAGER', 'ANALYST'] as const)(
		'does not offer export to %s',
		role => {
			initial.role = role
			render(view())
			expect(
				screen.getByRole('button', { name: 'Экспорт' })
			).toHaveProperty('disabled', true)
			expect(prepareWorkdayExport).not.toHaveBeenCalled()
		}
	)
	it.each(['sales:read', 'sales:export'])(
		'requires missing %s',
		removed => {
			initial.permissions = initial.permissions.filter(
				permission => permission !== removed
			)
			render(view())
			expect(
				screen.getByRole('button', { name: 'Экспорт' })
			).toHaveProperty('disabled', true)
		}
	)
	it('respects the caller disabled gate', () => {
		render(view(true, true))
		expect(screen.getByRole('button', { name: 'Экспорт' })).toHaveProperty(
			'disabled',
			true
		)
	})
	it('supports CSV using v2 and keeps the spreadsheet conversion warning', async () => {
		render(view())
		open()
		fireEvent.change(screen.getByLabelText('Формат файла'), {
			target: { value: 'csv' }
		})
		expect(screen.getByText(/обратный импорт/i)).toBeTruthy()
		start()
		await waitFor(() =>
			expect(prepareWorkdayExport).toHaveBeenCalledWith(
				'captured',
				workspaceId,
				'owner',
				'csv',
				expect.any(AbortSignal)
			)
		)
	})
	it('allows ACTIVE to READ_ONLY transition when export authority and data scope are unchanged', async () => {
		initial = {
			...initial,
			state: 'ACTIVE',
			permissions: ['sales:read', 'sales:write', 'sales:export']
		}
		vi.mocked(getCrmPermissions)
			.mockResolvedValueOnce(initial)
			.mockResolvedValueOnce({
				...initial,
				state: 'READ_ONLY',
				permissions: ['sales:read', 'sales:export']
			})
		render(view())
		open()
		start()
		await screen.findByText(/Проверено записей: 0/)
		expect(downloadFile).toHaveBeenCalledTimes(1)
	})
	it('rejects permission revocation after bytes arrive', async () => {
		vi.mocked(getCrmPermissions)
			.mockResolvedValueOnce(initial)
			.mockResolvedValueOnce({ ...initial, permissions: ['sales:read'] })
		render(view())
		open()
		start()
		await waitFor(() =>
			expect(
				screen.getByRole('button', { name: 'Экспорт' })
			).toHaveProperty('disabled', true)
		)
		expect(downloadFile).not.toHaveBeenCalled()
		expect(toast.success).not.toHaveBeenCalled()
	})
	it('rejects final authority failure instead of saving a prepared file', async () => {
		vi.mocked(getCrmPermissions)
			.mockResolvedValueOnce(initial)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('forbidden', 'Export revoked')
			)
		render(view())
		open()
		start()
		await screen.findByText('Export revoked')
		expect(downloadFile).not.toHaveBeenCalled()
	})
	it.each([
		'unmount',
		'workspace',
		'actor',
		'same-actor-session',
		'cancel',
		'offline'
	] as const)(
		'aborts bytes and suppresses save after %s',
		async boundary => {
			let resolve!: (value: typeof result) => void
			vi.mocked(prepareWorkdayExport).mockImplementationOnce(
				() =>
					new Promise(done => {
						resolve = done
					})
			)
			const rendered = render(view())
			open()
			start()
			await waitFor(() =>
				expect(prepareWorkdayExport).toHaveBeenCalledTimes(1)
			)
			const signal = vi.mocked(prepareWorkdayExport).mock.calls[0][4]
			if (boundary === 'unmount') rendered.rerender(view(false))
			else if (boundary === 'workspace') {
				target = otherId
				rendered.rerender(view())
			} else if (boundary === 'actor' || boundary === 'same-actor-session')
				act(() =>
					useSessionStore.getState().setAuthenticated({
						userId: boundary === 'actor' ? 'other' : 'owner',
						accessToken: 'new-token'
					})
				)
			else if (boundary === 'offline')
				act(() => {
					Object.defineProperty(navigator, 'onLine', {
						configurable: true,
						value: false
					})
					window.dispatchEvent(new Event('offline'))
				})
			else
				fireEvent.click(screen.getByRole('button', { name: 'Отменить' }))
			expect(signal.aborted).toBe(true)
			await act(async () => resolve(result))
			expect(downloadFile).not.toHaveBeenCalled()
			expect(toast.success).not.toHaveBeenCalled()
		}
	)
	it('retries export failures as reads without mutation UUID or silent logout', async () => {
		vi.mocked(prepareWorkdayExport).mockRejectedValueOnce(
			new AuthenticatedApiError('temporary', 'Invalid export')
		)
		render(view())
		open()
		start()
		await screen.findByText('Invalid export')
		expect(downloadFile).not.toHaveBeenCalled()
		fireEvent.click(
			screen.getByRole('button', { name: 'Повторить экспорт' })
		)
		await screen.findByText(/Проверено записей: 0/)
		expect(prepareWorkdayExport).toHaveBeenCalledTimes(2)
		expect(useSessionStore.getState().status).toBe('authenticated')
	})
})
