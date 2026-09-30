'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
	crmPermissionScope,
	useCrmPermissions
} from '@/entities/crm-access'
import { listCustomers, type Customer } from '@/entities/customer'
import {
	getMailAttachment,
	getMailSend,
	mailCommand,
	uploadMailAttachment
} from '@/entities/mail/api/mail.api'
import {
	parseMailSendResult,
	type MailAddress,
	type MailAttachment,
	type MailMailbox,
	type MailMessageDetail,
	type MailSendCommand,
	type MailSendState
} from '@/entities/mail/model/mail.contract'
import { useDirtyForm } from '@/shared/lib/dirty-form'
import { Button, Drawer, SelectField, TextField } from '@/shared/ui'
import { RichMailEditor } from './RichMailEditor'
import {
	newMailCommand,
	useMailCommand,
	useMailContext
} from '../model/use-mail-context'
import { MailCommandNotice } from './MailCommandNotice'
import styles from './Mail.module.scss'

export const mailStateLabel: Record<MailSendState, string> = {
	QUEUED: 'В очереди',
	SENDING: 'Передаётся серверу',
	ACCEPTED: 'Принято почтовым сервером',
	PARTIAL_ACCEPTED: 'Принято для части получателей',
	FAILED: 'Отправка не выполнена',
	UNKNOWN: 'Результат отправки неизвестен',
	CANCELLED: 'Отправка отменена'
}
const addresses = (value: string): MailAddress[] | null => {
	const values = value
		.split(/[,;\n]/)
		.map(item => item.trim())
		.filter(Boolean)
	if (
		values.length > 20 ||
		values.some(email => !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email))
	)
		return null
	return [...new Set(values)].map(email => ({ email, name: null }))
}

