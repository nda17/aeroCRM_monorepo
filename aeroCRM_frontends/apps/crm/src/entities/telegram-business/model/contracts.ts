import {
	hasExactKeys,
	isIsoDate,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'
import type { ChatAttachment } from '@/entities/workspace-collaboration/api/chat-attachments.api'

export interface TelegramBusinessBinding {
	workspaceId: string
	subject: string
}

export type MessengerEntryKind =
	| 'INTERNAL'
	| 'TELEGRAM_INBOUND'
	| 'TELEGRAM_OUTBOUND'
export type MessengerContentKind =
	| 'TEXT'
	| 'PHOTO'
	| 'VIDEO'
	| 'DOCUMENT'
	| 'VOICE'
	| 'OTHER'
export type TelegramDeliveryStatus =
	| 'QUEUED'
	| 'SENDING'
	| 'SENT'
	| 'FAILED'
	| 'UNKNOWN'
	| 'CANCELLED'

export interface MessengerEntry {
	id: string
	sequence: number
	kind: MessengerEntryKind
	text: string
	createdAt: string
	editedAt: string | null
	deletedAt: string | null
	author: {
		kind: 'EMPLOYEE' | 'TELEGRAM_USER' | 'TELEGRAM_ACCOUNT'
		displayName: string
		subject: string | null
		membershipId: string | null
	}
	internal: null | {
		conversationId: string
		messageId: string
		attachments: ChatAttachment[]
	}
	telegram: null | {
		messageId: string
		channelId: string
		dialogId: string
		accountName: string
		peerName: string
		contentKind: MessengerContentKind
		mediaAvailable: boolean
		deliveryStatus: TelegramDeliveryStatus | null
		canReply: boolean
		replyUntil: string | null
		replyUnavailableReason: string | null
	}
}

export interface MessengerFeed extends TelegramBusinessBinding {
	schemaVersion: 3
	conversationId: string
	items: MessengerEntry[]
	nextBeforeSequence: number | null
	lastSequence: number
	readThroughSequence: number
	unreadCount: number
	canSend: boolean
}

export interface TelegramChannel {
	id: string
	version: number
	status: 'ACTIVE' | 'DISCONNECTED' | 'REVOKED' | 'DEGRADED'
	account: { id: string; displayName: string; username: string | null }
	canReply: boolean
	lastInboundAt: string | null
	lastOutboundAt: string | null
	connectedAt: string
	disconnectedAt: string | null
	lastErrorCode: string | null
}

export interface TelegramConnectSession {
	id: string
	version: number
	state:
		| 'WAITING_TELEGRAM'
		| 'OWNER_VERIFIED'
		| 'CONNECTION_READY'
		| 'CONNECTED'
		| 'EXPIRED'
		| 'CANCELLED'
	expiresAt: string
	deepLink: string | null
	owner: null | {
		id: string
		displayName: string
		username: string | null
	}
	channelId: string | null
	errorCode: string | null
}

export interface TelegramChannelsResponse extends TelegramBusinessBinding {
	schemaVersion: 1
	configured: boolean
	botUsername: string | null
	canManage: boolean
	items: TelegramChannel[]
}
export interface TelegramChannelMutationResponse extends TelegramBusinessBinding {
	schemaVersion: 1
	item: TelegramChannel
}
export interface TelegramConversation {
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
		senderSubject: string | null
		senderName?: string
		text: string
		createdAt: string
	}
	canSend: boolean
}
export interface TelegramConversationsResponse extends TelegramBusinessBinding {
	schemaVersion: 3
	page: number
	pageSize: number
	total: number
	unreadCount: number
	items: TelegramConversation[]
}
export interface TelegramConnectSessionResponse extends TelegramBusinessBinding {
	schemaVersion: 1
	item: TelegramConnectSession
}
export interface TelegramCommandResponse extends TelegramBusinessBinding {
	schemaVersion: 1
	commandId: string
	messageId: string
	deliveryStatus: TelegramDeliveryStatus | null
}

