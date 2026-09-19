'use client'

import {
	useCrmPermissions,
	useCrmWorkspaceAccess,
	crmPermissionScope
} from '@/entities/crm-access'
import { useSessionStore } from '@/entities/session'

export const useSalesSession = () => {
	const workspace = useCrmWorkspaceAccess()
	const { session, sessionRevision } = useSessionStore()
	const permissions = useCrmPermissions(
		workspace.workspaceId,
		session,
		sessionRevision
	)
	const canRead =
		!!session &&
		!permissions.isFetching &&
		permissions.data?.subject === session?.userId &&
		!!permissions.data &&
		!permissions.isError &&
		permissions.data.permissions.includes('sales:read') &&
		permissions.data.role !== 'ANALYST'
	const canWrite =
		canRead &&
		workspace.canWrite &&
		!permissions.isFetching &&
		permissions.data?.state !== 'READ_ONLY' &&
		permissions.data?.permissions.includes('sales:write') === true
	const scopeKey = crmPermissionScope(permissions.data)
	const key = [
		workspace.workspaceId,
		session?.userId,
		sessionRevision,
		scopeKey
	] as const
	return {
		workspace,
		session,
		sessionRevision,
		permissions,
		canRead,
		canWrite,
		key,
		scopeKey
	}
}
