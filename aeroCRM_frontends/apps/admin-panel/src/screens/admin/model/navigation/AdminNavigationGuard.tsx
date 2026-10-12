'use client'

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	type PropsWithChildren
} from 'react'
import { installAdminHistoryGuard } from './history'

interface FormState {
	label: string
	dirty: boolean
	// A sent command is separate from a draft and cannot be discarded.
	pending?: boolean
	// These screens already persist an actor-bound recovery pointer before send.
	recoverable?: boolean
	onDiscard?: () => void
}

class AdminGuard {
	private forms = new Map<string, () => FormState>()
	private approved = false

	register(id: string, read: () => FormState) {
		this.forms.set(id, read)
		return () => {
			this.forms.delete(id)
		}
	}

	hasChanges = () =>
		!this.approved &&
		Array.from(this.forms.values()).some(read => {
			const state = read()
			return state.dirty || state.pending || state.recoverable
		})

	confirmNavigation = (action: () => void, ids?: readonly string[]) => {
		if (this.approved) {
			action()
			return true
		}
		const states = Array.from(this.forms.entries())
			.filter(([id]) => !ids || ids.includes(id))
			.map(([, read]) => read())
		const pending = states.find(state => state.pending)
		if (pending) {
			window.alert(
				`«${pending.label}»: операция ещё выполняется или её результат не подтверждён. Проверьте результат или повторите ту же попытку перед выходом.`
			)
			return false
		}
		const dirty = states.filter(state => state.dirty)
		const recoverable = states.some(state => state.recoverable)
		if (
			(dirty.length || recoverable) &&
			!window.confirm(
				recoverable
					? `Результат операции ещё не подтверждён. Номер для проверки сохранён в этой вкладке.${dirty.length ? ' Несохранённые изменения формы будут потеряны.' : ''} Перейти и проверить результат позже?`
					: 'Есть несохранённые изменения. Перейти без сохранения?'
			)
		)
			return false
		dirty.forEach(state => state.onDiscard?.())
		this.approved = true
		try {
			action()
		} finally {
			window.setTimeout(() => {
				this.approved = false
			}, 0)
		}
		return true
	}
}

const Context = createContext<AdminGuard | null>(null)
const cleanGuard = {
	confirmNavigation: (action: () => void) => {
		action()
		return true
	}
}

export function AdminNavigationGuardProvider({
	children
}: PropsWithChildren) {
	const [guard] = useState(() => new AdminGuard())
	useEffect(() => {
		const beforeUnload = (event: BeforeUnloadEvent) => {
			if (!guard.hasChanges()) return
			event.preventDefault()
			event.returnValue = ''
		}
		const click = (event: MouseEvent) => {
			if (
				event.defaultPrevented ||
				event.button !== 0 ||
				event.metaKey ||
				event.ctrlKey ||
				event.shiftKey ||
				event.altKey
			)
				return
			const anchor =
				event.target instanceof Element
					? event.target.closest('a[href]')
					: null
			if (
				!(anchor instanceof HTMLAnchorElement) ||
				anchor.hasAttribute('download') ||
				(anchor.target && anchor.target !== '_self')
			)
				return
			const url = new URL(anchor.href, location.href)
			// Query-only changes keep the same screen and its drafts mounted.
			if (
				!['http:', 'https:'].includes(url.protocol) ||
				(url.origin === location.origin &&
					url.pathname === location.pathname)
			)
				return
			if (!guard.hasChanges()) return
			if (!guard.confirmNavigation(() => undefined)) {
				event.preventDefault()
				event.stopImmediatePropagation()
			}
		}
		window.addEventListener('beforeunload', beforeUnload)
		document.addEventListener('click', click, true)
		const removeHistoryGuard = installAdminHistoryGuard(guard)
		return () => {
			window.removeEventListener('beforeunload', beforeUnload)
			document.removeEventListener('click', click, true)
			removeHistoryGuard()
		}
	}, [guard])
	return <Context.Provider value={guard}>{children}</Context.Provider>
}

export const useAdminNavigationGuard = () =>
	useContext(Context) ?? cleanGuard

// Only metadata reaches the registry. Values, files, credentials and command
// payloads remain with their existing screen/hook and are never persisted here.
export const useAdminDirtyGuard = (state: FormState) => {
	const guard = useContext(Context)
	const id = useId()
	const current = useRef(state)
	current.current = state
	useLayoutEffect(
		() => guard?.register(id, () => current.current),
		[guard, id]
	)
	const markClean = useCallback(() => {
		current.current = { ...current.current, dirty: false }
	}, [])
	const confirmDiscard = useCallback(
		(action: () => void) => {
			if (guard) return guard.confirmNavigation(action, [id])
			action()
			return true
		},
		[guard, id]
	)
	return { markClean, confirmDiscard }
}
