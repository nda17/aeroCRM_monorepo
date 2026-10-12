interface NavigationGuard {
	hasChanges: () => boolean
	confirmNavigation: (action: () => void) => boolean
}

const INDEX = '__adminHistoryIndex'
const indexOf = (state: unknown) => {
	if (!state || typeof state !== 'object') return null
	const value = (state as Record<string, unknown>)[INDEX]
	return typeof value === 'number' && Number.isSafeInteger(value)
		? value
		: null
}

type NavigationEvent = Event & {
	navigationType: string
	destination: { sameDocument: boolean; url: string }
}

const changesPage = (from: string, to: string) => {
	const current = new URL(from)
	const destination = new URL(to, from)
	return (
		current.origin !== destination.origin ||
		current.pathname !== destination.pathname
	)
}

export const installAdminHistoryGuard = (guard: NavigationGuard) => {
	const navigation = (window as Window & { navigation?: EventTarget })
		.navigation
	if (navigation) {
		const navigate = (event: Event) => {
			const transition = event as NavigationEvent
			if (
				transition.navigationType !== 'traverse' ||
				!transition.destination.sameDocument ||
				!transition.cancelable ||
				!changesPage(location.href, transition.destination.url) ||
				!guard.hasChanges()
			)
				return
			if (!guard.confirmNavigation(() => undefined))
				transition.preventDefault()
		}
		navigation.addEventListener('navigate', navigate)
		return () => navigation.removeEventListener('navigate', navigate)
	}

	// App Router has no beforePopState. Restore the known position before Next
	// receives the event; preventDefault alone cannot undo a history traversal.
	const originalPush = window.history.pushState
	const originalReplace = window.history.replaceState
	let currentIndex = indexOf(window.history.state) ?? 0
	let currentHref = location.href
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
		const result = originalPush.call(
			this,
			{ ...state, [INDEX]: currentIndex },
			unused,
			url
		)
		currentHref = location.href
		return result
	}
	const replace: History['replaceState'] = function (
		this: History,
		state,
		unused,
		url
	) {
		const result = originalReplace.call(
			this,
			{ ...state, [INDEX]: currentIndex },
			unused,
			url
		)
		currentHref = location.href
		return result
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
			guard.confirmNavigation(() => {
				approvedIndex = destination
				window.history.go(delta)
			})
			return
		}
		if (targetIndex === null) return
		if (targetIndex === approvedIndex) {
			approvedIndex = null
			currentIndex = targetIndex
			currentHref = location.href
			return
		}
		if (
			targetIndex === currentIndex ||
			!changesPage(currentHref, location.href) ||
			!guard.hasChanges()
		) {
			currentIndex = targetIndex
			currentHref = location.href
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
