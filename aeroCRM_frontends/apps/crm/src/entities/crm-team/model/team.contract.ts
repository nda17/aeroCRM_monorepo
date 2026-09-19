import {
	hasExactKeys,
	isIsoDate,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'

export const crmRoles = [
	'CRM_ADMIN',
	'TEAM_LEAD',
	'MANAGER',
	'ANALYST'
] as const
export type CrmRole = (typeof crmRoles)[number]
export const crmRoleLabels: Record<CrmRole, string> = {
	CRM_ADMIN: 'Администратор CRM',
	TEAM_LEAD: 'Руководитель отдела',
	MANAGER: 'Менеджер',
	ANALYST: 'Аналитик'
}
export interface CrmMember {
	id: string
	workspaceId: string
	subject: string
	membershipId: string
	role: CrmRole
	teamIds: string[]
	disabledAt: string | null
	version: number
	createdAt: string
	updatedAt: string
}
export interface CrmMemberRow extends CrmMember {
	kind: 'member'
	displayName: string | null
	verifiedEmail: string | null
}
export interface CrmTeam {
	id: string
	workspaceId: string
	name: string
	version: number
	archivedAt: string | null
	createdAt: string
	updatedAt: string
}
export interface CrmTeamRow extends CrmTeam {
	kind: 'team'
}
export interface CrmInvitation {
	id: string
	workspaceId: string
	email: string
	role: CrmRole
	teamIds: string[]
	status: 'REGISTERING' | 'INVITED' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'
	version: number
	expiresAt: string
	createdAt: string
	updatedAt: string
}
export interface CrmInvitationRow extends CrmInvitation {
	kind: 'invitation'
}
export interface CrmDelivery {
	id: string
	workspaceId: string
	eventId: string
	consumer: 'provision' | 'acceptance' | 'admission'
	status: 'RETRY_SCHEDULED' | 'DEAD_LETTERED'
	version: number
	retryAttempt: number
	manualRetryCycle: number
	lastError: string | null
	createdAt: string
	updatedAt: string
}
export interface CrmDeliveryRow extends CrmDelivery {
	kind: 'delivery'
}
export type TeamRow =
	| CrmMemberRow
	| CrmTeamRow
	| CrmInvitationRow
	| CrmDeliveryRow
export type TeamCollection =
	| 'members'
	| 'teams'
	| 'invitations'
	| 'deliveries'
export interface TeamPage {
	schemaVersion: 1
	page: number
	pageSize: number
	total: number
	items: TeamRow[]
	ownerSubject?: string
	quota?: { seatLimit: number; usedSeats: number; waitingCount: number }
}
const integer = (value: unknown, min = 0, max = 2147483647) =>
	Number.isSafeInteger(value) &&
	Number(value) >= min &&
	Number(value) <= max
const nullableDate = (value: unknown) => value === null || isIsoDate(value)
const teamIds = (value: unknown) =>
	Array.isArray(value) &&
	value.length <= 1000 &&
	value.every(isUuidV4) &&
	new Set(value).size === value.length
const email = (value: unknown) =>
	typeof value === 'string' &&
	value.length <= 254 &&
	value === value.trim().toLowerCase() &&
	/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
const role = (value: unknown): value is CrmRole =>
	crmRoles.includes(value as CrmRole)
const base = (
	value: unknown,
	workspaceId: string
): value is Record<string, unknown> =>
	isRecord(value) &&
	isUuidV4(value.id) &&
	isUuidV4(workspaceId) &&
	value.workspaceId === workspaceId &&
	integer(value.version, 1) &&
	isIsoDate(value.createdAt) &&
	isIsoDate(value.updatedAt)
export const parseCrmMember = (
	value: unknown,
	workspaceId: string,
	profile = false
): CrmMember | CrmMemberRow | null => {
	if (
		!base(value, workspaceId) ||
		!hasExactKeys(value, [
			'id',
			'workspaceId',
			'subject',
			'membershipId',
			'role',
			'teamIds',
			'disabledAt',
			'version',
			'createdAt',
			'updatedAt',
			...(profile ? ['displayName', 'verifiedEmail'] : [])
		]) ||
		!isNonEmptyString(value.subject, 256) ||
		!isUuidV4(value.membershipId) ||
		!role(value.role) ||
		!teamIds(value.teamIds) ||
		!nullableDate(value.disabledAt) ||
		(profile &&
			(!(
				value.displayName === null ||
				(typeof value.displayName === 'string' &&
					value.displayName.length <= 1000)
			) ||
				!(value.verifiedEmail === null || email(value.verifiedEmail))))
	)
		return null
	return profile
		? ({ ...value, kind: 'member' } as unknown as CrmMemberRow)
		: (value as unknown as CrmMember)
}
export const parseCrmTeam = (
	value: unknown,
	workspaceId: string
): CrmTeam | null =>
	!base(value, workspaceId) ||
	!hasExactKeys(value, [
		'id',
		'workspaceId',
		'name',
		'version',
		'archivedAt',
		'createdAt',
		'updatedAt'
	]) ||
	!isNonEmptyString(value.name, 100) ||
	!nullableDate(value.archivedAt)
		? null
		: (value as unknown as CrmTeam)
export const parseCrmInvitation = (
	value: unknown,
	workspaceId: string
): CrmInvitation | null =>
	!base(value, workspaceId) ||
	!hasExactKeys(value, [
		'id',
		'workspaceId',
		'email',
		'role',
		'teamIds',
		'status',
		'version',
		'expiresAt',
		'createdAt',
		'updatedAt'
	]) ||
	!email(value.email) ||
	!role(value.role) ||
	!teamIds(value.teamIds) ||
	!['REGISTERING', 'INVITED', 'ACCEPTED', 'REVOKED', 'EXPIRED'].includes(
		String(value.status)
	) ||
	!isIsoDate(value.expiresAt)
		? null
		: (value as unknown as CrmInvitation)
export const parseCrmDelivery = (
	value: unknown,
	workspaceId: string
): CrmDelivery | null =>
	!base(value, workspaceId) ||
	!hasExactKeys(value, [
		'id',
		'workspaceId',
		'eventId',
		'consumer',
		'status',
		'version',
		'retryAttempt',
		'manualRetryCycle',
		'lastError',
		'createdAt',
		'updatedAt'
	]) ||
	!isUuidV4(value.eventId) ||
	!['provision', 'acceptance', 'admission'].includes(
		String(value.consumer)
	) ||
	!['RETRY_SCHEDULED', 'DEAD_LETTERED'].includes(String(value.status)) ||
	!integer(value.retryAttempt, 0, 3) ||
	!integer(value.manualRetryCycle) ||
	!(
		value.lastError === null ||
		(typeof value.lastError === 'string' &&
			/^[A-Z_]{1,64}$/.test(value.lastError))
	)
		? null
		: (value as unknown as CrmDelivery)
export const parseTeamPage = (
	value: unknown,
	workspaceId: string,
	collection: TeamCollection,
	page: number,
	pageSize: number
): TeamPage | null => {
	const roster = collection === 'members'
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'page',
			'pageSize',
			'total',
			'items',
			...(roster ? ['workspaceId', 'ownerSubject', 'quota'] : [])
		]) ||
		value.schemaVersion !== 1 ||
		value.page !== page ||
		value.pageSize !== pageSize ||
		!integer(value.total) ||
		!Array.isArray(value.items) ||
		value.items.length > pageSize ||
		value.items.length > Number(value.total)
	)
		return null
	if (
		roster &&
		(value.workspaceId !== workspaceId ||
			!isNonEmptyString(value.ownerSubject, 256) ||
			!isRecord(value.quota) ||
			!hasExactKeys(value.quota, [
				'seatLimit',
				'usedSeats',
				'waitingCount'
			]) ||
			!integer(value.quota.seatLimit, 2, 10000) ||
			!integer(value.quota.usedSeats, 1) ||
			!integer(value.quota.waitingCount))
	)
		return null
	const items = value.items.map(item => {
		if (collection === 'members')
			return parseCrmMember(item, workspaceId, true) as CrmMemberRow | null
		if (collection === 'teams') {
			const row = parseCrmTeam(item, workspaceId)
			return row?.archivedAt === null
				? { ...row, kind: 'team' as const }
				: null
		}
		if (collection === 'invitations') {
			const row = parseCrmInvitation(item, workspaceId)
			return row ? { ...row, kind: 'invitation' as const } : null
		}
		const row = parseCrmDelivery(item, workspaceId)
		return row ? { ...row, kind: 'delivery' as const } : null
	})
	if (
		items.some(item => !item) ||
		new Set(items.map(item => item?.id)).size !== items.length ||
		(roster &&
			items.some(
				item =>
					item?.kind === 'member' && item.subject === value.ownerSubject
			))
	)
		return null
	return {
		schemaVersion: 1,
		page,
		pageSize,
		total: Number(value.total),
		items: items as TeamRow[],
		...(roster
			? {
					ownerSubject: value.ownerSubject as string,
					quota: value.quota as TeamPage['quota']
				}
			: {})
	}
}