export const MailComposer = ({
	contactId,
	email,
	mailboxes,
	reply,
	replyContacts = [],
	accessBlocked = false,
	onRecheckAccess,
	onClose,
	onQueued
}: {
	contactId: string | null
	email: string | null
	mailboxes: MailMailbox[]
	reply?: MailMessageDetail
	replyContacts?: { id: string; label: string }[]
	accessBlocked?: boolean
	onRecheckAccess?: () => void
	onClose: () => void
	onQueued: () => void
}) => {
	const context = useMailContext()
	const [chosenContactId, setChosenContactId] = useState(contactId)
	const [chooseContact, setChooseContact] = useState(false)
	const [mailboxId, setMailboxId] = useState(
		reply?.mailboxId ?? mailboxes[0]?.id ?? ''
	)
	const [to, setTo] = useState(
		reply
			? (reply.direction === 'INBOUND' ? reply.from : reply.to)
					.map(item => item.email)
					.join(', ')
			: (email ?? '')
	)
	const [cc, setCc] = useState('')
	const [bcc, setBcc] = useState('')
	const [subject, setSubject] = useState(
		reply
			? /^re:/i.test(reply.subject)
				? reply.subject
				: `Re: ${reply.subject}`
			: ''
	)
	const [text, setText] = useState('')
	const [html, setHtml] = useState<string | undefined>()
	const [attachments, setAttachments] = useState<MailAttachment[]>([])
	const [sendId, setSendId] = useState<string | null>(null)
	const [attachmentPending, setAttachmentPending] = useState(false)
	const [validation, setValidation] = useState<string | null>(null)
	const [initial] = useState({ to, subject, mailboxId })
	const form = useDirtyForm({
		dirty:
			!sendId &&
			(!!text ||
				!!html ||
				!!cc ||
				!!bcc ||
				!!attachments.length ||
				to !== initial.to ||
				chosenContactId !== contactId ||
				subject !== initial.subject ||
				mailboxId !== initial.mailboxId),
		label: contactId ? 'Письмо клиенту' : 'Письмо'
	})
	const command = useMailCommand(
		context,
		`mail-compose:${chosenContactId ?? 'mailbox'}:${reply?.id ?? 'new'}`,
		'mail:send',
		(token, data: MailSendCommand) =>
			mailCommand(token, '/send', data, parseMailSendResult),
		result => {
			setSendId(result.sendId)
			setText('')
			setHtml(undefined)
			setAttachments([])
			form.markClean()
			onQueued()
		},
		!accessBlocked
	)
	const build = (): MailSendCommand => ({
		...newMailCommand(context.workspace.workspaceId),
		mailboxId,
		contactId: chosenContactId,
		to: addresses(to)!,
		cc: addresses(cc)!,
		bcc: addresses(bcc)!,
		subject,
		text,
		...(html ? { html } : {}),
		attachmentIds: attachments.map(item => item.id),
		replyToMessageId: reply?.id ?? null
	})
	const submit = () => {
		if (accessBlocked || !command.enabled) return
		setValidation(null)
		if (replyContacts.length > 1 && !chosenContactId) {
			setValidation('Выберите контакт, к которому будет привязан ответ.')
			return
		}
		if (attachmentPending) {
			setValidation(
				'Дождитесь прикрепления выбранного файла или уберите его.'
			)
			return
		}
		if (
			!addresses(to)?.length ||
			!addresses(cc) ||
			!addresses(bcc) ||
			[
				...(addresses(to) ?? []),
				...(addresses(cc) ?? []),
				...(addresses(bcc) ?? [])
			].length > 20
		) {
			setValidation(
				'Укажите до 20 адресов получателей через запятую. Имена и угловые скобки не нужны.'
			)
			return
		}
		const encoder = new TextEncoder()
		if (
			encoder.encode(text).byteLength +
				encoder.encode(html ?? '').byteLength >
			24 * 1024
		) {
			setValidation(
				'Слишком длинное письмо с форматированием. Сократите текст или прикрепите его файлом.'
			)
			return
		}
		if (!mailboxId || !mailboxes.some(item => item.id === mailboxId)) {
			setValidation('Выберите доступный ящик отправителя.')
			return
		}
		if (
			attachments.some(
				item =>
					item.state !== 'VALIDATED' ||
					(item.expiresAt && Date.parse(item.expiresAt) <= Date.now())
			)
		) {
			setValidation(
				'Одно из вложений недоступно. Удалите его и прикрепите заново.'
			)
			return
		}
		const data = build()
		if (encoder.encode(JSON.stringify(data)).byteLength > 32 * 1024) {
			setValidation(
				'Письмо с получателями и форматированием превышает допустимый размер. Сократите его или прикрепите текст файлом.'
			)
			return
		}
		void command.execute(() => data)
	}
	return (
		<Drawer
			isOpen
			title={reply ? 'Ответить на письмо' : 'Новое письмо'}
			onClose={onClose}
			dirtyFormIds={[form.id]}
		>
			{accessBlocked ? (
				<div className={styles.stack} role="status">
					<p>
						Доступ к отправке пока не подтверждён. Локальный текст письма
						сохранён; отправка и прикрепление файлов приостановлены.
					</p>
					{onRecheckAccess ? (
						<Button
							variant="secondary"
							disabled={context.capabilities.isFetching}
							onClick={onRecheckAccess}
						>
							Проверить доступ
						</Button>
					) : null}
				</div>
			) : null}
			{sendId ? (
				<SendStatus
					id={sendId}
					accessBlocked={accessBlocked}
					onClose={onClose}
				/>
			) : (
				<form
					className={styles.stack}
					onSubmit={event => {
						event.preventDefault()
						submit()
					}}
				>
					<fieldset className={styles.fieldset} disabled={command.locked}>
						<div className={styles.stack}>
							{replyContacts.length > 1 ? (
								<SelectField
									label="Контакт для ответа"
									required
									value={chosenContactId ?? ''}
									disabled={attachmentPending}
									hint="Письмо связано с несколькими контактами. Выберите, к кому привязать ответ. При смене контакта вложения нужно прикрепить заново."
									onChange={event => {
										const next = event.target.value || null
										const change = () => {
											setChosenContactId(next)
											setAttachments([])
											setValidation(null)
										}
										if (attachments.length) form.confirmDiscard(change)
										else change()
									}}
								>
									<option value="">Выберите контакт</option>
									{replyContacts.map(item => (
										<option key={item.id} value={item.id}>
											{item.label}
										</option>
									))}
								</SelectField>
							) : null}
							{!reply && !contactId ? (
								<>
									<Button
										type="button"
										variant="secondary"
										disabled={attachmentPending}
										onClick={() => setChooseContact(value => !value)}
									>
										Выбрать получателя из контактов
									</Button>
									{chooseContact ? (
										<ContactRecipientPicker
											disabled={command.locked || attachmentPending}
											onSelect={(id, address) => {
												const change = () => {
													setChosenContactId(id)
													setTo(address)
													setAttachments([])
													setValidation(null)
													setChooseContact(false)
												}
												if (attachments.length) form.confirmDiscard(change)
												else change()
											}}
										/>
									) : null}
								</>
							) : null}
							<SelectField
								label="Отправитель"
								value={mailboxId}
								disabled={!!reply || attachmentPending}
								onChange={event => {
									const next = event.target.value
									const change = () => {
										setMailboxId(next)
										setAttachments([])
									}
									if (attachments.length) form.confirmDiscard(change)
									else change()
								}}
							>
								{mailboxes.map(mailbox => (
									<option key={mailbox.id} value={mailbox.id}>
										{mailbox.displayName} — {mailbox.address}
									</option>
								))}
							</SelectField>
							<TextField
								label="Кому"
								required
								maxLength={4000}
								value={to}
								onChange={event => {
									const next = event.target.value
									if (!chosenContactId || contactId || reply) {
										setTo(next)
										return
									}
									const change = () => {
										setTo(next)
										setChosenContactId(null)
										setAttachments([])
									}
									if (attachments.length) form.confirmDiscard(change)
									else change()
								}}
								hint="Несколько адресов можно разделить запятой."
							/>
							{!reply && !contactId && chosenContactId ? (
								<p className={styles.muted}>
									Получатель выбран из контактов. Если изменить адрес
									вручную, привязка к контакту будет снята.
								</p>
							) : null}
							<div className={styles.grid}>
								<TextField
									label="Копия"
									maxLength={4000}
									value={cc}
									onChange={event => setCc(event.target.value)}
								/>
								<TextField
									label="Скрытая копия"
									maxLength={4000}
									value={bcc}
									onChange={event => setBcc(event.target.value)}
								/>
							</div>
							<TextField
								label="Тема"
								maxLength={300}
								value={subject}
								onChange={event => setSubject(event.target.value)}
							/>
							<RichMailEditor
								text={text}
								html={html}
								disabled={command.locked}
								onChange={content => {
									setText(content.text)
									setHtml(content.html)
								}}
							/>
							{attachments.length ? (
								<ul
									className={styles.list}
									aria-label="Прикреплённые файлы"
								>
									{attachments.map(item => (
										<li className={styles.item} key={item.id}>
											<div className={styles.row}>
												<span>
													{item.fileName} ·{' '}
													{Math.ceil(item.byteSize / 1024)} КБ
												</span>
												<Button
													variant="ghost"
													onClick={() =>
														setAttachments(previous =>
															previous.filter(
																value => value.id !== item.id
															)
														)
													}
												>
													Удалить
												</Button>
											</div>
										</li>
									))}
								</ul>
							) : null}
						</div>
					</fieldset>
					{context.capabilities.data?.attachmentsAvailable ? (
						<AttachmentUpload
							key={`${context.key.join(':')}:${mailboxId}:${chosenContactId}`}
							mailboxId={mailboxId}
							contactId={chosenContactId}
							current={attachments}
							disabled={
								command.locked ||
								accessBlocked ||
								(replyContacts.length > 1 && !chosenContactId)
							}
							onPendingChange={setAttachmentPending}
							onAttached={attachment =>
								setAttachments(previous => [...previous, attachment])
							}
						/>
					) : (
						<p className={styles.muted}>
							Прикрепление файлов пока недоступно.
						</p>
					)}
					{validation ? <p role="alert">{validation}</p> : null}
					{!accessBlocked ? <MailCommandNotice command={command} /> : null}
					<Button
						type="submit"
						disabled={
							command.locked ||
							!command.enabled ||
							(replyContacts.length > 1 && !chosenContactId) ||
							attachmentPending ||
							!context.capabilities.data?.mailPermissions.includes(
								'mail:send'
							)
						}
					>
						Отправить
					</Button>
				</form>
			)}
		</Drawer>
	)
}

