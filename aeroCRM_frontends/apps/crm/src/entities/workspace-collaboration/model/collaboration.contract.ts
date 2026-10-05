import {
	hasExactKeys,
	isIsoDate,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'

export interface DirectoryFields {
	firstName: string | null
	lastName: string | null
	middleName: string | null
	phone: string | null
	email: string | null
	position: string | null
	department: string | null
	extension: string | null
	telegram: string | null
}
export type DirectoryStatus =
	| 'REGISTERING'
	| 'INVITED'
	| 'WAITING'
	| 'ACTIVE'
	| 'DISABLED'
	| 'EXPIRED'
	| 'REVOKED'
export interface DirectoryEntry {
	id: string
	subject: string | null
	membershipId: string | null
	invitationId: string | null
	status: DirectoryStatus
	isOwner: boolean
	displayName: string
	fields: DirectoryFields
	version: number
	archivedAt: string | null
	updatedAt: string
	canEdit: boolean
	canArchive: boolean
	canMessage: boolean
}
export interface ChatMessage {
	id: string
	conversationId: string
	sequence: number
	senderSubject: string
	senderMembershipId: string | null
	senderName: string
	text: string
	createdAt: string
}
export interface ChatConversation {
	id: string
	kind: 'DIRECT' | 'WORKSPACE'
	title: string
	peer: null | {
		subject: string
		membershipId: string
		displayName: string
		active: boolean
	}
	lastSequence: number
	readThroughSequence: number
	peerReadThroughSequence: number | null
	unreadCount: number
	lastMessageAt: string | null
	lastMessage: null | {
		id: string
		sequence: number
		senderSubject: string
		text: string
		createdAt: string
	}
	canSend: boolean
}
export interface CollaborationBinding {
	workspaceId: string
	subject: string
}
export interface DirectoryCommand extends CollaborationBinding {
	entryId: string
	commandId: string
	expectedVersion: number
}
export interface ChatSendCommand extends CollaborationBinding {
	conversationId: string
	commandId: string
	text: string
}
export interface ChatReadCommand extends CollaborationBinding {
	conversationId: string
	commandId: string
	throughSequence: number
}
export interface ChatDirectCommand extends CollaborationBinding {
	commandId: string
	recipientSubject: string
}
export interface DirectoryListRequest extends CollaborationBinding {
	q?: string
	page?: number
	pageSize?: number
	includeArchived?: boolean
	activeOnly?: boolean
}
export interface ConversationListRequest extends CollaborationBinding {
	q?: string
	page?: number
	pageSize?: number
}
export interface MessageListRequest extends CollaborationBinding {
	conversationId: string
	beforeSequence?: number
	limit?: number
}
export interface ChatNotificationsRequest extends CollaborationBinding {
	page?: number
	pageSize?: number
	unreadOnly?: boolean
}
export interface DirectoryListResponse extends CollaborationBinding {
	schemaVersion: 1
	page: number
	pageSize: number
	total: number
	items: DirectoryEntry[]
}
export interface DirectoryMutationResponse extends CollaborationBinding {
	schemaVersion: 1
	item: DirectoryEntry
}
export interface ConversationListResponse extends CollaborationBinding {
	schemaVersion: 1
	page: number
	pageSize: number
	total: number
	unreadCount: number
	items: ChatConversation[]
}
export interface MessageListResponse extends CollaborationBinding {
	schemaVersion: 1
	conversation: ChatConversation
	items: ChatMessage[]
	nextBeforeSequence: number | null
}
export interface ChatNotification {
	id: string
	messageId: string
	conversationId: string
	sequence: number
	title: string
	text: string
	senderName: string
	createdAt: string
	readAt: string | null
}
export interface ChatNotificationsResponse extends CollaborationBinding {
	schemaVersion: 1
	page: number
	pageSize: number
	total: number
	unreadCount: number
	items: ChatNotification[]
}
export interface ChatSendResponse extends CollaborationBinding {
	schemaVersion: 1
	item: ChatMessage
}
export interface ChatDirectResponse extends CollaborationBinding {
	schemaVersion: 1
	conversation: ChatConversation
}
export interface ChatReadResponse extends CollaborationBinding {
	schemaVersion: 1
	conversationId: string
	throughSequence: number
	unreadCount: number
}

const exact = (
	v: unknown,
	keys: readonly string[]
): v is Record<string, unknown> => isRecord(v) && hasExactKeys(v, keys)
const number = (v: unknown, min = 0, max = 2147483647): v is number =>
	Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max
const nullableUuid = (v: unknown) => v === null || isUuidV4(v)
const nullableDate = (v: unknown) => v === null || isIsoDate(v)
const nullableText = (v: unknown, max: number) =>
	v === null || isNonEmptyString(v, max)
const statusValues: readonly string[] = [
	'REGISTERING',
	'INVITED',
	'WAITING',
	'ACTIVE',
	'DISABLED',
	'EXPIRED',
	'REVOKED'
]
const parseFields = (v: unknown): v is DirectoryFields =>
	exact(v, [
		'firstName',
		'lastName',
		'middleName',
		'phone',
		'email',
		'position',
		'department',
		'extension',
		'telegram'
	]) &&
	(
		[
			'firstName',
			'lastName',
			'middleName',
			'phone',
			'email',
			'position',
			'department',
			'extension',
			'telegram'
		] as const
	).every(k =>
		nullableText(
			v[k],
			k === 'phone'
				? 64
				: k === 'email'
					? 254
					: k === 'extension'
						? 20
						: 100
		)
	)
const parseEntry = (v: unknown): v is DirectoryEntry =>
	exact(v, [
		'id',
		'subject',
		'membershipId',
		'invitationId',
		'status',
		'isOwner',
		'displayName',
		'fields',
		'version',
		'archivedAt',
		'updatedAt',
		'canEdit',
		'canArchive',
		'canMessage'
	]) &&
	isUuidV4(v.id) &&
	nullableText(v.subject, 256) &&
	nullableUuid(v.membershipId) &&
	nullableUuid(v.invitationId) &&
	typeof v.status === 'string' &&
	statusValues.includes(v.status) &&
	typeof v.isOwner === 'boolean' &&
	isNonEmptyString(v.displayName, 302) &&
	parseFields(v.fields) &&
	number(v.version, 1, 2147483646) &&
	nullableDate(v.archivedAt) &&
	isIsoDate(v.updatedAt) &&
	typeof v.canEdit === 'boolean' &&
	typeof v.canArchive === 'boolean' &&
	typeof v.canMessage === 'boolean'
const parsePeer = (v: unknown) =>
	v === null ||
	(exact(v, ['subject', 'membershipId', 'displayName', 'active']) &&
		isNonEmptyString(v.subject, 256) &&
		isUuidV4(v.membershipId) &&
		isNonEmptyString(v.displayName, 302) &&
		typeof v.active === 'boolean')
const parseLast = (v: unknown) =>
	v === null ||
	(exact(v, ['id', 'sequence', 'senderSubject', 'text', 'createdAt']) &&
		isUuidV4(v.id) &&
		number(v.sequence, 1) &&
		isNonEmptyString(v.senderSubject, 256) &&
		isNonEmptyString(v.text, 10000) &&
		isIsoDate(v.createdAt))
const parseConversation = (v: unknown): v is ChatConversation =>
	exact(v, [
		'id',
		'kind',
		'title',
		'peer',
		'lastSequence',
		'readThroughSequence',
		'peerReadThroughSequence',
		'unreadCount',
		'lastMessageAt',
		'lastMessage',
		'canSend'
	]) &&
	isUuidV4(v.id) &&
	(v.kind === 'DIRECT' || v.kind === 'WORKSPACE') &&
	isNonEmptyString(v.title, 302) &&
	parsePeer(v.peer) &&
	number(v.lastSequence) &&
	number(v.readThroughSequence) &&
	(v.peerReadThroughSequence === null ||
		number(v.peerReadThroughSequence)) &&
	(v.kind === 'DIRECT'
		? v.peer !== null && v.peerReadThroughSequence !== null
		: v.peer === null && v.peerReadThroughSequence === null) &&
	number(v.unreadCount) &&
	nullableDate(v.lastMessageAt) &&
	parseLast(v.lastMessage) &&
	typeof v.canSend === 'boolean'
const parseMessage = (v: unknown): v is ChatMessage =>
	exact(v, [
		'id',
		'conversationId',
		'sequence',
		'senderSubject',
		'senderMembershipId',
		'senderName',
		'text',
		'createdAt'
	]) &&
	isUuidV4(v.id) &&
	isUuidV4(v.conversationId) &&
	number(v.sequence, 1) &&
	isNonEmptyString(v.senderSubject, 256) &&
	nullableUuid(v.senderMembershipId) &&
	isNonEmptyString(v.senderName, 302) &&
	isNonEmptyString(v.text, 10000) &&
	isIsoDate(v.createdAt)
const bound = (v: unknown, b: CollaborationBinding) =>
	isRecord(v) && v.workspaceId === b.workspaceId && v.subject === b.subject
const validPage = (
	v: Record<string, unknown>,
	page: number,
	pageSize: number
): v is Record<string, unknown> & { items: unknown[] } =>
	v.page === page &&
	v.pageSize === pageSize &&
	number(v.total) &&
	Array.isArray(v.items)

export const parseDirectoryList = (
	v: unknown,
	b: CollaborationBinding,
	page: number,
	pageSize: number
): DirectoryListResponse | null =>
	exact(v, [
		'schemaVersion',
		'workspaceId',
		'subject',
		'page',
		'pageSize',
		'total',
		'items'
	]) &&
	v.schemaVersion === 1 &&
	bound(v, b) &&
	validPage(v, page, pageSize) &&
	v.items.length <= pageSize &&
	v.items.every(parseEntry)
		? (v as unknown as DirectoryListResponse)
		: null
export const parseDirectoryMutation = (
	v: unknown,
	b: CollaborationBinding,
	entryId: string
): DirectoryMutationResponse | null =>
	exact(v, ['schemaVersion', 'workspaceId', 'subject', 'item']) &&
	v.schemaVersion === 1 &&
	bound(v, b) &&
	parseEntry(v.item) &&
	v.item.id === entryId
		? (v as unknown as DirectoryMutationResponse)
		: null
export const parseConversationList = (
	v: unknown,
	b: CollaborationBinding,
	page: number,
	pageSize: number
): ConversationListResponse | null =>
	exact(v, [
		'schemaVersion',
		'workspaceId',
		'subject',
		'page',
		'pageSize',
		'total',
		'unreadCount',
		'items'
	]) &&
	v.schemaVersion === 1 &&
	bound(v, b) &&
	validPage(v, page, pageSize) &&
	number(v.unreadCount) &&
	v.items.length <= pageSize &&
	v.items.every(parseConversation)
		? (v as unknown as ConversationListResponse)
		: null
export const parseMessageList = (
	v: unknown,
	b: CollaborationBinding,
	id: string,
	before: number | undefined,
	limit: number
): MessageListResponse | null =>
	exact(v, [
		'schemaVersion',
		'workspaceId',
		'subject',
		'conversation',
		'items',
		'nextBeforeSequence'
	]) &&
	v.schemaVersion === 1 &&
	bound(v, b) &&
	parseConversation(v.conversation) &&
	v.conversation.id === id &&
	Array.isArray(v.items) &&
	v.items.length <= limit &&
	v.items.every(parseMessage) &&
	(v.items as ChatMessage[]).every(m => m.conversationId === id) &&
	(v.items as ChatMessage[]).every(
		(m, i, a) => i === 0 || a[i - 1]!.sequence < m.sequence
	) &&
	(before === undefined ||
		(v.items as ChatMessage[]).every(m => m.sequence < before)) &&
	(v.nextBeforeSequence === null ||
		(number(v.nextBeforeSequence, 1) &&
			(v.items as ChatMessage[]).length > 0 &&
			v.nextBeforeSequence === (v.items as ChatMessage[])[0]!.sequence &&
			(v.items as ChatMessage[]).length === limit))
		? (v as unknown as MessageListResponse)
		: null
export const parseChatSend = (
	v: unknown,
	b: CollaborationBinding,
	id: string
): ChatSendResponse | null =>
	exact(v, ['schemaVersion', 'workspaceId', 'subject', 'item']) &&
	v.schemaVersion === 1 &&
	bound(v, b) &&
	parseMessage(v.item) &&
	v.item.conversationId === id
		? (v as unknown as ChatSendResponse)
		: null
export const parseChatDirect = (
	v: unknown,
	b: CollaborationBinding
): ChatDirectResponse | null =>
	exact(v, ['schemaVersion', 'workspaceId', 'subject', 'conversation']) &&
	v.schemaVersion === 1 &&
	bound(v, b) &&
	parseConversation(v.conversation) &&
	v.conversation.kind === 'DIRECT'
		? (v as unknown as ChatDirectResponse)
		: null
export const parseChatRead = (
	v: unknown,
	b: CollaborationBinding,
	id: string,
	requested: number
): ChatReadResponse | null =>
	exact(v, [
		'schemaVersion',
		'workspaceId',
		'subject',
		'conversationId',
		'throughSequence',
		'unreadCount'
	]) &&
	v.schemaVersion === 1 &&
	bound(v, b) &&
	v.conversationId === id &&
	number(v.throughSequence) &&
	v.throughSequence >= requested &&
	number(v.unreadCount)
		? (v as unknown as ChatReadResponse)
		: null
export const parseChatNotifications = (
	v: unknown,
	b: CollaborationBinding,
	page: number,
	pageSize: number
): ChatNotificationsResponse | null =>
	exact(v, [
		'schemaVersion',
		'workspaceId',
		'subject',
		'page',
		'pageSize',
		'total',
		'unreadCount',
		'items'
	]) &&
	v.schemaVersion === 1 &&
	bound(v, b) &&
	validPage(v, page, pageSize) &&
	number(v.unreadCount) &&
	v.items.length <= pageSize &&
	v.items.every(
		(n: unknown) =>
			exact(n, [
				'id',
				'messageId',
				'conversationId',
				'sequence',
				'title',
				'text',
				'senderName',
				'createdAt',
				'readAt'
			]) &&
			n.id === n.messageId &&
			isUuidV4(n.id) &&
			isUuidV4(n.conversationId) &&
			number(n.sequence, 1) &&
			isNonEmptyString(n.title, 302) &&
			isNonEmptyString(n.text, 10000) &&
			isNonEmptyString(n.senderName, 302) &&
			isIsoDate(n.createdAt) &&
			nullableDate(n.readAt)
	)
		? (v as unknown as ChatNotificationsResponse)
		: null
export const validCollaborationRequest = (b: CollaborationBinding) =>
	isUuidV4(b.workspaceId) && isNonEmptyString(b.subject, 256)
