import {
	hasExactKeys,
	isIsoDate,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'

export type MailPermission = 'mail:read' | 'mail:send' | 'mail:manage'
export type MailboxPermission = 'read' | 'send' | 'manage'
export type MailboxKind = 'PERSONAL' | 'SHARED'
export type MailTransportSecurity = 'TLS' | 'STARTTLS'
export type MailSendState =
	| 'QUEUED'
	| 'SENDING'
	| 'ACCEPTED'
	| 'PARTIAL_ACCEPTED'
	| 'FAILED'
	| 'UNKNOWN'
	| 'CANCELLED'
export type MailAttachmentState =
	| 'DEFERRED'
	| 'UPLOADING'
	| 'QUARANTINED'
	| 'VALIDATED'
	| 'REJECTED'
	| 'UNAVAILABLE'
export type MailAttachmentMediaType =
	| 'image/png'
	| 'image/jpeg'
	| 'image/webp'
	| 'application/pdf'
	| 'text/plain'
	| 'text/csv'
	| 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
	| 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export type MailAttachmentLimits = {
	maxFileBytes: 5_242_880
	maxSendBytes: 10_485_760
	maxFiles: 10
	supportedMediaTypes: MailAttachmentMediaType[]
}

export type MailTransport = {
	host: string
	port: 993 | 143 | 465 | 25 | 587 | 2525
	security: MailTransportSecurity
	username: string
}
export type MailConnectionSettings = {
	imap: MailTransport
	smtp: MailTransport
}
export type MailConnectCommand = {
	schemaVersion: 1
	workspaceId: string
	commandId: string
	kind: MailboxKind
	address: string
	displayName: string
	imap: MailTransport
	smtp: MailTransport
	password: string
	smtpPassword: string | null
}
export type MailFolderSelection = { path: string; kind: 'INBOX' | 'SENT' }
export type MailGrantCommand = MailGrant & { membershipId: string }
export type MailSendCommand = {
	schemaVersion: 1
	workspaceId: string
	commandId: string
	mailboxId: string
	contactId: string | null
	to: MailAddress[]
	cc: MailAddress[]
	bcc: MailAddress[]
	subject: string
	text: string
	html?: string
	attachmentIds: string[]
	replyToMessageId: string | null
}

export type MailCapabilities = {
	schemaVersion: 1
	workspaceId: string
	enabled: boolean
	connectionAvailable: boolean
	attachmentsAvailable: boolean
	mailPermissions: MailPermission[]
	canCreatePersonal: boolean
	canCreateShared: boolean
	attachmentLimits: MailAttachmentLimits
}

export type MailboxState = 'ACTIVE' | 'REAUTH_REQUIRED' | 'DISCONNECTED'
export type MailboxSyncStatus =
	| 'NOT_CONFIGURED'
	| 'IDLE'
	| 'SYNCING'
	| 'BACKFILL'
	| 'CURRENT'
	| 'ERROR'
	| 'DISCONNECTED'

export type MailMailbox = {
	id: string
	kind: MailboxKind
	address: string
	displayName: string
	state: MailboxState
	version: number
	permissions: MailboxPermission[]
	syncStatus: MailboxSyncStatus
	lastSyncAt: string | null
	safeErrorCode: string | null
}

export type MailFolder = {
	path: string
	name: string
	kind: 'INBOX' | 'SENT' | null
	selected: boolean
}

export type MailAddress = { email: string; name: string | null }
export type MailDirection = 'INBOUND' | 'OUTBOUND'
export type MailSourceKind = 'IMAP' | 'CRM_SEND'
export type MailBodyStatus = 'COMPLETE' | 'TOO_LARGE' | 'UNAVAILABLE'
export type MailLinkState = 'UNMATCHED' | 'AMBIGUOUS' | 'LINKED'

export type MailAttachment = {
	id: string
	fileName: string
	declaredMime: string
	detectedMime: string | null
	byteSize: number
	state: MailAttachmentState
	sha256: string | null
	validationVersion: number
	expiresAt: string | null
}

export type MailContactLink = {
	externalEmail: string
	contactId: string | null
	state: MailLinkState
	version: number
}

export type MailMessage = {
	id: string
	mailboxId: string
	direction: MailDirection
	subject: string
	from: MailAddress[]
	to: MailAddress[]
	cc: MailAddress[]
	sentAt: string | null
	receivedAt: string
	attachmentCount: number
	sourceKind: MailSourceKind
	state: MailSendState | null
	createdAt: string
}

export type MailMessageDetail = MailMessage & {
	text: string | null
	bodyStatus: MailBodyStatus
	bcc: MailAddress[]
	attachments: MailAttachment[]
	links: MailContactLink[]
	provenance: {
		folderPath: string | null
		uidValidity: string | null
		uid: string | null
		messageId: string | null
		inReplyTo: string | null
		references: string[]
	}
}

export type MailSendResult = {
	schemaVersion: 1
	workspaceId: string
	sendId: string
	state: 'QUEUED'
	messageId: string
}

export type MailSendStatus = {
	schemaVersion: 1
	workspaceId: string
	item: {
		id: string
		state: MailSendState
		messageId: string
		accepted: string[]
		rejected: string[]
		safeErrorCode: string | null
		createdAt: string
		settledAt: string | null
	}
}

export type MailGrant = {
	subject: string
	membershipId: string
	read: boolean
	send: boolean
	manage: boolean
}

export type MailList<T> = {
	schemaVersion: 1
	workspaceId: string
	items: T[]
	nextCursor: string | null
}
export type MailItem<T> = {
	schemaVersion: 1
	workspaceId: string
	item: T
}

const PERMISSIONS: readonly MailPermission[] = [
	'mail:read',
	'mail:send',
	'mail:manage'
]
const MAILBOX_PERMISSIONS: readonly MailboxPermission[] = [
	'read',
	'send',
	'manage'
]
const SEND_STATES: readonly MailSendState[] = [
	'QUEUED',
	'SENDING',
	'ACCEPTED',
	'PARTIAL_ACCEPTED',
	'FAILED',
	'UNKNOWN',
	'CANCELLED'
]
const ATTACHMENT_STATES: readonly MailAttachmentState[] = [
	'DEFERRED',
	'UPLOADING',
	'QUARANTINED',
	'VALIDATED',
	'REJECTED',
	'UNAVAILABLE'
]
const ATTACHMENT_TYPES: readonly MailAttachmentMediaType[] = [
	'image/png',
	'image/jpeg',
	'image/webp',
	'application/pdf',
	'text/plain',
	'text/csv',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]
const UUID = isUuidV4
const nonEmpty = (value: unknown, max: number) =>
	isNonEmptyString(value, max)
const emailAddress = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.length <= 254 &&
	/^[^\s@<>\x00-\x1f\x7f]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(
		value
	)
const nullableString = (value: unknown, max: number) =>
	value === null || nonEmpty(value, max)
const nullableDate = (value: unknown) => value === null || isIsoDate(value)
const positiveInt = (value: unknown) =>
	typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const nonNegativeInt = (value: unknown) =>
	typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const enumValue = <T extends string>(
	value: unknown,
	values: readonly T[]
): value is T => typeof value === 'string' && values.includes(value as T)
const stringArray = (value: unknown, max: number, itemMax = 254) =>
	Array.isArray(value) &&
	value.length <= max &&
	value.every(item => nonEmpty(item, itemMax))

const parseAddress = (value: unknown): value is MailAddress =>
	isRecord(value) &&
	hasExactKeys(value, ['email', 'name']) &&
	emailAddress(value.email) &&
	nullableString(value.name, 200)

const parseAttachment = (value: unknown): value is MailAttachment =>
	isRecord(value) &&
	hasExactKeys(value, [
		'id',
		'fileName',
		'declaredMime',
		'detectedMime',
		'byteSize',
		'state',
		'sha256',
		'validationVersion',
		'expiresAt'
	]) &&
	UUID(value.id) &&
	nonEmpty(value.fileName, 255) &&
	nonEmpty(value.declaredMime, 200) &&
	nullableString(value.detectedMime, 200) &&
	nonNegativeInt(value.byteSize) &&
	enumValue(value.state, ATTACHMENT_STATES) &&
	(value.sha256 === null ||
		(typeof value.sha256 === 'string' &&
			/^[a-f0-9]{64}$/i.test(value.sha256))) &&
	positiveInt(value.validationVersion) &&
	nullableDate(value.expiresAt)

const parseMessage = (value: unknown): value is MailMessage =>
	isRecord(value) &&
	hasExactKeys(value, [
		'id',
		'mailboxId',
		'direction',
		'subject',
		'from',
		'to',
		'cc',
		'sentAt',
		'receivedAt',
		'attachmentCount',
		'sourceKind',
		'state',
		'createdAt'
	]) &&
	UUID(value.id) &&
	UUID(value.mailboxId) &&
	enumValue(value.direction, ['INBOUND', 'OUTBOUND'] as const) &&
	typeof value.subject === 'string' &&
	value.subject.length <= 300 &&
	Array.isArray(value.from) &&
	value.from.every(parseAddress) &&
	Array.isArray(value.to) &&
	value.to.every(parseAddress) &&
	Array.isArray(value.cc) &&
	value.cc.every(parseAddress) &&
	nullableDate(value.sentAt) &&
	isIsoDate(value.receivedAt) &&
	nonNegativeInt(value.attachmentCount) &&
	enumValue(value.sourceKind, ['IMAP', 'CRM_SEND'] as const) &&
	(value.state === null || enumValue(value.state, SEND_STATES)) &&
	isIsoDate(value.createdAt) &&
	(value.sourceKind === 'CRM_SEND'
		? value.state !== null
		: value.state === null)

const parseGrant = (value: unknown): value is MailGrant =>
	isRecord(value) &&
	hasExactKeys(value, [
		'subject',
		'membershipId',
		'read',
		'send',
		'manage'
	]) &&
	nonEmpty(value.subject, 256) &&
	UUID(value.membershipId) &&
	typeof value.read === 'boolean' &&
	typeof value.send === 'boolean' &&
	typeof value.manage === 'boolean' &&
	(!value.send || value.read)

const parseEnvelope = (value: unknown, workspaceId: string) =>
	isRecord(value) &&
	value.schemaVersion === 1 &&
	value.workspaceId === workspaceId

const parsePage = <T>(
	value: unknown,
	workspaceId: string,
	parseItem: (item: unknown) => item is T
): MailList<T> | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'items',
			'nextCursor'
		]) ||
		!parseEnvelope(value, workspaceId) ||
		!Array.isArray(value.items) ||
		!value.items.every(parseItem) ||
		!nullableString(value.nextCursor, 2048)
	)
		return null
	return value as MailList<T>
}

