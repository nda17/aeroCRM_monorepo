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
	useSyncExternalStore,
	type PropsWithChildren
} from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/shared/ui/button'
import { DirtyFormCoordinator } from './coordinator'
import { installDirtyHistoryGuard } from './history'
import styles from './DirtyFormDialog.module.scss'

const Context = createContext<DirtyFormCoordinator | null>(null)
const ScopeContext = createContext<readonly string[]>([])
export const DirtyFormScope = ({
	id,
	children
}: PropsWithChildren<{ id: string }>) => {
	const parent = useContext(ScopeContext)
	const scopes = useState(() => [...parent, id])[0]
	return (
		<ScopeContext.Provider value={scopes}>
			{children}
		</ScopeContext.Provider>
	)
}
const cleanGuard = { confirmDiscard: (action: () => void) => action() }
export const DirtyFormProvider = ({
	owner,
	readOwner,
	subscribeOwner,
	children
}: PropsWithChildren<{
	owner: string | null
	readOwner?: () => string | null
	subscribeOwner?: (notify: (owner: string | null) => void) => () => void
}>) => {
	const [guard] = useState(
		() => new DirtyFormCoordinator(owner, readOwner)
	)
	useLayoutEffect(() => guard.setOwner(owner), [guard, owner])
	useEffect(
		() => subscribeOwner?.(value => guard.setOwner(value)),
		[guard, subscribeOwner]
	)
	useEffect(() => {
		let approvedUnload = false
		const beforeUnload = (event: BeforeUnloadEvent) => {
			if (approvedUnload || !guard.hasDirty()) return
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
				anchor.download ||
				(anchor.target && anchor.target !== '_self')
			)
				return
			const url = new URL(anchor.href, location.href)
			if (
				!['http:', 'https:'].includes(url.protocol) ||
				url.href === location.href ||
				(url.origin === location.origin &&
					url.pathname === location.pathname &&
					url.search === location.search)
			)
				return
			if (!guard.hasDirty()) return
			event.preventDefault()
			event.stopPropagation()
			guard.confirmDiscard(() => {
				approvedUnload = true
				anchor.click()
				window.setTimeout(() => {
					approvedUnload = false
				}, 0)
			})
		}
		window.addEventListener('beforeunload', beforeUnload)
		document.addEventListener('click', click, true)
		const removeHistoryGuard = installDirtyHistoryGuard(guard)
		return () => {
			window.removeEventListener('beforeunload', beforeUnload)
			document.removeEventListener('click', click, true)
			removeHistoryGuard()
			guard.setOwner(null)
		}
	}, [guard])
	return (
		<Context.Provider value={guard}>
			{children}
			<DiscardDialog guard={guard} />
		</Context.Provider>
	)
}
const DiscardDialog = ({ guard }: { guard: DirtyFormCoordinator }) => {
	useSyncExternalStore(guard.subscribe, guard.snapshot, guard.snapshot)
	const ref = useRef<HTMLDialogElement>(null)
	const titleId = useId()
	const open = guard.isConfirming()
	useEffect(() => {
		const dialog = ref.current
		if (open && dialog && !dialog.open) dialog.showModal()
		else if (!open && dialog?.open) dialog.close()
	}, [open])
	return (
		<dialog
			ref={ref}
			className={styles.dialog}
			aria-labelledby={titleId}
			onCancel={event => {
				event.preventDefault()
				guard.cancel()
			}}
		>
			<h2 id={titleId}>Несохранённые изменения</h2>
			<p>
				Изменения в форме будут потеряны. Отправленные операции продолжат
				выполняться.
			</p>
			<div className={styles.actions}>
				<Button
					variant="secondary"
					onClick={() => guard.cancel()}
					autoFocus
				>
					Продолжить редактирование
				</Button>
				<Button variant="danger" onClick={() => guard.discard()}>
					Отбросить изменения
				</Button>
			</div>
		</dialog>
	)
}
export const useDirtyFormGuard = () => useContext(Context) ?? cleanGuard
export const useDirtyForm = ({
	dirty,
	label
}: {
	dirty: boolean
	label: string
}) => {
	const guard = useContext(Context)
	const scopes = useContext(ScopeContext)
	const id = useId()
	useLayoutEffect(() => {
		guard?.update({ id, label, dirty, scopes })
	}, [guard, id, label, dirty, scopes])
	useLayoutEffect(() => () => guard?.remove(id), [guard, id])
	const confirmDiscard = useCallback(
		(action: () => void) => {
			if (guard) guard.confirmDiscard(action, [id])
			else action()
		},
		[guard, id]
	)
	const markClean = useCallback(
		() => guard?.update({ id, label, dirty: false, scopes }),
		[guard, id, label, scopes]
	)
	return { id, confirmDiscard, markClean }
}
// Local-state editors retain their own baseline. No values leave this hook.
export const useDirtyValue = (value: unknown, label: string) => {
	const serialized = JSON.stringify(value)
	const [baseline, setBaseline] = useState(serialized)
	const form = useDirtyForm({ dirty: serialized !== baseline, label })
	return {
		...form,
		resetBaseline: (nextValue: unknown = value) => {
			setBaseline(JSON.stringify(nextValue))
			form.markClean()
		}
	}
}
export const useGuardedRouter = () => {
	const router = useRouter()
	const guard = useDirtyFormGuard()
	return {
		...router,
		push: (...args: Parameters<typeof router.push>) =>
			guard.confirmDiscard(() => router.push(...args)),
		replace: (...args: Parameters<typeof router.replace>) =>
			guard.confirmDiscard(() => router.replace(...args)),
		back: () => guard.confirmDiscard(() => router.back()),
		forward: () => guard.confirmDiscard(() => router.forward())
	}
}
