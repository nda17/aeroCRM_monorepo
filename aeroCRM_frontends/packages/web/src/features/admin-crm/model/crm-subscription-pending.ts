import { useAuthStore } from '@/entities/user/model/auth-store'
import {
	CRM_ADMIN_UUID,
	type CrmAdminGrantCommand
} from './crm-subscriptions.contract'

export interface PendingCrmAdminGrant {
	workspaceId: string
	commandId: string
	command?: CrmAdminGrantCommand
}

const pendingByActor = new Map<string, PendingCrmAdminGrant>()
let boundActor: string | null = null
const key = (actorSubject: string) =>
	`wincrm-admin-grant-v1:${actorSubject}`

useAuthStore.subscribe((state, previous) => {
	if (
		state.auth !== previous.auth ||
		state.isAuthResolved !== previous.isAuthResolved
	) {
		pendingByActor.clear()
		boundActor = null
	}
})

export function bindCrmAdminGrantActor(actorSubject: string) {
	if (boundActor !== null && boundActor !== actorSubject)
		pendingByActor.clear()
	boundActor = actorSubject
}

export function readPendingCrmAdminGrant(
	actorSubject: string
): PendingCrmAdminGrant | null {
	const memory = pendingByActor.get(actorSubject)
	if (memory) return memory
	const raw = window.sessionStorage.getItem(key(actorSubject))
	if (raw === null) return null
	const marker: unknown = JSON.parse(raw)
	if (!marker || typeof marker !== 'object' || Array.isArray(marker))
		throw new Error('Invalid CRM pending marker')
	const value = marker as Record<string, unknown>
	if (
		Object.keys(value).length !== 3 ||
		value.schemaVersion !== 1 ||
		typeof value.workspaceId !== 'string' ||
		!CRM_ADMIN_UUID.test(value.workspaceId) ||
		typeof value.commandId !== 'string' ||
		!CRM_ADMIN_UUID.test(value.commandId)
	)
		throw new Error('Invalid CRM pending marker')
	return { workspaceId: value.workspaceId, commandId: value.commandId }
}

export function retainPendingCrmAdminGrant(
	actorSubject: string,
	workspaceId: string,
	command: CrmAdminGrantCommand
) {
	const auth = useAuthStore.getState()
	if (
		!auth.auth ||
		!auth.isAuthResolved ||
		boundActor !== actorSubject ||
		command.expectedActorSubject !== actorSubject
	)
		throw new Error('CRM grant authentication changed')
	const previous = readPendingCrmAdminGrant(actorSubject)
	if (previous) {
		if (
			previous.workspaceId !== workspaceId ||
			previous.commandId !== command.commandId ||
			previous.command !== command
		)
			throw new Error(
				'CRM grant is already unresolved or requires read-only recovery'
			)
		return previous
	}
	// Only a recovery pointer is persisted: no free-form reason, email or request body.
	window.sessionStorage.setItem(
		key(actorSubject),
		JSON.stringify({
			schemaVersion: 1,
			workspaceId,
			commandId: command.commandId
		})
	)
	const pending = {
		workspaceId,
		commandId: command.commandId,
		command: Object.freeze({ ...command })
	}
	pendingByActor.set(actorSubject, pending)
	return pending
}

export function clearResolvedCrmAdminGrant(
	actorSubject: string,
	commandId: string
) {
	const previous = readPendingCrmAdminGrant(actorSubject)
	// A late confirmed response from the previous mount may already have cleared
	// this pointer. Rechecking the same terminal proof must remain idempotent.
	if (previous === null) return
	if (previous?.commandId !== commandId)
		throw new Error('CRM grant recovery pointer changed')
	window.sessionStorage.removeItem(key(actorSubject))
	pendingByActor.delete(actorSubject)
}