export const parseMailCapabilities = (
	value: unknown,
	workspaceId: string
): MailCapabilities | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'enabled',
			'connectionAvailable',
			'attachmentsAvailable',
			'mailPermissions',
			'canCreatePersonal',
			'canCreateShared',
			'attachmentLimits'
		]) ||
		!parseEnvelope(value, workspaceId) ||
		typeof value.enabled !== 'boolean' ||
		typeof value.connectionAvailable !== 'boolean' ||
		typeof value.attachmentsAvailable !== 'boolean' ||
		!Array.isArray(value.mailPermissions) ||
		!value.mailPermissions.every(item => enumValue(item, PERMISSIONS)) ||
		typeof value.canCreatePersonal !== 'boolean' ||
		typeof value.canCreateShared !== 'boolean' ||
		!isRecord(value.attachmentLimits) ||
		!hasExactKeys(value.attachmentLimits, [
			'maxFileBytes',
			'maxSendBytes',
			'maxFiles',
			'supportedMediaTypes'
		]) ||
		value.attachmentLimits.maxFileBytes !== 5_242_880 ||
		value.attachmentLimits.maxSendBytes !== 10_485_760 ||
		value.attachmentLimits.maxFiles !== 10 ||
		!Array.isArray(value.attachmentLimits.supportedMediaTypes) ||
		!value.attachmentLimits.supportedMediaTypes.every(item =>
			enumValue(item, ATTACHMENT_TYPES)
		)
	)
		return null
	return value as MailCapabilities
}

