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
	`aerocrm-admin-grant-v1:${actorSubject}`
// Transitional adapter: existing browser pages must retain the same unresolved
// command ID. Keep both keys until terminal proof clears them; never reset it.
const legacyKey = (actorSubject: string) =>
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

const parsePendingMarker = (
	raw: string | null
): PendingCrmAdminGrant | null => {
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

const samePendingMarker = (
	left: PendingCrmAdminGrant,
	right: PendingCrmAdminGrant
) =>
	left.workspaceId === right.workspaceId &&
	left.commandId === right.commandId

export function readPendingCrmAdminGrant(
	actorSubject: string
): PendingCrmAdminGrant | null {
	const memory = pendingByActor.get(actorSubject)
	const current = parsePendingMarker(
		window.sessionStorage.getItem(key(actorSubject))
	)
	const legacyRaw = window.sessionStorage.getItem(legacyKey(actorSubject))
	const legacy = parsePendingMarker(legacyRaw)
	if (current && legacy && !samePendingMarker(current, legacy))
		throw new Error('CRM grant recovery pointers conflict')
	const marker = current ?? legacy
	if (memory && marker && !samePendingMarker(memory, marker))
		throw new Error('CRM grant recovery pointer changed')
	if (!current && legacy) {
		try {
			window.sessionStorage.setItem(key(actorSubject), legacyRaw!)
		} catch {
			// Retain the old recovery pointer; a failed migration cannot allow a new grant.
		}
	}
	return memory ?? marker
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
	const marker = JSON.stringify({
		schemaVersion: 1,
		workspaceId,
		commandId: command.commandId
	})
	// Write the compatibility pointer before sending a command, including when
	// an old page is restored from browser history. Either write failure blocks it.
	window.sessionStorage.setItem(legacyKey(actorSubject), marker)
	window.sessionStorage.setItem(key(actorSubject), marker)
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
	window.sessionStorage.removeItem(legacyKey(actorSubject))
	pendingByActor.delete(actorSubject)
}
