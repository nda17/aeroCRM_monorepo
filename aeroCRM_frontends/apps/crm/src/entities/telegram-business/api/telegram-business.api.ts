import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { isNonEmptyString, isUuidV4 } from '@/shared/lib/contract'
import {
	parseMessengerFeed,
	parseTelegramChannels,
	parseTelegramChannelMutation,
	parseTelegramCommand,
	parseTelegramConnectSession,
	parseTelegramConversations,
	validTelegramBusinessBinding,
	type TelegramBusinessBinding,
	type TelegramConnectSessionCommand,
	type TelegramConversationListRequest,
	type TelegramFeedRequest,
	type TelegramReadCommand,
	type TelegramReplyCommand,
	type TelegramVersionedCommand,
	type TelegramConnectSessionResponse
} from '../model/contracts'

const safeId = (value: string) => {
	if (!isUuidV4(value)) throw invalidContractError()
	return value
}
const binding = (value: TelegramBusinessBinding) => {
	if (!validTelegramBusinessBinding(value)) throw invalidContractError()
	return { workspaceId: safeId(value.workspaceId), subject: value.subject }
}
const commandEnvelope = (
	b: TelegramBusinessBinding,
	commandId: string
) => ({
	schemaVersion: 1 as const,
	workspaceId: safeId(b.workspaceId),
	commandId: safeId(commandId)
})
const parse = <T>(
	value: unknown,
	parser: (value: unknown) => T | null
): T => {
	const result = parser(value)
	if (result === null) throw invalidContractError()
	return result
}
const pageValues = (page = 1, pageSize = 50) => {
	if (
		!Number.isSafeInteger(page) ||
		page < 1 ||
		page > 2147483647 ||
		!Number.isSafeInteger(pageSize) ||
		pageSize < 1 ||
		pageSize > 100
	)
		throw invalidContractError()
	return { page, pageSize }
}
const sequenceValues = (beforeSequence?: number, limit = 50) => {
	if (
		(beforeSequence !== undefined &&
			(!Number.isSafeInteger(beforeSequence) ||
				beforeSequence < 1 ||
				beforeSequence > 2147483647)) ||
		!Number.isSafeInteger(limit) ||
		limit < 1 ||
		limit > 100
	)
		throw invalidContractError()
	return { beforeSequence, limit }
}
const versioned = (value: TelegramVersionedCommand) => {
	const b = binding(value)
	if (
		!Number.isSafeInteger(value.expectedVersion) ||
		value.expectedVersion < 1 ||
		value.expectedVersion > 2147483646
	)
		throw invalidContractError()
	return {
		b,
		expectedVersion: value.expectedVersion,
		commandId: safeId(value.commandId)
	}
}

export const listTelegramConversations = async (
	token: string,
	request: TelegramConversationListRequest
) => {
	const b = binding(request)
	const { page, pageSize } = pageValues(request.page, request.pageSize)
	if (
		request.q !== undefined &&
		(typeof request.q !== 'string' || request.q.length > 100)
	)
		throw invalidContractError()
	const value = await authenticatedRequest({
		accessToken: token,
		method: 'GET',
		url: '/crm/access/chat/conversations-v3',
		params: {
			workspaceId: b.workspaceId,
			page: String(page),
			pageSize: String(pageSize),
			...(request.q !== undefined ? { q: request.q } : {})
		}
	})
	return parse(value, v =>
		parseTelegramConversations(v, b, page, pageSize)
	)
}

export const getTelegramMessengerFeed = async (
	token: string,
	request: TelegramFeedRequest
) => {
	const b = binding(request)
	const conversationId = safeId(request.conversationId)
	const { beforeSequence, limit } = sequenceValues(
		request.beforeSequence,
		request.limit
	)
	const value = await authenticatedRequest({
		accessToken: token,
		method: 'GET',
		url: `/crm/access/chat/conversations/${conversationId}/messages-v3`,
		params: {
			workspaceId: b.workspaceId,
			limit: String(limit),
			...(beforeSequence !== undefined
				? { beforeSequence: String(beforeSequence) }
				: {})
		}
	})
	return parse(value, v =>
		parseMessengerFeed(v, b, conversationId, beforeSequence, limit)
	)
}

export const markTelegramConversationRead = async (
	token: string,
	command: TelegramReadCommand
) => {
	const b = binding(command)
	const conversationId = safeId(command.conversationId)
	const commandId = safeId(command.commandId)
	if (
		!Number.isSafeInteger(command.throughSequence) ||
		command.throughSequence < 0 ||
		command.throughSequence > 2147483647
	)
		throw invalidContractError()
	const value = await authenticatedRequest({
		accessToken: token,
		method: 'PUT',
		url: `/crm/access/chat/conversations/${conversationId}/read-v3`,
		headers: { 'Idempotency-Key': commandId },
		data: {
			schemaVersion: 3,
			workspaceId: b.workspaceId,
			commandId,
			throughSequence: command.throughSequence
		}
	})
	return parse(value, v => {
		if (!v || typeof v !== 'object' || Array.isArray(v)) return null
		const x = v as Record<string, unknown>
		return Object.keys(x).length === 6 &&
			[
				'schemaVersion',
				'workspaceId',
				'subject',
				'conversationId',
				'throughSequence',
				'unreadCount'
			].every(k => Object.hasOwn(x, k)) &&
			x.schemaVersion === 3 &&
			x.workspaceId === b.workspaceId &&
			x.subject === b.subject &&
			x.conversationId === conversationId &&
			Number.isSafeInteger(x.throughSequence) &&
			(x.throughSequence as number) >= command.throughSequence &&
			(x.throughSequence as number) <= 2147483647 &&
			Number.isSafeInteger(x.unreadCount) &&
			(x.unreadCount as number) >= 0 &&
			(x.unreadCount as number) <= 2147483647
			? (x as unknown as {
					schemaVersion: 3
					workspaceId: string
					subject: string
					conversationId: string
					throughSequence: number
					unreadCount: number
				})
			: null
	})
}

