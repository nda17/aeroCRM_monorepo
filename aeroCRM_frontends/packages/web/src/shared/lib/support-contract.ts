/** Plain HTTP contracts shared by the two applications; no UI or auth runtime. */
export const SUPPORT_UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const SUPPORT_STATUSES = ['NEW', 'IN_PROGRESS', 'RESOLVED'] as const
export type SupportStatus = (typeof SUPPORT_STATUSES)[number]
export const supportStatusLabels: Record<SupportStatus, string> = {
	NEW: 'Новое',
	IN_PROGRESS: 'В работе',
	RESOLVED: 'Решено'
}
export interface SupportAttachment {
	id: string
	fileName: string
	mediaType: string
	byteSize: number
	width: number
	height: number
}
export interface SupportConversation {
	id: string
	number: number
	authorSubject: string
	authorName: string | null
	workspaceId: string | null
	companyName: string | null
	subject: string
	status: SupportStatus
	section: string
	appVersion: string
	lastSequence: number
	version: number
	unreadCount: number
	createdAt: string
	updatedAt: string
	lastMessageAt: string
}
export interface SupportMessage {
	id: string
	conversationId: string
	senderKind: 'CLIENT' | 'OPERATOR'
	senderName: string | null
	text: string
	sequence: number
	createdAt: string
	attachments: SupportAttachment[]
}
export interface SupportPage {
	items: SupportConversation[]
	total: number
	page: number
	limit: number
}
export interface SupportHistory {
	items: SupportMessage[]
	hasMore: boolean
	lastSequence: number
}
export interface SupportSettings {
	version: number
	enabled: boolean
	emailEnabled: boolean
	staffEmails: string[]
	telegramEnabled: boolean
	telegramChatId: string | null
	telegramThreadId: number | null
	telegramBot: 'SUPPORT'
	clientEmailEnabled: boolean
}
export interface SupportReplyCommand {
	commandId: string
	expectedActorSubject: string
	text: string
	attachmentIds: string[]
}
export interface SupportCreateCommand extends SupportReplyCommand {
	draftId: string
	workspaceId?: string
	subject: string
	section: string
	appVersion: string
}
export interface SupportSendResult {
	commandId: string
	conversation: SupportConversation
	message: SupportMessage
}
export type SupportRecovery =
	| { state: 'NOT_FOUND'; commandId: string }
	| {
			state: 'COMPLETED'
			commandId: string
			conversationId: string
			messageId?: string
	  }
const fail = (): never => {
	throw new Error('Сервис поддержки вернул некорректный ответ.')
}
const record = (v: unknown): Record<string, unknown> =>
	v && typeof v === 'object' && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: fail()
const text = (v: unknown, max = 10000): string =>
	typeof v === 'string' && v.length <= max ? v : fail()
const nullable = (v: unknown, max = 1000) =>
	v === null ? null : text(v, max)
const integer = (v: unknown): number =>
	typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 2147483647
		? v
		: fail()
const bool = (v: unknown): boolean => (typeof v === 'boolean' ? v : fail())
const uuid = (v: unknown): string =>
	typeof v === 'string' && SUPPORT_UUID.test(v) ? v : fail()
const date = (v: unknown): string =>
	typeof v === 'string' &&
	/^\d{4}-\d\d-\d\dT/.test(v) &&
	Number.isFinite(Date.parse(v))
		? v
		: fail()
