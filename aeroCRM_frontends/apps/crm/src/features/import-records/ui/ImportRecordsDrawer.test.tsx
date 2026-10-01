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
	crmPermissionScope,
	getCrmPermissions,
	type CrmPermissions
} from '@/entities/crm-access'
import {
	applyCrmImport,
	getCrmImport,
	inspectCrmImport,
	previewCrmImport
} from '@/entities/crm-import/api/import.api'
import type {
	ImportPreview,
	ImportResult
} from '@/entities/crm-import/model/import.contract'
import { useSessionStore } from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { ImportRecordsDrawer } from './ImportRecordsDrawer'

vi.mock('@/entities/crm-access', async original => ({
	...(await original<typeof import('@/entities/crm-access')>()),
	getCrmPermissions: vi.fn()
}))
vi.mock('@/entities/crm-import/api/import.api', async original => ({
	...(await original<
		typeof import('@/entities/crm-import/api/import.api')
	>()),
	applyCrmImport: vi.fn(),
	getCrmImport: vi.fn(),
	inspectCrmImport: vi.fn(),
	previewCrmImport: vi.fn()
}))

const workspaceId = '11111111-1111-4111-8111-111111111111'
const userId = 'user-import-test'
const previewId = '22222222-2222-4222-8222-222222222222'
const commandId = '33333333-3333-4333-8333-333333333333'
const permissions: CrmPermissions = {
	schemaVersion: 1,
	workspaceId,
	subject: userId,
	role: 'OWNER',
	state: 'ACTIVE',
	dataScope: 'ALL',
	teamIds: [],
	permissions: ['customers:read', 'customers:write']
}
const headers = ['Name', 'E-mail 1 - Value', 'Phone 1 - Value']
const importedPreview = (overrides: Partial<ImportPreview> = {}) =>
	({
		schemaVersion: 1,
		workspaceId,
		previewId,
		entity: 'contacts',
		sourceKey: 'google-personal',
		expiresAt: '2030-10-01T00:00:00.000Z',
		rows: [
			{
				row: 2,
				sourceId: 'google-1',
				action: 'CREATE',
				targetId: null,
				expectedVersion: null,
				values: {
					name: 'Ada Lovelace',
					email: 'ada@example.test',
					phone: '+79990000000'
				},
				errors: [],
				warnings: [],
				candidates: []
			}
		],
		summary: { create: 1, link: 0, skip: 0, error: 0 },
		result: null,
		...overrides
	}) as ImportPreview
const appliedResult = (): ImportResult => ({
	schemaVersion: 1,
	previewId,
	commandId,
	entity: 'contacts',
	status: 'APPLIED',
	created: 1,
	linked: 0,
	skipped: 0,
	items: [
		{
			row: 2,
			sourceId: 'google-1',
			entityId: '44444444-4444-4444-8444-444444444444',
			action: 'CREATE'
		}
	]
})
let client: QueryClient
const onClose = vi.fn()
const storageKey = `crm:import-receipt:v1:${workspaceId}:${userId}:contacts`
let lockTail: Promise<void>

const drawer = (canWrite = true, access = permissions) => (
	<QueryClientProvider client={client}>
		<ImportRecordsDrawer
			entity="contacts"
			workspaceId={workspaceId}
			session={{ userId, accessToken: 'access-token' }}
			revision={1}
			scope={crmPermissionScope(access)}
			canWrite={canWrite}
			onClose={onClose}
		/>
	</QueryClientProvider>
)
const file = () =>
	new File(
		[
			'Name,E-mail 1 - Value,Phone 1 - Value\nAda Lovelace,ada@example.test,+79990000000'
		],
		'google-contacts.csv',
		{ type: 'text/csv' }
	)
const selectFile = () =>
	fireEvent.change(screen.getByLabelText('Файл контактов'), {
		target: { files: [file()] }
	})
const inspectResponse = {
	schemaVersion: 1 as const,
	entity: 'contacts' as const,
	fileDigest: 'a'.repeat(64),
	sheets: [{ name: 'CSV', headers, rowCount: 1, sample: [] }]
}
const previewFile = async () => {
	selectFile()
	await screen.findByText(/google-contacts\.csv/)
	fireEvent.change(screen.getByLabelText('Источник переноса'), {
		target: { value: 'google-personal' }
	})
	fireEvent.click(
		screen.getByRole('button', { name: 'Проверить весь файл' })
	)
}
const confirmAndApply = async () => {
	await screen.findByRole('region', { name: 'Предпросмотр импорта' })
	fireEvent.click(screen.getByRole('checkbox'))
	fireEvent.click(
		screen.getByRole('button', { name: 'Импортировать весь пакет' })
	)
}

