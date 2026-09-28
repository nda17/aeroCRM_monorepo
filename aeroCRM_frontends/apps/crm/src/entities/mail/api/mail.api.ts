import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { authenticatedDownload } from '@/shared/api/authenticated-download'
import * as contract from '../model/mail.contract'

const base = '/crm/customers/mail'
const checked = <T>(value: T | null): T => {
	if (!value) throw invalidContractError()
	return value
}
const read = (
	accessToken: string,
	workspaceId: string,
	path: string,
	params: Record<string, string> = {}
) =>
	authenticatedRequest({
		accessToken,
		method: 'GET',
		url: `${base}${path}`,
		params: { workspaceId, ...params }
	})

export const getMailCapabilities = async (
	token: string,
	workspaceId: string
) =>
	checked(
		contract.parseMailCapabilities(
			await read(token, workspaceId, '/capabilities'),
			workspaceId
		)
	)
export const listMailboxes = async (token: string, workspaceId: string) =>
	checked(
		contract.parseMailMailboxPage(
			await read(token, workspaceId, '/mailboxes'),
			workspaceId
		)
	)
export const listMailFolders = async (
	token: string,
	workspaceId: string,
	mailboxId: string
) =>
	checked(
		contract.parseMailFolderPage(
			await read(token, workspaceId, `/mailboxes/${mailboxId}/folders`),
			workspaceId
		)
	)
export const getMailConnection = async (
	token: string,
	workspaceId: string,
	mailboxId: string
) =>
	checked(
		contract.parseMailConnectionResult(
			await read(token, workspaceId, `/mailboxes/${mailboxId}/connection`),
			workspaceId
		)
	)
export const listMailGrants = async (
	token: string,
	workspaceId: string,
	mailboxId: string
) =>
	checked(
		contract.parseMailGrants(
			await read(token, workspaceId, `/mailboxes/${mailboxId}/grants`),
			workspaceId
		)
	)
export const listContactMail = async (
	token: string,
	workspaceId: string,
	contactId: string,
	cursor?: string
) =>
	checked(
		contract.parseMailMessagePage(
			await read(
				token,
				workspaceId,
				`/contacts/${contactId}/messages`,
				cursor ? { cursor } : {}
			),
			workspaceId
		)
	)
export const listMailboxMessages = async (
	token: string,
	workspaceId: string,
	mailboxId: string,
	folder: 'INBOX' | 'SENT',
	cursor?: string
) => {
	const result = checked(
		contract.parseMailMessagePage(
			await read(token, workspaceId, '/messages', {
				mailboxId,
				folder,
				...(cursor ? { cursor } : {})
			}),
			workspaceId
		)
	)
	if (
		result.items.some(
			item =>
				item.mailboxId !== mailboxId ||
				item.direction !== (folder === 'INBOX' ? 'INBOUND' : 'OUTBOUND')
		)
	)
		throw invalidContractError()
	return result
}
export const listUnmatchedMail = async (
	token: string,
	workspaceId: string,
	mailboxId: string,
	cursor?: string
) =>
	checked(
		contract.parseMailMessagePage(
			await read(
				token,
				workspaceId,
				`/mailboxes/${mailboxId}/unmatched`,
				cursor ? { cursor } : {}
			),
			workspaceId
		)
	)
export const getMailMessage = async (
	token: string,
	workspaceId: string,
	id: string
) =>
	checked(
		contract.parseMailMessageResult(
			await read(token, workspaceId, `/messages/${id}`),
			workspaceId
		)
	)
export const getRichMailMessage = async (
	token: string,
	workspaceId: string,
	id: string
) =>
	checked(
		contract.parseMailRichMessageResult(
			await read(token, workspaceId, `/messages/${id}`, {
				bodyFormat: 'html'
			}),
			workspaceId
		)
	)
export const getUnmatchedMailMessage = async (
	token: string,
	workspaceId: string,
	mailboxId: string,
	id: string
) =>
	checked(
		contract.parseMailMessageResult(
			await read(
				token,
				workspaceId,
				`/mailboxes/${mailboxId}/unmatched/${id}`
			),
			workspaceId
		)
	)
export const getMailAttachment = async (
	token: string,
	workspaceId: string,
	id: string
) =>
	checked(
		contract.parseMailAttachmentResult(
			await read(token, workspaceId, `/attachments/${id}`),
			workspaceId
		)
	)
export const getMailSend = async (
	token: string,
	workspaceId: string,
	id: string
) =>
	checked(
		contract.parseMailSendStatus(
			await read(token, workspaceId, `/sends/${id}`),
			workspaceId
		)
	)

export const mailCommand = async <T>(
	token: string,
	path: string,
	command: { schemaVersion: 1; workspaceId: string; commandId: string },
	parse: (value: unknown, workspaceId: string) => T | null,
	method: 'POST' | 'PUT' = 'POST'
) =>
	checked(
		parse(
			await authenticatedRequest({
				accessToken: token,
				method,
				url: `${base}${path}`,
				headers: { 'Idempotency-Key': command.commandId },
				data: command
			}),
			command.workspaceId
		)
	)

export const uploadMailAttachment = async (
	token: string,
	command: {
		schemaVersion: 1
		workspaceId: string
		commandId: string
		mailboxId: string
		contactId: string | null
		file: File
	}
) => {
	const data = new FormData()
	for (const [key, value] of Object.entries(command)) {
		if (key === 'file' || value === null) continue
		data.append(key, String(value))
	}
	data.append('file', command.file)
	return checked(
		contract.parseMailAttachmentResult(
			await authenticatedRequest({
				accessToken: token,
				method: 'POST',
				url: `${base}/attachments`,
				headers: {
					'Idempotency-Key': command.commandId,
					'x-mail-workspace-id': command.workspaceId,
					'x-mail-mailbox-id': command.mailboxId,
					...(command.contactId
						? { 'x-mail-contact-id': command.contactId }
						: {})
				},
				data
			}),
			command.workspaceId
		)
	)
}

export const downloadMailAttachment = async (
	token: string,
	workspaceId: string,
	attachment: { id: string; byteSize: number; sha256: string },
	signal: AbortSignal
) => {
	const bytes = await authenticatedDownload({
		accessToken: token,
		path: `${base}/attachments/${attachment.id}/content`,
		params: { workspaceId },
		signal,
		maxBytes: attachment.byteSize,
		accept: 'application/octet-stream',
		inspectHeaders: headers => {
			if (
				!headers
					.get('content-type')
					?.startsWith('application/octet-stream') ||
				!headers.get('content-disposition')?.startsWith('attachment;')
			)
				throw invalidContractError()
			return attachment.byteSize
		}
	})
	const digest = await crypto.subtle.digest('SHA-256', bytes)
	const hash = Array.from(new Uint8Array(digest), byte =>
		byte.toString(16).padStart(2, '0')
	).join('')
	if (hash !== attachment.sha256) throw invalidContractError()
	return new Blob([bytes], { type: 'application/octet-stream' })
}
