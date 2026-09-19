import { StrictMode } from 'react'
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import toast from 'react-hot-toast'
import { PendingCommandProvider, useMemoryCommand } from './index'

vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() })
}))
afterEach(() => {
	cleanup()
	vi.clearAllMocks()
})
const scope = { owner: 'actor:1', workspaceId: 'workspace', view: 'ALL' }
const authorize = async () => 'token'

describe('pending command provider boundaries', () => {
	it('works in StrictMode, warns before unload only while unresolved and clears private data at the auth boundary', async () => {
		let finish!: () => void
		const send = vi.fn(
			() =>
				new Promise<void>(resolve => {
					finish = resolve
				})
		)
		const saved = vi.fn()
		const Probe = () => {
			const command = useMemoryCommand(
				scope,
				'new',
				true,
				authorize,
				send,
				saved
			)
			return (
				<button
					onClick={() =>
						void command.execute(() => ({
							commandId: 'stable',
							privateToken: 'private-test-secret'
						}))
					}
				>
					{command.running ? 'running' : 'send'}
				</button>
			)
		}
		const tree = (owner: string | null) => (
			<StrictMode>
				<PendingCommandProvider owner={owner}>
					<Probe />
				</PendingCommandProvider>
			</StrictMode>
		)
		const view = render(tree(scope.owner))
		const initial = new Event('beforeunload', { cancelable: true })
		window.dispatchEvent(initial)
		expect(initial.defaultPrevented).toBe(false)
		fireEvent.click(screen.getByRole('button', { name: 'send' }))
		await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
		const pending = new Event('beforeunload', { cancelable: true })
		window.dispatchEvent(pending)
		expect(pending.defaultPrevented).toBe(true)
		expect(document.body.textContent).not.toContain('private-test-secret')
		view.rerender(tree(null))
		await act(async () => {
			finish()
			await Promise.resolve()
		})
		expect(saved).not.toHaveBeenCalled()
		const loggedOut = new Event('beforeunload', { cancelable: true })
		window.dispatchEvent(loggedOut)
		expect(loggedOut.defaultPrevented).toBe(false)
	})
	it('does not deliver a late response or toast into another row scope, and requires explicit server replay', async () => {
		let finish!: () => void
		const send = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise(resolve => {
						finish = () => resolve({ id: 'saved' })
					})
			)
			.mockResolvedValueOnce({ id: 'saved' })
		const saved = vi.fn()
		const Probe = ({ view }: { view: string }) => {
			const command = useMemoryCommand(
				{ ...scope, view },
				'new',
				true,
				authorize,
				send,
				saved
			)
			return (
				<button
					disabled={command.running}
					onClick={() =>
						void command.execute(() => ({
							commandId: crypto.randomUUID(),
							original: 'draft'
						}))
					}
				>
					{command.uncertain ? 'recover' : 'send'}
				</button>
			)
		}
		const tree = (permission: string) => (
			<PendingCommandProvider owner={scope.owner}>
				<Probe view={permission} />
			</PendingCommandProvider>
		)
		const view = render(tree('ALL'))
		fireEvent.click(screen.getByRole('button', { name: 'send' }))
		await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
		view.rerender(tree('OWN'))
		await act(async () => {
			finish()
			await Promise.resolve()
		})
		expect(saved).not.toHaveBeenCalled()
		expect(toast.success).not.toHaveBeenCalled()
		expect(send).toHaveBeenCalledTimes(1)
		fireEvent.click(await screen.findByRole('button', { name: 'recover' }))
		await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
		expect(send.mock.calls[1][1]).toBe(send.mock.calls[0][1])
	})
})
