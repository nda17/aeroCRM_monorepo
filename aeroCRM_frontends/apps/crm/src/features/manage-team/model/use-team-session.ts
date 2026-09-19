'use client'

import {
	crmPermissionScope,
	useCrmPermissions,
	useCrmWorkspaceAccess
} from '@/entities/crm-access'
import { useSessionStore } from '@/entities/session'

export const useTeamSession = () => {
	const workspace = useCrmWorkspaceAccess()
	const { session, sessionRevision } = useSessionStore()
	const permissions = useCrmPermissions(
		workspace.workspaceId,
		session,
		sessionRevision
	)
	const confirmed = permissions.isSuccess && !permissions.isFetching
	const canRead =
		!!session &&
		confirmed &&
		permissions.data.subject === session.userId &&
		['OWNER', 'CRM_ADMIN'].includes(permissions.data.role) &&
		permissions.data.permissions.includes('access:read-team')
	const writable =
		canRead &&
		workspace.canWrite &&
		permissions.data?.state !== 'READ_ONLY'
	const canManage =
		writable &&
		permissions.data?.permissions.includes('access:manage-team') === true
	const canRevoke =
		writable &&
		permissions.data?.permissions.includes('access:revoke-access') === true
	const scopeKey = crmPermissionScope(permissions.data)
	return {
		workspace,
		session,
		sessionRevision,
		permissions,
		confirmed,
		canRead,
		canManage,
		canRevoke,
		scopeKey,
		key: [
			workspace.workspaceId,
			session?.userId,
			sessionRevision,
			scopeKey
		] as const
	}
}