export const listTelegramChannels = async (
	token: string,
	request: TelegramBusinessBinding
) => {
	const b = binding(request)
	const value = await authenticatedRequest({
		accessToken: token,
		method: 'GET',
		url: '/crm/access/telegram/channels',
		params: { workspaceId: b.workspaceId }
	})
	return parse(value, v => parseTelegramChannels(v, b))
}

export const createTelegramConnectSession = async (
	token: string,
	command: TelegramConnectSessionCommand
) => {
	const b = binding(command)
	const commandId = safeId(command.commandId)
	if (command.channelId !== undefined) safeId(command.channelId)
	const value = await authenticatedRequest({
		accessToken: token,
		method: 'POST',
		url: '/crm/access/telegram/connect-sessions',
		headers: { 'Idempotency-Key': commandId },
		data: {
			...commandEnvelope(b, commandId),
			...(command.channelId ? { channelId: command.channelId } : {})
		}
	})
	return parse(value, v => parseTelegramConnectSession(v, b))
}

export const getTelegramConnectSession = async (
	token: string,
	request: TelegramBusinessBinding & { connectSessionId: string }
) => {
	const b = binding(request)
	const connectSessionId = safeId(request.connectSessionId)
	const value = await authenticatedRequest({
		accessToken: token,
		method: 'GET',
		url: `/crm/access/telegram/connect-sessions/${connectSessionId}`,
		params: { workspaceId: b.workspaceId }
	})
	return parse<TelegramConnectSessionResponse>(value, v =>
		parseTelegramConnectSession(v, b, connectSessionId)
	)
}

const sessionCommand = async (
	token: string,
	command: TelegramVersionedCommand,
	action: 'confirm' | 'cancel'
) => {
	const { b, expectedVersion, commandId } = versioned(command)
	if (!command.connectSessionId) throw invalidContractError()
	const connectSessionId = safeId(command.connectSessionId)
	const value = await authenticatedRequest({
		accessToken: token,
		method: 'POST',
		url: `/crm/access/telegram/connect-sessions/${connectSessionId}/${action}`,
		headers: { 'Idempotency-Key': commandId },
		data: { ...commandEnvelope(b, commandId), expectedVersion }
	})
	return parse(value, v =>
		parseTelegramConnectSession(v, b, connectSessionId)
	)
}
export const confirmTelegramConnectSession = (
	token: string,
	command: TelegramVersionedCommand
) => sessionCommand(token, command, 'confirm')
export const cancelTelegramConnectSession = (
	token: string,
	command: TelegramVersionedCommand
) => sessionCommand(token, command, 'cancel')

export const disconnectTelegramChannel = async (
	token: string,
	command: TelegramVersionedCommand
) => {
	const { b, expectedVersion, commandId } = versioned(command)
	if (!command.channelId) throw invalidContractError()
	const channelId = safeId(command.channelId)
	const value = await authenticatedRequest({
		accessToken: token,
		method: 'POST',
		url: `/crm/access/telegram/channels/${channelId}/disconnect`,
		headers: { 'Idempotency-Key': commandId },
		data: { ...commandEnvelope(b, commandId), expectedVersion }
	})
	return parse(value, v => parseTelegramChannelMutation(v, b, channelId))
}

export const replyToTelegramMessage = async (
	token: string,
	command: TelegramReplyCommand
) => {
	const b = binding(command)
	const commandId = safeId(command.commandId)
	if (!isNonEmptyString(command.text, 4096)) throw invalidContractError()
	const sourceMessageId = safeId(command.sourceMessageId)
	const value = await authenticatedRequest({
		accessToken: token,
		method: 'POST',
		url: `/crm/access/telegram/messages/${encodeURIComponent(sourceMessageId)}/replies`,
		headers: { 'Idempotency-Key': commandId },
		data: { ...commandEnvelope(b, commandId), text: command.text }
	})
	return parse(value, v => parseTelegramCommand(v, b, commandId))
}

export const lookupTelegramCommand = async (
	token: string,
	request: TelegramBusinessBinding & { commandId: string }
) => {
	const b = binding(request)
	const commandId = safeId(request.commandId)
	const value = await authenticatedRequest({
		accessToken: token,
		method: 'GET',
		url: `/crm/access/telegram/commands/${commandId}`,
		params: { workspaceId: b.workspaceId }
	})
	return parse(value, v => parseTelegramCommand(v, b, commandId))
}