const parseMailbox = (value: unknown): value is MailMailbox =>
	isRecord(value) &&
	hasExactKeys(value, [
		'id',
		'kind',
		'address',
		'displayName',
		'state',
		'version',
		'permissions',
		'syncStatus',
		'lastSyncAt',
		'safeErrorCode'
	]) &&
	UUID(value.id) &&
	enumValue(value.kind, ['PERSONAL', 'SHARED'] as const) &&
	emailAddress(value.address) &&
	nonEmpty(value.displayName, 200) &&
	enumValue(value.state, [
		'ACTIVE',
		'REAUTH_REQUIRED',
		'DISCONNECTED'
	] as const) &&
	positiveInt(value.version) &&
	Array.isArray(value.permissions) &&
	value.permissions.every(item => enumValue(item, MAILBOX_PERMISSIONS)) &&
	enumValue(value.syncStatus, [
		'NOT_CONFIGURED',
		'IDLE',
		'SYNCING',
		'BACKFILL',
		'CURRENT',
		'ERROR',
		'DISCONNECTED'
	] as const) &&
	nullableDate(value.lastSyncAt) &&
	nullableString(value.safeErrorCode, 128)

export const parseMailMailboxPage = (
	value: unknown,
	workspaceId: string
) => parsePage(value, workspaceId, parseMailbox)