export interface TelegramConnectSessionCommand extends TelegramBusinessBinding {
	commandId: string
	channelId?: string
}
export interface TelegramVersionedCommand extends TelegramBusinessBinding {
	commandId: string
	expectedVersion: number
	connectSessionId?: string
	channelId?: string
}
export interface TelegramReplyCommand extends TelegramBusinessBinding {
	commandId: string
	sourceMessageId: string
	text: string
}
export interface TelegramConversationListRequest extends TelegramBusinessBinding {
	q?: string
	page?: number
	pageSize?: number
}
export interface TelegramReadCommand extends TelegramBusinessBinding {
	conversationId: string
	commandId: string
	throughSequence: number
}
export interface TelegramFeedRequest extends TelegramBusinessBinding {
	conversationId: string
	beforeSequence?: number
	limit?: number
}

const exact = (
	v: unknown,
	keys: readonly string[]
): v is Record<string, unknown> => isRecord(v) && hasExactKeys(v, keys)
const number = (v: unknown, min = 0, max = 2147483647): v is number =>
	Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max
const nullableText = (v: unknown, max = 512) =>
	v === null || isNonEmptyString(v, max)
const nullableDate = (v: unknown) => v === null || isIsoDate(v)
const bindingMatches = (v: unknown, b: TelegramBusinessBinding) =>
	isRecord(v) && v.workspaceId === b.workspaceId && v.subject === b.subject

export const validTelegramBusinessBinding = (b: TelegramBusinessBinding) =>
	isUuidV4(b.workspaceId) && isNonEmptyString(b.subject, 256)

const parseAttachment = (v: unknown): v is ChatAttachment =>
	exact(v, ['id', 'fileName', 'mediaType', 'byteSize', 'sha256']) &&
	isUuidV4(v.id) &&
	isNonEmptyString(v.fileName, 255) &&
	isNonEmptyString(v.mediaType, 255) &&
	number(v.byteSize, 1, 25 * 1024 * 1024) &&
	typeof v.sha256 === 'string' &&
	/^[a-f0-9]{64}$/i.test(v.sha256)

const parseEntry = (v: unknown): v is MessengerEntry => {
	if (
		!exact(v, [
			'id',
			'sequence',
			'kind',
			'text',
			'createdAt',
			'editedAt',
			'deletedAt',
			'author',
			'internal',
			'telegram'
		]) ||
		!isUuidV4(v.id) ||
		!number(v.sequence, 1) ||
		!['INTERNAL', 'TELEGRAM_INBOUND', 'TELEGRAM_OUTBOUND'].includes(
			String(v.kind)
		) ||
		typeof v.text !== 'string' ||
		v.text.length > 10000 ||
		!isIsoDate(v.createdAt) ||
		!nullableDate(v.editedAt) ||
		!nullableDate(v.deletedAt) ||
		!exact(v.author, ['kind', 'displayName', 'subject', 'membershipId']) ||
		!['EMPLOYEE', 'TELEGRAM_USER', 'TELEGRAM_ACCOUNT'].includes(
			String(v.author.kind)
		) ||
		!isNonEmptyString(v.author.displayName, 302) ||
		!nullableText(v.author.subject, 256) ||
		!(v.author.membershipId === null || isUuidV4(v.author.membershipId))
	)
		return false
	if (v.kind === 'INTERNAL') {
		if (
			!exact(v.internal, ['conversationId', 'messageId', 'attachments']) ||
			v.telegram !== null ||
			!isUuidV4(v.internal.conversationId) ||
			!isUuidV4(v.internal.messageId) ||
			!Array.isArray(v.internal.attachments) ||
			!v.internal.attachments.every(parseAttachment)
		)
			return false
	} else {
		if (
			v.internal !== null ||
			!exact(v.telegram, [
				'messageId',
				'channelId',
				'dialogId',
				'accountName',
				'peerName',
				'contentKind',
				'mediaAvailable',
				'deliveryStatus',
				'canReply',
				'replyUntil',
				'replyUnavailableReason'
			]) ||
			!isNonEmptyString(v.telegram.messageId, 128) ||
			!isUuidV4(v.telegram.channelId) ||
			!isNonEmptyString(v.telegram.dialogId, 256) ||
			!isNonEmptyString(v.telegram.accountName, 302) ||
			!isNonEmptyString(v.telegram.peerName, 302) ||
			!['TEXT', 'PHOTO', 'VIDEO', 'DOCUMENT', 'VOICE', 'OTHER'].includes(
				String(v.telegram.contentKind)
			) ||
			typeof v.telegram.mediaAvailable !== 'boolean' ||
			!(
				v.telegram.deliveryStatus === null ||
				[
					'QUEUED',
					'SENDING',
					'SENT',
					'FAILED',
					'UNKNOWN',
					'CANCELLED'
				].includes(String(v.telegram.deliveryStatus))
			) ||
			typeof v.telegram.canReply !== 'boolean' ||
			!nullableDate(v.telegram.replyUntil) ||
			!nullableText(v.telegram.replyUnavailableReason, 256)
		)
			return false
	}
	return true
}