export const parseSupportAttachment = (
	value: unknown
): SupportAttachment => {
	const v = record(value)
	const mediaType = text(v.mediaType, 20)
	const result = {
		id: uuid(v.id),
		fileName: text(v.fileName, 255),
		mediaType,
		byteSize: integer(v.byteSize),
		width: integer(v.width),
		height: integer(v.height)
	}
	if (
		!['image/png', 'image/jpeg', 'image/webp'].includes(mediaType) ||
		!result.byteSize ||
		result.byteSize > 5 * 1024 * 1024 ||
		!result.width ||
		!result.height ||
		result.width * result.height > 40000000
	)
		fail()
	return result
}
export const parseSupportConversation = (
	value: unknown
): SupportConversation => {
	const v = record(value)
	if (!SUPPORT_STATUSES.includes(v.status as SupportStatus)) fail()
	return {
		id: uuid(v.id),
		number: integer(v.number),
		authorSubject: text(v.authorSubject, 255),
		authorName: nullable(v.authorName),
		workspaceId: v.workspaceId === null ? null : uuid(v.workspaceId),
		companyName: nullable(v.companyName),
		subject: text(v.subject, 160),
		status: v.status as SupportStatus,
		section: text(v.section, 64),
		appVersion: text(v.appVersion, 64),
		lastSequence: integer(v.lastSequence),
		version: integer(v.version),
		unreadCount: integer(v.unreadCount),
		createdAt: date(v.createdAt),
		updatedAt: date(v.updatedAt),
		lastMessageAt: date(v.lastMessageAt)
	}
}
export const parseSupportMessage = (value: unknown): SupportMessage => {
	const v = record(value)
	if (
		!['CLIENT', 'OPERATOR'].includes(v.senderKind as string) ||
		!Array.isArray(v.attachments) ||
		v.attachments.length > 3
	)
		fail()
	return {
		id: uuid(v.id),
		conversationId: uuid(v.conversationId),
		senderKind: v.senderKind as SupportMessage['senderKind'],
		senderName: nullable(v.senderName),
		text: text(v.text),
		sequence: integer(v.sequence),
		createdAt: date(v.createdAt),
		attachments: (v.attachments as unknown[]).map(parseSupportAttachment)
	}
}
export const parseSupportPage = (value: unknown): SupportPage => {
	const v = record(value)
	if (!Array.isArray(v.items) || v.items.length > 100) fail()
	return {
		items: (v.items as unknown[]).map(parseSupportConversation),
		total: integer(v.total),
		page: integer(v.page),
		limit: integer(v.limit)
	}
}
export const parseSupportHistory = (
	value: unknown,
	conversationId: string
): SupportHistory => {
	const v = record(value)
	if (!Array.isArray(v.items) || v.items.length > 100) fail()
	const items = (v.items as unknown[]).map(parseSupportMessage)
	if (
		items.some(
			(item, i) =>
				item.conversationId !== conversationId ||
				(i > 0 && items[i - 1].sequence >= item.sequence)
		)
	)
		fail()
	return {
		items,
		hasMore: bool(v.hasMore),
		lastSequence: integer(v.lastSequence)
	}
}
export const parseSupportSettings = (value: unknown): SupportSettings => {
	const v = record(value)
	if (
		v.telegramBot !== 'SUPPORT' ||
		!Array.isArray(v.staffEmails) ||
		v.staffEmails.length > 10
	)
		fail()
	return {
		version: integer(v.version),
		enabled: bool(v.enabled),
		emailEnabled: bool(v.emailEnabled),
		staffEmails: (v.staffEmails as unknown[]).map(value =>
			text(value, 254)
		),
		telegramEnabled: bool(v.telegramEnabled),
		telegramChatId: nullable(v.telegramChatId, 64),
		telegramThreadId:
			v.telegramThreadId === null ? null : integer(v.telegramThreadId),
		telegramBot: 'SUPPORT',
		clientEmailEnabled: bool(v.clientEmailEnabled)
	}
}
export const parseSupportSend = (
	value: unknown,
	commandId: string,
	conversationId?: string
): SupportSendResult => {
	const v = record(value)
	const conversation = parseSupportConversation(v.conversation)
	const message = parseSupportMessage(v.message)
	if (
		v.commandId !== commandId ||
		message.conversationId !== conversation.id ||
		(conversationId && conversation.id !== conversationId)
	)
		fail()
	return { commandId, conversation, message }
}
export const parseSupportRecovery = (
	value: unknown,
	commandId: string
): SupportRecovery => {
	const v = record(value)
	if (v.commandId !== commandId) fail()
	if (v.state === 'NOT_FOUND') return { state: 'NOT_FOUND', commandId }
	if (v.state !== 'COMPLETED') fail()
	return {
		state: 'COMPLETED',
		commandId,
		conversationId: uuid(v.conversationId),
		...(v.messageId === undefined ? {} : { messageId: uuid(v.messageId) })
	}
}
export const parseSupportUnread = (value: unknown) =>
	integer(record(value).unreadCount)
export const supportSection = (pathname: string) =>
	pathname === '/contacts' || pathname.startsWith('/contacts/')
		? 'customers'
		: pathname === '/tasks'
			? 'planner'
			: (['inbox', 'customers', 'deals', 'planner', 'settings'].find(
					section =>
						pathname === `/${section}` ||
						pathname.startsWith(`/${section}/`)
				) ?? 'other')
export const validateSupportFile = (file: Pick<File, 'size' | 'type'>) => {
	if (
		!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
		file.size < 1 ||
		file.size > 5 * 1024 * 1024
	)
		throw new Error('Выберите PNG, JPEG или WebP размером до 5 МБ.')
}
