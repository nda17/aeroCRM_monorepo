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
import {
	listCrmNotifications,
	readCrmNotification
} from '@/features/manage-reminders/api/crm-notifications.api'
import { CustomerMailPanel } from './CustomerMailPanel'
import { ConnectMailbox } from './ConnectMailbox'
import { MailComposer } from './MailComposer'
import { MailMessageReader } from './MailMessageReader'
import { MailSettings } from './MailSettings'
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
const contactMessage = (
	state: 'QUEUED' | 'SENDING' | null,
	direction: 'INBOUND' | 'OUTBOUND' = state ? 'OUTBOUND' : 'INBOUND'
) => ({
	id: messageId,
	mailboxId,
	direction,
	subject: state ? 'Pending outgoing mail' : 'Incoming mail update',
	from: [{ email: 'customer@example.ru', name: null }],
	to: [{ email: 'team@corp.ru', name: null }],
	cc: [],
	sentAt: null,
	receivedAt: stamp,
	attachmentCount: 0,
	sourceKind: state ? 'CRM_SEND' : 'IMAP',
	state,
	createdAt: stamp
})
const mailPage = (items: unknown[]) => ({
	schemaVersion: 1,
	workspaceId,
	items,
	nextCursor: null
})
const success = <T,>(item: T) => ({ schemaVersion: 1, workspaceId, item })
const attachmentReceipt = (
	state: 'QUARANTINED' | 'VALIDATED' | 'REJECTED'
) => ({
	id: attachmentId,
	fileName: 'offer.pdf',
	declaredMime: 'application/pdf',
	detectedMime: 'application/pdf',
	byteSize: 12,
	state,
	sha256: 'a'.repeat(64),
	validationVersion: 1,
	expiresAt: null
})

describe('incoming mail notification contract', () => {
	const notificationId = 'aa111111-1111-4111-8111-111111111111'
	const notification = {
		id: notificationId,
		messageId,
		contactId,
		title: 'Новое письмо от клиента',
		createdAt: stamp,
		readAt: null
	}
	const response = {
		schemaVersion: 1,
		workspaceId,
		page: 1,
		pageSize: 10,
		total: 1,
		unreadCount: 1,
		items: [notification]
	}

	it('parses mail notification list and desired-state read receipt strictly', async () => {
		request.mockResolvedValueOnce(response)
		await expect(
			listCrmNotifications(
				'mail',
				session.accessToken,
				workspaceId,
				1,
				false
			)
		).resolves.toMatchObject({
			unreadCount: 1,
			items: [{ targetId: messageId, contactId, readAt: null }]
		})
		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({
				method: 'GET',
				url: '/crm/customers/mail/notifications',
				params: {
					page: '1',
					unreadOnly: 'false',
					workspaceId,
					pageSize: '10'
				}
			})
		)

		request.mockResolvedValueOnce({
			schemaVersion: 1,
			workspaceId,
			id: notificationId,
			readAt: stamp
		})
		await expect(
			readCrmNotification('mail', session.accessToken, workspaceId, {
				id: notificationId,
				title: notification.title,
				createdAt: stamp,
				readAt: null,
				targetId: messageId,
				contactId
			})
		).resolves.toMatchObject({ id: notificationId, readAt: stamp })
		expect(request).toHaveBeenLastCalledWith(
			expect.objectContaining({
				method: 'PUT',
				url: `/crm/customers/mail/notifications/${notificationId}/read`,
				data: { schemaVersion: 1, workspaceId, read: true }
			})
		)
	})

	it.each([
		{ ...response, pageSize: 20 },
		{ ...response, workspaceId: contactId },
		{ ...response, extra: true },
		{ ...response, items: [{ ...notification, recipient: 'secret' }] },
		{ ...response, items: [{ ...notification, contactId: 'invalid' }] },
		{ ...response, items: [{ ...notification, title: '' }] },
		{ ...response, items: [{ ...notification, readAt: 'yesterday' }] }
	])(
		'rejects malformed or overbroad mail notification payload %#',
		async bad => {
			request.mockResolvedValueOnce(bad)
			await expect(
				listCrmNotifications(
					'mail',
					session.accessToken,
					workspaceId,
					1,
					false
				)
			).rejects.toThrow()
		}
	)

	it('rejects a read receipt for another notification or an invalid read timestamp', async () => {
		for (const bad of [
			{ schemaVersion: 1, workspaceId, id: contactId, readAt: stamp },
			{
				schemaVersion: 1,
				workspaceId,
				id: notificationId,
				readAt: 'later'
			}
		]) {
			request.mockResolvedValueOnce(bad)
			await expect(
				readCrmNotification('mail', session.accessToken, workspaceId, {
					id: notificationId,
					title: notification.title,
					createdAt: stamp,
					readAt: null,
					targetId: messageId,
					contactId
				})
			).rejects.toThrow()
		}
	})
})

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
			return {
				schemaVersion: 1,
				workspaceId,
				sendId,
				state: 'QUEUED',
				messageId: '<sent@example.ru>'
			} as never
		throw new Error(`Unexpected mail API request: ${config.method} ${url}`)
	})
})