beforeEach(() => {
	vi.resetAllMocks()
	window.localStorage.clear()
	lockTail = Promise.resolve()
	Object.defineProperty(navigator, 'onLine', {
		configurable: true,
		value: true
	})
	Object.defineProperty(navigator, 'locks', {
		configurable: true,
		value: {
			request: vi.fn(async (_name, _options, callback) => {
				const previous = lockTail
				let release = () => {}
				lockTail = new Promise<void>(resolve => {
					release = resolve
				})
				await previous
				try {
					return await callback()
				} finally {
					release()
				}
			})
		}
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
		session: { userId, accessToken: 'access-token' },
		sessionRevision: 1,
		errorMessage: null
	})
	vi.mocked(getCrmPermissions).mockResolvedValue(permissions)
	vi.mocked(inspectCrmImport).mockResolvedValue(inspectResponse)
	vi.mocked(previewCrmImport).mockResolvedValue(importedPreview())
	vi.mocked(getCrmImport).mockResolvedValue(importedPreview())
	vi.mocked(applyCrmImport).mockImplementation(
		async (_token, _entity, input) => ({
			...appliedResult(),
			commandId: input.commandId
		})
	)
})

afterEach(() => {
	cleanup()
	client.clear()
})

describe('ImportRecordsDrawer', () => {
	it('maps Google Contacts aliases and blocks the whole batch when preview contains an error', async () => {
		vi.mocked(previewCrmImport).mockResolvedValue(
			importedPreview({
				rows: [
					{
						...importedPreview().rows[0],
						action: 'ERROR',
						errors: ['Телефон имеет неверный формат']
					}
				],
				summary: { create: 0, link: 0, skip: 0, error: 1 }
			})
		)
		render(drawer())
		await previewFile()
		expect(
			await screen.findByText('Телефон имеет неверный формат')
		).toBeTruthy()
		expect(previewCrmImport).toHaveBeenCalledWith(
			'access-token',
			expect.objectContaining({
				mapping: {
					name: 'Name',
					email: 'E-mail 1 - Value',
					phone: 'Phone 1 - Value'
				},
				sourceKey: 'google-personal'
			})
		)
		const checkbox = screen.getByRole('checkbox') as HTMLInputElement
		expect(checkbox.disabled).toBe(true)
		expect(
			(
				screen.getByRole('button', {
					name: 'Импортировать весь пакет'
				}) as HTMLButtonElement
			).disabled
		).toBe(true)
		expect(applyCrmImport).not.toHaveBeenCalled()
	})

	it('persists only preview and command IDs after an unknown response and retries that same command after reload', async () => {
		vi.mocked(applyCrmImport)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', 'Ответ сервера неизвестен')
			)
			.mockImplementationOnce(async (_token, _entity, input) => ({
				...appliedResult(),
				commandId: input.commandId
			}))
		render(drawer())
		await previewFile()
		await confirmAndApply()
		await screen.findByRole('region', { name: 'Восстановление импорта' })
		const marker = JSON.parse(
			window.localStorage.getItem(storageKey) || 'null'
		)
		expect(marker).toEqual({ previewId, commandId: expect.any(String) })
		expect(JSON.stringify(marker)).not.toContain('google-contacts.csv')
		expect(JSON.stringify(marker)).not.toContain('ada@example.test')
		const storedCommandId = marker.commandId
		cleanup()
		render(drawer())
		vi.mocked(getCrmImport).mockResolvedValueOnce(importedPreview())
		fireEvent.click(
			screen.getByRole('button', { name: 'Повторить тот же запрос' })
		)
		await screen.findByText('Импорт завершён')
		expect(applyCrmImport).toHaveBeenCalledTimes(2)
		expect(applyCrmImport).toHaveBeenLastCalledWith(
			'access-token',
			'contacts',
			{
				schemaVersion: 1,
				workspaceId,
				previewId,
				commandId: storedCommandId
			}
		)
		await waitFor(() =>
			expect(window.localStorage.getItem(storageKey)).toBeNull()
		)
	})

	it('allows read-only receipt lookup while keeping retry disabled', async () => {
		const readonly = {
			...permissions,
			state: 'READ_ONLY' as const,
			permissions: ['customers:read']
		}
		vi.mocked(getCrmPermissions).mockResolvedValue(readonly)
		window.localStorage.setItem(
			storageKey,
			JSON.stringify({ previewId, commandId })
		)
		render(drawer(false, readonly))
		const retry = screen.getByRole('button', {
			name: 'Повторить тот же запрос'
		})
		expect((retry as HTMLButtonElement).disabled).toBe(true)
		fireEvent.click(
			screen.getByRole('button', { name: 'Проверить результат' })
		)
		await waitFor(() =>
			expect(getCrmImport).toHaveBeenCalledWith(
				'access-token',
				'contacts',
				workspaceId,
				previewId
			)
		)
		expect(applyCrmImport).not.toHaveBeenCalled()
		expect(
			JSON.parse(window.localStorage.getItem(storageKey) || 'null')
		).toEqual({
			previewId,
			commandId
		})
	})

	it('serializes cross-tab marker creation so a second drawer cannot replace the first command', async () => {
		let releaseApply = () => {}
		vi.mocked(applyCrmImport).mockImplementationOnce(
			(_token, _entity, input) =>
				new Promise(resolve => {
					releaseApply = () =>
						resolve({ ...appliedResult(), commandId: input.commandId })
				})
		)
		render(
			<QueryClientProvider client={client}>
				<>
					<ImportRecordsDrawer
						entity="contacts"
						workspaceId={workspaceId}
						session={{ userId, accessToken: 'access-token' }}
						revision={1}
						scope={crmPermissionScope(permissions)}
						canWrite
						onClose={onClose}
					/>
					<ImportRecordsDrawer
						entity="contacts"
						workspaceId={workspaceId}
						session={{ userId, accessToken: 'access-token' }}
						revision={1}
						scope={crmPermissionScope(permissions)}
						canWrite
						onClose={onClose}
					/>
				</>
			</QueryClientProvider>
		)
		const drawers = document.querySelectorAll('dialog')
		const fileInputs = [...drawers].map(
			dialog => dialog.querySelector('input[type="file"]')!
		)
		for (const input of fileInputs)
			fireEvent.change(input, { target: { files: [file()] } })
		await screen.findAllByText(/google-contacts\.csv/)
		const sourceFields = screen.getAllByLabelText('Источник переноса')
		for (const source of sourceFields)
			fireEvent.change(source, { target: { value: 'google-personal' } })
		for (const button of screen.getAllByRole('button', {
			name: 'Проверить весь файл'
		}))
			fireEvent.click(button)
		await screen.findAllByRole('region', { name: 'Предпросмотр импорта' })
		for (const checkbox of screen.getAllByRole('checkbox'))
			fireEvent.click(checkbox)
		const applyButtons = screen.getAllByRole('button', {
			name: 'Импортировать весь пакет'
		})
		fireEvent.click(applyButtons[0])
		await waitFor(() => expect(applyCrmImport).toHaveBeenCalledTimes(1))
		fireEvent.click(applyButtons[1])
		await screen.findByText(/Обнаружен незавершённый импорт/)
		const firstMarker = JSON.parse(
			window.localStorage.getItem(storageKey) || 'null'
		)
		expect(firstMarker).toEqual({
			previewId,
			commandId: expect.any(String)
		})
		releaseApply()
		await screen.findAllByText('Импорт завершён')
	})

	it('clears a rejected expired command only after reading its empty receipt and keeps review data without the file', async () => {
		vi.mocked(applyCrmImport).mockRejectedValueOnce(
			new AuthenticatedApiError('conflict', 'Предпросмотр истёк')
		)
		vi.mocked(getCrmImport).mockResolvedValue(importedPreview())
		window.localStorage.setItem(
			storageKey,
			JSON.stringify({ previewId, commandId })
		)
		render(drawer())
		fireEvent.click(
			screen.getByRole('button', { name: 'Повторить тот же запрос' })
		)
		await screen.findByText(
			'Настройки изменились. Снова нажмите «Проверить весь файл».'
		)
		await waitFor(() =>
			expect(window.localStorage.getItem(storageKey)).toBeNull()
		)
		expect(screen.getByDisplayValue('google-personal')).toBeTruthy()
		expect(screen.queryByText('google-contacts.csv')).toBeNull()
		expect(getCrmImport).toHaveBeenCalledTimes(2)
		expect(applyCrmImport).toHaveBeenCalledTimes(1)
	})
})
