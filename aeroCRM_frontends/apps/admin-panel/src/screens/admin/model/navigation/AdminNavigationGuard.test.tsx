import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	AdminNavigationGuardProvider,
	useAdminDirtyGuard,
	useAdminNavigationGuard
} from './AdminNavigationGuard'

type FormState = {
	label: string
	dirty: boolean
	pending?: boolean
	recoverable?: boolean
	onDiscard?: () => void
}

function GuardControls({
	state,
	onNavigate,
	onSaved
}: {
	state: FormState
	onNavigate: () => void
	onSaved?: () => void
}) {
	const { markClean, confirmDiscard } = useAdminDirtyGuard(state)
	const navigation = useAdminNavigationGuard()

	return (
		<div>
			<button onClick={() => navigation.confirmNavigation(onNavigate)}>
				Quick navigate
			</button>
			<button onClick={() => confirmDiscard(onNavigate)}>
				Discard this form
			</button>
			<button
				onClick={() => {
					markClean()
					onSaved?.()
				}}
			>
				Save completed
			</button>
		</div>
	)
}

function TestProvider({ children }: React.PropsWithChildren) {
	return (
		<AdminNavigationGuardProvider>{children}</AdminNavigationGuardProvider>
	)
}

function suppressAnchorDefault(anchor: HTMLElement) {
	anchor.addEventListener('click', event => event.preventDefault(), {
		once: true
	})
}

const confirm = vi.fn(() => false)
const alert = vi.fn()

beforeEach(() => {
	confirm.mockReset().mockReturnValue(false)
	alert.mockReset()
	vi.stubGlobal('confirm', confirm)
	vi.stubGlobal('alert', alert)
	history.replaceState(null, '', '/admin/users')
})

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

