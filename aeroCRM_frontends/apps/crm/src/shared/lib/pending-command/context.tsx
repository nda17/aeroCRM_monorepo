'use client'

import {
	createContext,
	useContext,
	useEffect,
	useLayoutEffect,
	useState,
	useSyncExternalStore,
	type PropsWithChildren
} from 'react'
import {
	PendingCommandCoordinator,
	type CommandScope
} from './coordinator'

const Context = createContext<PendingCommandCoordinator | null>(null)
export const PendingCommandProvider = ({
	owner,
	readOwner,
	subscribeOwner,
	children
}: PropsWithChildren<{
	owner: string | null
	readOwner?: () => string | null
	subscribeOwner?: (notify: (owner: string | null) => void) => () => void
}>) => {
	const [coordinator] = useState(
		() => new PendingCommandCoordinator(owner, readOwner)
	)
	useEffect(
		() => subscribeOwner?.(owner => coordinator.setOwner(owner)),
		[coordinator, subscribeOwner]
	)
	useLayoutEffect(() => {
		coordinator.setOwner(owner)
	}, [coordinator, owner])
	useEffect(() => {
		const warn = (event: BeforeUnloadEvent) => {
			if (!coordinator.hasUnresolved()) return
			event.preventDefault()
			event.returnValue = ''
		}
		window.addEventListener('beforeunload', warn)
		return () => {
			window.removeEventListener('beforeunload', warn)
			coordinator.setOwner(null)
		}
	}, [coordinator])
	return (
		<Context.Provider value={coordinator}>{children}</Context.Provider>
	)
}
export const usePendingCommand = (scope: CommandScope, intent: string) => {
	const coordinator = useContext(Context)
	if (!coordinator) throw new Error('PendingCommandProvider is required')
	const snapshot = useSyncExternalStore(
		coordinator.subscribe,
		() => coordinator.get(scope, intent),
		() => coordinator.get(scope, intent)
	)
	return { coordinator, snapshot }
}
export const commandOwner = (
	userId: string | undefined,
	revision: number
) => JSON.stringify([userId ?? null, revision])
