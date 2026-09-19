import { hasExactKeys, isRecord, isUuidV4 } from '@/shared/lib/contract'

export const assigneeRoles = [
	'OWNER',
	'CRM_ADMIN',
	'TEAM_LEAD',
	'MANAGER'
] as const
export interface AssigneeOption {
	subject: string
	membershipId: string
	displayName: string | null
	verifiedEmail: string | null
	role: (typeof assigneeRoles)[number]
}
export interface AssigneeBinding {
	subject: string
	// null is an existing, historically unknown membership; never replace it implicitly.
	membershipId: string | null
}
export interface AssigneeOptionsRequest {
	workspaceId: string
	subject: string
	dataScope: 'ALL' | 'TEAM' | 'OWN'
	page: number
	pageSize: number
	search?: string
	selectedSubject?: string
	teamId?: string
}
export interface AssigneeOptionsPage {
	schemaVersion: 1
	workspaceId: string
	subject: string
	page: number
	pageSize: number
	total: number
	items: AssigneeOption[]
	selected: AssigneeOption | null
}

export const isAssigneeSubject = (value: unknown): value is string =>
	typeof value === 'string' && /^[^\s\x00-\x1f\x7f]{1,256}$/.test(value)

export const validAssigneeOptionsRequest = (
	request: AssigneeOptionsRequest
) =>
	isUuidV4(request.workspaceId) &&
	isAssigneeSubject(request.subject) &&
	['ALL', 'TEAM', 'OWN'].includes(request.dataScope) &&
	Number.isSafeInteger(request.page) &&
	request.page >= 1 &&
	request.page <= 1000000 &&
	Number.isSafeInteger(request.pageSize) &&
	request.pageSize >= 1 &&
	request.pageSize <= 100 &&
	(request.search === undefined ||
		(typeof request.search === 'string' &&
			request.search.length <= 200)) &&
	(request.selectedSubject === undefined ||
		isAssigneeSubject(request.selectedSubject)) &&
	(request.teamId === undefined || isUuidV4(request.teamId))

export const isScopedAssigneeOption = (
	item: unknown,
	request: Pick<AssigneeOptionsRequest, 'subject' | 'dataScope'>
): item is AssigneeOption =>
	isRecord(item) &&
	hasExactKeys(item, [
		'subject',
		'membershipId',
		'displayName',
		'verifiedEmail',
		'role'
	]) &&
	isAssigneeSubject(item.subject) &&
	isUuidV4(item.membershipId) &&
	assigneeRoles.includes(item.role as AssigneeOption['role']) &&
	(item.displayName === null ||
		(typeof item.displayName === 'string' &&
			item.displayName.length <= 1000)) &&
	(item.verifiedEmail === null ||
		(typeof item.verifiedEmail === 'string' &&
			item.verifiedEmail.length <= 254 &&
			item.verifiedEmail === item.verifiedEmail.trim().toLowerCase() &&
			/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.verifiedEmail))) &&
	(request.dataScope !== 'OWN' || item.subject === request.subject) &&
	(request.dataScope === 'ALL' || item.role !== 'OWNER')

export const parseAssigneeOptions = (
	value: unknown,
	request: AssigneeOptionsRequest
): AssigneeOptionsPage | null => {
	const option = (item: unknown): item is AssigneeOption =>
		isScopedAssigneeOption(item, request)
	if (
		!validAssigneeOptionsRequest(request) ||
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'subject',
			'page',
			'pageSize',
			'total',
			'items',
			'selected'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== request.workspaceId ||
		value.subject !== request.subject ||
		value.page !== request.page ||
		value.pageSize !== request.pageSize ||
		!Number.isSafeInteger(value.total) ||
		Number(value.total) < 0 ||
		Number(value.total) > (request.dataScope === 'OWN' ? 1 : 10001) ||
		!Array.isArray(value.items) ||
		!value.items.every(option) ||
		value.items.length !==
			Math.min(
				request.pageSize,
				Math.max(
					0,
					Number(value.total) - (request.page - 1) * request.pageSize
				)
			) ||
		new Set(value.items.map(item => item.subject)).size !==
			value.items.length ||
		new Set(value.items.map(item => item.membershipId)).size !==
			value.items.length ||
		(value.selected !== null &&
			(!option(value.selected) ||
				value.selected.subject !== request.selectedSubject))
	)
		return null
	const selected = value.selected as AssigneeOption | null
	const items = value.items as AssigneeOption[]
	const onPage = items.find(
		item => item.subject === request.selectedSubject
	)
	if (onPage && (!selected || !sameAssignee(onPage, selected))) return null
	if (
		selected &&
		items.some(
			item =>
				item.membershipId === selected.membershipId &&
				!sameAssignee(item, selected)
		)
	)
		return null
	const owners = new Set(
		[...items, ...(selected ? [selected] : [])]
			.filter(item => item.role === 'OWNER')
			.map(item => item.subject)
	)
	if (owners.size > 1) return null
	return value as unknown as AssigneeOptionsPage
}

const sameAssignee = (left: AssigneeOption, right: AssigneeOption) =>
	left.subject === right.subject &&
	left.membershipId === right.membershipId &&
	left.displayName === right.displayName &&
	left.verifiedEmail === right.verifiedEmail &&
	left.role === right.role

export const assigneeDisplayName = (option: AssigneeOption) =>
	option.displayName?.trim() ||
	option.verifiedEmail ||
	(option.role === 'OWNER'
		? 'Владелец пространства'
		: 'Сотрудник без имени')
