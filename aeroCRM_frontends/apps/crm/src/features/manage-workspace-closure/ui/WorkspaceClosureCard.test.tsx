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
import {
	getClosedWorkspaceBilling,
	getClosedWorkspaceBillingHistory,
	getClosedWorkspaceBillingOrder,
	getWorkspaceClosure,
	getWorkspaceClosurePreview,
	listWorkspaceClosures,
	requestWorkspaceClosure
} from '@/entities/workspace-closure'
import type {
	WorkspaceClosurePreview,
	WorkspaceClosureView
} from '@/entities/workspace-closure'
import { useSessionStore } from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { WorkspaceClosureCard } from './WorkspaceClosureCard'

vi.mock('@/entities/workspace-closure', () => ({
	getClosedWorkspaceBilling: vi.fn(),
	getClosedWorkspaceBillingHistory: vi.fn(),
	getClosedWorkspaceBillingOrder: vi.fn(),
	getWorkspaceClosure: vi.fn(),
	getWorkspaceClosurePreview: vi.fn(),
	listWorkspaceClosures: vi.fn(),
	requestWorkspaceClosure: vi.fn()
}))

const workspaceId = '11111111-1111-4111-8111-111111111111'
const closureId = '22222222-2222-4222-8222-222222222222'
const session = (userId = 'owner', accessToken = `${userId}-token`) => ({
	userId,
	accessToken,
	accessTokenExpiresAt: Date.now() + 60_000
})
const closure = (state: WorkspaceClosureView['state'] = 'CLOSING') =>
	({
		id: closureId,
		workspaceId,
		displayName: 'Аэрокосмическая лаборатория',
		state,
		version: '1',
		requestedAt: '2026-09-23T10:00:00.000Z',
		closedAt: state === 'CLOSED' ? '2026-09-23T10:05:00.000Z' : null,
		steps: [
			{
				service: 'crm-access',
				state: state === 'CLOSED' ? 'SETTLED' : 'FENCED',
				lastErrorCode: null
			}
		],
		financialPendingCount: 1,
		priorDispatchCount: 2,
		lastErrorCode: null
	}) satisfies WorkspaceClosureView
const preview = (
	confirmationLabel = 'Аэрокосмическая лаборатория',
	closureView: WorkspaceClosureView | null = null
) =>
	({
		schemaVersion: 1,
		scope: { subject: 'owner', workspaceId },
		enabled: true,
		version: '0',
		confirmationLabel,
		closure: closureView
	}) satisfies WorkspaceClosurePreview

let queryClient: QueryClient
const view = () => (
	<QueryClientProvider client={queryClient}>
		<WorkspaceClosureCard workspaceId={workspaceId} />
	</QueryClientProvider>
)
const openConfirmation = async () => {
	const trigger = (await screen.findByRole('button', {
		name: 'Закрыть пространство'
	})) as HTMLButtonElement
	await waitFor(() => expect(trigger.disabled).toBe(false))
	fireEvent.click(trigger)
	return screen.findByRole('dialog', {
		name: 'Подтвердить закрытие пространства'
	})
}

beforeEach(() => {
	vi.clearAllMocks()
	useSessionStore.getState().setAuthenticated(session())
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } }
	})
	vi.mocked(getWorkspaceClosurePreview).mockResolvedValue(preview())
	vi.mocked(getWorkspaceClosure).mockResolvedValue(closure())
	vi.mocked(getClosedWorkspaceBilling).mockRejectedValue(
		new Error('unused')
	)
	vi.mocked(getClosedWorkspaceBillingHistory).mockRejectedValue(
		new Error('unused')
	)
	vi.mocked(getClosedWorkspaceBillingOrder).mockRejectedValue(
		new Error('unused')
	)
	vi.mocked(listWorkspaceClosures).mockResolvedValue({
		schemaVersion: 1,
		scope: { subject: 'owner' },
		items: []
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
})

afterEach(() => {
	cleanup()
	queryClient.clear()
	useSessionStore.getState().setAnonymous()
})

