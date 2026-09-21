import {
	hasExactKeys,
	isIsoDate,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'
import {
	isCustomRoleName,
	isCustomRolePermissions,
	type CustomRolePermission,
	type CustomRoleScope
} from '@/shared/lib/custom-role'

export interface CustomRoleRef {
	id: string
	name: string
	version: number
}
export interface CrmCustomRole extends CustomRoleRef {
	workspaceId: string
	permissions: CustomRolePermission[]
	dataScope: CustomRoleScope
	archivedAt: string | null
	createdAt: string
	updatedAt: string
	memberCount: number
	invitationCount: number
}
export interface CrmCustomRoleRow extends CrmCustomRole {
	kind: 'role'
}
const count = (value: unknown) =>
	Number.isSafeInteger(value) && Number(value) >= 0
export const isCustomRoleRef = (value: unknown): value is CustomRoleRef =>
	isRecord(value) &&
	hasExactKeys(value, ['id', 'name', 'version']) &&
	isUuidV4(value.id) &&
	isCustomRoleName(value.name) &&
	count(value.version) &&
	Number(value.version) > 0
export const parseCrmCustomRole = (
	value: unknown,
	workspaceId: string
): CrmCustomRole | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'id',
			'workspaceId',
			'name',
			'permissions',
			'dataScope',
			'version',
			'archivedAt',
			'createdAt',
			'updatedAt',
			'memberCount',
			'invitationCount'
		]) ||
		!isUuidV4(value.id) ||
		!isUuidV4(workspaceId) ||
		value.workspaceId !== workspaceId ||
		!isCustomRoleName(value.name) ||
		!isCustomRolePermissions(value.permissions) ||
		!['OWN', 'TEAM', 'ALL'].includes(String(value.dataScope)) ||
		!count(value.version) ||
		Number(value.version) < 1 ||
		!(value.archivedAt === null || isIsoDate(value.archivedAt)) ||
		!isIsoDate(value.createdAt) ||
		!isIsoDate(value.updatedAt) ||
		!count(value.memberCount) ||
		!count(value.invitationCount)
	)
		return null
	return value as unknown as CrmCustomRole
}
