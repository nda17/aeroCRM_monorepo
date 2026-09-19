'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import {
	crmPermissionScope,
	useCrmPermissions,
	useCrmWorkspaceAccess
} from '@/entities/crm-access'
import { useSessionStore } from '@/entities/session'
import {
	useAssigneeOptions,
	type AssigneeDirectoryContext
} from '@/entities/crm-team'
import {
	sameReminderBinding,
	type ReminderBinding
} from '@/entities/crm-reminders'

export const useReminderSession = () => {
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
		scopeKey
	])
	const canRead =
		!!session &&
		!!authority &&
		permissions.isSuccess &&
		!permissions.isFetching &&
		authority.subject === session.userId &&
		authority.workspaceId === workspace.workspaceId &&
		authority.role !== 'ANALYST' &&
		authority.permissions.includes('sales:read')
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
	const self = useAssigneeOptions(directory, {
		selectedSubject: session?.userId
	})
	const selected = self.selected
	const confirmedActor =
		selected &&
		selected.subject === session?.userId &&
		selected.role === authority?.role
			? {
					subject: selected.subject,
					membershipId:
						selected.role === 'OWNER' ? null : selected.membershipId
				}
			: null
	// Retain only the draft's proven binding during refresh, never its eligibility.
	const [previous, setPrevious] = useState<{
		key: string
		actor: ReminderBinding | null
	}>({ key, actor: null })
	if (
		confirmedActor &&
		(previous.key !== key ||
			!previous.actor ||
			!sameReminderBinding(previous.actor, confirmedActor))
	)
		setPrevious({ key, actor: confirmedActor })
	const actor =
		confirmedActor ?? (previous.key === key ? previous.actor : null)
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
		self,
		actor,
		actorConfirmed: !!confirmedActor,
		canWrite:
			canRead &&
			workspace.canWrite &&
			authority?.state !== 'READ_ONLY' &&
			authority?.permissions.includes('sales:write') === true
	}
}
export type ReminderContext = ReturnType<typeof useReminderSession>