const ContactRecipientPicker = ({
	disabled,
	onSelect
}: {
	disabled: boolean
	onSelect: (id: string, email: string) => void
}) => {
	const context = useMailContext()
	const permissions = useCrmPermissions(
		context.workspace.workspaceId,
		context.session,
		context.sessionRevision
	)
	const [searchDraft, setSearchDraft] = useState('')
	const [search, setSearch] = useState('')
	const [page, setPage] = useState(1)
	const canRead =
		permissions.isSuccess &&
		!permissions.isFetching &&
		permissions.data.workspaceId === context.workspace.workspaceId &&
		permissions.data.subject === context.session?.userId &&
		permissions.data.permissions.includes('customers:read')
	const contacts = useQuery({
		queryKey: [
			'mail-recipient-contacts',
			...context.key,
			crmPermissionScope(permissions.data),
			search,
			page
		],
		enabled: canRead && search.length >= 2,
		queryFn: () =>
			listCustomers(
				context.session!.accessToken,
				'contacts',
				context.workspace.workspaceId,
				page,
				25,
				search
			),
		retry: false,
		gcTime: 0
	})
	return (
		<div className={styles.panel}>
			{permissions.isPending || permissions.isFetching ? (
				<p role="status">Проверяем доступ к контактам…</p>
			) : !canRead ? (
				<p role="status">
					Список контактов недоступен. Адрес можно ввести вручную.
				</p>
			) : (
				<>
					<div className={styles.actions}>
						<TextField
							label="Найти контакт по имени или email"
							value={searchDraft}
							maxLength={200}
							disabled={disabled}
							onChange={event => setSearchDraft(event.target.value)}
						/>
						<Button
							type="button"
							variant="secondary"
							disabled={disabled || searchDraft.trim().length < 2}
							onClick={() => {
								setSearch(searchDraft.trim())
								setPage(1)
							}}
						>
							Найти
						</Button>
					</div>
					{searchDraft.trim() !== search ? null : contacts.isFetching ? (
						<p role="status">Ищем контакты…</p>
					) : contacts.isError ? (
						<p role="alert">Не удалось загрузить контакты.</p>
					) : contacts.data ? (
						<>
							{!contacts.data.items.some(
								item => item.kind === 'contacts' && item.email
							) ? (
								<p role="status">
									На этой странице нет контактов с email. Уточните поиск
									или перейдите на следующую страницу.
								</p>
							) : null}
							<ul className={styles.list}>
								{contacts.data.items
									.filter(
										(
											item
										): item is Extract<Customer, { kind: 'contacts' }> =>
											item.kind === 'contacts' && !!item.email
									)
									.map(item => (
										<li key={item.id}>
											<Button
												type="button"
												variant="ghost"
												disabled={disabled}
												onClick={() => onSelect(item.id, item.email!)}
											>
												{item.name} — {item.email}
											</Button>
										</li>
									))}
							</ul>
							{contacts.data.total > 25 ? (
								<div className={styles.actions}>
									<Button
										variant="secondary"
										disabled={disabled || page === 1}
										onClick={() => setPage(value => value - 1)}
									>
										Назад
									</Button>
									<span>
										Страница {page} · найдено {contacts.data.total}
									</span>
									<Button
										variant="secondary"
										disabled={disabled || page * 25 >= contacts.data.total}
										onClick={() => setPage(value => value + 1)}
									>
										Далее
									</Button>
								</div>
							) : null}
						</>
					) : null}
				</>
			)}
		</div>
	)
}