export const parseMailMailboxResult = (
	value: unknown,
	workspaceId: string
): MailItem<MailMailbox> | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'workspaceId', 'item']) ||
		!parseEnvelope(value, workspaceId) ||
		!parseMailbox(value.item)
	)
		return null
	return value as MailItem<MailMailbox>
}

const parseFolder = (value: unknown): value is MailFolder =>
	isRecord(value) &&
	hasExactKeys(value, ['path', 'name', 'kind', 'selected']) &&
	nonEmpty(value.path, 512) &&
	nonEmpty(value.name, 200) &&
	(value.kind === null ||
		enumValue(value.kind, ['INBOX', 'SENT'] as const)) &&
	typeof value.selected === 'boolean'

export const parseMailFolderPage = (value: unknown, workspaceId: string) =>
	parsePage(value, workspaceId, parseFolder)

export const parseMailGrants = (value: unknown, workspaceId: string) =>
	parsePage(value, workspaceId, parseGrant)

export const parseMailMessagePage = (
	value: unknown,
	workspaceId: string
) => parsePage(value, workspaceId, parseMessage)

const parseLink = (value: unknown): value is MailContactLink =>
	isRecord(value) &&
	hasExactKeys(value, [
		'externalEmail',
		'contactId',
		'state',
		'version'
	]) &&
	emailAddress(value.externalEmail) &&
	(value.contactId === null || UUID(value.contactId)) &&
	enumValue(value.state, ['UNMATCHED', 'AMBIGUOUS', 'LINKED'] as const) &&
	positiveInt(value.version) &&
	(value.state === 'LINKED'
		? value.contactId !== null
		: value.contactId === null)

const parseMessageDetail = (
	value: unknown
): value is MailMessageDetail => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'id',
			'mailboxId',
			'direction',
			'subject',
			'from',
			'to',
			'cc',
			'sentAt',
			'receivedAt',
			'attachmentCount',
			'sourceKind',
			'state',
			'createdAt',
			'text',
			'bodyStatus',
			'bcc',
			'attachments',
			'links',
			'provenance'
		]) ||
		!parseMessage({
			id: value.id,
			mailboxId: value.mailboxId,
			direction: value.direction,
			subject: value.subject,
			from: value.from,
			to: value.to,
			cc: value.cc,
			sentAt: value.sentAt,
			receivedAt: value.receivedAt,
			attachmentCount: value.attachmentCount,
			sourceKind: value.sourceKind,
			state: value.state,
			createdAt: value.createdAt
		}) ||
		(value.text !== null &&
			(typeof value.text !== 'string' || value.text.length > 262_144)) ||
		!enumValue(value.bodyStatus, [
			'COMPLETE',
			'TOO_LARGE',
			'UNAVAILABLE'
		] as const) ||
		!Array.isArray(value.bcc) ||
		!value.bcc.every(parseAddress) ||
		!Array.isArray(value.attachments) ||
		!value.attachments.every(parseAttachment) ||
		!Array.isArray(value.links) ||
		!value.links.every(parseLink) ||
		!isRecord(value.provenance) ||
		!hasExactKeys(value.provenance, [
			'folderPath',
			'uidValidity',
			'uid',
			'messageId',
			'inReplyTo',
			'references'
		])
	)
		return false
	const provenance = value.provenance
	return (
		nullableString(provenance.folderPath, 512) &&
		nullableString(provenance.uidValidity, 32) &&
		nullableString(provenance.uid, 32) &&
		nullableString(provenance.messageId, 998) &&
		nullableString(provenance.inReplyTo, 998) &&
		stringArray(provenance.references, 100, 998)
	)
}

export const parseMailMessageResult = (
	value: unknown,
	workspaceId: string
): MailItem<MailMessageDetail> | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'workspaceId', 'item']) ||
		!parseEnvelope(value, workspaceId) ||
		!parseMessageDetail(value.item)
	)
		return null
	return value as MailItem<MailMessageDetail>
}

