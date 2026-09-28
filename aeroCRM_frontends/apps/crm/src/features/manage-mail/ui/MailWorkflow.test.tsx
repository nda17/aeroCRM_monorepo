import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CrmWorkspaceAccessProvider } from '@/entities/crm-access/model/crm-workspace-access.context'
import {
	resetSessionStore,
	useSessionStore
} from '@/entities/session/model/session.store'
import {
	AuthenticatedApiError,
	authenticatedRequest
} from '@/shared/api/authenticated-http-client'
import {
	commandOwner,
	PendingCommandProvider
} from '@/shared/lib/pending-command'
import { DirtyFormProvider } from '@/shared/lib/dirty-form'
import { ConnectMailbox } from './ConnectMailbox'
import { MailComposer } from './MailComposer'
import { MailMessageReader } from './MailMessageReader'
import { UnmatchedMail } from './UnmatchedMail'

vi.mock(
	'@/shared/api/authenticated-http-client',
	async importOriginal => ({
		...(await importOriginal<object>()),
		authenticatedRequest: vi.fn()
	})
)

const workspaceId = 'b531b13e-3624-4ec5-b66d-f24373b0b374'
const mailboxId = 'b1c1d3d9-dc5a-4a50-98ba-c79b3895db62'
const contactId = 'c1c1d3d9-dc5a-4a50-98ba-c79b3895db62'
const messageId = 'd1c1d3d9-dc5a-4a50-98ba-c79b3895db62'
const attachmentId = 'e1c1d3d9-dc5a-4a50-98ba-c79b3895db62'
const sendId = 'f1c1d3d9-dc5a-4a50-98ba-c79b3895db62'
const session = { accessToken: 'test-token', userId: 'mail-user' }
const owner = commandOwner(session.userId, 1)
const request = vi.mocked(authenticatedRequest)
const stamp = '2026-09-28T10:00:00.000Z'
let queryClient: QueryClient

const capabilities = {
	schemaVersion: 1,
	workspaceId,
	enabled: true,
	connectionAvailable: true,
	attachmentsAvailable: true,
	mailPermissions: ['mail:read', 'mail:send', 'mail:manage'],
	canCreatePersonal: true,
	canCreateShared: true,
	attachmentLimits: {
		maxFileBytes: 5_242_880,
		maxSendBytes: 10_485_760,
		maxFiles: 10,
		supportedMediaTypes: ['application/pdf']
	}
}
const mailbox = {
	id: mailboxId,
	kind: 'SHARED',
	address: 'team@corp.ru',
	displayName: 'Отдел продаж',
	state: 'ACTIVE',
	version: 7,
	permissions: ['read', 'send', 'manage'],
	syncStatus: 'IDLE',
	lastSyncAt: stamp,
	safeErrorCode: null
}
const detail = {
	id: messageId,
	mailboxId,
	direction: 'INBOUND',
	subject: 'Предложение',
	from: [{ email: 'customer@example.ru', name: null }],
	to: [{ email: 'team@corp.ru', name: null }],
	cc: [],
	sentAt: null,
	receivedAt: stamp,
	attachmentCount: 0,
	sourceKind: 'IMAP',
	state: null,
	createdAt: stamp,
	text: 'Содержание доступно только участникам ящика.',
	bodyStatus: 'COMPLETE',
	bcc: [],
	attachments: [],
	links: [
		{
			externalEmail: 'customer@example.ru',
			contactId: null,
			state: 'UNMATCHED',
			version: 1
		}
	],
	provenance: {
		folderPath: 'INBOX',
		uidValidity: '1',
		uid: '11',
		messageId: '<source@example.ru>',
		inReplyTo: null,
		references: []
	}
}
const success = <T,>(item: T) => ({ schemaVersion: 1, workspaceId, item })

const access = {
	schemaVersion: 1 as const,
	state: 'ACTIVE' as const,
	selectedWorkspaceId: workspaceId,
	membership: {
		membershipId: 'a1c1d3d9-dc5a-4a50-98ba-c79b3895db62',
		role: 'OWNER' as const
	},
	workspaces: [],
	entitlementStatus: 'ACTIVE' as const,
	entitlement: {
		id: 'a2c1d3d9-dc5a-4a50-98ba-c79b3895db62',
		workspaceId,
		planCode: 'TEAM',
		seatLimit: 5,
		policyVersion: 1,
		graceUntil: null,
		trialStartedAt: null,
		effectiveFrom: stamp,
		effectiveUntil: stamp,
		aggregateVersion: '1',
		sourceSequence: '1'
	},
	access: { lifecycle: 'ACTIVE' as const }
}