const AttachmentUpload = ({
	mailboxId,
	contactId,
	current,
	disabled,
	onPendingChange,
	onAttached
}: {
	mailboxId: string
	contactId: string | null
	current: MailAttachment[]
	disabled: boolean
	onPendingChange: (pending: boolean) => void
	onAttached: (item: MailAttachment) => void
}) => {
	const context = useMailContext()
	const [file, setFile] = useState<File | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [tracked, setTracked] = useState<{
		item: MailAttachment
		deadline: number
	} | null>(null)
	const [expired, setExpired] = useState(false)
	const attached = useRef<string | null>(null)
	const input = useRef<HTMLInputElement>(null)
	const form = useDirtyForm({ dirty: !!file, label: 'Вложение письма' })
	const limits = context.capabilities.data?.attachmentLimits
	const finish = (item: MailAttachment) => {
		if (attached.current === item.id) return
		attached.current = item.id
		onAttached(item)
		setTracked(null)
		setFile(null)
		if (input.current) input.current.value = ''
		form.markClean()
	}
	const build = () => ({
		...newMailCommand(context.workspace.workspaceId),
		mailboxId,
		contactId,
		file: file!
	})
	const command = useMailCommand(
		context,
		`mail-upload:${mailboxId}:${contactId}`,
		'mail:send',
		uploadMailAttachment,
		result => {
			if (result.item.state === 'VALIDATED') finish(result.item)
			else {
				setExpired(false)
				setTracked({ item: result.item, deadline: Date.now() + 60_000 })
			}
		},
		!disabled
	)
	const intermediate = (state: MailAttachment['state']) =>
		['DEFERRED', 'UPLOADING', 'QUARANTINED'].includes(state)
	const record = useQuery({
		queryKey: [
			'mail-upload-attachment',
			...context.key,
			mailboxId,
			contactId,
			tracked?.item.id
		],
		enabled:
			!!tracked &&
			intermediate(tracked.item.state) &&
			!expired &&
			!disabled &&
			command.enabled,
		queryFn: async () => {
			const result = await getMailAttachment(
				context.session!.accessToken,
				context.workspace.workspaceId,
				tracked!.item.id
			)
			if (result.item.id !== tracked!.item.id)
				throw new Error('Unexpected attachment identifier')
			return result
		},
		refetchInterval: query =>
			tracked &&
			Date.now() < tracked.deadline &&
			!query.state.error &&
			intermediate(query.state.data?.item.state ?? tracked.item.state)
				? 2000
				: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		gcTime: 0,
		staleTime: 0,
		retry: false
	})
	const checked = record.isError
		? null
		: (record.data?.item ?? tracked?.item)
	useEffect(() => {
		if (!tracked || !checked || !intermediate(checked.state)) return
		const timer = setTimeout(
			() => setExpired(true),
			Math.max(0, tracked.deadline - Date.now())
		)
		return () => clearTimeout(timer)
	}, [tracked, checked])
	useEffect(() => {
		if (
			tracked &&
			command.enabled &&
			!disabled &&
			!record.isError &&
			!record.isFetching &&
			checked?.id === tracked.item.id &&
			checked.state === 'VALIDATED'
		)
			finish(checked)
	})
	useEffect(() => {
		onPendingChange(!!file || !!tracked || command.locked)
		return () => onPendingChange(false)
	}, [file, tracked, command.locked, onPendingChange])
	const upload = () => {
		if (!file || !limits || tracked) return
		setError(null)
		if (
			file.size > limits.maxFileBytes ||
			current.length >= limits.maxFiles ||
			current.reduce((sum, item) => sum + item.byteSize, file.size) >
				limits.maxSendBytes
		) {
			setError('До 10 файлов: не более 5 МБ каждый и 10 МБ суммарно.')
			return
		}
		void command.execute(build)
	}
	return (
		<div className={styles.stack}>
			<label className={styles.stack}>
				Вложение
				<input
					ref={input}
					type="file"
					accept={limits?.supportedMediaTypes.join(',')}
					disabled={disabled || command.locked || !!tracked}
					onChange={event => {
						setFile(event.target.files?.[0] ?? null)
						setError(null)
					}}
				/>
			</label>
			<p className={styles.muted}>
				PDF, DOCX, XLSX, изображения, TXT и CSV. До 5 МБ на файл, до 10 МБ
				суммарно.
			</p>
			{file ? (
				<div className={styles.actions}>
					{!tracked ? (
						<Button
							variant="secondary"
							disabled={disabled || command.locked}
							onClick={upload}
						>
							Прикрепить файл
						</Button>
					) : null}
					<Button
						variant="ghost"
						disabled={disabled || command.locked}
						onClick={() => {
							setTracked(null)
							setExpired(false)
							setFile(null)
							setError(null)
							if (input.current) input.current.value = ''
						}}
					>
						Убрать выбранный файл
					</Button>
				</div>
			) : null}
			{tracked ? (
				<>
					{record.isError ? (
						<p role="alert">
							Не удалось проверить файл. Проверьте доступ и повторите
							проверку.
						</p>
					) : checked &&
					  ['REJECTED', 'UNAVAILABLE'].includes(checked.state) ? (
						<p role="alert">
							Файл не прошёл проверку или недоступен. Уберите его и
							выберите другой файл.
						</p>
					) : expired ? (
						<p role="status">
							Проверка файла ещё не завершена. Проверьте его позже.
						</p>
					) : (
						<p role="status">Проверяется файл…</p>
					)}
					{record.isError || expired ? (
						<Button
							variant="secondary"
							disabled={disabled || !command.enabled || record.isFetching}
							onClick={() => {
								setExpired(false)
								setTracked({ ...tracked, deadline: Date.now() + 60_000 })
								void record.refetch()
							}}
						>
							Проверить файл
						</Button>
					) : null}
				</>
			) : null}
			<MailCommandNotice command={command} />
			{error ? <p role="alert">{error}</p> : null}
		</div>
	)
}