afterEach(() => {
	cleanup()
	useSessionStore.getState().setAnonymous()
})

describe('mail UI workflows', () => {
	it.each([
		['BACKFILL', 'Загружается история'],
		['SYNCING', 'Загружается история'],
		['CURRENT', 'Подключён']
	])(
		'renders the %s mailbox sync state as %s',
		async (syncStatus, label) => {
			request.mockImplementation(async config => {
				const url = config.url ?? ''
				if (url.endsWith('/capabilities')) return capabilities as never
				if (url.endsWith('/mailboxes'))
					return {
						schemaVersion: 1,
						workspaceId,
						items: [{ ...mailbox, syncStatus }],
						nextCursor: null
					} as never
				throw new Error(
					`Unexpected mail API request: ${config.method} ${url}`
				)
			})
			render(<MailSettings />, { wrapper: Providers })
			expect(await screen.findByText(label)).toBeTruthy()
		}
	)

	it('recovers folder selection from the same command after a BACKFILL receipt', async () => {
		let attempts = 0
		request.mockImplementation(async config => {
			const url = config.url ?? ''
			if (url.endsWith('/capabilities')) return capabilities as never
			if (url.endsWith('/mailboxes'))
				return {
					schemaVersion: 1,
					workspaceId,
					items: [{ ...mailbox, syncStatus: 'CURRENT' }],
					nextCursor: null
				} as never
			if (
				url.endsWith(`/mailboxes/${mailboxId}/folders`) &&
				config.method === 'GET'
			)
				return {
					schemaVersion: 1,
					workspaceId,
					items: [
						{
							path: 'INBOX',
							name: 'Входящие',
							kind: 'INBOX',
							selected: false
						},
						{
							path: 'Sent Items',
							name: 'Отправленные',
							kind: 'SENT',
							selected: false
						}
					],
					nextCursor: null
				} as never
			if (
				url.endsWith(`/mailboxes/${mailboxId}/folders`) &&
				config.method === 'PUT'
			) {
				attempts++
				if (attempts === 1)
					throw new AuthenticatedApiError('temporary', 'Сеть недоступна.')
				return success({
					...mailbox,
					version: 8,
					syncStatus: 'BACKFILL'
				}) as never
			}
			throw new Error(
				`Unexpected mail API request: ${config.method} ${url}`
			)
		})
		render(<MailSettings />, { wrapper: Providers })
		fireEvent.click(
			await screen.findByRole('button', { name: 'Папки и импорт' })
		)
		fireEvent.change(await screen.findByLabelText('Входящие'), {
			target: { value: 'INBOX' }
		})
		fireEvent.click(
			screen.getByRole('button', { name: 'Сохранить и начать импорт' })
		)
		await screen.findByRole('button', { name: 'Проверить результат' })
		const first = request.mock.calls.find(
			([config]) =>
				config.method === 'PUT' && config.url?.endsWith('/folders')
		)?.[0]
		expect(first?.data).toMatchObject({
			expectedVersion: 7,
			folders: [{ path: 'INBOX', kind: 'INBOX' }]
		})
		expect(first?.headers?.['Idempotency-Key']).toBe(
			(first?.data as { commandId: string }).commandId
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Проверить результат' })
		)
		await waitFor(() => expect(attempts).toBe(2))
		const folderCommands = request.mock.calls
			.filter(
				([config]) =>
					config.method === 'PUT' && config.url?.endsWith('/folders')
			)
			.map(([config]) => config)
		expect(folderCommands).toHaveLength(2)
		expect(folderCommands[1]?.data).toEqual(first?.data)
		expect(folderCommands[1]?.headers?.['Idempotency-Key']).toBe(
			first?.headers?.['Idempotency-Key']
		)
		await waitFor(() =>
			expect(
				screen.queryByRole('button', { name: 'Сохранить и начать импорт' })
			).toBeNull()
		)
	})

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
		let attachmentReads = 0
		const onQueued = vi.fn()
		request.mockImplementation(async config => {
			if ((config.url ?? '').endsWith('/capabilities'))
				return capabilities as never
			if (
				(config.url ?? '').endsWith('/attachments') &&
				config.method === 'POST'
			)
				return (await new Promise<unknown>(resolve => {
					finishUpload = resolve
				})) as never
			if ((config.url ?? '').endsWith(`/attachments/${attachmentId}`)) {
				attachmentReads++
				return success({
					id: attachmentId,
					fileName: 'offer.pdf',
					declaredMime: 'application/pdf',
					detectedMime: 'application/pdf',
					byteSize: 12,
					state: attachmentReads === 1 ? 'QUARANTINED' : 'VALIDATED',
					sha256: 'a'.repeat(64),
					validationVersion: 1,
					expiresAt: null
				}) as never
			}
			if ((config.url ?? '').endsWith('/send'))
				return {
					schemaVersion: 1,
					workspaceId,
					sendId,
					state: 'QUEUED',
					messageId: '<sent@example.ru>'
				} as never
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
				onQueued={onQueued}
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
					state: 'QUARANTINED',
					sha256: 'a'.repeat(64),
					validationVersion: 1,
					expiresAt: null
				})
			)
		)
		await screen.findByText('Проверяется файл…')
		expect(
			(screen.getByLabelText('Письмо') as HTMLTextAreaElement).value
		).toBe('Ответ с вложением')
		expect(
			screen.getByRole('button', { name: 'Отправить' })
		).toHaveProperty('disabled', true)
		fireEvent.submit(
			screen.getByRole('button', { name: 'Отправить' }).closest('form')!
		)
		expect(
			request.mock.calls.some(([config]) => config.url?.endsWith('/send'))
		).toBe(false)
		await waitFor(
			() => expect(attachmentReads).toBeGreaterThanOrEqual(2),
			{
				timeout: 5000
			}
		)
		await screen.findByText(/offer\.pdf ·/)
		fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
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
		expect(
			request.mock.calls.filter(([config]) =>
				config.url?.endsWith('/attachments')
			)
		).toHaveLength(1)
		await waitFor(() => expect(onQueued).toHaveBeenCalledOnce())
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
				return {
					schemaVersion: 1,
					workspaceId,
					sendId,
					state: 'QUEUED',
					messageId: '<sent@example.ru>'
				} as never
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

	it('recovers a lost attachment POST, then checks the quarantined ID with GET only', async () => {
		let uploads = 0
		let reads = 0
		request.mockImplementation(async config => {
			const url = config.url ?? ''
			if (url.endsWith('/capabilities')) return capabilities as never
			if (url.endsWith('/attachments') && config.method === 'POST') {
				uploads++
				if (uploads === 1)
					throw new AuthenticatedApiError('temporary', 'Сеть недоступна.')
				return success(attachmentReceipt('QUARANTINED')) as never
			}
			if (url.endsWith(`/attachments/${attachmentId}`)) {
				reads++
				if (reads === 1)
					throw new AuthenticatedApiError(
						'temporary',
						'Проверка недоступна.'
					)
				return success(attachmentReceipt('VALIDATED')) as never
			}
			throw new Error(
				`Unexpected mail API request: ${config.method} ${url}`
			)
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
		fireEvent.change(screen.getByLabelText('Тема'), {
			target: { value: 'Вложение к предложению' }
		})
		fireEvent.change(screen.getByLabelText('Письмо'), {
			target: { value: 'Текст черновика во время проверки' }
		})
		fireEvent.change(await screen.findByLabelText('Вложение'), {
			target: {
				files: [
					new File(['document'], 'offer.pdf', { type: 'application/pdf' })
				]
			}
		})
		fireEvent.click(
			screen.getByRole('button', { name: 'Прикрепить файл' })
		)
		await screen.findByRole('button', { name: 'Проверить результат' })
		const firstPost = request.mock.calls.find(([config]) =>
			config.url?.endsWith('/attachments')
		)?.[0]
		fireEvent.click(
			screen.getByRole('button', { name: 'Проверить результат' })
		)
		await screen.findByRole('button', { name: 'Проверить файл' })
		expect(
			screen.getByText(
				'Не удалось проверить файл. Проверьте доступ и повторите проверку.'
			)
		).toBeTruthy()
		expect(
			(screen.getByLabelText('Письмо') as HTMLTextAreaElement).value
		).toBe('Текст черновика во время проверки')
		expect(
			screen.getByRole('button', { name: 'Отправить' })
		).toHaveProperty('disabled', true)
		const postsBeforeFileCheck = request.mock.calls.filter(([config]) =>
			config.url?.endsWith('/attachments')
		)
		expect(postsBeforeFileCheck).toHaveLength(2)
		const uploadData = firstPost?.data as FormData
		const replayData = postsBeforeFileCheck[1]?.[0].data as FormData
		const commandId = uploadData.get('commandId')
		expect(typeof commandId).toBe('string')
		expect(replayData.get('commandId')).toBe(commandId)
		expect(replayData.get('mailboxId')).toBe(mailboxId)
		expect(replayData.get('contactId')).toBe(contactId)
		expect(firstPost?.headers?.['Idempotency-Key']).toBe(commandId)
		expect(postsBeforeFileCheck[1]?.[0].headers?.['Idempotency-Key']).toBe(
			commandId
		)
		fireEvent.click(screen.getByRole('button', { name: 'Проверить файл' }))
		await screen.findByText(/offer\.pdf ·/)
		expect(uploads).toBe(2)
		expect(reads).toBe(2)
		expect(
			request.mock.calls.filter(([config]) =>
				config.url?.endsWith('/attachments')
			)
		).toHaveLength(2)
	})

	it('does not attach a terminal REJECTED receipt and lets the user remove it', async () => {
		let reads = 0
		request.mockImplementation(async config => {
			const url = config.url ?? ''
			if (url.endsWith('/capabilities')) return capabilities as never
			if (url.endsWith('/attachments') && config.method === 'POST')
				return success(attachmentReceipt('QUARANTINED')) as never
			if (url.endsWith(`/attachments/${attachmentId}`)) {
				reads++
				return success(attachmentReceipt('REJECTED')) as never
			}
			throw new Error(
				`Unexpected mail API request: ${config.method} ${url}`
			)
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
		fireEvent.change(screen.getByLabelText('Письмо'), {
			target: { value: 'Черновик сохранён' }
		})
		fireEvent.change(await screen.findByLabelText('Вложение'), {
			target: {
				files: [
					new File(['document'], 'offer.pdf', { type: 'application/pdf' })
				]
			}
		})
		fireEvent.click(
			screen.getByRole('button', { name: 'Прикрепить файл' })
		)
		expect((await screen.findByRole('alert')).textContent).toContain(
			'Файл не прошёл проверку или недоступен.'
		)
		expect(
			screen.queryByRole('list', { name: 'Прикреплённые файлы' })
		).toBeNull()
		expect(reads).toBe(1)
		expect(
			screen.getByRole('button', { name: 'Отправить' })
		).toHaveProperty('disabled', true)
		fireEvent.click(
			screen.getByRole('button', { name: 'Убрать выбранный файл' })
		)
		expect(screen.queryByRole('alert')).toBeNull()
		expect(
			screen.getByRole('button', { name: 'Отправить' })
		).toHaveProperty('disabled', false)
		expect(
			(screen.getByLabelText('Письмо') as HTMLTextAreaElement).value
		).toBe('Черновик сохранён')
	})

	it('does not attach a late VALIDATED result after the pending file was removed', async () => {
		let finishRead!: (value: unknown) => void
		request.mockImplementation(async config => {
			const url = config.url ?? ''
			if (url.endsWith('/capabilities')) return capabilities as never
			if (url.endsWith('/attachments') && config.method === 'POST')
				return success(attachmentReceipt('QUARANTINED')) as never
			if (url.endsWith(`/attachments/${attachmentId}`))
				return (await new Promise<unknown>(resolve => {
					finishRead = resolve
				})) as never
			throw new Error(
				`Unexpected mail API request: ${config.method} ${url}`
			)
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
		fireEvent.change(screen.getByLabelText('Письмо'), {
			target: { value: 'Черновик остаётся в форме' }
		})
		fireEvent.change(await screen.findByLabelText('Вложение'), {
			target: {
				files: [
					new File(['document'], 'offer.pdf', { type: 'application/pdf' })
				]
			}
		})
		fireEvent.click(
			screen.getByRole('button', { name: 'Прикрепить файл' })
		)
		await screen.findByText('Проверяется файл…')
		await screen.findByRole('button', { name: 'Убрать выбранный файл' })
		fireEvent.click(
			screen.getByRole('button', { name: 'Убрать выбранный файл' })
		)
		await act(async () =>
			finishRead(success(attachmentReceipt('VALIDATED')))
		)
		await waitFor(() =>
			expect(
				screen.getByRole('button', { name: 'Отправить' })
			).toHaveProperty('disabled', false)
		)
		expect(
			screen.queryByRole('list', { name: 'Прикреплённые файлы' })
		).toBeNull()
		expect(
			(screen.getByLabelText('Письмо') as HTMLTextAreaElement).value
		).toBe('Черновик остаётся в форме')
	})

	it('keeps a forbidden attachment status out of the composer without another upload', async () => {
		let uploads = 0
		request.mockImplementation(async config => {
			const url = config.url ?? ''
			if (url.endsWith('/capabilities')) return capabilities as never
			if (url.endsWith('/attachments') && config.method === 'POST') {
				uploads++
				return success(attachmentReceipt('QUARANTINED')) as never
			}
			if (url.endsWith(`/attachments/${attachmentId}`))
				throw new AuthenticatedApiError('forbidden', 'Forbidden')
			throw new Error(
				`Unexpected mail API request: ${config.method} ${url}`
			)
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
		fireEvent.change(await screen.findByLabelText('Вложение'), {
			target: {
				files: [
					new File(['document'], 'offer.pdf', { type: 'application/pdf' })
				]
			}
		})
		fireEvent.click(
			screen.getByRole('button', { name: 'Прикрепить файл' })
		)
		expect(await screen.findByRole('alert')).toBeTruthy()
		expect(
			screen.getByRole('button', { name: 'Проверить файл' })
		).toBeTruthy()
		expect(
			screen.queryByRole('list', { name: 'Прикреплённые файлы' })
		).toBeNull()
		expect(uploads).toBe(1)
		expect(
			screen.getByRole('button', { name: 'Отправить' })
		).toHaveProperty('disabled', true)
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
					access.membership.membershipId,
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

	describe('customer mail refresh', () => {
	const setup = (state: 'QUEUED' | 'SENDING' | null) => {
		const row = contactMessage(state)
		request.mockImplementation(async config => {
			const url = config.url ?? ''
			if (url.endsWith('/capabilities'))
				return {
					...capabilities,
					mailPermissions: ['mail:read']
				} as never
			if (url.endsWith('/mailboxes')) return mailPage([]) as never
			if (url.endsWith(`/contacts/${contactId}/messages`))
				return mailPage([row]) as never
			throw new Error(
				`Unexpected mail API request: ${config.method} ${url}`
			)
		})
		render(
			<CustomerMailPanel
				contactId={contactId}
				email="customer@example.ru"
			/>,
			{ wrapper: Providers }
		)
		return {
			row,
			messageRequests: () =>
				request.mock.calls.filter(([config]) =>
					config.url?.endsWith(`/contacts/${contactId}/messages`)
				)
		}
	}

	it.each([
		[null, 5000, 'Incoming mail update'],
		['QUEUED', 3000, 'Pending outgoing mail'],
		['SENDING', 3000, 'Pending outgoing mail']
	] as const)(
		'refetches visible %s contact mail at %i ms without sending a command',
		async (state, interval, subject) => {
			vi.useFakeTimers()
			const { messageRequests } = setup(state)
			await act(async () => {
				await vi.advanceTimersByTimeAsync(1)
			})
			expect(screen.getByText(subject)).toBeTruthy()
			expect(messageRequests()).toHaveLength(1)
			await act(async () => {
				await vi.advanceTimersByTimeAsync(interval - 2)
			})
			expect(messageRequests()).toHaveLength(1)
			await act(async () => {
				await vi.advanceTimersByTimeAsync(1)
			})
			expect(messageRequests()).toHaveLength(2)
			expect(screen.getByText(subject)).toBeTruthy()
			expect(
				request.mock.calls.every(([config]) => config.method === 'GET')
			).toBe(true)
		}
	)

	it('shows a newly arrived inbound message after the five-second refresh', async () => {
		vi.useFakeTimers()
		let messageCalls = 0
		request.mockImplementation(async config => {
			const url = config.url ?? ''
			if (url.endsWith('/capabilities'))
				return { ...capabilities, mailPermissions: ['mail:read'] } as never
			if (url.endsWith('/mailboxes')) return mailPage([]) as never
			if (url.endsWith(`/contacts/${contactId}/messages`)) {
				messageCalls++
				return mailPage(messageCalls === 1 ? [] : [contactMessage(null)]) as never
			}
			throw new Error(`Unexpected mail API request: ${config.method} ${url}`)
		})
		render(
			<CustomerMailPanel contactId={contactId} email="customer@example.ru" />,
			{ wrapper: Providers }
		)
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1)
		})
		expect(screen.queryByText('Incoming mail update')).toBeNull()
		expect(messageCalls).toBe(1)
		await act(async () => {
			await vi.advanceTimersByTimeAsync(4999)
		})
		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
		})
		expect(messageCalls).toBe(2)
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1)
		})
		expect(screen.getByText('Incoming mail update')).toBeTruthy()
		expect(request.mock.calls.every(([config]) => config.method === 'GET')).toBe(true)
	})

	it.each([
		['temporary' as const, 'Переписка недоступна'],
		['forbidden' as const, null]
	])(
		'stops polling and clears prior message content after %s response',
		async (kind, visibleError) => {
			vi.useFakeTimers()
			let messageCalls = 0
			request.mockImplementation(async config => {
				const url = config.url ?? ''
				if (url.endsWith('/capabilities'))
					return {
						...capabilities,
						mailPermissions: ['mail:read']
					} as never
				if (url.endsWith('/mailboxes')) return mailPage([]) as never
				if (url.endsWith(`/contacts/${contactId}/messages`)) {
					messageCalls++
					if (messageCalls > 1)
						throw new AuthenticatedApiError(kind, 'Mail access changed')
					return mailPage([contactMessage(null)]) as never
				}
				throw new Error(
					`Unexpected mail API request: ${config.method} ${url}`
				)
			})
			render(
				<CustomerMailPanel
					contactId={contactId}
					email="customer@example.ru"
				/>,
				{ wrapper: Providers }
			)
			await act(async () => {
				await vi.advanceTimersByTimeAsync(1)
			})
			expect(screen.getByText('Incoming mail update')).toBeTruthy()
			await act(async () => {
				await vi.advanceTimersByTimeAsync(5000)
			})
			expect(messageCalls).toBe(2)
			expect(screen.queryByText('Incoming mail update')).toBeNull()
			if (visibleError) expect(screen.getByText(visibleError)).toBeTruthy()
			else
				expect(
					screen.queryByRole('region', { name: 'Переписка с клиентом' })
				).toBeNull()
			await act(async () => {
				await vi.advanceTimersByTimeAsync(15_000)
			})
			expect(messageCalls).toBe(2)
			expect(
				request.mock.calls.every(([config]) => config.method === 'GET')
			).toBe(true)
		}
	)

	it('clears the previous contact mail and stops polling after session cleanup', async () => {
		vi.useFakeTimers()
		const { messageRequests } = setup(null)
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1)
		})
		expect(screen.getByText('Incoming mail update')).toBeTruthy()
		expect(messageRequests()).toHaveLength(1)
		act(() => useSessionStore.getState().setAnonymous())
		expect(screen.queryByText('Incoming mail update')).toBeNull()
		await act(async () => {
			await vi.advanceTimersByTimeAsync(20_000)
		})
		expect(messageRequests()).toHaveLength(1)
	})
})
