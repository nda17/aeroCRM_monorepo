'use client'

import {
	useCrmPermissions,
	useCrmWorkspaceAccess,
	crmPermissionScope
} from '@/entities/crm-access'
import { useSessionStore } from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { useSyncExternalStore } from 'react'

const subscribe = (notify: () => void) => {
	window.addEventListener('online', notify)
	window.addEventListener('offline', notify)
	return () => {
		window.removeEventListener('online', notify)
		window.removeEventListener('offline', notify)
	}
}
export const useIntakeAccess = () => {
	const workspace = useCrmWorkspaceAccess()
	const session = useSessionStore(state => state.session)
	const revision = useSessionStore(state => state.sessionRevision)
	const permissions = useCrmPermissions(
		workspace.workspaceId,
		session,
		revision
	)
	const online = useSyncExternalStore(
		subscribe,
		() => navigator.onLine,
		() => true
	)
	const confirmed = permissions.isSuccess && !permissions.isFetching
	const canRead =
		confirmed &&
		permissions.data.subject === session?.userId &&
		permissions.data.permissions.includes('intake:read')
	const sourceManager =
		canRead && ['OWNER', 'CRM_ADMIN'].includes(permissions.data!.role)
	const canWrite =
		confirmed &&
		canRead &&
		online &&
		workspace.canWrite &&
		permissions.data!.permissions.includes('intake:write')
	const canManageSources =
		confirmed &&
		sourceManager &&
		online &&
		workspace.canWrite &&
		permissions.data!.permissions.includes('intake:manage-sources')
	const authorize = async (
		permission: 'intake:write' | 'intake:manage-sources'
	) => {
		if (!session || !navigator.onLine)
			throw new AuthenticatedApiError(
				'temporary',
				'Нет подключения к сети. Повторите запрос после восстановления связи.'
			)
		const result = await permissions.refetch()
		if (result.error) throw result.error
		const currentState = useSessionStore.getState()
		const current = currentState.session
		if (
			!current ||
			currentState.sessionRevision !== revision ||
			current.userId !== session.userId ||
			result.data?.subject !== current.userId
		)
			throw new AuthenticatedApiError(
				'unauthorized',
				'Сессия изменилась. Откройте раздел заново.'
			)
		if (
			!workspace.canWrite ||
			result.data?.state === 'READ_ONLY' ||
			!result.data?.permissions.includes(permission)
		)
			throw new AuthenticatedApiError(
				'forbidden',
				'Изменения недоступны для текущей CRM-роли или подписки.'
			)
		return current.accessToken
	}
	return {
		scopeKey: crmPermissionScope(permissions.data),
		workspaceId: workspace.workspaceId,
		session,
		revision,
		permissions,
		confirmed,
		online,
		canRead,
		sourceManager,
		canWrite,
		canManageSources,
		authorize
	}
}
export type IntakeAccess = ReturnType<typeof useIntakeAccess>