const SendStatus = ({
	id,
	accessBlocked,
	onClose
}: {
	id: string
	accessBlocked: boolean
	onClose: () => void
}) => {
	const context = useMailContext()
	const status = useQuery({
		queryKey: ['mail-send', ...context.key, id],
		enabled: !!context.session && !accessBlocked,
		queryFn: () =>
			getMailSend(
				context.session!.accessToken,
				context.workspace.workspaceId,
				id
			),
		refetchInterval: query =>
			!accessBlocked &&
			!query.state.error &&
			(!query.state.data ||
				['QUEUED', 'SENDING'].includes(query.state.data.item.state))
				? 2000
				: false,
		gcTime: 0,
		retry: false
	})
	if (accessBlocked)
		return (
			<div className={styles.stack}>
				<p role="status">
					Письмо уже поставлено в очередь. Проверка статуса приостановлена
					до подтверждения доступа.
				</p>
				<Button variant="secondary" onClick={onClose}>
					Закрыть
				</Button>
			</div>
		)
	return (
		<div className={styles.stack}>
			<p role="status">
				{status.isError
					? 'Не удалось проверить статус. Письмо уже поставлено в очередь.'
					: status.data
						? mailStateLabel[status.data.item.state]
						: 'Письмо поставлено в очередь…'}
			</p>
			{status.data?.item.state === 'UNKNOWN' ? (
				<p>
					Почтовый сервер мог принять письмо до потери соединения.
					Проверьте ящик и получателя перед новой отправкой.
					Автоматического повтора не будет.
				</p>
			) : null}
			{status.data?.item.state === 'PARTIAL_ACCEPTED' ? (
				<p>
					Не приняты адреса: {status.data.item.rejected.join(', ')}.
					Автоматического повтора не будет.
				</p>
			) : null}
			{status.data?.item.state === 'ACCEPTED' ? (
				<p>
					Приём сервером подтверждён. Доставка адресату зависит от
					почтового сервиса.
				</p>
			) : null}
			{status.isError ? (
				<Button variant="secondary" onClick={() => void status.refetch()}>
					Проверить статус
				</Button>
			) : null}
			<Button variant="secondary" onClick={onClose}>
				Закрыть
			</Button>
		</div>
	)
}
