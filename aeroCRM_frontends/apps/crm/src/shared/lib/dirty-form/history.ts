import type { DirtyFormCoordinator } from './coordinator'

const INDEX = '__crmHistoryIndex'
type IndexedState = Record<string, unknown> & { [INDEX]?: number }
const indexOf = (state: unknown) => {
	if (!state || typeof state !== 'object') return null
	const value = (state as IndexedState)[INDEX]
	return typeof value === 'number' && Number.isSafeInteger(value)
		? value
		: null
}
type NavigationEvent = Event & {
	navigationType: string
	destination: { key: string; sameDocument: boolean }
}
type BrowserNavigation = EventTarget & {
	traverseTo: (key: string) => unknown
}

export const installDirtyHistoryGuard = (guard: DirtyFormCoordinator) => {
	const navigation = (
		window as Window & { navigation?: BrowserNavigation }
	).navigation
	if (navigation) {
		let approvedKey: string | null = null
		const navigate = (event: Event) => {
			const transition = event as NavigationEvent
			if (
				transition.navigationType !== 'traverse' ||
				!transition.destination.sameDocument
			)
				return
			if (approvedKey === transition.destination.key) {
				approvedKey = null
				return
			}
			if (!transition.cancelable || !guard.hasDirty()) return
			transition.preventDefault()
			guard.confirmDiscard(() => {
				approvedKey = transition.destination.key
				navigation.traverseTo(approvedKey)
			})
		}
		navigation.addEventListener('navigate', navigate)
		return () => navigation.removeEventListener('navigate', navigate)
	}

	// App Router has no beforePopState. Restore the known history position before
	// allowing Next to see the event; preventDefault alone cannot stop traversal.
	const originalPush = window.history.pushState
	const originalReplace = window.history.replaceState
	let currentIndex = indexOf(window.history.state) ?? 0
	let restoring = false
	let approvedIndex: number | null = null
	let pendingDelta = 0
	originalReplace.call(
		window.history,
		{ ...window.history.state, [INDEX]: currentIndex },
		''
	)
	const push: History['pushState'] = function (
		this: History,
		state,
		unused,
		url
	) {
		currentIndex += 1
		return originalPush.call(
			this,
			{ ...state, [INDEX]: currentIndex },
			unused,
			url
		)
	}
	const replace: History['replaceState'] = function (
		this: History,
		state,
		unused,
		url
	) {
		return originalReplace.call(
			this,
			{ ...state, [INDEX]: currentIndex },
			unused,
			url
		)
	}
	window.history.pushState = push
	window.history.replaceState = replace
	const pop = (event: PopStateEvent) => {
		const targetIndex = indexOf(event.state)
		if (restoring) {
			event.stopImmediatePropagation()
			restoring = false
			const delta = pendingDelta
			const destination = currentIndex + delta
			guard.confirmDiscard(() => {
				approvedIndex = destination
				window.history.go(delta)
			})
			return
		}
		if (targetIndex === null) return
		if (targetIndex === approvedIndex) {
			approvedIndex = null
			currentIndex = targetIndex
			return
		}
		if (targetIndex === currentIndex || !guard.hasDirty()) {
			currentIndex = targetIndex
			return
		}
		event.stopImmediatePropagation()
		pendingDelta = targetIndex - currentIndex
		restoring = true
		window.history.go(-pendingDelta)
	}
	window.addEventListener('popstate', pop, true)
	return () => {
		window.removeEventListener('popstate', pop, true)
		if (window.history.pushState === push)
			window.history.pushState = originalPush
		if (window.history.replaceState === replace)
			window.history.replaceState = originalReplace
	}
}
