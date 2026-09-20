import type { TurnstileWidget } from '../apps/crm/src/features/workspace-auth/model/turnstile-client'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTurnstile as useCrmTurnstile } from '../apps/crm/src/features/workspace-auth/model/useTurnstile'
import { useTurnstile as useWebTurnstile } from '../packages/web/src/features/auth/model/useTurnstile'

const mocks = vi.hoisted(() => ({
	loadCrm: vi.fn(() => Promise.resolve()),
	loadWeb: vi.fn(() => Promise.resolve())
}))

vi.mock('@tanstack/react-query', () => ({
	useQuery: vi.fn(() => ({ data: { turnstileEnabled: true } }))
}))
vi.mock('@/features/workspace-auth/api/workspace-auth.api', () => ({
	workspaceAuthApi: { getSettings: vi.fn() }
}))
vi.mock('@/features/auth/api/auth.api', () => ({
	authSettingsService: { get: vi.fn() }
}))
vi.mock('@/features/workspace-auth/model/turnstile-client', () => ({
	loadTurnstileScript: mocks.loadCrm,
	TurnstileUnavailableError: class TurnstileUnavailableError extends Error {
		constructor() {
			super('Turnstile unavailable')
			this.name = 'TurnstileUnavailableError'
		}
	}
}))
vi.mock('@/features/auth/model/turnstile-client', () => ({
	loadTurnstileScript: mocks.loadWeb,
	TurnstileUnavailableError: class TurnstileUnavailableError extends Error {
		constructor() {
			super('Turnstile unavailable')
			this.name = 'TurnstileUnavailableError'
		}
	}
}))

const implementations = [
	['CRM workspace auth', useCrmTurnstile],
	['shared web auth', useWebTurnstile]
] as const

type TurnstileOptions = Parameters<TurnstileWidget['render']>[1]

describe.each(implementations)(
	'%s Turnstile lifecycle',
	(_name, useTurnstile) => {
		let renderWidget: ReturnType<typeof vi.fn>
		let resetWidget: ReturnType<typeof vi.fn>
		let removeWidget: ReturnType<typeof vi.fn>
		let rendered: TurnstileOptions[]

		beforeEach(() => {
			process.env.NEXT_PUBLIC_MODE = 'production'
			process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site-key'
			rendered = []
			renderWidget = vi.fn(
				(_container: HTMLElement, options: TurnstileOptions) => {
					rendered.push(options)
					return `widget-${rendered.length}`
				}
			)
			resetWidget = vi.fn()
			removeWidget = vi.fn()
			window.turnstile = {
				render: renderWidget,
				reset: resetWidget,
				remove: removeWidget
			}
			vi.stubGlobal(
				'ResizeObserver',
				class {
					observe() {}
					disconnect() {}
				}
			)
		})

		afterEach(() => {
			cleanup()
			delete window.turnstile
			vi.unstubAllGlobals()
			delete process.env.NEXT_PUBLIC_MODE
			delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
		})

		const mount = async (action = 'login') => {
			const hook = renderHook(() => useTurnstile(action))
			const container = document.createElement('div')
			act(() => hook.result.current.containerRef(container))
			await waitFor(() => expect(rendered).toHaveLength(1))
			return hook
		}

		it('consumes a token without an immediate reset and obtains one fresh token on the next attempt', async () => {
			const hook = await mount()
			act(() => rendered[0].callback('token-1'))
			await expect(
				hook.result.current.executeTurnstile('login')
			).resolves.toBe('token-1')
			expect(resetWidget).not.toHaveBeenCalled()

			const next = hook.result.current.executeTurnstile('login')
			await waitFor(() => expect(resetWidget).toHaveBeenCalledTimes(1))
			act(() => rendered[0].callback('token-2'))
			await expect(next).resolves.toBe('token-2')
			expect(renderWidget).toHaveBeenCalledTimes(1)
			expect(resetWidget).toHaveBeenCalledTimes(1)
		})

		it('clears an expired token and lets the next attempt obtain a fresh token', async () => {
			const hook = await mount()
			act(() => rendered[0]['expired-callback']())
			expect(resetWidget).not.toHaveBeenCalled()

			const next = hook.result.current.executeTurnstile('login')
			act(() => rendered[0].callback('fresh-after-expiry'))
			await expect(next).resolves.toBe('fresh-after-expiry')
		})

		it('renders the requested resend action until the next form-action execute', async () => {
			const hook = await mount('login')
			const resend = hook.result.current.executeTurnstile(
				'email_resend_code'
			)
			await waitFor(() => expect(rendered).toHaveLength(2))
			expect(rendered.map(options => options.action)).toEqual([
				'login',
				'email_resend_code'
			])
			act(() => rendered[1].callback('resend-token'))
			await expect(resend).resolves.toBe('resend-token')
			expect(rendered).toHaveLength(2)

			const login = hook.result.current.executeTurnstile('login')
			await waitFor(() => expect(rendered).toHaveLength(3))
			expect(rendered[2].action).toBe('login')
			act(() => rendered[2].callback('login-after-resend'))
			await expect(login).resolves.toBe('login-after-resend')
		})

		it('rejects the old action waiter and ignores its late callback after rerender', async () => {
			const hook = renderHook(
				({ action }: { action: string }) => useTurnstile(action),
				{ initialProps: { action: 'register' } }
			)
			const container = document.createElement('div')
			act(() => hook.result.current.containerRef(container))
			await waitFor(() => expect(rendered).toHaveLength(1))

			const oldAttempt = hook.result.current.executeTurnstile('register')
			await Promise.resolve()
			const oldCallback = rendered[0].callback
			act(() => hook.rerender({ action: 'email_register' }))
			await expect(oldAttempt).rejects.toThrow('Turnstile unavailable')
			await waitFor(() => expect(rendered).toHaveLength(2))

			const nextAttempt =
				hook.result.current.executeTurnstile('email_register')
			let settled = false
			void nextAttempt.then(
				() => {
					settled = true
				},
				() => {
					settled = true
				}
			)
			act(() => oldCallback('stale-token'))
			await new Promise(resolve => setTimeout(resolve, 0))
			expect(settled).toBe(false)

			act(() => rendered[1].callback('email-register-token'))
			await expect(nextAttempt).resolves.toBe('email-register-token')
		})

		it('rejects the pending waiter on widget error', async () => {
			const hook = await mount()
			const pending = hook.result.current.executeTurnstile('login')
			await Promise.resolve()
			act(() => rendered[0]['error-callback']())
			await expect(pending).rejects.toThrow('Turnstile unavailable')
			expect(hook.result.current.isTurnstileUnavailable).toBe(true)
		})

		it('rejects the pending waiter when retry replaces the widget', async () => {
			const hook = await mount()
			const pending = hook.result.current.executeTurnstile('login')
			await Promise.resolve()
			act(() => hook.result.current.retryTurnstile())
			await expect(pending).rejects.toThrow('Turnstile unavailable')
		})

		it('rejects the pending waiter when the hook unmounts', async () => {
			const hook = await mount()
			const pending = hook.result.current.executeTurnstile('login')
			await Promise.resolve()
			hook.unmount()
			await expect(pending).rejects.toThrow('Turnstile unavailable')
		})

		it('rejects a concurrent execute without consuming the first waiter', async () => {
			const hook = await mount()
			const first = hook.result.current.executeTurnstile('login')
			await Promise.resolve()
			const second = hook.result.current.executeTurnstile('login')
			await expect(second).rejects.toThrow('Turnstile unavailable')
			act(() => rendered[0].callback('only-token'))
			await expect(first).resolves.toBe('only-token')
		})
	}
)
