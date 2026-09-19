import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import {
	isRecord,
	isUuidV4,
	hasExactKeys,
	isNonEmptyString
} from '@/shared/lib/contract'
import { supportApi } from '@/entities/support/api/support.api'

export type NotificationSource = 'intake' | 'support'
export interface CrmNotification {
	id: string
	title: string
	createdAt: string
	readAt: string | null
	targetId: string
	sequence?: number
}
export interface NotificationPage {
	page: number
	pageSize: number
	total: number
	unreadCount: number
	items: CrmNotification[]
}
const date = (v: unknown): v is string =>
	typeof v === 'string' && Number.isFinite(Date.parse(v))
export async function listCrmNotifications(
	source: NotificationSource,
	token: string,
	workspaceId: string,
	page: number,
	unreadOnly: boolean
): Promise<NotificationPage> {
	const value = await authenticatedRequest({
		accessToken: token,
		method: 'GET',
		url:
			source === 'intake'
				? '/crm/intake/notifications'
				: '/support/notifications',
		params: {
			page: String(page),
			unreadOnly: String(unreadOnly),
			...(source === 'intake'
				? { workspaceId, pageSize: '10' }
				: { limit: '10' })
		}
	})
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'page',
			'pageSize',
			'total',
			'unreadCount',
			'items',
			...(source === 'intake' ? ['workspaceId'] : [])
		]) ||
		value.schemaVersion !== 1 ||
		value.page !== page ||
		value.pageSize !== 10 ||
		(source === 'intake' && value.workspaceId !== workspaceId) ||
		!Number.isSafeInteger(value.total) ||
		Number(value.total) < 0 ||
		!Number.isSafeInteger(value.unreadCount) ||
		Number(value.unreadCount) < 0 ||
		!Array.isArray(value.items) ||
		value.items.length > 10
	)
		throw invalidContractError()
	const items = value.items.map(row => {
		if (
			!isRecord(row) ||
			!hasExactKeys(row, [
				'id',
				'title',
				'createdAt',
				'readAt',
				...(source === 'intake'
					? ['entryId']
					: ['conversationId', 'sequence'])
			]) ||
			!isUuidV4(row.id) ||
			!isNonEmptyString(row.title, 200) ||
			!date(row.createdAt) ||
			(row.readAt !== null && !date(row.readAt)) ||
			!isUuidV4(source === 'intake' ? row.entryId : row.conversationId) ||
			(source === 'support' &&
				(!Number.isInteger(row.sequence) || Number(row.sequence) < 1))
		)
			throw invalidContractError()
		return {
			id: row.id,
			title: row.title,
			createdAt: row.createdAt,
			readAt: row.readAt as string | null,
			targetId: (source === 'intake'
				? row.entryId
				: row.conversationId) as string,
			...(source === 'support' ? { sequence: Number(row.sequence) } : {})
		}
	})
	if (new Set(items.map(item => item.id)).size !== items.length)
		throw invalidContractError()
	return {
		page,
		pageSize: 10,
		total: Number(value.total),
		unreadCount: Number(value.unreadCount),
		items
	}
}
export async function readCrmNotification(
	source: NotificationSource,
	token: string,
	workspaceId: string,
	item: CrmNotification
) {
	if (source === 'support')
		return supportApi.read(token, item.targetId, item.sequence!)
	return authenticatedRequest({
		accessToken: token,
		method: 'PUT',
		url: '/crm/intake/notifications/' + item.id + '/read',
		data: { schemaVersion: 1, workspaceId, read: item.readAt === null }
	})
}
