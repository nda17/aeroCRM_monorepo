import { useSessionBootstrap } from '@/features/session-bootstrap/model/useSessionBootstrap'
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SessionGate from './SessionGate'

vi.mock('@/features/session-bootstrap/model/useSessionBootstrap', () => ({
	useSessionBootstrap: vi.fn()
}))

vi.mock('@/shared/config/runtime', () => ({
	getRuntimeConfig: () => ({
		mode: 'development',
		appOrigin: 'http://localhost:3001',
		mainAppOrigin: 'http://localhost:3000',
		apiBaseUrl: 'http://localhost:4100/api/v1'
	})
}))

vi.mock('react-hot-toast', () => ({
	default: vi.fn()
}))

const mockedUseSessionBootstrap = vi.mocked(useSessionBootstrap)
const retry = vi.fn()
const fail = vi.fn()

describe('SessionGate', () => {
	beforeEach(() => {
		window.history.replaceState({}, '', '/deals?stage=new#ignored')
	})

	afterEach(() => {
		cleanup()
	})

	it.each(['checking', 'anonymous', 'error'] as const)(
		'does not render workspace children while session is %s',
		status => {
			mockedUseSessionBootstrap.mockReturnValue({
				status,
				errorMessage: status === 'error' ? 'Временная ошибка' : null,
				retry,
				fail
			})
			const Workspace = vi.fn(() => <div>Workspace</div>)

			render(
				<SessionGate redirectToLogin={vi.fn()}>
					<Workspace />
				</SessionGate>
			)

			expect(Workspace).not.toHaveBeenCalled()
		}
	)

	it('renders workspace children only after authentication', () => {
		mockedUseSessionBootstrap.mockReturnValue({
			status: 'authenticated',
			errorMessage: null,
			retry,
			fail
		})

		render(
			<SessionGate>
				<div>Workspace</div>
			</SessionGate>
		)

		expect(screen.getByText('Workspace')).toBeTruthy()
	})

	it('redirects an anonymous session to the exact main login URL', async () => {
		const redirectToLogin = vi.fn()
		mockedUseSessionBootstrap.mockReturnValue({
			status: 'anonymous',
			errorMessage: null,
			retry,
			fail
		})

		render(
			<SessionGate redirectToLogin={redirectToLogin}>
				<div>Workspace</div>
			</SessionGate>
		)

		await waitFor(() => {
			expect(redirectToLogin).toHaveBeenCalledWith(
				'http://localhost:3000/login?returnUrl=http%3A%2F%2Flocalhost%3A3001%2Fdeals%3Fstage%3Dnew'
			)
		})
	})

	it('keeps a temporary failure on screen and allows retry', () => {
		const redirectToLogin = vi.fn()
		mockedUseSessionBootstrap.mockReturnValue({
			status: 'error',
			errorMessage: 'Временная ошибка',
			retry,
			fail
		})

		render(
			<SessionGate redirectToLogin={redirectToLogin}>
				<div>Workspace</div>
			</SessionGate>
		)

		expect(screen.getByText('Временная ошибка')).toBeTruthy()
		fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
		expect(retry).toHaveBeenCalledTimes(1)
		expect(redirectToLogin).not.toHaveBeenCalled()
	})
})
