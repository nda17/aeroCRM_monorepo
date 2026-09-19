'use client'

import { useLayoutEffect, useRef } from 'react'
import {
	crmPermissionScope,
	useCrmPermissions,
	useCrmWorkspaceAccess
} from '@/entities/crm-access'
import { useSessionStore } from '@/entities/session'
import type { AssigneeDirectoryContext } from '@/entities/crm-team'

export const useSlaSession = () => {
	const workspace = useCrmWorkspaceAccess()
	const { session, sessionRevision } = useSessionStore()
	const permissions = useCrmPermissions(
		workspace.workspaceId,
		session,
		sessionRevision
	)
	const authority = permissions.data
	const scopeKey = crmPermissionScope(authority)
	const key = JSON.stringify([
		workspace.workspaceId,
		session?.userId,
		sessionRevision,
		scopeKey,
		authority?.state
	])
	const canRead =
		!!session &&
		!!authority &&
		permissions.isSuccess &&
		!permissions.isFetching &&
		authority.subject === session.userId &&
		authority.workspaceId === workspace.workspaceId &&
		['OWNER', 'CRM_ADMIN'].includes(authority.role) &&
		authority.permissions.includes('intake:read')
	const live = useRef({ key, canRead, mounted: true })
	useLayoutEffect(() => {
		live.current = { key, canRead, mounted: true }
		return () => {
			live.current.mounted = false
		}
	}, [key, canRead])
	const current = () => {
		const store = useSessionStore.getState()
		return (
			live.current.mounted &&
			live.current.canRead &&
			live.current.key === key &&
			!!session &&
			store.session?.accessToken === session.accessToken &&
			store.session?.userId === session.userId &&
			store.sessionRevision === sessionRevision
		)
	}
	const directory: AssigneeDirectoryContext = {
		workspaceId: workspace.workspaceId,
		subject: session?.userId,
		accessToken: session?.accessToken,
		sessionRevision,
		canRead,
		isCurrent: current,
		authority
	}
	return {
		workspace,
		session,
		sessionRevision,
		permissions,
		authority,
		scopeKey,
		key,
		canRead,
		current,
		directory,
		canWrite:
			canRead &&
			workspace.canWrite &&
			['ACTIVE', 'GRACE'].includes(authority!.state) &&
			authority!.permissions.includes('intake:write')
	}
}
export type SlaContext = ReturnType<typeof useSlaSession>
