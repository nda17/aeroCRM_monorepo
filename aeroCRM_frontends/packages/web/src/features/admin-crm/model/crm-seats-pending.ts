import { useAuthStore } from '@/entities/user/model/auth-store'
import { CRM_ADMIN_UUID } from './crm-subscriptions.contract'
import type { CrmAdminSeatsCommand } from './crm-subscription-seats.contract'

export interface PendingCrmAdminSeats {
	workspaceId: string
	commandId: string
	command?: CrmAdminSeatsCommand
}
const pendingByActor = new Map<string, PendingCrmAdminSeats>()
let boundActor: string | null = null
const key = (actor: string) => `aerocrm-admin-seats-v1:${actor}`

useAuthStore.subscribe((state, previous) => {
	if (
		state.auth !== previous.auth ||
		state.isAuthResolved !== previous.isAuthResolved
	) {
		pendingByActor.clear()
		boundActor = null
	}
})

export function bindCrmAdminSeatsActor(actor: string) {
	if (boundActor !== null && boundActor !== actor) pendingByActor.clear()
	boundActor = actor
}

export function readPendingCrmAdminSeats(
	actor: string
): PendingCrmAdminSeats | null {
	const raw = window.sessionStorage.getItem(key(actor))
	let marker: PendingCrmAdminSeats | null = null
	if (raw !== null) {
		const value: unknown = JSON.parse(raw)
		if (!value || typeof value !== 'object' || Array.isArray(value))
			throw new Error('Invalid CRM seats recovery pointer')
		const row = value as Record<string, unknown>
		if (
			Object.keys(row).length !== 3 ||
			row.schemaVersion !== 1 ||
			typeof row.workspaceId !== 'string' ||
			!CRM_ADMIN_UUID.test(row.workspaceId) ||
			typeof row.commandId !== 'string' ||
			!CRM_ADMIN_UUID.test(row.commandId)
		)
			throw new Error('Invalid CRM seats recovery pointer')
		marker = { workspaceId: row.workspaceId, commandId: row.commandId }
	}
	const memory = pendingByActor.get(actor)
	if (
		memory &&
		marker &&
		(memory.workspaceId !== marker.workspaceId ||
			memory.commandId !== marker.commandId)
	)
		throw new Error('CRM seats recovery pointer changed')
	return memory ?? marker
}

export function retainPendingCrmAdminSeats(
	actor: string,
	workspaceId: string,
	command: CrmAdminSeatsCommand
) {
	const auth = useAuthStore.getState()
	if (
		!auth.auth ||
		!auth.isAuthResolved ||
		boundActor !== actor ||
		command.expectedActorSubject !== actor
	)
		throw new Error('CRM seats authentication changed')
	const previous = readPendingCrmAdminSeats(actor)
	if (previous) {
		if (
			previous.workspaceId !== workspaceId ||
			previous.commandId !== command.commandId ||
			previous.command !== command
		)
			throw new Error(
				'CRM seats command is unresolved or requires read-only recovery'
			)
		return previous
	}
	// Persist only a recovery pointer. The reason and command body stay in memory.
	window.sessionStorage.setItem(
		key(actor),
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
	pendingByActor.set(actor, pending)
	return pending
}

export function clearResolvedCrmAdminSeats(
	actor: string,
	commandId: string
) {
	const previous = readPendingCrmAdminSeats(actor)
	if (previous === null) return
	if (previous.commandId !== commandId)
		throw new Error('CRM seats recovery pointer changed')
	window.sessionStorage.removeItem(key(actor))
	pendingByActor.delete(actor)
}