export type MailRichMessageDetail = MailMessageDetail & {
	html: string | null
}

export const parseMailRichMessageResult = (
	value: unknown,
	workspaceId: string
): MailItem<MailRichMessageDetail> | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'workspaceId', 'item']) ||
		!parseEnvelope(value, workspaceId) ||
		!isRecord(value.item) ||
		!Object.hasOwn(value.item, 'html') ||
		(value.item.html !== null &&
			(typeof value.item.html !== 'string' ||
				value.item.html.length > 262_144))
	)
		return null
	const { html, ...legacy } = value.item
	if (!parseMessageDetail(legacy)) return null
	return {
		schemaVersion: 1,
		workspaceId,
		item: { ...legacy, html }
	} as MailItem<MailRichMessageDetail>
}

export const parseMailLinkResult = (
	value: unknown,
	workspaceId: string
): MailItem<MailContactLink> | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'workspaceId', 'item']) ||
		!parseEnvelope(value, workspaceId) ||
		!parseLink(value.item)
	)
		return null
	return value as MailItem<MailContactLink>
}

const parseTransport = (
	value: unknown,
	kind: 'imap' | 'smtp'
): value is MailTransport => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['host', 'port', 'security', 'username']) ||
		!nonEmpty(value.host, 253) ||
		value.host !== value.host.toLowerCase() ||
		!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
			value.host
		) ||
		/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value.host) ||
		/(?:\.localhost|\.local|\.internal|\.test|\.invalid|\.example|\.onion)$/.test(
			value.host
		) ||
		!nonEmpty(value.username, 254) ||
		/[\x00-\x1f\x7f]/.test(value.username) ||
		!enumValue(value.security, ['TLS', 'STARTTLS'] as const)
	)
		return false
	return kind === 'imap'
		? (value.port === 993 && value.security === 'TLS') ||
				(value.port === 143 && value.security === 'STARTTLS')
		: (value.port === 465 && value.security === 'TLS') ||
				([25, 587, 2525].includes(value.port as number) &&
					value.security === 'STARTTLS')
}

export const parseMailConnectionResult = (
	value: unknown,
	workspaceId: string
): MailItem<MailConnectionSettings> | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'workspaceId', 'item']) ||
		!parseEnvelope(value, workspaceId) ||
		!isRecord(value.item) ||
		!hasExactKeys(value.item, ['imap', 'smtp']) ||
		!parseTransport(value.item.imap, 'imap') ||
		!parseTransport(value.item.smtp, 'smtp')
	)
		return null
	return value as MailItem<MailConnectionSettings>
}

export const parseMailAttachmentResult = (
	value: unknown,
	workspaceId: string
): MailItem<MailAttachment> | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'workspaceId', 'item']) ||
		!parseEnvelope(value, workspaceId) ||
		!parseAttachment(value.item)
	)
		return null
	return value as MailItem<MailAttachment>
}

export const parseMailSendResult = (
	value: unknown,
	workspaceId: string
): MailSendResult | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'sendId',
			'state',
			'messageId'
		]) ||
		!parseEnvelope(value, workspaceId) ||
		!UUID(value.sendId) ||
		value.state !== 'QUEUED' ||
		!nonEmpty(value.messageId, 998) ||
		!value.messageId.startsWith('<') ||
		!value.messageId.endsWith('>')
	)
		return null
	return value as MailSendResult
}

export const parseMailSendStatus = (
	value: unknown,
	workspaceId: string
): MailSendStatus | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'workspaceId', 'item']) ||
		!parseEnvelope(value, workspaceId) ||
		!isRecord(value.item) ||
		!hasExactKeys(value.item, [
			'id',
			'state',
			'messageId',
			'accepted',
			'rejected',
			'safeErrorCode',
			'createdAt',
			'settledAt'
		])
	)
		return null
	const item = value.item
	if (
		!UUID(item.id) ||
		!enumValue(item.state, SEND_STATES) ||
		!nonEmpty(item.messageId, 998) ||
		!item.messageId.startsWith('<') ||
		!item.messageId.endsWith('>') ||
		!stringArray(item.accepted, 20) ||
		!stringArray(item.rejected, 20) ||
		!nullableString(item.safeErrorCode, 128) ||
		!isIsoDate(item.createdAt) ||
		!nullableDate(item.settledAt)
	)
		return null
	return value as MailSendStatus
}
