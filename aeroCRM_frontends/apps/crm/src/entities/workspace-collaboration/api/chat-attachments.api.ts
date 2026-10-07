import axios from 'axios'
import {
	authenticatedRequest,
	invalidContractError,
	AuthenticatedApiError
} from '@/shared/api/authenticated-http-client'
import { resolveSessionTransport } from '@/shared/api/session-transport'
import { getPublicHttpClient } from '@/shared/api/http-client'
import { isUuidV4 } from '@/shared/lib/contract'
import {
	parseMessageList,
	parseChatSend,
	validCollaborationRequest,
	type MessageListRequest,
	type CollaborationBinding,
	type ChatSendCommand
} from '../model/collaboration.contract'
export type ChatAttachment = {
	id: string
	fileName: string
	mediaType: string
	byteSize: number
	sha256: string
}
export type PendingChatAttachment = ChatAttachment & {
	conversationId: string
	state: 'UPLOADING' | 'READY' | 'ATTACHED' | 'DELETING' | 'DELETED'
	expiresAt: string
}
const record = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v)
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> =>
	record(v) &&
	Object.keys(v).length === keys.length &&
	keys.every(k => Object.hasOwn(v, k))
const allowed = [
	'image/png',
	'image/jpeg',
	'image/webp',
	'application/pdf',
	'text/plain',
	'text/csv',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]
const attachment = (
	v: unknown,
	pending = false
): v is PendingChatAttachment =>
	exact(v, [
		'id',
		'fileName',
		'mediaType',
		'byteSize',
		'sha256',
		...(pending ? ['conversationId', 'state', 'expiresAt'] : [])
	]) &&
	isUuidV4(v.id) &&
	typeof v.fileName === 'string' &&
	v.fileName.length > 0 &&
	v.fileName.length <= 200 &&
	typeof v.mediaType === 'string' &&
	allowed.includes(v.mediaType) &&
	typeof v.byteSize === 'number' &&
	Number.isInteger(v.byteSize) &&
	v.byteSize > 0 &&
	v.byteSize <= 5242880 &&
	typeof v.sha256 === 'string' &&
	/^[a-f0-9]{64}$/.test(v.sha256) &&
	(!pending ||
		(isUuidV4(v.conversationId) &&
			['UPLOADING', 'READY', 'ATTACHED', 'DELETING', 'DELETED'].includes(
				String(v.state)
			) &&
			typeof v.expiresAt === 'string' &&
			Number.isFinite(Date.parse(v.expiresAt))))
