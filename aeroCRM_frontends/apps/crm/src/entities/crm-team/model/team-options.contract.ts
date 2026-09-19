import {
	hasExactKeys,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'

export interface TeamOption {
	id: string
	name: string
}
export interface TeamOptionsRequest {
	workspaceId: string
	subject: string
	teamIds: readonly string[]
	page: number
	pageSize: number
	selectedId: string
}
export interface TeamOptionsPage {
	schemaVersion: 1
	workspaceId: string
	subject: string
	page: number
	pageSize: number
	total: number
	items: TeamOption[]
	selected: TeamOption | null
}

export const parseTeamOptions = (
	value: unknown,
	request: TeamOptionsRequest
): TeamOptionsPage | null => {
	const allowed = new Set(request.teamIds)
	const option = (item: unknown): item is TeamOption =>
		isRecord(item) &&
		hasExactKeys(item, ['id', 'name']) &&
		isUuidV4(item.id) &&
		allowed.has(item.id) &&
		isNonEmptyString(item.name, 100) &&
		item.name === item.name.trim()
	if (
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
		!isUuidV4(request.workspaceId) ||
		!isNonEmptyString(request.subject, 256) ||
		!Number.isSafeInteger(request.page) ||
		request.page < 1 ||
		request.page > 1000000 ||
		!Number.isSafeInteger(request.pageSize) ||
		request.pageSize < 1 ||
		request.pageSize > 100 ||
		(request.selectedId !== '' && !isUuidV4(request.selectedId)) ||
		allowed.size !== request.teamIds.length ||
		allowed.size > 1000 ||
		!request.teamIds.every(isUuidV4) ||
		value.page !== request.page ||
		value.pageSize !== request.pageSize ||
		!Number.isSafeInteger(value.total) ||
		Number(value.total) < 0 ||
		Number(value.total) > allowed.size ||
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
		new Set(value.items.map(item => item.id)).size !==
			value.items.length ||
		(value.selected !== null &&
			(!option(value.selected) ||
				value.selected.id !== request.selectedId ||
				!value.total))
	)
		return null
	const pageSelection = value.items.find(
		item => item.id === request.selectedId
	)
	if (
		pageSelection &&
		(!value.selected || pageSelection.name !== value.selected.name)
	)
		return null
	return value as unknown as TeamOptionsPage
}
