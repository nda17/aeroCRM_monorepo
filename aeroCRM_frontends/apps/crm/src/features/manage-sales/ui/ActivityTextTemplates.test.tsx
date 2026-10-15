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
	PendingCommandProvider,
	commandOwner
} from '@/shared/lib/pending-command'
import { DirtyFormProvider } from '@/shared/lib/dirty-form'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import type { ActivityTextTemplatesSnapshot } from '@/entities/sales/model/activity-text-templates.contract'
import { useActivityTextTemplates } from '@/entities/sales/model/use-activity-text-templates'
import { saveActivityTextTemplates } from '@/entities/sales/api/activity-text-templates.api'
import { ActivityTextTemplatePicker } from './ActivityTextTemplatePicker'
import { ActivityTextTemplatesDrawer } from './ActivityTextTemplatesDrawer'

vi.mock('@/entities/sales/model/use-activity-text-templates', () => ({
	useActivityTextTemplates: vi.fn()
}))
vi.mock('@/entities/sales/api/activity-text-templates.api', () => ({
	saveActivityTextTemplates: vi.fn()
}))

const workspaceId = 'b531b13e-3624-4ec5-b66d-f24373b0b374'
const owner = 'administrator'
const revision = 4
const active = {
	id: 'd6249dca-c181-4ed8-8f31-83c263a7459e',
	title: 'Звонок',
	body: 'Обсудили условия',
	archived: false
}
const archived = {
	id: 'd6249dca-c181-4ed8-8f31-83c263a7459f',
	title: 'Старое',
	body: 'Архивный текст',
	archived: true
}
let client: QueryClient
let snapshot: ActivityTextTemplatesSnapshot
let state: ReturnType<typeof useActivityTextTemplates>

const view = (children: React.ReactNode) => (
	<QueryClientProvider client={client}>
		<PendingCommandProvider owner={commandOwner(owner, revision)}>
			<DirtyFormProvider owner={commandOwner(owner, revision)}>
				{children}
			</DirtyFormProvider>
		</PendingCommandProvider>
	</QueryClientProvider>
)

beforeEach(() => {
	vi.clearAllMocks()
	HTMLDialogElement.prototype.showModal = function () {
		this.open = true
	}
	HTMLDialogElement.prototype.close = function () {
		this.open = false
	}
	client = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	snapshot = {
		schemaVersion: 1,
		workspaceId,
		version: 3,
		templates: [{ ...active }, { ...archived }]
	}
	state = {
		context: {
			key: [owner, workspaceId],
			scopeKey: owner,
			workspace: { workspaceId },
			session: { userId: owner, accessToken: 'test-token' },
			sessionRevision: revision,
			canRead: true,
			canWrite: true,
			current: () => true,
			authorize: async () => 'test-token',
			permissions: { isError: false }
		} as never,
		query: {
			data: snapshot,
			isError: false,
			refetch: vi
				.fn()
				.mockResolvedValue({ data: snapshot, isError: false })
		} as never,
		canManage: true,
		data: snapshot
	} as never
	vi.mocked(useActivityTextTemplates).mockImplementation(() => state)
})

afterEach(() => {
	cleanup()
	client.clear()
})

