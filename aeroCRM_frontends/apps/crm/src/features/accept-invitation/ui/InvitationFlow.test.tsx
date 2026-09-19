import AppProviders from '@/app/providers/AppProviders'
import { useSessionStore } from '@/entities/session'
import {
	acceptWorkspaceInvitation,
	getWorkspaceInvitation,
	type WorkspaceInvitation
} from '@/entities/workspace-invitation'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
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
import { checkInvitationCrmAccess } from '../api/invitation-access.api'
import { InvitationFlow } from './InvitationFlow'

vi.mock('@/entities/workspace-invitation', async importOriginal => ({
	...(await importOriginal<
		typeof import('@/entities/workspace-invitation')
	>()),
	acceptWorkspaceInvitation: vi.fn(),
	getWorkspaceInvitation: vi.fn()
}))
vi.mock('../api/invitation-access.api', () => ({
	checkInvitationCrmAccess: vi.fn()
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
	Toaster: () => null
}))
const id = '11111111-1111-4111-8111-111111111111'
const workspaceId = '22222222-2222-4222-8222-222222222222'
const invitation: WorkspaceInvitation = {
	id,
	workspaceId,
	productCode: 'WINCRM',
	version: 1,
	status: 'PENDING',
	expiresAt: '2099-01-01T00:00:00.000Z',
	acceptedAt: null
}
const accepted = {
	id: '33333333-3333-4333-8333-333333333333',
	invitationId: id,
	invitationVersion: 2,
	workspaceId,
	productCode: 'WINCRM' as const,
	subject: 'user-1',
	membershipId: '44444444-4444-4444-8444-444444444444',
	acceptedAt: '2026-09-05T00:00:00.000Z',
	emailVerifiedAt: '2026-09-04T00:00:00.000Z'
}
const view = (visible = true) => (
	<AppProviders>
		{visible ? (
			<InvitationFlow invitationId={id} />
		) : (
			<div>Another screen</div>
		)}
	</AppProviders>
)