export const parseMessengerFeed = (
	v: unknown,
	b: TelegramBusinessBinding,
	conversationId: string,
	beforeSequence: number | undefined,
	limit: number
): MessengerFeed | null =>
	exact(v, [
		'schemaVersion',
		'workspaceId',
		'subject',
		'conversationId',
		'items',
		'nextBeforeSequence',
		'lastSequence',
		'readThroughSequence',
		'unreadCount',
		'canSend'
	]) &&
	v.schemaVersion === 3 &&
	bindingMatches(v, b) &&
	v.conversationId === conversationId &&
	Array.isArray(v.items) &&
	v.items.length <= limit &&
	v.items.every(parseEntry) &&
	(v.items as MessengerEntry[]).every(
		(item, i, all) => i === 0 || all[i - 1]!.sequence < item.sequence
	) &&
	(beforeSequence === undefined ||
		(v.items as MessengerEntry[]).every(
			item => item.sequence < beforeSequence
		)) &&
	(v.nextBeforeSequence === null ||
		(number(v.nextBeforeSequence, 1) &&
			(v.items as MessengerEntry[]).length === limit &&
			(v.items as MessengerEntry[])[0]?.sequence ===
				v.nextBeforeSequence)) &&
	number(v.lastSequence) &&
	number(v.readThroughSequence) &&
	v.readThroughSequence <= v.lastSequence &&
	number(v.unreadCount) &&
	typeof v.canSend === 'boolean'
		? (v as unknown as MessengerFeed)
		: null

const parseConversation = (v: unknown): v is TelegramConversation =>
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
	(v.peer === null ||
		(exact(v.peer, ['subject', 'membershipId', 'displayName', 'active']) &&
			isNonEmptyString(v.peer.subject, 256) &&
			isUuidV4(v.peer.membershipId) &&
			isNonEmptyString(v.peer.displayName, 302) &&
			typeof v.peer.active === 'boolean')) &&
	number(v.lastSequence) &&
	number(v.readThroughSequence) &&
	(v.peerReadThroughSequence === null ||
		number(v.peerReadThroughSequence)) &&
	(v.kind === 'DIRECT'
		? v.peer !== null && v.peerReadThroughSequence !== null
		: v.peer === null && v.peerReadThroughSequence === null) &&
	number(v.unreadCount) &&
	nullableDate(v.lastMessageAt) &&
	(v.lastMessage === null ||
		(exact(
			v.lastMessage,
			v.kind === 'WORKSPACE'
				? [
						'id',
						'sequence',
						'senderName',
						'senderSubject',
						'text',
						'createdAt'
					]
				: ['id', 'sequence', 'senderSubject', 'text', 'createdAt']
		) &&
			isUuidV4(v.lastMessage.id) &&
			number(v.lastMessage.sequence, 1) &&
			(v.kind === 'WORKSPACE'
				? isNonEmptyString(v.lastMessage.senderName, 302) &&
					(v.lastMessage.senderSubject === null ||
						isNonEmptyString(v.lastMessage.senderSubject, 256))
				: isNonEmptyString(v.lastMessage.senderSubject, 256)) &&
			isNonEmptyString(v.lastMessage.text, 10000) &&
			isIsoDate(v.lastMessage.createdAt))) &&
	typeof v.canSend === 'boolean'

export const parseTelegramConversations = (
	v: unknown,
	b: TelegramBusinessBinding,
	page: number,
	pageSize: number
) =>
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
	v.schemaVersion === 3 &&
	bindingMatches(v, b) &&
	v.page === page &&
	v.pageSize === pageSize &&
	number(v.total) &&
	number(v.unreadCount) &&
	Array.isArray(v.items) &&
	v.items.length <= pageSize &&
	v.items.every(parseConversation)
		? (v as unknown as TelegramConversationsResponse)
		: null

