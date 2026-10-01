'use client'

import {
	crmPermissionScope,
	useCrmPermissions,
	useCrmWorkspaceAccess
} from '@/entities/crm-access'
import type { ImportEntity } from '@/entities/crm-import/model/import.contract'
import { useSessionStore } from '@/entities/session'
import { useDirtyFormGuard } from '@/shared/lib/dirty-form'
import { Button } from '@/shared/ui'
import { useState } from 'react'
import { ImportRecordsDrawer } from './ImportRecordsDrawer'

export const ImportRecordsControl = ({
	entity,
	disabled = false
}: {
	entity: ImportEntity
	disabled?: boolean
}) => {
	const workspace = useCrmWorkspaceAccess()
	const { session, sessionRevision } = useSessionStore()
	const permissions = useCrmPermissions(
		workspace.workspaceId,
		session,
		sessionRevision
	)
	const guard = useDirtyFormGuard()
	const [opened, setOpened] = useState<string | null>(null)
	const scope = crmPermissionScope(permissions.data)
	const key = JSON.stringify([
		workspace.workspaceId,
		session?.userId,
		sessionRevision,
		scope,
		entity
	])
	const area = entity === 'deals' ? 'sales' : 'customers'
	const canRead =
		!!session &&
		permissions.isSuccess &&
		permissions.data.subject === session.userId &&
		permissions.data.workspaceId === workspace.workspaceId &&
		permissions.data.permissions.includes(`${area}:read`) &&
		(entity !== 'deals' ||
			permissions.data.permissions.includes('customers:read'))
	const canWrite =
		canRead &&
		workspace.canWrite &&
		!permissions.isFetching &&
		permissions.data?.state !== 'READ_ONLY' &&
		permissions.data?.permissions.includes(`${area}:write`) === true &&
		!disabled
	return (
		<>
			<Button
				variant="secondary"
				disabled={!canRead || disabled}
				onClick={() => guard.confirmDiscard(() => setOpened(key))}
			>
				{canWrite ? 'Импорт Excel / CSV' : 'Просмотр импорта'}
			</Button>
			{opened === key && canRead && session && (
				<ImportRecordsDrawer
					key={key}
					entity={entity}
					workspaceId={workspace.workspaceId}
					session={session}
					revision={sessionRevision}
					scope={scope}
					canWrite={canWrite}
					onClose={() => setOpened(null)}
				/>
			)}
		</>
	)
}
