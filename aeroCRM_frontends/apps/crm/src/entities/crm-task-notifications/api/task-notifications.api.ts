import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import {
	hasExactKeys,
	isRecord,
	isUuidV4,
	isIsoDate
} from '@/shared/lib/contract'

export interface TaskNotification {
	id: string
	kind: 'ASSIGNED' | 'DUE'
	taskId: string
	title: string
	dueAt: string
	createdAt: string
	readAt: string | null
	href: string
}
export interface TaskNotificationRequest {
	workspaceId: string
	actorMembershipId: string | null
	page: number
	pageSize: number
	unreadOnly: boolean
}
export interface TaskNotificationPage {
	schemaVersion: 1
	workspaceId: string
	page: number
	pageSize: number
	total: number
	unreadCount: number
	items: TaskNotification[]
}
const integer = (v: unknown, min: number, max: number) =>
	typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> =>
	isRecord(v) && hasExactKeys(v, keys)
const binding = (
	request: Pick<
		TaskNotificationRequest,
		'workspaceId' | 'actorMembershipId'
	>
) =>
	isUuidV4(request.workspaceId) &&
	(request.actorMembershipId === null ||
		isUuidV4(request.actorMembershipId))
export const parseTaskNotifications = (
	value: unknown,
	request: TaskNotificationRequest
): TaskNotificationPage | null => {
	if (
		!exact(value, [
			'schemaVersion',
			'workspaceId',
			'page',
			'pageSize',
			'total',
			'unreadCount',
			'items'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== request.workspaceId ||
		value.page !== request.page ||
		value.pageSize !== request.pageSize ||
		!integer(value.total, 0, Number.MAX_SAFE_INTEGER) ||
		!integer(value.unreadCount, 0, Number.MAX_SAFE_INTEGER) ||
		(request.unreadOnly
			? value.total !== value.unreadCount
			: Number(value.unreadCount) > Number(value.total)) ||
		!Array.isArray(value.items) ||
		value.items.length !==
			Math.min(
				request.pageSize,
				Math.max(
					0,
					Number(value.total) - (request.page - 1) * request.pageSize
				)
			)
	)
		return null
	if (
		value.items.some(
			item =>
				!exact(item, [
					'id',
					'kind',
					'taskId',
					'title',
					'dueAt',
					'createdAt',
					'readAt',
					'href'
				]) ||
				!isUuidV4(item.id) ||
				!isUuidV4(item.taskId) ||
				!['ASSIGNED', 'DUE'].includes(String(item.kind)) ||
				typeof item.title !== 'string' ||
				!item.title.trim() ||
				item.title.length > 200 ||
				!isIsoDate(item.dueAt) ||
				!isIsoDate(item.createdAt) ||
				!(item.readAt === null || isIsoDate(item.readAt)) ||
				(request.unreadOnly && item.readAt !== null) ||
				item.href !== `/planner?task=${item.taskId}`
		) ||
		new Set(value.items.map(item => item.id)).size !== value.items.length
	)
		return null
	return value as unknown as TaskNotificationPage
}
export const listTaskNotifications = async (
	accessToken: string,
	input: TaskNotificationRequest
) => {
	const request = structuredClone(input)
	if (
		!binding(request) ||
		!integer(request.page, 1, 1000000) ||
		!integer(request.pageSize, 1, 100) ||
		typeof request.unreadOnly !== 'boolean'
	)
		throw invalidContractError()
	const result = parseTaskNotifications(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: '/crm/sales/notifications',
			params: {
				workspaceId: request.workspaceId,
				page: String(request.page),
				pageSize: String(request.pageSize),
				unreadOnly: String(request.unreadOnly),
				...(request.actorMembershipId
					? { actorMembershipId: request.actorMembershipId }
					: {})
			}
		}),
		request
	)
	if (!result) throw invalidContractError()
	return result
}
export const setTaskNotificationRead = async (
	accessToken: string,
	input: Pick<
		TaskNotificationRequest,
		'workspaceId' | 'actorMembershipId'
	> & { id: string; read: boolean }
) => {
	const request = structuredClone(input)
	if (
		!binding(request) ||
		!isUuidV4(request.id) ||
		typeof request.read !== 'boolean'
	)
		throw invalidContractError()
	const result = await authenticatedRequest({
		accessToken,
		method: 'PUT',
		url: `/crm/sales/notifications/${request.id}/read`,
		data: {
			workspaceId: request.workspaceId,
			actorMembershipId: request.actorMembershipId,
			read: request.read
		}
	})
	if (
		!exact(result, ['schemaVersion', 'workspaceId', 'id', 'readAt']) ||
		result.schemaVersion !== 1 ||
		result.workspaceId !== request.workspaceId ||
		result.id !== request.id ||
		(request.read ? !isIsoDate(result.readAt) : result.readAt !== null)
	)
		throw invalidContractError()
	return result
}
