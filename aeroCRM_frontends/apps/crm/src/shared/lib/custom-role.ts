export const customRolePermissions = [
	'customers:read',
	'customers:write',
	'intake:read',
	'intake:write',
	'sales:read',
	'sales:write',
	'sales:analytics'
] as const
export type CustomRolePermission = (typeof customRolePermissions)[number]
export type CustomRoleScope = 'OWN' | 'TEAM' | 'ALL'
export const normalizeRoleName = (name: string) =>
	name.trim().normalize('NFC').replace(/ +/g, ' ')
export const isCustomRoleName = (name: unknown): name is string =>
	typeof name === 'string' &&
	name.length <= 80 &&
	name === normalizeRoleName(name) &&
	/^[А-ЯЁ][А-Яа-яЁё0-9 -]*$/.test(name)
export const isCustomRolePermissions = (
	value: unknown
): value is CustomRolePermission[] =>
	Array.isArray(value) &&
	value.length > 0 &&
	value.every(permission => customRolePermissions.includes(permission)) &&
	new Set(value).size === value.length &&
	['customers', 'intake', 'sales'].every(
		section =>
			!value.includes(`${section}:write`) ||
			value.includes(`${section}:read`)
	)
