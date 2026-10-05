import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { isNonEmptyString, isUuidV4 } from '@/shared/lib/contract'
import {
	parseChatDirect,
	parseChatNotifications,
	parseChatRead,
	parseChatSend,
	parseConversationList,
	parseDirectoryList,
	parseDirectoryMutation,
	parseMessageList,
	validCollaborationRequest,
	type ChatDirectCommand,
	type ChatNotificationsRequest,
	type ChatReadCommand,
	type ChatSendCommand,
	type CollaborationBinding,
	type ConversationListRequest,
	type DirectoryCommand,
	type DirectoryFields,
	type DirectoryListRequest,
	type MessageListRequest
} from '../model/collaboration.contract'

const safe = (value: string) => {
	if (!isUuidV4(value)) throw invalidContractError()
	return value
}
const pageValues = (page = 1, pageSize = 50, max = 100) => {
	if (
		!Number.isSafeInteger(page) ||
		page < 1 ||
		page > 2147483647 ||
		!Number.isSafeInteger(pageSize) ||
		pageSize < 1 ||
		pageSize > max
	)
		throw invalidContractError()
	return { page, pageSize }
}
const binding = (b: CollaborationBinding) => {
	if (!validCollaborationRequest(b)) throw invalidContractError()
	return { workspaceId: safe(b.workspaceId), subject: b.subject }
}
const get = async <T>(
	accessToken: string,
	url: string,
	params: Record<string, string>,
	parse: (v: unknown) => T | null
): Promise<T> => {
	const value = parse(
		await authenticatedRequest({ accessToken, method: 'GET', url, params })
	)
	if (value === null) throw invalidContractError()
	return value
}
const commandBody = (b: CollaborationBinding, commandId: string) => ({
	schemaVersion: 1 as const,
	workspaceId: safe(b.workspaceId),
	commandId: safe(commandId)
})