describe('InvitationFlow', () => {
	beforeEach(() => {
		vi.resetAllMocks()
		Object.defineProperty(navigator, 'onLine', {
			configurable: true,
			value: true
		})
		useSessionStore.setState({
			status: 'authenticated',
			sessionRevision: 1,
			session: { userId: 'user-1', accessToken: 'token-one' },
			errorMessage: null
		})
		vi.mocked(getWorkspaceInvitation).mockResolvedValue(invitation)
		vi.mocked(acceptWorkspaceInvitation).mockImplementation(async () => {
			vi.mocked(getWorkspaceInvitation).mockResolvedValue({
				...invitation,
				status: 'ACCEPTED',
				version: accepted.invitationVersion,
				acceptedAt: accepted.acceptedAt
			})
			return accepted
		})
	})
	afterEach(() => cleanup())
	it('opens before workspace access and does not activate Trial or check admission before acceptance', async () => {
		render(view())
		fireEvent.click(
			await screen.findByRole('button', { name: 'Принять приглашение' })
		)
		await screen.findByRole('button', {
			name: 'Проверить доступ и открыть CRM'
		})
		expect(acceptWorkspaceInvitation).toHaveBeenCalledTimes(1)
		expect(checkInvitationCrmAccess).not.toHaveBeenCalled()
		expect(
			screen.getByText(/CRM отдельно проверяет роль и свободное место/)
		).toBeTruthy()
	})
	it('uses the same frozen command after unknown outcome and remount even if the preview version changed', async () => {
		vi.mocked(acceptWorkspaceInvitation).mockRejectedValueOnce(
			new AuthenticatedApiError('temporary', 'Unknown outcome')
		)
		const rendered = render(view())
		fireEvent.click(
			await screen.findByRole('button', { name: 'Принять приглашение' })
		)
		await screen.findByText('Unknown outcome')
		const firstCommand = vi.mocked(acceptWorkspaceInvitation).mock
			.calls[0][4]
		rendered.rerender(view(false))
		vi.mocked(getWorkspaceInvitation).mockResolvedValue({
			...invitation,
			version: 7
		})
		rendered.rerender(view())
		const retry = await screen.findByRole('button', {
			name: 'Повторить тот же запрос'
		})
		await waitFor(() =>
			expect((retry as HTMLButtonElement).disabled).toBe(false)
		)
		expect(acceptWorkspaceInvitation).toHaveBeenCalledTimes(1)
		fireEvent.click(retry)
		await screen.findByRole('button', {
			name: 'Проверить доступ и открыть CRM'
		})
		expect(vi.mocked(acceptWorkspaceInvitation).mock.calls[1][4]).toEqual(
			firstCommand
		)
		expect(firstCommand.expectedVersion).toBe(1)
	})
	it.each(['mutation', 'authorization'] as const)(
		'preserves the same owner and pending command after unknown then %s 401',
		async boundary => {
			vi.mocked(acceptWorkspaceInvitation).mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', 'Unknown outcome')
			)
			render(view())
			fireEvent.click(
				await screen.findByRole('button', { name: 'Принять приглашение' })
			)
			await screen.findByText('Unknown outcome')
			const firstCommand = vi.mocked(acceptWorkspaceInvitation).mock
				.calls[0][4]
			const unauthorized = new AuthenticatedApiError(
				'unauthorized',
				'Session not confirmed'
			)
			if (boundary === 'mutation')
				vi.mocked(acceptWorkspaceInvitation).mockRejectedValueOnce(
					unauthorized
				)
			else
				vi.mocked(getWorkspaceInvitation).mockRejectedValueOnce(
					unauthorized
				)
			fireEvent.click(
				screen.getByRole('button', { name: 'Повторить тот же запрос' })
			)
			await screen.findByText('Session not confirmed')
			expect(useSessionStore.getState().session?.userId).toBe('user-1')
			expect(useSessionStore.getState().sessionRevision).toBe(1)
			expect(
				screen.queryByRole('button', { name: 'Принять приглашение' })
			).toBeNull()
			fireEvent.click(
				screen.getByRole('button', { name: 'Повторить тот же запрос' })
			)
			await screen.findByRole('button', {
				name: 'Проверить доступ и открыть CRM'
			})
			for (const call of vi.mocked(acceptWorkspaceInvitation).mock.calls)
				expect(call[4]).toEqual(firstCommand)
		}
	)
	it('reads current revoked status after successful historical acceptance replay', async () => {
		vi.mocked(acceptWorkspaceInvitation)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', 'Unknown outcome')
			)
			.mockResolvedValueOnce(accepted)
		render(view())
		fireEvent.click(
			await screen.findByRole('button', { name: 'Принять приглашение' })
		)
		await screen.findByText('Unknown outcome')
		vi.mocked(getWorkspaceInvitation).mockResolvedValue({
			...invitation,
			status: 'REVOKED',
			version: 3,
			acceptedAt: accepted.acceptedAt
		})
		fireEvent.click(
			screen.getByRole('button', { name: 'Повторить тот же запрос' })
		)
		await screen.findByText('Приглашение отменено')
		expect(
			screen.queryByRole('button', {
				name: 'Проверить доступ и открыть CRM'
			})
		).toBeNull()
		expect(checkInvitationCrmAccess).not.toHaveBeenCalled()
	})
	it('does not discard an unknown command when preview revalidation returns 401', async () => {
		vi.mocked(acceptWorkspaceInvitation).mockRejectedValueOnce(
			new AuthenticatedApiError('temporary', 'Unknown outcome')
		)
		render(view())
		fireEvent.click(
			await screen.findByRole('button', { name: 'Принять приглашение' })
		)
		await screen.findByText('Unknown outcome')
		const firstCommand = vi.mocked(acceptWorkspaceInvitation).mock
			.calls[0][4]
		vi.mocked(getWorkspaceInvitation).mockRejectedValueOnce(
			new AuthenticatedApiError('unauthorized', 'Preview 401')
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Обновить приглашение' })
		)
		await screen.findByText(
			'Не удалось обновить приглашение. Перед новым действием повторите проверку.'
		)
		expect(useSessionStore.getState().session?.userId).toBe('user-1')
		expect(
			screen.queryByRole('button', { name: 'Принять приглашение' })
		).toBeNull()
		fireEvent.click(
			screen.getByRole('button', { name: 'Повторить тот же запрос' })
		)
		await screen.findByRole('button', {
			name: 'Проверить доступ и открыть CRM'
		})
		expect(vi.mocked(acceptWorkspaceInvitation).mock.calls[1][4]).toEqual(
			firstCommand
		)
	})
	it('does not unlock a new intent after unknown followed by conflict', async () => {
		vi.mocked(acceptWorkspaceInvitation)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', 'Unknown outcome')
			)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('conflict', 'Still unresolved')
			)
		render(view())
		fireEvent.click(
			await screen.findByRole('button', { name: 'Принять приглашение' })
		)
		await screen.findByText('Unknown outcome')
		fireEvent.click(
			screen.getByRole('button', { name: 'Повторить тот же запрос' })
		)
		await screen.findByText('Still unresolved')
		expect(
			screen.queryByRole('button', { name: 'Принять приглашение' })
		).toBeNull()
		expect(vi.mocked(acceptWorkspaceInvitation).mock.calls[1][4]).toEqual(
			vi.mocked(acceptWorkspaceInvitation).mock.calls[0][4]
		)
	})
	it('does not treat accepted Identity membership as an active CRM seat', async () => {
		vi.mocked(getWorkspaceInvitation).mockResolvedValue({
			...invitation,
			status: 'ACCEPTED',
			acceptedAt: accepted.acceptedAt
		})
		vi.mocked(checkInvitationCrmAccess).mockRejectedValue(
			new AuthenticatedApiError('forbidden', 'No CRM role')
		)
		render(view())
		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Проверить доступ и открыть CRM'
			})
		)
		await screen.findByText(/Доступ к CRM пока не подтверждён/)
		expect(checkInvitationCrmAccess).toHaveBeenCalledWith(
			'token-one',
			workspaceId,
			'user-1'
		)
		expect(acceptWorkspaceInvitation).not.toHaveBeenCalled()
	})
	it('uses one generic unavailable message for unknown, unverified and different email', async () => {
		vi.mocked(getWorkspaceInvitation).mockRejectedValue(
			new AuthenticatedApiError('notFound', 'Invitation not found')
		)
		render(view())
		await screen.findByText(
			/Войдите с тем адресом, на который пришло письмо/
		)
		expect(
			screen.queryByRole('button', { name: 'Принять приглашение' })
		).toBeNull()
		expect(acceptWorkspaceInvitation).not.toHaveBeenCalled()
	})
	it('ignores late old-session 401 without changing the newer account', async () => {
		let reject!: (error: unknown) => void
		vi.mocked(acceptWorkspaceInvitation).mockImplementationOnce(
			() =>
				new Promise((_resolve, failure) => {
					reject = failure
				})
		)
		render(view())
		fireEvent.click(
			await screen.findByRole('button', { name: 'Принять приглашение' })
		)
		await waitFor(() =>
			expect(acceptWorkspaceInvitation).toHaveBeenCalledTimes(1)
		)
		act(() =>
			useSessionStore
				.getState()
				.setAuthenticated({ userId: 'user-2', accessToken: 'token-two' })
		)
		await act(async () =>
			reject(new AuthenticatedApiError('unauthorized', 'Old 401'))
		)
		expect(useSessionStore.getState().status).toBe('authenticated')
		expect(useSessionStore.getState().session?.userId).toBe('user-2')
		expect(toast.success).not.toHaveBeenCalled()
	})
	it('suppresses late access-check toast/navigation after the invitation screen unmounts', async () => {
		vi.mocked(getWorkspaceInvitation).mockResolvedValue({
			...invitation,
			status: 'ACCEPTED',
			acceptedAt: accepted.acceptedAt
		})
		let resolve!: (value: {
			workspaceId: string
			state: 'ACTIVE'
			destination: string
		}) => void
		vi.mocked(checkInvitationCrmAccess).mockImplementationOnce(
			() =>
				new Promise(finish => {
					resolve = finish
				})
		)
		const rendered = render(view())
		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Проверить доступ и открыть CRM'
			})
		)
		rendered.rerender(view(false))
		await act(async () =>
			resolve({
				workspaceId,
				state: 'ACTIVE',
				destination: `/inbox?workspaceId=${workspaceId}`
			})
		)
		expect(toast.success).not.toHaveBeenCalled()
	})
	it('blocks revoked invitations', async () => {
		vi.mocked(getWorkspaceInvitation).mockResolvedValue({
			...invitation,
			status: 'REVOKED'
		})
		render(view())
		await screen.findByText('Приглашение отменено')
		expect(
			screen.queryByRole('button', { name: 'Принять приглашение' })
		).toBeNull()
		expect(acceptWorkspaceInvitation).not.toHaveBeenCalled()
	})
	it('blocks commands when the browser goes offline', async () => {
		render(view())
		const submit = await screen.findByRole('button', {
			name: 'Принять приглашение'
		})
		act(() => {
			Object.defineProperty(navigator, 'onLine', {
				configurable: true,
				value: false
			})
			window.dispatchEvent(new Event('offline'))
		})
		expect((submit as HTMLButtonElement).disabled).toBe(true)
		fireEvent.click(submit)
		expect(acceptWorkspaceInvitation).not.toHaveBeenCalled()
	})
})