describe('activity text template UI', () => {
	it('appends the selected active template and refuses to truncate overlong drafts', () => {
		const onInsert = vi.fn()
		const { rerender } = render(
			view(
				<ActivityTextTemplatePicker
					value="Ручной текст"
					onInsert={onInsert}
					disabled={false}
				/>
			)
		)
		const picker = screen.getByRole('combobox', {
			name: 'Текстовый шаблон'
		})
		expect(picker.textContent).toContain('Звонок')
		expect(picker.textContent).not.toContain('Старое')
		fireEvent.change(picker, { target: { value: active.id } })
		fireEvent.click(
			screen.getByRole('button', { name: 'Добавить в текст' })
		)
		expect(onInsert).toHaveBeenCalledWith(
			'Ручной текст\n\nОбсудили условия'
		)

		onInsert.mockClear()
		rerender(
			view(
				<ActivityTextTemplatePicker
					value={'x'.repeat(3990)}
					onInsert={onInsert}
					disabled={false}
				/>
			)
		)
		fireEvent.change(
			screen.getByRole('combobox', { name: 'Текстовый шаблон' }),
			{ target: { value: active.id } }
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Добавить в текст' })
		)
		expect(onInsert).not.toHaveBeenCalled()
		expect(screen.getByRole('alert').textContent).toMatch(/превышает 4000/)
	})

	it('leaves the manual activity editor available when the template query fails', () => {
		state = {
			...state,
			query: { ...state.query, isError: true }
		} as never
		vi.mocked(useActivityTextTemplates).mockImplementation(() => state)
		render(
			view(
				<>
					<textarea aria-label="Ручная запись" defaultValue="Черновик" />
					<ActivityTextTemplatePicker
						value="Черновик"
						onInsert={vi.fn()}
						disabled={false}
					/>
				</>
			)
		)
		expect(
			(
				screen.getByRole('textbox', {
					name: 'Ручная запись'
				}) as HTMLTextAreaElement
			).value
		).toBe('Черновик')
		expect(
			screen.getByRole('button', { name: 'Повторить загрузку шаблонов' })
		).toBeTruthy()
	})

	it('retries an uncertain save with the same command id and normalized payload', async () => {
		vi.mocked(saveActivityTextTemplates)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', 'Неизвестный результат')
			)
			.mockImplementationOnce(async (_token, command) => ({
				schemaVersion: 1,
				workspaceId,
				version: command.expectedVersion + 1,
				templates: command.templates.map(item => ({
					...item,
					title: item.title.trim(),
					body: item.body.replace(/\r\n/g, '\n').trim()
				}))
			}))
		const newerCached = { ...snapshot, version: 8 }
		client.setQueryData(
			['crm-activity-text-templates', owner, workspaceId],
			newerCached
		)
		render(view(<ActivityTextTemplatesDrawer onClose={vi.fn()} />))
		const title = screen.getByRole('textbox', {
			name: 'Название шаблона 1'
		})
		fireEvent.change(title, {
			target: { value: '  Обновлённый звонок  ' }
		})
		fireEvent.click(
			screen.getByRole('button', { name: 'Сохранить шаблоны' })
		)
		await screen.findByRole('button', { name: 'Проверить сохранение' })
		const sent = vi.mocked(saveActivityTextTemplates).mock.calls[0][1]
		expect(sent.expectedVersion).toBe(3)
		fireEvent.click(
			screen.getByRole('button', { name: 'Проверить сохранение' })
		)
		await waitFor(() =>
			expect(saveActivityTextTemplates).toHaveBeenCalledTimes(2)
		)
		expect(vi.mocked(saveActivityTextTemplates).mock.calls[1][1]).toBe(
			sent
		)
		await waitFor(() =>
			expect(
				screen.getByRole('button', { name: 'Сохранить шаблоны' })
			).toHaveProperty('disabled', true)
		)
		expect(
			client.getQueryData([
				'crm-activity-text-templates',
				owner,
				workspaceId
			])
		).toEqual(newerCached)
	})

	it('blocks saving a dirty draft after the query observes a newer version', async () => {
		const { rerender } = render(
			view(<ActivityTextTemplatesDrawer onClose={vi.fn()} />)
		)
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Название шаблона 1' }),
			{
				target: { value: 'Локальный вариант' }
			}
		)
		state = {
			...state,
			query: {
				...state.query,
				data: { ...snapshot, version: snapshot.version + 1 }
			}
		} as never
		vi.mocked(useActivityTextTemplates).mockImplementation(() => state)
		act(() =>
			rerender(view(<ActivityTextTemplatesDrawer onClose={vi.fn()} />))
		)
		await screen.findByText(/изменились/)
		expect(
			screen.getByRole('button', { name: 'Сохранить шаблоны' })
		).toHaveProperty('disabled', true)
		expect(saveActivityTextTemplates).not.toHaveBeenCalled()
	})

	it('locks edits during a confirmed refresh and applies its result only after it settles', async () => {
		let resolve!: (result: {
			data: ActivityTextTemplatesSnapshot
			isError: false
		}) => void
		const query = {
			...state.query,
			refetch: vi.fn(
				() =>
					new Promise<{
						data: ActivityTextTemplatesSnapshot
						isError: false
					}>(done => {
						resolve = done
					})
			)
		}
		state = { ...state, query } as never
		vi.mocked(useActivityTextTemplates).mockImplementation(() => state)
		render(view(<ActivityTextTemplatesDrawer onClose={vi.fn()} />))
		const title = screen.getByRole('textbox', {
			name: 'Название шаблона 1'
		})
		fireEvent.change(title, { target: { value: 'Локальная правка' } })
		fireEvent.click(
			screen.getByRole('button', { name: 'Загрузить актуальные' })
		)
		fireEvent.click(
			await screen.findByRole('button', { name: 'Отбросить изменения' })
		)
		await waitFor(() => expect(query.refetch).toHaveBeenCalledOnce())
		expect(title).toHaveProperty('disabled', true)
		fireEvent.change(title, { target: { value: 'Правка во время GET' } })
		expect((title as HTMLInputElement).value).toBe('Локальная правка')
		const fresh = {
			...snapshot,
			version: 4,
			templates: [{ ...active, title: 'Свежее значение' }, { ...archived }]
		}
		await act(async () => {
			resolve({ data: fresh, isError: false })
		})
		await waitFor(() =>
			expect(
				screen.getByRole('textbox', { name: 'Название шаблона 1' })
			).toHaveProperty('disabled', false)
		)
		expect(
			(
				screen.getByRole('textbox', {
					name: 'Название шаблона 1'
				}) as HTMLInputElement
			).value
		).toBe('Свежее значение')
	})
})