describe('WorkspaceClosureCard', () => {
	it('requires the exact current confirmation label before sending a typed command', async () => {
		vi.mocked(requestWorkspaceClosure).mockResolvedValue(closure())
		render(view())
		const dialog = (await openConfirmation()) as HTMLDialogElement
		const confirm = screen.getByRole('button', {
			name: 'Подтвердить закрытие'
		}) as HTMLButtonElement
		expect(confirm.disabled).toBe(true)
		fireEvent.change(screen.getByLabelText('Название пространства'), {
			target: { value: 'аэрокосмическая лаборатория' }
		})
		expect(confirm.disabled).toBe(true)
		fireEvent.change(screen.getByLabelText('Название пространства'), {
			target: { value: 'Аэрокосмическая лаборатория' }
		})
		expect(confirm.disabled).toBe(false)
		fireEvent.click(confirm)
		await waitFor(() =>
			expect(requestWorkspaceClosure).toHaveBeenCalledTimes(1)
		)
		expect(requestWorkspaceClosure).toHaveBeenCalledWith(
			'owner-token',
			expect.objectContaining({
				schemaVersion: 1,
				commandId: expect.any(String),
				workspaceId,
				expectedVersion: '0',
				confirmationLabel: 'Аэрокосмическая лаборатория'
			}),
			'owner'
		)
		expect(dialog.isConnected).toBe(true)
		await screen.findByText(/Доступ в CRM остановлен/)
	})

	it('focuses the open drawer, closes on Escape, and returns focus without sending', async () => {
		render(view())
		const trigger = (await screen.findByRole('button', {
			name: 'Закрыть пространство'
		})) as HTMLButtonElement
		await waitFor(() => expect(trigger.disabled).toBe(false))
		trigger.focus()
		fireEvent.click(trigger)
		const dialog = (await screen.findByRole('dialog', {
			name: 'Подтвердить закрытие пространства'
		})) as HTMLDialogElement
		const close = within(dialog).getByRole('button', {
			name: 'Закрыть панель'
		})
		await waitFor(() => expect(document.activeElement).toBe(close))
		fireEvent(
			dialog,
			new Event('cancel', { bubbles: true, cancelable: true })
		)
		await waitFor(() =>
			expect((dialog as HTMLDialogElement).open).toBe(false)
		)
		await waitFor(() => expect(document.activeElement).toBe(trigger))
		expect(requestWorkspaceClosure).not.toHaveBeenCalled()
	})

	it('retries a lost POST with the same command after unmount and remount', async () => {
		vi.mocked(requestWorkspaceClosure)
			.mockRejectedValueOnce(new Error('response lost'))
			.mockResolvedValueOnce(closure())
		render(view())
		await openConfirmation()
		fireEvent.change(screen.getByLabelText('Название пространства'), {
			target: { value: 'Аэрокосмическая лаборатория' }
		})
		fireEvent.click(
			screen.getByRole('button', { name: 'Подтвердить закрытие' })
		)
		await screen.findByText(/Результат запроса пока не подтверждён/)
		const firstCommand = vi.mocked(requestWorkspaceClosure).mock
			.calls[0][1]
		cleanup()
		render(view())
		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Проверить прежний запрос'
			})
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Повторить прежний запрос' })
		)
		await waitFor(() =>
			expect(requestWorkspaceClosure).toHaveBeenCalledTimes(2)
		)
		expect(vi.mocked(requestWorkspaceClosure).mock.calls[1]).toEqual([
			'owner-token',
			firstCommand,
			'owner'
		])
	})

	it.each([
		{ kind: 'validation', status: 400 },
		{ kind: 'conflict', status: 409 }
	] as const)(
		'requires a fresh label after a confirmed pre-commit $kind refusal ($status)',
		async ({ kind }) => {
			vi.mocked(getWorkspaceClosurePreview)
				.mockResolvedValueOnce(preview('Old workspace name'))
				.mockResolvedValueOnce(preview('Current workspace name'))
			vi.mocked(requestWorkspaceClosure)
				.mockRejectedValueOnce(new AuthenticatedApiError(kind, 'Refused'))
				.mockResolvedValueOnce(closure())
			render(view())
			await openConfirmation()
			fireEvent.change(screen.getByLabelText('Название пространства'), {
				target: { value: 'Old workspace name' }
			})
			fireEvent.click(
				screen.getByRole('button', { name: 'Подтвердить закрытие' })
			)
			await screen.findByRole('status')
			expect(
				screen.getByText(
					'Название или условия закрытия изменились. Проверьте актуальное подтверждение.'
				)
			).toBeTruthy()
			fireEvent.click(
				screen.getByRole('button', { name: 'Закрыть пространство' })
			)
			const confirm = screen.getByRole('button', {
				name: 'Подтвердить закрытие'
			}) as HTMLButtonElement
			expect(confirm.disabled).toBe(true)
			fireEvent.change(screen.getByLabelText('Название пространства'), {
				target: { value: 'Current workspace name' }
			})
			fireEvent.click(confirm)
			await waitFor(() =>
				expect(requestWorkspaceClosure).toHaveBeenCalledTimes(2)
			)
			const first = vi.mocked(requestWorkspaceClosure).mock.calls[0][1]
			const second = vi.mocked(requestWorkspaceClosure).mock.calls[1][1]
			expect(second.confirmationLabel).toBe('Current workspace name')
			expect(second.commandId).not.toBe(first.commandId)
		}
	)

	it('does not render a late CLOSED response after the session scope changes', async () => {
		let complete!: (value: WorkspaceClosureView) => void
		vi.mocked(requestWorkspaceClosure).mockReturnValue(
			new Promise(resolve => {
				complete = resolve
			})
		)
		const rendered = render(view())
		await openConfirmation()
		fireEvent.change(screen.getByLabelText('Название пространства'), {
			target: { value: 'Аэрокосмическая лаборатория' }
		})
		fireEvent.click(
			screen.getByRole('button', { name: 'Подтвердить закрытие' })
		)
		await waitFor(() =>
			expect(requestWorkspaceClosure).toHaveBeenCalledOnce()
		)
		useSessionStore.getState().setAuthenticated(session('owner-2'))
		rendered.rerender(view())
		await waitFor(() =>
			expect(getWorkspaceClosurePreview).toHaveBeenCalledWith(
				'owner-2-token',
				workspaceId,
				'owner-2'
			)
		)
		complete(closure('CLOSED'))
		await waitFor(() =>
			expect(screen.queryByText('Аэрокосмическая лаборатория')).toBeNull()
		)
		expect(getClosedWorkspaceBilling).not.toHaveBeenCalled()
	})
})