export const listDirectory = async (
	token: string,
	request: DirectoryListRequest
) => {
	const b = binding(request)
	const { page, pageSize } = pageValues(request.page, request.pageSize)
	if (
		request.q !== undefined &&
		(typeof request.q !== 'string' || request.q.length > 100)
	)
		throw invalidContractError()
	if (
		(request.includeArchived !== undefined &&
			typeof request.includeArchived !== 'boolean') ||
		(request.activeOnly !== undefined &&
			typeof request.activeOnly !== 'boolean')
	)
		throw invalidContractError()
	return get(
		token,
		'/crm/access/directory',
		{
			workspaceId: b.workspaceId,
			...(request.q !== undefined ? { q: request.q } : {}),
			page: String(page),
			pageSize: String(pageSize),
			includeArchived: String(request.includeArchived ?? false),
			activeOnly: String(request.activeOnly ?? false)
		},
		v => parseDirectoryList(v, b, page, pageSize)
	)
}
export const updateDirectoryEntry = async (
	token: string,
	command: DirectoryCommand & { fields: DirectoryFields }
) => {
	const b = binding(command)
	const entryId = safe(command.entryId)
	if (
		!safe(command.commandId) ||
		!Number.isSafeInteger(command.expectedVersion) ||
		command.expectedVersion < 1 ||
		command.expectedVersion > 2147483646
	)
		throw invalidContractError()
	const fields = command.fields
	const names = [
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
	const maxes = {
		firstName: 100,
		lastName: 100,
		middleName: 100,
		phone: 64,
		email: 254,
		position: 100,
		department: 100,
		extension: 20,
		telegram: 100
	}
	if (
		!fields ||
		Object.keys(fields).length !== names.length ||
		names.some(
			name =>
				!Object.hasOwn(fields, name) ||
				(fields[name] !== null &&
					(typeof fields[name] !== 'string' ||
						fields[name]!.length > maxes[name]))
		)
	)
		throw invalidContractError()
	const result = parseDirectoryMutation(
		await authenticatedRequest({
			accessToken: token,
			method: 'POST',
			url: `/crm/access/directory/${entryId}/update`,
			headers: { 'Idempotency-Key': command.commandId },
			data: {
				...commandBody(b, command.commandId),
				expectedVersion: command.expectedVersion,
				fields: { ...fields }
			}
		}),
		b,
		entryId
	)
	if (!result) throw invalidContractError()
	return result
}
const archiveMutation = async (
	token: string,
	command: DirectoryCommand,
	action: 'archive' | 'restore'
) => {
	const b = binding(command)
	const entryId = safe(command.entryId)
	if (
		!safe(command.commandId) ||
		!Number.isSafeInteger(command.expectedVersion) ||
		command.expectedVersion < 1 ||
		command.expectedVersion > 2147483646
	)
		throw invalidContractError()
	const result = parseDirectoryMutation(
		await authenticatedRequest({
			accessToken: token,
			method: 'POST',
			url: `/crm/access/directory/${entryId}/${action}`,
			headers: { 'Idempotency-Key': command.commandId },
			data: {
				...commandBody(b, command.commandId),
				expectedVersion: command.expectedVersion
			}
		}),
		b,
		entryId
	)
	if (!result) throw invalidContractError()
	return result
}
export const archiveDirectoryEntry = (
	token: string,
	command: DirectoryCommand
) => archiveMutation(token, command, 'archive')
export const restoreDirectoryEntry = (
	token: string,
	command: DirectoryCommand
) => archiveMutation(token, command, 'restore')
export const listConversations = async (
	token: string,
	request: ConversationListRequest
) => {
	const b = binding(request)
	const { page, pageSize } = pageValues(request.page, request.pageSize)
	if (
		request.q !== undefined &&
		(typeof request.q !== 'string' || request.q.length > 100)
	)
		throw invalidContractError()
	return get(
		token,
		'/crm/access/chat/conversations',
		{
			workspaceId: b.workspaceId,
			...(request.q !== undefined ? { q: request.q } : {}),
			page: String(page),
			pageSize: String(pageSize)
		},
		v => parseConversationList(v, b, page, pageSize)
	)
}
export const ensureDirectConversation = async (
	token: string,
	command: ChatDirectCommand
) => {
	const b = binding(command)
	if (
		!safe(command.commandId) ||
		!isNonEmptyString(command.recipientSubject, 256) ||
		command.recipientSubject === b.subject
	)
		throw invalidContractError()
	const result = parseChatDirect(
		await authenticatedRequest({
			accessToken: token,
			method: 'POST',
			url: '/crm/access/chat/conversations/direct',
			headers: { 'Idempotency-Key': command.commandId },
			data: {
				...commandBody(b, command.commandId),
				recipientSubject: command.recipientSubject
			}
		}),
		b
	)
	if (!result) throw invalidContractError()
	return result
}
export const listChatMessages = async (
	token: string,
	request: MessageListRequest
) => {
	const b = binding(request)
	const id = safe(request.conversationId)
	const limit = request.limit ?? 50
	if (
		!Number.isSafeInteger(limit) ||
		limit < 1 ||
		limit > 100 ||
		(request.beforeSequence !== undefined &&
			(!Number.isSafeInteger(request.beforeSequence) ||
				request.beforeSequence < 1 ||
				request.beforeSequence > 2147483647))
	)
		throw invalidContractError()
	return get(
		token,
		`/crm/access/chat/conversations/${id}/messages`,
		{
			workspaceId: b.workspaceId,
			limit: String(limit),
			...(request.beforeSequence !== undefined
				? { beforeSequence: String(request.beforeSequence) }
				: {})
		},
		v => parseMessageList(v, b, id, request.beforeSequence, limit)
	)
}
export const sendChatMessage = async (
	token: string,
	command: ChatSendCommand
) => {
	const b = binding(command)
	const id = safe(command.conversationId)
	if (
		!safe(command.commandId) ||
		typeof command.text !== 'string' ||
		command.text.length < 1 ||
		command.text.length > 10000 ||
		command.text.trim().length === 0
	)
		throw invalidContractError()
	const result = parseChatSend(
		await authenticatedRequest({
			accessToken: token,
			method: 'POST',
			url: `/crm/access/chat/conversations/${id}/messages`,
			headers: { 'Idempotency-Key': command.commandId },
			data: { ...commandBody(b, command.commandId), text: command.text }
		}),
		b,
		id
	)
	if (!result) throw invalidContractError()
	return result
}
export const readChatConversation = async (
	token: string,
	command: ChatReadCommand
) => {
	const b = binding(command)
	const id = safe(command.conversationId)
	if (
		!safe(command.commandId) ||
		!Number.isSafeInteger(command.throughSequence) ||
		command.throughSequence < 0 ||
		command.throughSequence > 2147483647
	)
		throw invalidContractError()
	const result = parseChatRead(
		await authenticatedRequest({
			accessToken: token,
			method: 'PUT',
			url: `/crm/access/chat/conversations/${id}/read`,
			headers: { 'Idempotency-Key': command.commandId },
			data: {
				...commandBody(b, command.commandId),
				throughSequence: command.throughSequence
			}
		}),
		b,
		id,
		command.throughSequence
	)
	if (!result) throw invalidContractError()
	return result
}
export const listChatNotifications = async (
	token: string,
	request: ChatNotificationsRequest
) => {
	const b = binding(request)
	const { page, pageSize } = pageValues(
		request.page ?? 1,
		request.pageSize ?? 20
	)
	if (
		request.unreadOnly !== undefined &&
		typeof request.unreadOnly !== 'boolean'
	)
		throw invalidContractError()
	return get(
		token,
		'/crm/access/chat/notifications',
		{
			workspaceId: b.workspaceId,
			page: String(page),
			pageSize: String(pageSize),
			unreadOnly: String(request.unreadOnly ?? false)
		},
		v => parseChatNotifications(v, b, page, pageSize)
	)
}