describe('admin navigation guard', () => {
	it('keeps the registered state current across rerenders and allows an unchanged form through', () => {
		const onNavigate = vi.fn()
		const view = render(
			<TestProvider>
				<GuardControls
					state={{ label: 'User', dirty: false }}
					onNavigate={onNavigate}
				/>
			</TestProvider>
		)

		view.rerender(
			<TestProvider>
				<GuardControls
					state={{ label: 'User', dirty: true }}
					onNavigate={onNavigate}
				/>
			</TestProvider>
		)
		confirm.mockReturnValue(true)
		fireEvent.click(screen.getByRole('button', { name: 'Quick navigate' }))
		expect(confirm).toHaveBeenCalledOnce()
		expect(onNavigate).toHaveBeenCalledOnce()

		view.rerender(
			<TestProvider>
				<GuardControls
					state={{ label: 'User', dirty: false }}
					onNavigate={onNavigate}
				/>
			</TestProvider>
		)
		confirm.mockClear()
		fireEvent.click(screen.getByRole('button', { name: 'Quick navigate' }))
		expect(confirm).not.toHaveBeenCalled()
		expect(onNavigate).toHaveBeenCalledTimes(2)
	})

	it('cancels or confirms quick navigation and runs discard only after confirmation', () => {
		const onNavigate = vi.fn()
		const onDiscard = vi.fn()
		render(
			<TestProvider>
				<GuardControls
					state={{ label: 'User details', dirty: true, onDiscard }}
					onNavigate={onNavigate}
				/>
			</TestProvider>
		)

		fireEvent.click(screen.getByRole('button', { name: 'Quick navigate' }))
		expect(onNavigate).not.toHaveBeenCalled()
		expect(onDiscard).not.toHaveBeenCalled()

		confirm.mockReturnValue(true)
		fireEvent.click(screen.getByRole('button', { name: 'Quick navigate' }))
		expect(onNavigate).toHaveBeenCalledOnce()
		expect(onDiscard).toHaveBeenCalledOnce()
	})

	it('clears the guard when a successful save resets the baseline', () => {
		const onNavigate = vi.fn()
		const onDiscard = vi.fn()
		render(
			<TestProvider>
				<GuardControls
					state={{ label: 'User details', dirty: true, onDiscard }}
					onNavigate={onNavigate}
				/>
			</TestProvider>
		)

		fireEvent.click(screen.getByRole('button', { name: 'Save completed' }))
		fireEvent.click(screen.getByRole('button', { name: 'Quick navigate' }))
		expect(confirm).not.toHaveBeenCalled()
		expect(onDiscard).not.toHaveBeenCalled()
		expect(onNavigate).toHaveBeenCalledOnce()
	})

	it('blocks beforeunload while dirty or pending, and permits it after save', () => {
		const view = render(
			<TestProvider>
				<GuardControls
					state={{ label: 'User', dirty: true }}
					onNavigate={vi.fn()}
				/>
			</TestProvider>
		)
		const dirtyEvent = new Event('beforeunload', { cancelable: true })
		window.dispatchEvent(dirtyEvent)
		expect(dirtyEvent.defaultPrevented).toBe(true)

		view.rerender(
			<TestProvider>
				<GuardControls
					state={{ label: 'User', dirty: false, pending: true }}
					onNavigate={vi.fn()}
				/>
			</TestProvider>
		)
		const pendingEvent = new Event('beforeunload', { cancelable: true })
		window.dispatchEvent(pendingEvent)
		expect(pendingEvent.defaultPrevented).toBe(true)

		view.rerender(
			<TestProvider>
				<GuardControls
					state={{ label: 'User', dirty: false, pending: false }}
					onNavigate={vi.fn()}
				/>
			</TestProvider>
		)
		const cleanEvent = new Event('beforeunload', { cancelable: true })
		window.dispatchEvent(cleanEvent)
		expect(cleanEvent.defaultPrevented).toBe(false)
	})

	it('intercepts same-tab route links and lets modified, new-tab, download, and same-screen links pass', () => {
		const onDiscard = vi.fn()
		render(
			<TestProvider>
				<GuardControls
					state={{ label: 'User', dirty: true, onDiscard }}
					onNavigate={vi.fn()}
				/>
				<a href="/admin/settings" data-testid="route">
					Route
				</a>
				<a href="/admin/settings" target="_blank" data-testid="new-tab">
					New tab
				</a>
				<a href="/admin/settings" download data-testid="download">
					Download
				</a>
				<a href="/admin/users?filter=active" data-testid="query">
					Query
				</a>
				<a href="/admin/users#form" data-testid="hash">
					Hash
				</a>
				<a href="/admin/settings" data-testid="modified">
					Modified
				</a>
			</TestProvider>
		)

		const routeClick = new MouseEvent('click', {
			bubbles: true,
			cancelable: true,
			button: 0
		})
		const route = screen.getByTestId('route')
		suppressAnchorDefault(route)
		route.dispatchEvent(routeClick)
		expect(routeClick.defaultPrevented).toBe(true)
		expect(confirm).toHaveBeenCalledOnce()
		expect(onDiscard).not.toHaveBeenCalled()

		confirm.mockClear()
		const allowedAtCapture: boolean[] = []
		const observeCapture = (event: MouseEvent) => {
			allowedAtCapture.push(event.defaultPrevented)
			event.preventDefault()
		}
		document.addEventListener('click', observeCapture, true)
		const modifiedClick = new MouseEvent('click', {
			bubbles: true,
			cancelable: true,
			button: 0,
			ctrlKey: true
		})
		const modified = screen.getByTestId('modified')
		suppressAnchorDefault(modified)
		modified.dispatchEvent(modifiedClick)
		const skippedLinks = ['new-tab', 'download', 'query', 'hash']
		skippedLinks.forEach((name, index) => {
			const click = new MouseEvent('click', {
				bubbles: true,
				cancelable: true,
				button: 0
			})
			const anchor = screen.getByTestId(name)
			suppressAnchorDefault(anchor)
			anchor.dispatchEvent(click)
			expect(allowedAtCapture[index + 1]).toBe(false)
		})
		document.removeEventListener('click', observeCapture, true)
		expect(allowedAtCapture[0]).toBe(false)
		expect(confirm).not.toHaveBeenCalled()

		confirm.mockReturnValue(true)
		const acceptedRouteClick = new MouseEvent('click', {
			bubbles: true,
			cancelable: true,
			button: 0
		})
		suppressAnchorDefault(route)
		route.dispatchEvent(acceptedRouteClick)
		expect(confirm).toHaveBeenCalledOnce()
		expect(onDiscard).toHaveBeenCalledOnce()
	})

	it('blocks pending operations even when confirmation would be accepted', () => {
		const onNavigate = vi.fn()
		const onDiscard = vi.fn()
		confirm.mockReturnValue(true)
		render(
			<TestProvider>
				<GuardControls
					state={{
						label: 'Payment',
						dirty: true,
						pending: true,
						onDiscard
					}}
					onNavigate={onNavigate}
				/>
				<a href="/admin/settings" data-testid="pending-route">
					Route
				</a>
			</TestProvider>
		)

		const routeClick = new MouseEvent('click', {
			bubbles: true,
			cancelable: true,
			button: 0
		})
		const route = screen.getByTestId('pending-route')
		suppressAnchorDefault(route)
		route.dispatchEvent(routeClick)
		expect(routeClick.defaultPrevented).toBe(true)
		expect(alert).toHaveBeenCalledOnce()
		expect(confirm).not.toHaveBeenCalled()
		expect(onDiscard).not.toHaveBeenCalled()
		expect(onNavigate).not.toHaveBeenCalled()
	})

	it('keeps recoverable commands registered after cancel and allows leaving without discarding them', () => {
		const onNavigate = vi.fn()
		const onDiscard = vi.fn()
		render(
			<TestProvider>
				<GuardControls
					state={{
						label: 'Subscription change',
						dirty: false,
						recoverable: true,
						onDiscard
					}}
					onNavigate={onNavigate}
				/>
			</TestProvider>
		)

		fireEvent.click(screen.getByRole('button', { name: 'Quick navigate' }))
		expect(confirm).toHaveBeenCalledOnce()
		expect(onNavigate).not.toHaveBeenCalled()
		expect(onDiscard).not.toHaveBeenCalled()

		confirm.mockReturnValue(true)
		fireEvent.click(screen.getByRole('button', { name: 'Quick navigate' }))
		expect(confirm).toHaveBeenCalledTimes(2)
		expect(onNavigate).toHaveBeenCalledOnce()
		expect(onDiscard).not.toHaveBeenCalled()
	})

	it('blocks recoverable commands while a request is still pending, even when confirmation would be accepted', () => {
		const onNavigate = vi.fn()
		confirm.mockReturnValue(true)
		render(
			<TestProvider>
				<GuardControls
					state={{
						label: 'Subscription change',
						dirty: false,
						pending: true,
						recoverable: true
					}}
					onNavigate={onNavigate}
				/>
			</TestProvider>
		)

		fireEvent.click(screen.getByRole('button', { name: 'Quick navigate' }))
		expect(alert).toHaveBeenCalledOnce()
		expect(confirm).not.toHaveBeenCalled()
		expect(onNavigate).not.toHaveBeenCalled()
	})

	it('blocks beforeunload while a command has a recoverable result pointer', () => {
		render(
			<TestProvider>
				<GuardControls
					state={{
						label: 'Subscription change',
						dirty: false,
						recoverable: true
					}}
					onNavigate={vi.fn()}
				/>
			</TestProvider>
		)

		const event = new Event('beforeunload', { cancelable: true })
		window.dispatchEvent(event)
		expect(event.defaultPrevented).toBe(true)
	})

	it('aggregates several forms for route links and unregisters a form when its owner unmounts', () => {
		const discarded = vi.fn()
		const { rerender } = render(
			<TestProvider>
				<GuardControls
					state={{ label: 'First', dirty: true, onDiscard: discarded }}
					onNavigate={vi.fn()}
				/>
				<GuardControls
					state={{ label: 'Second', dirty: true }}
					onNavigate={vi.fn()}
				/>
				<a href="/admin/settings" data-testid="route">
					Route
				</a>
			</TestProvider>
		)
		confirm.mockReturnValue(true)
		const accepted = new MouseEvent('click', {
			bubbles: true,
			cancelable: true,
			button: 0
		})
		const route = screen.getByTestId('route')
		suppressAnchorDefault(route)
		route.dispatchEvent(accepted)
		expect(confirm).toHaveBeenCalledOnce()
		expect(discarded).toHaveBeenCalledOnce()

		confirm.mockClear()
		rerender(
			<TestProvider>
				<a href="/admin/settings" data-testid="route">
					Route
				</a>
			</TestProvider>
		)
		const afterUnmount = new MouseEvent('click', {
			bubbles: true,
			cancelable: true,
			button: 0
		})
		const cleanRoute = screen.getByTestId('route')
		suppressAnchorDefault(cleanRoute)
		cleanRoute.dispatchEvent(afterUnmount)
		expect(confirm).not.toHaveBeenCalled()
	})

	it('runs an unguarded navigation action when used without the provider', () => {
		const onNavigate = vi.fn()
		render(
			<GuardControls
				state={{ label: 'User', dirty: true }}
				onNavigate={onNavigate}
			/>
		)
		fireEvent.click(screen.getByRole('button', { name: 'Quick navigate' }))
		expect(confirm).not.toHaveBeenCalled()
		expect(onNavigate).toHaveBeenCalledOnce()
	})
})
