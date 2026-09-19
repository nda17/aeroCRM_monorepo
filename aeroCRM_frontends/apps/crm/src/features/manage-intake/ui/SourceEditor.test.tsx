import {
	cleanup,
	fireEvent,
	render as baseRender,
	screen,
	waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mutateIntakeSource, type IntakeSource } from '@/entities/intake'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import type { IntakeAccess } from '../model/use-intake-access'
import { SourceEditor } from './SourceEditor'
import {
	PendingCommandProvider,
	commandOwner
} from '@/shared/lib/pending-command'
import type { ReactElement, PropsWithChildren } from 'react'
const TestProvider = ({ children }: PropsWithChildren) => (
	<PendingCommandProvider owner={commandOwner('owner', 1)}>
		{children}
	</PendingCommandProvider>
)
const render = (ui: ReactElement) =>
	baseRender(ui, { wrapper: TestProvider })

vi.mock('@/entities/intake', () => ({ mutateIntakeSource: vi.fn() }))
vi.mock('@/shared/config/runtime', () => ({
	getRuntimeConfig: () => ({ apiBaseUrl: 'http://localhost:4100/api/v1' })
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
const workspaceId = '11111111-1111-4111-8111-111111111111'
const source: IntakeSource = {
	id: '22222222-2222-4222-8222-222222222222',
	workspaceId,
	name: 'Сайт QA',
	kind: 'API',
	tokenVersion: 1,
	createdBySubject: 'owner',
	teamId: null,
	version: 3,
	revokedAt: null,
	createdAt: '2026-09-05T00:00:00.000Z',
	updatedAt: '2026-09-05T00:00:00.000Z'
}
const access = () =>
	({
		workspaceId,
		sourceManager: true,
		canManageSources: true,
		canRead: true,
		online: true,
		session: { userId: 'owner', accessToken: 'session-token' },
		revision: 1,
		authorize: vi.fn().mockResolvedValue('session-token'),
		permissions: { isSuccess: true, isError: false, refetch: vi.fn() }
	}) as unknown as IntakeAccess

beforeEach(() => {
	vi.clearAllMocks()
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
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: { writeText: vi.fn().mockResolvedValue(undefined) }
	})
	vi.mocked(mutateIntakeSource).mockResolvedValue(source)
})
afterEach(cleanup)

describe('SourceEditor', () => {
	it('creates a named Tilda source through the unchanged API command and only copies the key explicitly', async () => {
		const storage = vi.spyOn(Storage.prototype, 'setItem')
		render(
			<SourceEditor
				access={access()}
				operation="create"
				integration="tilda"
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		expect(
			screen.getByRole('textbox', { name: 'Название источника' })
		).toHaveProperty('value', 'Tilda')
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Название источника' }),
			{ target: { value: '  Сайт QA  ' } }
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Создать источник' })
		)
		await screen.findByRole('button', { name: 'Скопировать ключ' })
		const command = vi.mocked(mutateIntakeSource).mock.calls[0][1]
		if (command.operation !== 'create') throw new Error('Expected create')
		expect(command).toEqual({
			workspaceId,
			commandId: expect.any(String),
			operation: 'create',
			name: 'Сайт QA',
			token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
			teamId: null
		})
		expect(document.body.textContent).not.toContain(command.token)
		expect(document.body.textContent).toContain('X-WinCRM-Source-Token')
		expect(document.body.textContent).not.toContain('Idempotency-Key')
		expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
		fireEvent.click(
			screen.getByRole('button', { name: 'Скопировать адрес Tilda' })
		)
		await waitFor(() =>
			expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
				`http://localhost:4100/api/v1/crm/intake/ingest/${source.id}/tilda`
			)
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Скопировать ключ' })
		)
		await waitFor(() =>
			expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
				command.token
			)
		)
		expect(storage).not.toHaveBeenCalled()
		storage.mockRestore()
	})
	it('rotates a Tilda key using the existing versioned source command and hides setup when access is lost', async () => {
		const current = access()
		const props = {
			source,
			operation: 'rotate' as const,
			integration: 'tilda' as const,
			onClose: vi.fn(),
			onSaved: vi.fn()
		}
		const view = render(<SourceEditor {...props} access={current} />)
		expect(mutateIntakeSource).not.toHaveBeenCalled()
		expect(document.body.textContent).toContain(
			'Обновите ключ в настройках Webhook в Tilda'
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Подтвердить замену ключа' })
		)
		await screen.findByRole('button', { name: 'Скопировать адрес Tilda' })
		const command = vi.mocked(mutateIntakeSource).mock.calls[0][1]
		expect(command).toEqual({
			workspaceId,
			commandId: expect.any(String),
			operation: 'rotate',
			id: source.id,
			expectedVersion: source.version,
			token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)
		})
		if (command.operation !== 'rotate') throw new Error('Expected rotate')
		fireEvent.click(screen.getByRole('button', { name: 'Показать ключ' }))
		expect(document.body.textContent).toContain(command.token)
		view.rerender(
			<SourceEditor
				{...props}
				access={{
					...current,
					sourceManager: false,
					canManageSources: false
				}}
			/>
		)
		expect(document.body.textContent).not.toContain(command.token)
		expect(screen.queryByLabelText('Адрес Webhook для Tilda')).toBeNull()
	})
	it('recovers the original private key after a complete editor remount, even with an empty new form', async () => {
		vi.mocked(mutateIntakeSource)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', 'Unknown')
			)
			.mockResolvedValueOnce(source)
		const props = {
			access: access(),
			operation: 'create' as const,
			onClose: vi.fn(),
			onSaved: vi.fn()
		}
		const view = render(<SourceEditor {...props} />)
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Название источника' }),
			{ target: { value: 'Первоначальный источник' } }
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Создать источник' })
		)
		await screen.findByRole('button', { name: 'Повторить тот же запрос' })
		const original = vi.mocked(mutateIntakeSource).mock.calls[0][1]
		view.rerender(<div>Доступ проверяется</div>)
		view.rerender(<SourceEditor {...props} />)
		expect(
			screen.getByRole('textbox', { name: 'Название источника' })
		).toHaveProperty('value', '')
		expect(vi.mocked(mutateIntakeSource)).toHaveBeenCalledTimes(1)
		fireEvent.click(
			screen.getByRole('button', { name: 'Повторить тот же запрос' })
		)
		await screen.findByRole('button', { name: 'Скопировать ключ' })
		expect(vi.mocked(mutateIntakeSource).mock.calls[1][1]).toBe(original)
		if (original.operation !== 'create') throw new Error('Expected create')
		expect(document.body.textContent).not.toContain(original.token)
		fireEvent.click(screen.getByRole('button', { name: 'Показать ключ' }))
		expect(document.body.textContent).toContain(original.token)
	})
	it('retains an uncertain key privately while a temporary permission check hides the editor', async () => {
		vi.mocked(mutateIntakeSource)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', 'Временно недоступно')
			)
			.mockResolvedValueOnce(source)
		const current = access()
		const props = {
			operation: 'create' as const,
			onClose: vi.fn(),
			onSaved: vi.fn()
		}
		const view = render(<SourceEditor {...props} access={current} />)
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Название источника' }),
			{ target: { value: 'Сайт QA' } }
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Создать источник' })
		)
		await screen.findByRole('button', { name: 'Повторить тот же запрос' })
		const command = vi.mocked(mutateIntakeSource).mock.calls[0][1]
		view.rerender(
			<SourceEditor
				{...props}
				access={{
					...current,
					sourceManager: false,
					canManageSources: false
				}}
			/>
		)
		expect(
			screen.queryByRole('button', { name: 'Повторить тот же запрос' })
		).toBeNull()
		if (command.operation !== 'create') throw new Error('Expected create')
		expect(document.body.textContent).not.toContain(command.token)
		view.rerender(<SourceEditor {...props} access={current} />)
		fireEvent.click(
			screen.getByRole('button', { name: 'Повторить тот же запрос' })
		)
		await screen.findByRole('button', { name: 'Скопировать ключ' })
		expect(vi.mocked(mutateIntakeSource).mock.calls[1][1]).toBe(command)
	})
	it('preserves the exact unknown command and token, displays no secret until explicit reveal', async () => {
		vi.mocked(mutateIntakeSource)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', 'Временно недоступно')
			)
			.mockResolvedValueOnce(source)
		const onClose = vi.fn()
		render(
			<SourceEditor
				access={access()}
				operation="create"
				onClose={onClose}
				onSaved={vi.fn()}
			/>
		)
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Название источника' }),
			{ target: { value: 'Сайт QA' } }
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Создать источник' })
		)
		await screen.findByRole('button', { name: 'Повторить тот же запрос' })
		const command = vi.mocked(mutateIntakeSource).mock.calls[0][1]
		expect(command.operation).toBe('create')
		if (command.operation !== 'create')
			throw new Error('Expected create command')
		expect(command.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
		expect(Object.isFrozen(command)).toBe(true)
		expect(
			screen.getByRole('textbox', { name: 'Название источника' })
		).toHaveProperty('readOnly', true)
		fireEvent.click(screen.getByRole('button', { name: 'Закрыть панель' }))
		expect(onClose).not.toHaveBeenCalled()
		fireEvent.click(
			screen.getByRole('button', { name: 'Повторить тот же запрос' })
		)
		await screen.findByRole('button', { name: 'Скопировать ключ' })
		expect(vi.mocked(mutateIntakeSource).mock.calls[1][1]).toBe(command)
		expect(document.body.textContent).not.toContain(command.token)
		fireEvent.click(
			screen.getByRole('button', { name: 'Скопировать ключ' })
		)
		await waitFor(() =>
			expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
				command.token
			)
		)
		fireEvent.click(screen.getByRole('button', { name: 'Показать ключ' }))
		expect(
			screen.getByLabelText('Секретный ключ источника').textContent
		).toBe(command.token)
		fireEvent.click(
			screen.getByRole('button', { name: 'Закрыть и скрыть ключ' })
		)
		expect(onClose).toHaveBeenCalledOnce()
		expect(document.body.textContent).not.toContain(command.token)
	})
	it('does not generate or send a key while read-only/offline/permissions unresolved', () => {
		const current = access()
		current.canManageSources = false
		const random = vi.spyOn(crypto, 'getRandomValues')
		render(
			<SourceEditor
				access={current}
				operation="create"
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		expect(
			screen.getByRole('button', { name: 'Создать источник' })
		).toHaveProperty('disabled', true)
		fireEvent.click(
			screen.getByRole('button', { name: 'Создать источник' })
		)
		expect(random).not.toHaveBeenCalled()
		expect(mutateIntakeSource).not.toHaveBeenCalled()
		random.mockRestore()
	})
	it('fresh-checks authorization before generating a command', async () => {
		const current = access()
		vi.mocked(current.authorize).mockRejectedValue(
			new AuthenticatedApiError('forbidden', 'Доступ изменился')
		)
		const random = vi.spyOn(crypto, 'getRandomValues')
		render(
			<SourceEditor
				access={current}
				operation="create"
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Название источника' }),
			{ target: { value: 'Сайт QA' } }
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Создать источник' })
		)
		await screen.findByRole('alert')
		expect(mutateIntakeSource).not.toHaveBeenCalled()
		expect(random).not.toHaveBeenCalled()
		random.mockRestore()
	})
	it('rotation sends the selected source version and a new secret; conflict requires manual reload', async () => {
		vi.mocked(mutateIntakeSource).mockRejectedValue(
			new AuthenticatedApiError('conflict', 'Версия изменена')
		)
		const onSaved = vi.fn()
		render(
			<SourceEditor
				access={access()}
				source={source}
				operation="rotate"
				onClose={vi.fn()}
				onSaved={onSaved}
			/>
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Подтвердить замену ключа' })
		)
		await screen.findByRole('button', {
			name: 'Перечитать список источников'
		})
		expect(vi.mocked(mutateIntakeSource).mock.calls[0][1]).toMatchObject({
			operation: 'rotate',
			id: source.id,
			workspaceId,
			expectedVersion: 3
		})
		expect(
			screen.getByRole('button', { name: 'Подтвердить замену ключа' })
		).toHaveProperty('disabled', true)
		expect(onSaved).not.toHaveBeenCalled()
	})
	it('revoke is explicit and never generates a new credential', async () => {
		const random = vi.spyOn(crypto, 'getRandomValues')
		vi.mocked(mutateIntakeSource).mockResolvedValue({
			...source,
			revokedAt: source.updatedAt
		})
		const onClose = vi.fn()
		render(
			<SourceEditor
				access={access()}
				source={source}
				operation="revoke"
				onClose={onClose}
				onSaved={vi.fn()}
			/>
		)
		expect(mutateIntakeSource).not.toHaveBeenCalled()
		fireEvent.click(
			screen.getByRole('button', { name: 'Подтвердить отзыв' })
		)
		await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
		expect(vi.mocked(mutateIntakeSource).mock.calls[0][1]).toMatchObject({
			operation: 'revoke',
			id: source.id,
			expectedVersion: 3
		})
		expect(random).not.toHaveBeenCalled()
		random.mockRestore()
	})
})