const Providers = ({ children }: PropsWithChildren) => {
	return (
		<QueryClientProvider client={queryClient}>
			<PendingCommandProvider owner={owner}>
				<DirtyFormProvider owner={owner}>
					<CrmWorkspaceAccessProvider access={access}>
						{children}
					</CrmWorkspaceAccessProvider>
				</DirtyFormProvider>
			</PendingCommandProvider>
		</QueryClientProvider>
	)
}

beforeEach(() => {
	vi.clearAllMocks()
	queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false }
		}
	})
	resetSessionStore()
	useSessionStore.getState().setAuthenticated(session)
	HTMLDialogElement.prototype.showModal ??= function () {
		this.open = true
	}
	HTMLDialogElement.prototype.close ??= function () {
		this.open = false
	}
	request.mockImplementation(async config => {
		const url = config.url ?? ''
		if (url.endsWith('/capabilities')) return capabilities as never
		if (
			url.endsWith(`/mailboxes/${mailboxId}/connection`) &&
			config.method === 'GET'
		)
			return success({
				imap: {
					host: 'imap.corp.ru',
					port: 993,
					security: 'TLS',
					username: 'imap-login'
				},
				smtp: {
					host: 'smtp.corp.ru',
					port: 465,
					security: 'TLS',
					username: 'smtp-login'
				}
			}) as never
		if (
			url.endsWith(`/mailboxes/${mailboxId}/connection`) &&
			config.method === 'PUT'
		)
			return success(mailbox) as never
		if (url.endsWith('/connections')) return success(mailbox) as never
		if (url.endsWith(`/mailboxes/${mailboxId}/unmatched/${messageId}`))
			return success(detail) as never
		if (url.endsWith('/attachments'))
			return success({
				id: attachmentId,
				fileName: 'offer.pdf',
				declaredMime: 'application/pdf',
				detectedMime: 'application/pdf',
				byteSize: 12,
				state: 'VALIDATED',
				sha256: 'a'.repeat(64),
				validationVersion: 1,
				expiresAt: null
			}) as never
		if (url.endsWith('/send'))
			return success({
				sendId,
				state: 'QUEUED',
				messageId: '<sent@example.ru>'
			}) as never
		throw new Error(`Unexpected mail API request: ${config.method} ${url}`)
	})
})

afterEach(() => {
	cleanup()
	useSessionStore.getState().setAnonymous()
})