const pendingEnvelope = (
	v: unknown,
	workspaceId: string
): PendingChatAttachment | null => {
	if (
		!exact(v, ['schemaVersion', 'workspaceId', 'attachment']) ||
		v.schemaVersion !== 1 ||
		v.workspaceId !== workspaceId ||
		(v.attachment !== null && !attachment(v.attachment, true))
	)
		throw invalidContractError()
	return v.attachment as PendingChatAttachment | null
}
const strip = (v: unknown) => {
	if (
		!record(v) ||
		!Array.isArray(v.attachments) ||
		v.attachments.length > 10 ||
		!v.attachments.every(a => attachment(a)) ||
		new Set(v.attachments.map(a => a.id)).size !== v.attachments.length ||
		v.attachments.reduce((sum, a) => sum + a.byteSize, 0) > 20971520
	)
		throw invalidContractError()
	const { attachments, ...old } = v
	return { old, attachments: attachments as ChatAttachment[] }
}
const sendResult = (v: unknown, b: CollaborationBinding, id: string) => {
	if (!record(v) || v.schemaVersion !== 2) throw invalidContractError()
	const item = strip(v.item)
	const result = parseChatSend(
		{ ...v, schemaVersion: 1, item: item.old },
		b,
		id
	)
	if (!result) throw invalidContractError()
	return {
		...result,
		schemaVersion: 2 as const,
		item: { ...result.item, attachments: item.attachments }
	}
}
const validBinding = (
	value: CollaborationBinding & {
		conversationId?: string
		commandId?: string
	}
) => {
	if (
		!validCollaborationRequest(value) ||
		(value.conversationId !== undefined &&
			!isUuidV4(value.conversationId)) ||
		(value.commandId !== undefined && !isUuidV4(value.commandId))
	)
		throw invalidContractError()
}
export const listChatMessagesV2 = async (
	token: string,
	request: MessageListRequest
) => {
	validBinding(request)
	if (
		!Number.isInteger(request.limit ?? 50) ||
		(request.limit ?? 50) < 1 ||
		(request.limit ?? 50) > 100 ||
		(request.beforeSequence !== undefined &&
			(!Number.isSafeInteger(request.beforeSequence) ||
				request.beforeSequence < 1 ||
				request.beforeSequence > 2147483647))
	)
		throw invalidContractError()

	const v = await authenticatedRequest({
		accessToken: token,
		method: 'GET',
		url: `/crm/access/chat/conversations/${request.conversationId}/messages-v2`,
		params: {
			workspaceId: request.workspaceId,
			limit: String(request.limit ?? 50),
			...(request.beforeSequence
				? { beforeSequence: String(request.beforeSequence) }
				: {})
		}
	})
	if (!record(v) || v.schemaVersion !== 2 || !Array.isArray(v.items))
		throw invalidContractError()
	const items = v.items.map(strip)
	const result = parseMessageList(
		{ ...v, schemaVersion: 1, items: items.map(i => i.old) },
		request,
		request.conversationId,
		request.beforeSequence,
		request.limit ?? 50
	)
	if (!result) throw invalidContractError()
	return {
		...result,
		schemaVersion: 2 as const,
		items: result.items.map((item, index) => ({
			...item,
			attachments: items[index]!.attachments
		}))
	}
}
export type ChatSendV2Command = ChatSendCommand & {
	attachmentIds: string[]
}
export const sendChatMessageV2 = async (
	token: string,
	c: ChatSendV2Command
) => {
	validBinding(c)
	if (
		typeof c.text !== 'string' ||
		c.text.length > 10000 ||
		!Array.isArray(c.attachmentIds) ||
		c.attachmentIds.length > 10 ||
		!c.attachmentIds.every(isUuidV4) ||
		new Set(c.attachmentIds).size !== c.attachmentIds.length ||
		(!c.text.trim() && !c.attachmentIds.length)
	)
		throw invalidContractError()

	const value = await authenticatedRequest({
		accessToken: token,
		method: 'POST',
		url: `/crm/access/chat/conversations/${c.conversationId}/messages-v2`,
		headers: { 'Idempotency-Key': c.commandId },
		data: {
			schemaVersion: 2,
			workspaceId: c.workspaceId,
			commandId: c.commandId,
			text: c.text,
			attachmentIds: c.attachmentIds
		}
	})
	return sendResult(value, c, c.conversationId)
}
export const lookupChatSendV2 = async (
	token: string,
	c: ChatSendV2Command
) => {
	validBinding(c)

	const v = await authenticatedRequest({
		accessToken: token,
		method: 'GET',
		url: `/crm/access/chat/conversations/${c.conversationId}/messages-v2/commands/${c.commandId}`,
		params: { workspaceId: c.workspaceId }
	})
	if (
		!exact(v, ['schemaVersion', 'workspaceId', 'status', 'result']) ||
		v.schemaVersion !== 1 ||
		v.workspaceId !== c.workspaceId
	)
		throw invalidContractError()
	if (v.status === 'ABSENT' && v.result === null) return null
	if (v.status !== 'COMMITTED') throw invalidContractError()
	return sendResult(v.result, c, c.conversationId)
}
export const chatAttachmentCapabilities = async (
	token: string,
	workspaceId: string
) => {
	const v = await authenticatedRequest({
		accessToken: token,
		method: 'GET',
		url: '/crm/access/chat/attachments/capabilities',
		params: { workspaceId }
	})
	if (
		!exact(v, [
			'schemaVersion',
			'workspaceId',
			'enabled',
			'maxFileBytes',
			'maxFiles',
			'maxMessageBytes',
			'allowedExtensions'
		]) ||
		v.schemaVersion !== 1 ||
		v.workspaceId !== workspaceId ||
		typeof v.enabled !== 'boolean' ||
		v.maxFileBytes !== 5242880 ||
		v.maxFiles !== 10 ||
		v.maxMessageBytes !== 20971520 ||
		!Array.isArray(v.allowedExtensions) ||
		v.allowedExtensions.join(',') !==
			'png,jpg,jpeg,webp,pdf,txt,csv,docx,xlsx'
	)
		throw invalidContractError()
	return v.enabled
}
export const lookupChatAttachment = async (
	token: string,
	workspaceId: string,
	commandId: string
) =>
	pendingEnvelope(
		await authenticatedRequest({
			accessToken: token,
			method: 'GET',
			url: `/crm/access/chat/attachments/commands/${commandId}`,
			params: { workspaceId }
		}),
		workspaceId
	)
