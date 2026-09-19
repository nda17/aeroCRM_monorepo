import {
	axiosClassicRequest,
	getAccessToken,
	isAccessTokenValid
} from '@/shared/api'
import { refreshAccessToken } from '@/shared/api/browser-client'
import { API_URL } from '@/shared/config/api.config'
import { decodeJwt } from 'jose'
import axios from 'axios'
import {
	parseSupportAttachment,
	parseSupportConversation,
	parseSupportHistory,
	parseSupportPage,
	parseSupportSend,
	parseSupportSettings,
	SUPPORT_UUID,
	validateSupportFile,
	type SupportAttachment,
	type SupportReplyCommand,
	type SupportSettings,
	type SupportStatus
} from '@/shared/lib/support-contract'

export class SupportAdminError extends Error {
	constructor(
		message: string,
		readonly status?: number
	) {
		super(message)
		this.name = 'SupportAdminError'
	}
}
export const supportActorIsCurrent = (actor: string) => {
	try {
		const token = getAccessToken()
		return !!token && decodeJwt(token).sub === actor
	} catch {
		return false
	}
}
const bearer = (actor: string) => {
	const token = getAccessToken()
	if (!token || !supportActorIsCurrent(actor))
		throw new SupportAdminError(
			'Учётная запись изменилась. Откройте поддержку заново.',
			401
		)
	return token
}
const readyBearer = async (actor: string) => {
	let token = bearer(actor)
	if (!isAccessTokenValid(token)) {
		await refreshAccessToken()
		token = bearer(actor)
	}
	return token
}
const request = async (
	actor: string,
	method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
	url: string,
	data?: unknown,
	params?: Record<string, unknown>
) => {
	let token = await readyBearer(actor)
	const send = () =>
		axiosClassicRequest.request<unknown>({
			method,
			url,
			data,
			params,
			timeout: 30000,
			headers: {
				Authorization: `Bearer ${token}`,
				...(data instanceof FormData ? { 'Content-Type': undefined } : {})
			}
		})
	try {
		let response
		try {
			response = await send()
		} catch (error) {
			if (!axios.isAxiosError(error) || error.response?.status !== 401)
				throw error
			bearer(actor)
			await refreshAccessToken()
			token = bearer(actor)
			if (method !== 'GET')
				throw new SupportAdminError(
					'Сессия обновлена. Повторите действие с сохранённой командой.'
				)
			response = await send()
		}
		bearer(actor)
		return response.data
	} catch (error) {
		if (error instanceof SupportAdminError) throw error
		const status = axios.isAxiosError(error)
			? error.response?.status
			: undefined
		throw new SupportAdminError(
			status === 409
				? 'Обращение или настройки изменились. Обновите данные и проверьте действие.'
				: status === 403
					? 'Недостаточно прав для этого действия.'
					: status === 404
						? 'Обращение или файл недоступны.'
						: status === 400 || status === 413
							? 'Проверьте поля и допустимый размер изображений.'
							: status === 429
								? 'Слишком много запросов. Подождите и повторите действие.'
								: 'Не удалось подтвердить результат. Повторите действие.',
			status
		)
	}
}
const path = (id: string) => {
	if (!SUPPORT_UUID.test(id)) throw new Error('Некорректное обращение.')
	return `/support/admin/conversations/${id}`
}
export const adminSupportApi = {
	async list(
		actor: string,
		params: {
			page: number
			limit: number
			status?: SupportStatus
			unreadOnly?: boolean
			q?: string
		}
	) {
		return parseSupportPage(
			await request(
				actor,
				'GET',
				'/support/admin/conversations',
				undefined,
				params
			)
		)
	},
	async detail(actor: string, id: string) {
		const row = parseSupportConversation(
			await request(actor, 'GET', path(id))
		)
		if (row.id !== id) throw new Error('Не удалось подтвердить обращение.')
		return row
	},
	async history(actor: string, id: string, beforeSequence?: number) {
		return parseSupportHistory(
			await request(actor, 'GET', `${path(id)}/messages`, undefined, {
				limit: 50,
				beforeSequence
			}),
			id
		)
	},
	async reply(actor: string, id: string, command: SupportReplyCommand) {
		if (command.expectedActorSubject !== actor)
			throw new SupportAdminError('Учётная запись изменилась.', 401)
		return parseSupportSend(
			await request(actor, 'POST', `${path(id)}/messages`, command),
			command.commandId,
			id
		)
	},
	async read(actor: string, id: string, throughSequence: number) {
		return request(actor, 'PUT', `${path(id)}/read`, { throughSequence })
	},
	async status(
		actor: string,
		id: string,
		command: {
			commandId: string
			expectedActorSubject: string
			expectedVersion: number
			status: SupportStatus
		}
	) {
		return parseSupportConversation(
			await request(actor, 'PATCH', `${path(id)}/status`, command)
		)
	},
	async settings(actor: string) {
		return parseSupportSettings(
			await request(actor, 'GET', '/support/admin/notification-settings')
		)
	},
	async saveSettings(
		actor: string,
		command: Omit<SupportSettings, 'version' | 'telegramBot'> & {
			commandId: string
			expectedActorSubject: string
			expectedVersion: number
		}
	) {
		return parseSupportSettings(
			await request(
				actor,
				'PATCH',
				'/support/admin/notification-settings',
				command
			)
		)
	},
	async upload(actor: string, id: string, file: File, commandId: string) {
		validateSupportFile(file)
		const form = new FormData()
		form.set('file', file)
		form.set('commandId', commandId)
		form.set('expectedActorSubject', actor)
		form.set('conversationId', id)
		return parseSupportAttachment(
			await request(actor, 'POST', '/support/attachments', form)
		)
	},
	async remove(actor: string, id: string) {
		if (!SUPPORT_UUID.test(id)) throw new Error('Некорректное вложение.')
		return request(actor, 'DELETE', `/support/attachments/${id}`)
	},
	async content(actor: string, attachment: SupportAttachment) {
		const token = await readyBearer(actor)
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), 30000)
		try {
			const response = await fetch(
				`${API_URL}/support/attachments/${attachment.id}/content`,
				{
					headers: {
						Authorization: `Bearer ${token}`,
						Accept: attachment.mediaType
					},
					credentials: 'include',
					cache: 'no-store',
					redirect: 'error',
					referrerPolicy: 'no-referrer',
					signal: controller.signal
				}
			)
			bearer(actor)
			if (
				!response.ok ||
				!response.body ||
				response.headers.get('content-type')?.split(';')[0] !==
					attachment.mediaType
			)
				throw new Error('Изображение недоступно. Повторите запрос.')
			const reader = response.body.getReader()
			const chunks: Uint8Array<ArrayBuffer>[] = []
			let size = 0
			try {
				while (true) {
					const { done, value } = await reader.read()
					bearer(actor)
					if (done) break
					size += value.byteLength
					if (size > attachment.byteSize || size > 5 * 1024 * 1024)
						throw new Error('Размер изображения не подтверждён.')
					chunks.push(new Uint8Array(value))
				}
			} finally {
				await reader.cancel().catch(() => undefined)
				reader.releaseLock()
			}
			if (size !== attachment.byteSize)
				throw new Error('Изображение загружено не полностью.')
			return new Blob(chunks, { type: attachment.mediaType })
		} finally {
			clearTimeout(timer)
			controller.abort()
		}
	}
}