const parseChannel = (v: unknown): v is TelegramChannel =>
	exact(v, [
		'id',
		'version',
		'status',
		'account',
		'canReply',
		'lastInboundAt',
		'lastOutboundAt',
		'connectedAt',
		'disconnectedAt',
		'lastErrorCode'
	]) &&
	isUuidV4(v.id) &&
	number(v.version, 1, 2147483646) &&
	['ACTIVE', 'DISCONNECTED', 'REVOKED', 'DEGRADED'].includes(
		String(v.status)
	) &&
	exact(v.account, ['id', 'displayName', 'username']) &&
	isNonEmptyString(v.account.id, 128) &&
	isNonEmptyString(v.account.displayName, 302) &&
	nullableText(v.account.username, 64) &&
	typeof v.canReply === 'boolean' &&
	nullableDate(v.lastInboundAt) &&
	nullableDate(v.lastOutboundAt) &&
	isIsoDate(v.connectedAt) &&
	nullableDate(v.disconnectedAt) &&
	nullableText(v.lastErrorCode, 128)

export const parseTelegramChannels = (
	v: unknown,
	b: TelegramBusinessBinding
) =>
	exact(v, [
		'schemaVersion',
		'workspaceId',
		'subject',
		'configured',
		'botUsername',
		'canManage',
		'items'
	]) &&
	v.schemaVersion === 1 &&
	bindingMatches(v, b) &&
	typeof v.configured === 'boolean' &&
	nullableText(v.botUsername, 64) &&
	typeof v.canManage === 'boolean' &&
	Array.isArray(v.items) &&
	v.items.every(parseChannel)
		? (v as unknown as TelegramChannelsResponse)
		: null

export const parseTelegramChannelMutation = (
	v: unknown,
	b: TelegramBusinessBinding,
	channelId: string
) =>
	exact(v, ['schemaVersion', 'workspaceId', 'subject', 'item']) &&
	v.schemaVersion === 1 &&
	bindingMatches(v, b) &&
	parseChannel(v.item) &&
	v.item.id === channelId
		? (v as unknown as TelegramChannelMutationResponse)
		: null

const parseConnectSession = (v: unknown): v is TelegramConnectSession =>
	exact(v, [
		'id',
		'version',
		'state',
		'expiresAt',
		'deepLink',
		'owner',
		'channelId',
		'errorCode'
	]) &&
	isUuidV4(v.id) &&
	number(v.version, 1, 2147483646) &&
	[
		'WAITING_TELEGRAM',
		'OWNER_VERIFIED',
		'CONNECTION_READY',
		'CONNECTED',
		'EXPIRED',
		'CANCELLED'
	].includes(String(v.state)) &&
	isIsoDate(v.expiresAt) &&
	nullableText(v.deepLink, 2048) &&
	(v.owner === null ||
		(exact(v.owner, ['id', 'displayName', 'username']) &&
			isNonEmptyString(v.owner.id, 128) &&
			isNonEmptyString(v.owner.displayName, 302) &&
			nullableText(v.owner.username, 64))) &&
	(v.channelId === null || isUuidV4(v.channelId)) &&
	nullableText(v.errorCode, 128)

export const parseTelegramConnectSession = (
	v: unknown,
	b: TelegramBusinessBinding,
	sessionId?: string
) =>
	exact(v, ['schemaVersion', 'workspaceId', 'subject', 'item']) &&
	v.schemaVersion === 1 &&
	bindingMatches(v, b) &&
	parseConnectSession(v.item) &&
	(sessionId === undefined || v.item.id === sessionId)
		? (v as unknown as TelegramConnectSessionResponse)
		: null

export const parseTelegramCommand = (
	v: unknown,
	b: TelegramBusinessBinding,
	commandId: string,
	messageId?: string
) =>
	exact(v, [
		'schemaVersion',
		'workspaceId',
		'subject',
		'commandId',
		'messageId',
		'deliveryStatus'
	]) &&
	v.schemaVersion === 1 &&
	bindingMatches(v, b) &&
	v.commandId === commandId &&
	isNonEmptyString(v.messageId, 128) &&
	(messageId === undefined || v.messageId === messageId) &&
	(v.deliveryStatus === null ||
		[
			'QUEUED',
			'SENDING',
			'SENT',
			'FAILED',
			'UNKNOWN',
			'CANCELLED'
		].includes(String(v.deliveryStatus)))
		? (v as unknown as TelegramCommandResponse)
		: null

export const validTelegramEntry = parseEntry