describe('mail UI workflows', () => {
	it('submits the universal IMAP/SMTP connect contract with shared credentials and no provider selector', async () => {
		const onConnected = vi.fn()
		render(
			<ConnectMailbox onClose={vi.fn()} onConnected={onConnected} />,
			{ wrapper: Providers }
		)
		expect(screen.queryByLabelText(/провайдер/i)).toBeNull()
		await waitFor(() =>
			expect(
				screen.getByRole('button', { name: 'Проверить и подключить' })
			).toHaveProperty('disabled', false)
		)
		fireEvent.change(screen.getByLabelText(/^Адрес почты/), {
			target: { value: ' team@corp.ru ' }
		})
		fireEvent.change(screen.getByLabelText(/^Сервер IMAP/), {
			target: { value: 'imap.corp.ru' }
		})
		fireEvent.change(screen.getByLabelText('Логин IMAP'), {
			target: { value: 'mail-login' }
		})
		fireEvent.change(screen.getByLabelText(/^Сервер SMTP/), {
			target: { value: 'smtp.corp.ru' }
		})
		fireEvent.change(
			screen.getByLabelText(/^Пароль приложения или почтового ящика/),
			{ target: { value: 'mail-secret' } }
		)
		fireEvent.submit(
			screen
				.getByRole('button', { name: 'Проверить и подключить' })
				.closest('form')!
		)
		await waitFor(() =>
			expect(request).toHaveBeenCalledWith(
				expect.objectContaining({ url: '/crm/customers/mail/connections' })
			)
		)
		const sent = request.mock.calls.find(([config]) =>
			config.url?.endsWith('/connections')
		)?.[0]
		const sentData = sent?.data as Record<string, unknown>
		expect(Object.keys(sentData).sort()).toEqual(
			[
				'address',
				'commandId',
				'displayName',
				'imap',
				'kind',
				'password',
				'schemaVersion',
				'smtp',
				'smtpPassword',
				'workspaceId'
			].sort()
		)
		expect(sentData).toMatchObject({
			kind: 'PERSONAL',
			address: 'team@corp.ru',
			password: 'mail-secret',
			smtpPassword: null,
			imap: { username: 'mail-login', port: 993, security: 'TLS' },
			smtp: { username: 'team@corp.ru', port: 465, security: 'TLS' }
		})
		expect(JSON.stringify(sentData)).not.toMatch(/oauth|provider|timeweb/i)
		await waitFor(() => expect(onConnected).toHaveBeenCalledOnce())
	})

	it('prefills reconnection transports and keeps mailbox identity and version in the update request', async () => {
		render(
			<ConnectMailbox
				mailbox={mailbox as never}
				onClose={vi.fn()}
				onConnected={vi.fn()}
			/>,
			{ wrapper: Providers }
		)
		expect(await screen.findByDisplayValue('imap.corp.ru')).toBeTruthy()
		expect(screen.getByDisplayValue('smtp.corp.ru')).toBeTruthy()
		expect(screen.getByDisplayValue('imap-login')).toBeTruthy()
		expect(screen.getByDisplayValue('smtp-login')).toBeTruthy()
		expect(screen.getByDisplayValue('team@corp.ru')).toBeTruthy()
		fireEvent.change(
			screen.getByLabelText(/^Пароль приложения или почтового ящика/),
			{ target: { value: 'new-secret' } }
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Проверить и переподключить' })
		)
		await waitFor(() =>
			expect(request).toHaveBeenCalledWith(
				expect.objectContaining({
					url: `/crm/customers/mail/mailboxes/${mailboxId}/connection`,
					method: 'PUT'
				})
			)
		)
		const sent = request.mock.calls.find(
			([config]) =>
				config.url?.endsWith(`/mailboxes/${mailboxId}/connection`) &&
				config.method === 'PUT'
		)?.[0]
		expect(sent?.data).toMatchObject({
			expectedVersion: 7,
			imap: { host: 'imap.corp.ru', username: 'imap-login' },
			smtp: { host: 'smtp.corp.ru', username: 'smtp-login' },
			password: 'new-secret',
			smtpPassword: null
		})
		expect(sent?.data).not.toHaveProperty('mailboxId')
	})

	it('loads an unmatched message through its mailbox-scoped reader endpoint', async () => {
		render(
			<MailMessageReader id={messageId} unmatchedMailboxId={mailboxId} />,
			{ wrapper: Providers }
		)
		expect(
			await screen.findByText(
				'Содержание доступно только участникам ящика.'
			)
		).toBeTruthy()
		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({
				method: 'GET',
				url: `/crm/customers/mail/mailboxes/${mailboxId}/unmatched/${messageId}`,
				params: { workspaceId }
			})
		)
	})

	it('manually links an unmatched sender through the strict contact-link result parser', async () => {
		const messageSummary = {
			id: messageId,
			mailboxId,
			direction: 'INBOUND',
			subject: 'Предложение',
			from: detail.from,
			to: detail.to,
			cc: [],
			sentAt: null,
			receivedAt: stamp,
			attachmentCount: 0,
			sourceKind: 'IMAP',
			state: null,
			createdAt: stamp
		}
		const customer = {
			id: contactId,
			workspaceId,
			name: 'Анна Клиентова',
			notes: null,
			createdBySubject: 'mail-user',
			teamId: null,
			version: 1,
			archivedAt: null,
			createdAt: stamp,
			updatedAt: stamp,
			phone: null,
			email: 'customer@example.ru',
			companyId: null,
			timeZone: null,
			preferredCallStart: null,
			preferredCallEnd: null
		}
		request.mockImplementation(async config => {
			const url = config.url ?? ''
			if (url.endsWith('/capabilities')) return capabilities as never
			if (url.endsWith(`/mailboxes/${mailboxId}/unmatched`))
				return {
					schemaVersion: 1,
					workspaceId,
					items: [messageSummary],
					nextCursor: null
				} as never
			if (url.endsWith(`/mailboxes/${mailboxId}/unmatched/${messageId}`))
				return success(detail) as never
			if (url.endsWith('/v2/contacts'))
				return {
					schemaVersion: 2,
					page: 1,
					pageSize: 25,
					total: 1,
					items: [customer]
				} as never
			if (url.endsWith(`/messages/${messageId}/link`))
				return success({
					externalEmail: 'customer@example.ru',
					contactId,
					state: 'LINKED',
					version: 2
				}) as never
			throw new Error(
				`Unexpected mail API request: ${config.method} ${url}`
			)
		})
		render(
			<UnmatchedMail mailbox={mailbox as never} onClose={vi.fn()} />,
			{ wrapper: Providers }
		)
		fireEvent.click(
			await screen.findByRole('button', { name: 'Предложение' })
		)
		expect(
			await screen.findByText(
				'Содержание доступно только участникам ящика.'
			)
		).toBeTruthy()
		await screen.findByLabelText(/^Адрес из письма/)
		fireEvent.change(screen.getByLabelText(/^Адрес из письма/), {
			target: { value: 'customer@example.ru' }
		})
		await screen.findByRole('option', { name: 'Анна Клиентова' })
		fireEvent.change(screen.getByLabelText(/^Контакт/), {
			target: { value: contactId }
		})
		fireEvent.click(
			screen.getByRole('button', { name: 'Привязать к контакту' })
		)
		await waitFor(() =>
			expect(request).toHaveBeenCalledWith(
				expect.objectContaining({
					method: 'POST',
					url: `/crm/customers/mail/messages/${messageId}/link`,
					data: expect.objectContaining({
						expectedVersion: 1,
						externalEmail: 'customer@example.ru',
						contactId
					})
				})
			)
		)
	})

	it('keeps a reply draft and prevents sending until the selected attachment upload is validated', async () => {
		let finishUpload!: (value: unknown) => void
		request.mockImplementation(async config => {
			if ((config.url ?? '').endsWith('/capabilities'))
				return capabilities as never
			if ((config.url ?? '').endsWith('/attachments'))
				return (await new Promise<unknown>(resolve => {
					finishUpload = resolve
				})) as never
			if ((config.url ?? '').endsWith('/send'))
				return success({
					sendId,
					state: 'QUEUED',
					messageId: '<sent@example.ru>'
				}) as never
			throw new Error(`Unexpected request: ${config.method} ${config.url}`)
		})
		const reply = { ...detail, subject: 'Исходная тема' }
		render(
			<MailComposer
				contactId={contactId}
				email={null}
				mailboxes={[mailbox as never]}
				reply={reply as never}
				onClose={vi.fn()}
				onQueued={vi.fn()}
			/>,
			{ wrapper: Providers }
		)
		fireEvent.change(screen.getByLabelText('Письмо'), {
			target: { value: 'Ответ с вложением' }
		})
		await screen.findByLabelText('Вложение')
		const file = new File(['document'], 'offer.pdf', {
			type: 'application/pdf'
		})
		fireEvent.change(screen.getByLabelText('Вложение'), {
			target: { files: [file] }
		})
		fireEvent.click(
			screen.getByRole('button', { name: 'Прикрепить файл' })
		)
		await waitFor(() =>
			expect(
				screen.getByRole('button', { name: 'Отправить' })
			).toHaveProperty('disabled', true)
		)
		fireEvent.submit(
			screen.getByRole('button', { name: 'Отправить' }).closest('form')!
		)
		expect(
			request.mock.calls.some(([config]) => config.url?.endsWith('/send'))
		).toBe(false)
		await act(async () =>
			finishUpload(
				success({
					id: attachmentId,
					fileName: 'offer.pdf',
					declaredMime: 'application/pdf',
					detectedMime: 'application/pdf',
					byteSize: 12,
					state: 'VALIDATED',
					sha256: 'a'.repeat(64),
					validationVersion: 1,
					expiresAt: null
				})
			)
		)
		fireEvent.click(
			await screen.findByRole('button', { name: 'Отправить' })
		)
		await waitFor(() =>
			expect(
				request.mock.calls.some(([config]) =>
					config.url?.endsWith('/send')
				)
			).toBe(true)
		)
		const send = request.mock.calls.find(([config]) =>
			config.url?.endsWith('/send')
		)?.[0]
		const sendData = send?.data as Record<string, unknown>
		expect(sendData).toMatchObject({
			mailboxId,
			contactId,
			to: [{ email: 'customer@example.ru', name: null }],
			subject: 'Re: Исходная тема',
			text: 'Ответ с вложением',
			attachmentIds: [attachmentId],
			replyToMessageId: messageId
		})
		expect(send?.headers?.['Idempotency-Key']).toBe(sendData.commandId)
	})

	it('replays an unknown send with the same idempotency key and immutable request', async () => {
		let attempt = 0
		request.mockImplementation(async config => {
			if ((config.url ?? '').endsWith('/capabilities'))
				return capabilities as never
			if ((config.url ?? '').endsWith('/send')) {
				attempt++
				if (attempt === 1)
					throw new AuthenticatedApiError('temporary', 'Сеть недоступна.')
				return success({
					sendId,
					state: 'QUEUED',
					messageId: '<sent@example.ru>'
				}) as never
			}
			throw new Error(`Unexpected request: ${config.method} ${config.url}`)
		})
		render(
			<MailComposer
				contactId={contactId}
				email="customer@example.ru"
				mailboxes={[mailbox as never]}
				onClose={vi.fn()}
				onQueued={vi.fn()}
			/>,
			{ wrapper: Providers }
		)
		await waitFor(() =>
			expect(
				screen.getByRole('button', { name: 'Отправить' })
			).toHaveProperty('disabled', false)
		)
		fireEvent.change(screen.getByLabelText('Тема'), {
			target: { value: 'Коммерческое предложение' }
		})
		fireEvent.change(screen.getByLabelText('Письмо'), {
			target: { value: 'Текст черновика' }
		})
		fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
		await waitFor(() =>
			expect(
				request.mock.calls.filter(([config]) =>
					config.url?.endsWith('/send')
				)
			).toHaveLength(1)
		)
		await screen.findByRole('button', { name: 'Проверить результат' })
		expect(
			(screen.getByLabelText('Письмо') as HTMLTextAreaElement).value
		).toBe('Текст черновика')
		fireEvent.click(
			screen.getByRole('button', { name: 'Проверить результат' })
		)
		await waitFor(() => expect(attempt).toBe(2))
		const sends = request.mock.calls
			.filter(([config]) => config.url?.endsWith('/send'))
			.map(([config]) => config)
		expect(sends[1]?.headers?.['Idempotency-Key']).toBe(
			sends[0]?.headers?.['Idempotency-Key']
		)
		expect(sends[1]?.data).toEqual(sends[0]?.data)
	})

	it('hides an unmatched message after a hard access denial', async () => {
		let denied = false
		request.mockImplementation(async config => {
			if ((config.url ?? '').endsWith('/capabilities'))
				return capabilities as never
			if (
				(config.url ?? '').endsWith(
					`/mailboxes/${mailboxId}/unmatched/${messageId}`
				)
			) {
				if (denied)
					throw new AuthenticatedApiError('forbidden', 'Forbidden')
				return success(detail) as never
			}
			throw new Error(`Unexpected request: ${config.method} ${config.url}`)
		})
		render(
			<MailMessageReader id={messageId} unmatchedMailboxId={mailboxId} />,
			{ wrapper: Providers }
		)
		expect(
			await screen.findByText(
				'Содержание доступно только участникам ящика.'
			)
		).toBeTruthy()
		denied = true
		await act(async () =>
			queryClient.invalidateQueries({
				queryKey: [
					'mail-unmatched-message',
					workspaceId,
					session.userId,
					1,
					messageId
				]
			})
		)
		await waitFor(() =>
			expect(
				request.mock.calls.filter(([config]) =>
					config.url?.endsWith(
						`/mailboxes/${mailboxId}/unmatched/${messageId}`
					)
				)
			).toHaveLength(2)
		)
		await waitFor(() =>
			expect(
				screen.queryByText('Содержание доступно только участникам ящика.')
			).toBeNull()
		)
	})
})
