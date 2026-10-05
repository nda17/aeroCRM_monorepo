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

export type NotificationSource = 'intake' | 'support' | 'mail'
export interface CrmNotification {
	id: string
	title: string
	createdAt: string
	readAt: string | null
	targetId: string
	contactId?: string | null
	mailboxId?: string
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
				: source === 'mail'
					? '/crm/customers/mail/notifications-v2'
					: '/support/notifications',
		params: {
			page: String(page),
			unreadOnly: String(unreadOnly),
			...(source !== 'support'
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
			...(source !== 'support' ? ['workspaceId'] : [])
		]) ||
		value.schemaVersion !== (source === 'mail' ? 2 : 1) ||
		value.page !== page ||
		value.pageSize !== 10 ||
		(source !== 'support' && value.workspaceId !== workspaceId) ||
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
					: source === 'mail'
						? ['messageId', 'mailboxId', 'contactId']
						: ['conversationId', 'sequence'])
			]) ||
			!isUuidV4(row.id) ||
			!isNonEmptyString(row.title, 200) ||
			!date(row.createdAt) ||
			(row.readAt !== null && !date(row.readAt)) ||
			!isUuidV4(
				source === 'intake'
					? row.entryId
					: source === 'mail'
						? row.messageId
						: row.conversationId
			) ||
			(source === 'mail' &&
				(!isUuidV4(row.mailboxId) ||
					(row.contactId !== null && !isUuidV4(row.contactId)))) ||
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
				: source === 'mail'
					? row.messageId
					: row.conversationId) as string,
			...(source === 'mail'
				? {
						contactId: row.contactId as string | null,
						mailboxId: row.mailboxId as string
					}
				: {}),
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
	const value = await authenticatedRequest({
		accessToken: token,
		method: 'PUT',
		url:
			(source === 'mail'
				? '/crm/customers/mail/notifications/'
				: '/crm/intake/notifications/') +
			item.id +
			'/read',
		data: { schemaVersion: 1, workspaceId, read: item.readAt === null }
	})
	if (
		source === 'mail' &&
		(!isRecord(value) ||
			!hasExactKeys(value, [
				'schemaVersion',
				'workspaceId',
				'id',
				'readAt'
			]) ||
			value.schemaVersion !== 1 ||
			value.workspaceId !== workspaceId ||
			value.id !== item.id ||
			(value.readAt !== null && !date(value.readAt)) ||
			(item.readAt === null
				? value.readAt === null
				: value.readAt !== null))
	)
		throw invalidContractError()
	return value
}
