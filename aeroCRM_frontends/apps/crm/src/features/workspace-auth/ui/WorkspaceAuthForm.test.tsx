import { workspaceAuthApi } from '@/features/workspace-auth/api/workspace-auth.api'
import { useTurnstile } from '@/features/workspace-auth/model/useTurnstile'
import { useAndroidAppContext } from '@/shared/lib/pwa/app-context'
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { WorkspaceAuthForm } from './WorkspaceAuthForm'

vi.mock('@/features/workspace-auth/api/workspace-auth.api', () => ({
	workspaceAuthApi: {
		finishEmailRegistration: vi.fn(),
		getSettings: vi.fn(),
		login: vi.fn(),
		loginPhone: vi.fn(),
		providerUrl: vi.fn(
			(provider: string, returnPath: string) =>
				`/oauth/${provider}?returnPath=${encodeURIComponent(returnPath)}`
		),
		registerPhone: vi.fn(),
		resendEmailCode: vi.fn(),
		restorePassword: vi.fn(),
		startEmailRegistration: vi.fn(),
		sendPhoneCode: vi.fn()
	}
}))
vi.mock('@/features/workspace-auth/model/useTurnstile', () => ({
	useTurnstile: vi.fn()
}))
vi.mock('@/shared/lib/pwa/app-context', () => ({
	useAndroidAppContext: vi.fn()
}))
vi.mock('@tanstack/react-query', () => ({
	useQuery: vi.fn()
}))
vi.mock('next/navigation', () => ({
	useRouter: vi.fn()
}))
vi.mock('next/link', () => ({
	default: ({ children, href }: { children: ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	)
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), {
		error: vi.fn(),
		success: vi.fn()
	})
}))

const mockedApi = vi.mocked(workspaceAuthApi)
const mockedAppContext = vi.mocked(useAndroidAppContext)
const mockedQuery = vi.mocked(useQuery)
const mockedRouter = vi.mocked(useRouter)
const mockedTurnstile = vi.mocked(useTurnstile)

beforeEach(() => {
	vi.clearAllMocks()
	const replace = vi.fn()
	mockedRouter.mockReturnValue({ replace } as never)
	mockedAppContext.mockReturnValue(false)
	mockedQuery.mockReturnValue({
		data: {
			googleAuthEnabled: false,
			yandexAuthEnabled: false,
			vkAuthEnabled: false
		}
	} as never)
	mockedTurnstile.mockReturnValue({
		containerRef: vi.fn(),
		executeTurnstile: vi.fn().mockResolvedValue('turnstile-token'),
		isTurnstileEnabled: false,
		isTurnstileReady: true,
		isTurnstileUnavailable: false,
		retryTurnstile: vi.fn()
	} as never)
	mockedApi.startEmailRegistration.mockResolvedValue(undefined as never)
})

afterEach(() => {
	cleanup()
})

describe('WorkspaceAuthForm app boundary', () => {
	it('redirects an Android app registration request to login with the return path', async () => {
		mockedAppContext.mockReturnValue(true)
		const returnPath = '/workspace?tab=customers'

		render(<WorkspaceAuthForm mode="register" returnPath={returnPath} />)

		expect(screen.getByText('Пожалуйста, подождите')).toBeTruthy()
		expect(screen.queryByLabelText('Email')).toBeNull()
		expect(
			screen.queryByRole('button', { name: 'Получить код' })
		).toBeNull()
		await waitFor(() =>
			expect(
				mockedRouter.mock.results[0]?.value.replace
			).toHaveBeenCalledWith(
				'/login?returnPath=%2Fworkspace%3Ftab%3Dcustomers'
			)
		)
		expect(mockedApi.startEmailRegistration).not.toHaveBeenCalled()
	})

	it('keeps registration unavailable while the Android context is still unknown', () => {
		mockedAppContext.mockReturnValue(null)

		render(<WorkspaceAuthForm mode="register" returnPath="/workspace" />)

		expect(screen.getByText('Пожалуйста, подождите')).toBeTruthy()
		expect(screen.queryByLabelText('Email')).toBeNull()
		expect(mockedApi.startEmailRegistration).not.toHaveBeenCalled()
	})

	it('keeps normal web registration and its API submission available', async () => {
		render(<WorkspaceAuthForm mode="register" returnPath="/workspace" />)

		fireEvent.change(screen.getByPlaceholderText('Email:'), {
			target: { value: ' User@Example.com ' }
		})
		fireEvent.change(screen.getByPlaceholderText('Пароль:'), {
			target: { value: 'Strong1' }
		})
		fireEvent.click(screen.getByRole('button', { name: 'Получить код' }))

		await waitFor(() =>
			expect(
				mockedApi.startEmailRegistration
			).toHaveBeenCalledExactlyOnceWith(
				'user@example.com',
				'Strong1',
				'turnstile-token'
			)
		)
		expect(
			mockedTurnstile.mock.results[0]?.value.executeTurnstile
		).toHaveBeenCalledWith('register')
	})

	it('toggles password visibility accessibly without changing the value', () => {
		render(<WorkspaceAuthForm mode="login" returnPath="/workspace" />)
		const password = screen.getByPlaceholderText('Пароль:')
		fireEvent.change(password, { target: { value: 'KeepMe1' } })

		const show = screen.getByRole('button', { name: 'Показать пароль' })
		fireEvent.click(show)
		expect(password.getAttribute('type')).toBe('text')
		expect((password as HTMLInputElement).value).toBe('KeepMe1')
		expect(
			screen
				.getByRole('button', { name: 'Скрыть пароль' })
				.getAttribute('aria-pressed')
		).toBe('true')

		fireEvent.click(screen.getByRole('button', { name: 'Скрыть пароль' }))
		expect(password.getAttribute('type')).toBe('password')
		expect((password as HTMLInputElement).value).toBe('KeepMe1')
	})
})
