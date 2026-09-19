'use client'

import { useSessionStore } from '@/entities/session'
import { isUuidV4 } from '@/shared/lib/contract'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Billing is session-scoped, not dependent on a writable CRM workspace. */
export const useBillingActor = (workspaceId: string) => {
	const { session, sessionRevision, status } = useSessionStore()
	const [online, setOnline] = useState(true)
	const scope = JSON.stringify([
		workspaceId,
		session?.userId,
		sessionRevision
	])
	const mountedScope = useRef<string | null>(null)
	useLayoutEffect(() => {
		mountedScope.current = scope
		return () => {
			mountedScope.current = null
		}
	}, [scope])
	useEffect(() => {
		const update = () => setOnline(navigator.onLine)
		update()
		window.addEventListener('online', update)
		window.addEventListener('offline', update)
		return () => {
			window.removeEventListener('online', update)
			window.removeEventListener('offline', update)
		}
	}, [])
	const current = () => {
		const now = useSessionStore.getState()
		return (
			mountedScope.current === scope &&
			!!session &&
			now.status === 'authenticated' &&
			now.session?.userId === session.userId &&
			now.session?.accessToken === session.accessToken &&
			now.sessionRevision === sessionRevision
		)
	}
	return {
		workspaceId,
		session,
		sessionRevision,
		online,
		scope,
		key: [workspaceId, session?.userId, sessionRevision] as const,
		current,
		enabled:
			status === 'authenticated' &&
			!!session &&
			isUuidV4(workspaceId) &&
			online
	}
}
