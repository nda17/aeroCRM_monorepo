import { authenticatedRequest } from '@/shared/api/authenticated-http-client'
import { authenticatedDownload } from '@/shared/api/authenticated-download'
import {
	parseSupportAttachment,
	parseSupportConversation,
	parseSupportHistory,
	parseSupportPage,
	parseSupportSend,
	parseSupportUnread,
	SUPPORT_UUID,
	validateSupportFile,
	type SupportAttachment,
	type SupportCreateCommand,
	type SupportReplyCommand
} from '../model/support.contract'

const path = (id: string) => {
	if (!SUPPORT_UUID.test(id))
		throw new Error('Некорректный номер обращения.')
	return `/support/conversations/${id}`
}
export const supportApi = {
	async list(token: string, page: number) {
		return parseSupportPage(
			await authenticatedRequest({
				accessToken: token,
				method: 'GET',
				url: '/support/conversations',
				params: { page: String(page), limit: '20' }
			})
		)
	},
	async unread(token: string) {
		return parseSupportUnread(
			await authenticatedRequest({
				accessToken: token,
				method: 'GET',
				url: '/support/unread-count'
			})
		)
	},
	async detail(token: string, id: string) {
		const result = parseSupportConversation(
			await authenticatedRequest({
				accessToken: token,
				method: 'GET',
				url: path(id)
			})
		)
		if (result.id !== id)
			throw new Error('Не удалось подтвердить обращение.')
		return result
	},
	async history(token: string, id: string, beforeSequence?: number) {
		return parseSupportHistory(
			await authenticatedRequest({
				accessToken: token,
				method: 'GET',
				url: `${path(id)}/messages`,
				params: {
					limit: '50',
					...(beforeSequence
						? { beforeSequence: String(beforeSequence) }
						: {})
				}
			}),
			id
		)
	},
	async send(
		token: string,
		command: SupportReplyCommand | SupportCreateCommand,
		id?: string
	) {
		return parseSupportSend(
			await authenticatedRequest({
				accessToken: token,
				method: 'POST',
				url: id ? `${path(id)}/messages` : '/support/conversations',
				data: command
			}),
			command.commandId,
			id
		)
	},
	async read(token: string, id: string, throughSequence: number) {
		return authenticatedRequest({
			accessToken: token,
			method: 'PUT',
			url: `${path(id)}/read`,
			data: { throughSequence }
		})
	},
	async upload(
		token: string,
		actor: string,
		file: File,
		commandId: string,
		target: { draftId: string } | { conversationId: string }
	) {
		validateSupportFile(file)
		const form = new FormData()
		form.set('commandId', commandId)
		form.set('expectedActorSubject', actor)
		for (const [key, value] of Object.entries(target)) form.set(key, value)
		form.set('file', file)
		return parseSupportAttachment(
			await authenticatedRequest({
				accessToken: token,
				method: 'POST',
				url: '/support/attachments',
				data: form
			})
		)
	},
	async remove(token: string, id: string) {
		if (!SUPPORT_UUID.test(id)) throw new Error('Некорректное вложение.')
		return authenticatedRequest({
			accessToken: token,
			method: 'DELETE',
			url: `/support/attachments/${id}`
		})
	},
	async content(
		token: string,
		attachment: SupportAttachment,
		signal: AbortSignal
	) {
		const bytes = await authenticatedDownload({
			accessToken: token,
			path: `/support/attachments/${attachment.id}/content`,
			params: {},
			signal,
			maxBytes: 5 * 1024 * 1024,
			accept: attachment.mediaType,
			inspectHeaders: headers => {
				if (
					headers.get('content-type')?.split(';')[0] !==
					attachment.mediaType
				)
					throw new Error('Неподдерживаемый формат изображения.')
				return attachment.byteSize
			}
		})
		return new Blob([new Uint8Array(bytes)], {
			type: attachment.mediaType
		})
	}
}
