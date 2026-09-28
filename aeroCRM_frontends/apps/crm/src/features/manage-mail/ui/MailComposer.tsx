'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
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
import {
	Button,
	Drawer,
	SelectField,
	TextField,
	TextareaField
} from '@/shared/ui'
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
	onClose,
	onQueued
}: {
	contactId: string
	email: string | null
	mailboxes: MailMailbox[]
	reply?: MailMessageDetail
	onClose: () => void
	onQueued: () => void
}) => {
	const context = useMailContext()
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
	const [attachments, setAttachments] = useState<MailAttachment[]>([])
	const [sendId, setSendId] = useState<string | null>(null)
	const [attachmentPending, setAttachmentPending] = useState(false)
	const [validation, setValidation] = useState<string | null>(null)
	const [initial] = useState({ to, subject, mailboxId })
	const form = useDirtyForm({
		dirty:
			!sendId &&
			(!!text ||
				!!cc ||
				!!bcc ||
				!!attachments.length ||
				to !== initial.to ||
				subject !== initial.subject ||
				mailboxId !== initial.mailboxId),
		label: 'Письмо клиенту'
	})
	const command = useMailCommand(
		context,
		`mail-compose:${contactId}:${reply?.id ?? 'new'}`,
		'mail:send',
		(token, data: MailSendCommand) =>
			mailCommand(token, '/send', data, parseMailSendResult),
		result => {
			setSendId(result.sendId)
			setText('')
			setAttachments([])
			form.markClean()
			onQueued()
		}
	)
	const build = (): MailSendCommand => ({
		...newMailCommand(context.workspace.workspaceId),
		mailboxId,
		contactId,
		to: addresses(to)!,
		cc: addresses(cc)!,
		bcc: addresses(bcc)!,
		subject,
		text,
		attachmentIds: attachments.map(item => item.id),
		replyToMessageId: reply?.id ?? null
	})
	const submit = () => {
		setValidation(null)
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
		if (new TextEncoder().encode(text).byteLength > 24 * 1024) {
			setValidation(
				'Слишком длинное письмо. Сократите текст или прикрепите его файлом.'
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
		void command.execute(build)
	}
	return (
		<Drawer
			isOpen
			title={reply ? 'Ответить клиенту' : 'Новое письмо'}
			onClose={onClose}
			dirtyFormIds={[form.id]}
		>
			{sendId ? (
				<SendStatus id={sendId} onClose={onClose} />
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
								onChange={event => setTo(event.target.value)}
								hint="Несколько адресов можно разделить запятой."
							/>
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
							<TextareaField
								label="Письмо"
								rows={10}
								maxLength={24576}
								value={text}
								onChange={event => setText(event.target.value)}
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
							key={mailboxId}
							mailboxId={mailboxId}
							contactId={contactId}
							current={attachments}
							disabled={command.locked}
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
					<MailCommandNotice command={command} />
					<Button
						type="submit"
						disabled={
							command.locked ||
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

const AttachmentUpload = ({
	mailboxId,
	contactId,
	current,
	disabled,
	onPendingChange,
	onAttached
}: {
	mailboxId: string
	contactId: string
	current: MailAttachment[]
	disabled: boolean
	onPendingChange: (pending: boolean) => void
	onAttached: (item: MailAttachment) => void
}) => {
	const context = useMailContext()
	const [file, setFile] = useState<File | null>(null)
	const [error, setError] = useState<string | null>(null)
	const input = useRef<HTMLInputElement>(null)
	const form = useDirtyForm({ dirty: !!file, label: 'Вложение письма' })
	const limits = context.capabilities.data?.attachmentLimits
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
			if (result.item.state !== 'VALIDATED') {
				setError('Файл не прошёл проверку. Выберите другой файл.')
				return
			}
			onAttached(result.item)
			setFile(null)
			if (input.current) input.current.value = ''
			form.markClean()
		}
	)
	useEffect(() => {
		onPendingChange(!!file || command.locked)
		return () => onPendingChange(false)
	}, [file, command.locked, onPendingChange])
	const upload = () => {
		if (!file || !limits) return
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
					disabled={disabled || command.locked}
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
					<Button
						variant="secondary"
						disabled={disabled || command.locked}
						onClick={upload}
					>
						Прикрепить файл
					</Button>
					<Button
						variant="ghost"
						disabled={disabled || command.locked}
						onClick={() => {
							setFile(null)
							if (input.current) input.current.value = ''
						}}
					>
						Убрать выбранный файл
					</Button>
				</div>
			) : null}
			<MailCommandNotice command={command} />
			{error ? <p role="alert">{error}</p> : null}
		</div>
	)
}

const SendStatus = ({
	id,
	onClose
}: {
	id: string
	onClose: () => void
}) => {
	const context = useMailContext()
	const status = useQuery({
		queryKey: ['mail-send', ...context.key, id],
		enabled: !!context.session,
		queryFn: () =>
			getMailSend(
				context.session!.accessToken,
				context.workspace.workspaceId,
				id
			),
		refetchInterval: query =>
			!query.state.error &&
			(!query.state.data ||
				['QUEUED', 'SENDING'].includes(query.state.data.item.state))
				? 2000
				: false,
		gcTime: 0,
		retry: false
	})
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