export const discardChatAttachment = async (
	token: string,
	workspaceId: string,
	id: string,
	commandId: string
) =>
	pendingEnvelope(
		await authenticatedRequest({
			accessToken: token,
			method: 'POST',
			url: `/crm/access/chat/attachments/${id}/discard`,
			headers: { 'Idempotency-Key': commandId },
			data: { schemaVersion: 1, workspaceId, commandId }
		}),
		workspaceId
	)
export const uploadChatAttachment = async (
	token: string,
	workspaceId: string,
	conversationId: string,
	commandId: string,
	file: File,
	signal: AbortSignal,
	progress: (percent: number) => void
) => {
	const lease = await resolveSessionTransport(token)
	if (!lease.isCurrent()) throw invalidContractError()
	const form = new FormData()
	form.append('schemaVersion', '1')
	form.append('workspaceId', workspaceId)
	form.append('commandId', commandId)
	form.append('file', file)
	try {
		const response = await getPublicHttpClient().post(
			`/crm/access/chat/conversations/${conversationId}/attachments`,
			form,
			{
				signal,
				timeout: 90000,
				headers: {
					Authorization: `Bearer ${lease.accessToken}`,
					'Idempotency-Key': commandId,
					'x-chat-workspace-id': workspaceId
				},
				onUploadProgress: event =>
					progress(
						Math.min(
							99,
							Math.round((event.loaded / (event.total || file.size)) * 100)
						)
					)
			}
		)
		if (!lease.isCurrent()) throw invalidContractError()
		const result = pendingEnvelope(response.data, workspaceId)
		if (!result || result.conversationId !== conversationId)
			throw invalidContractError()
		progress(100)
		return result
	} catch (error) {
		if (error instanceof AuthenticatedApiError) throw error
		if (
			axios.isAxiosError(error) &&
			[400, 401, 403, 404].includes(error.response?.status ?? 0)
		)
			throw new AuthenticatedApiError(
				error.response?.status === 400
					? 'validation'
					: error.response?.status === 401
						? 'unauthorized'
						: error.response?.status === 403
							? 'forbidden'
							: 'notFound',
				'Загрузка отклонена: проверьте тип файла, пространство и текущий доступ.'
			)
		throw new AuthenticatedApiError(
			'temporary',
			'Результат загрузки неизвестен. Проверьте состояние или повторите ту же загрузку.'
		)
	}
}
export const downloadChatAttachment = async (
	token: string,
	workspaceId: string,
	id: string,
	fileName: string
) => {
	const lease = await resolveSessionTransport(token)
	if (!lease.isCurrent()) throw invalidContractError()
	const response = await getPublicHttpClient().get(
		`/crm/access/chat/attachments/${id}/content`,
		{
			params: { workspaceId },
			responseType: 'blob',
			timeout: 45000,
			headers: { Authorization: `Bearer ${lease.accessToken}` }
		}
	)
	if (!lease.isCurrent()) throw invalidContractError()
	const url = URL.createObjectURL(response.data)
	const link = document.createElement('a')
	link.href = url
	link.download = fileName
	link.click()
	setTimeout(() => URL.revokeObjectURL(url), 1000)
}
