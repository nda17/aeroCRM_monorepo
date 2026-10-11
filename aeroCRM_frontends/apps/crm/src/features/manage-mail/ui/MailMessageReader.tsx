'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Button, ScreenState } from '@/shared/ui'
import { invalidContractError } from '@/shared/api/authenticated-http-client'
import {
	getRichMailMessage,
	getUnmatchedMailMessage,
	getMailAttachment,
	getMailProcessing,
	mailCommand,
	downloadMailAttachment
} from '@/entities/mail/api/mail.api'
import {
	parseMailAttachmentResult,
	type MailAttachment,
	type MailMessageDetail
} from '@/entities/mail/model/mail.contract'
import {
	newMailCommand,
	useMailCommand,
	useMailContext
} from '../model/use-mail-context'
import { MailCommandNotice } from './MailCommandNotice'
import { MailRichText } from './MailRichText'
import { MailIntakeCopyControl } from './MailIntakeCopyControl'
import { getMailIntakeProcessing } from '@/entities/intake/api/processing.api'
import { useIntakeAccess } from '@/features/manage-intake/model/use-intake-access'
import { useEmployeeNames } from '@/features/workspace-collaboration/model/use-employee-names'
import { mailStateLabel } from './MailComposer'
import styles from './Mail.module.scss'

export const MailMessageReader = ({
	id,
	unmatchedMailboxId,
	contactId,
	expectedMailboxId,
	replyMailboxIds,
	onReply
}: {
	id: string
	contactId?: string
	expectedMailboxId?: string
	replyMailboxIds?: readonly string[]
	unmatchedMailboxId?: string
	onReply?: (message: MailMessageDetail) => void
}) => {
	const context = useMailContext()
	const message = useQuery({
		queryKey: [
			unmatchedMailboxId ? 'mail-unmatched-message' : 'mail-message',
			...context.key,
			id,
			contactId,
			expectedMailboxId,
			unmatchedMailboxId ? 'plain' : 'html'
		],
		enabled:
			!!context.session &&
			!context.capabilities.isError &&
			context.capabilities.data?.enabled === true &&
			context.capabilities.data.mailPermissions.includes('mail:read'),
		queryFn: async () => {
			const result = await (unmatchedMailboxId
				? getUnmatchedMailMessage(
						context.session!.accessToken,
						context.workspace.workspaceId,
						unmatchedMailboxId,
						id
					)
				: getRichMailMessage(
						context.session!.accessToken,
						context.workspace.workspaceId,
						id
					))
			if (
				result.item.id !== id ||
				(expectedMailboxId && result.item.mailboxId !== expectedMailboxId)
			)
				throw invalidContractError()
			return result
		},
		gcTime: 0,
		staleTime: 0,
		retry: false,
		refetchInterval: query =>
			!query.state.error && !context.capabilities.isError ? 5000 : false
	})
	const readable =
		!context.capabilities.isError &&
		context.capabilities.data?.enabled === true &&
		context.capabilities.data.mailPermissions.includes('mail:read')
	const linked =
		!contactId ||
		message.data?.item.links.some(
			link => link.state === 'LINKED' && link.contactId === contactId
		)
	const refresh = async () => {
		const fresh = await context.capabilities.refetch()
		if (
			!context.current() ||
			fresh.isError ||
			!fresh.data?.enabled ||
			!fresh.data.mailPermissions.includes('mail:read')
		)
			return
		await message.refetch()
	}
	if (!readable || message.isError || !message.data || !linked)
		return (
			<ScreenState
				compact
				variant={
					message.isError || !readable || !linked ? 'error' : 'loading'
				}
				title={
					message.isError || !readable || !linked
						? 'Письмо недоступно'
						: 'Загружаем письмо…'
				}
				action={
					message.isError || !readable || !linked ? (
						<Button onClick={() => void refresh()}>Повторить</Button>
					) : undefined
				}
			/>
		)
	const item = message.data.item
	return (
		<article className={styles.stack}>
			<h3 className={styles.title}>{item.subject || 'Без темы'}</h3>
			<div className={styles.muted}>
				От:{' '}
				{item.from
					.map(address =>
						address.name
							? `${address.name} <${address.email}>`
							: address.email
					)
					.join(', ')}
				<br />
				Кому: {item.to.map(address => address.email).join(', ')}
				{item.cc.length ? (
					<>
						<br />
						Копия: {item.cc.map(address => address.email).join(', ')}
					</>
				) : null}
			</div>
			{item.bodyStatus !== 'COMPLETE' ? (
				<p role="status">
					{item.bodyStatus === 'TOO_LARGE'
						? 'Текст письма превышает допустимый размер. Полную версию можно открыть в почтовом клиенте.'
						: 'Текст письма недоступен.'}
				</p>
			) : null}
			{'html' in item &&
			typeof item.html === 'string' &&
			item.sourceKind === 'CRM_SEND' ? (
				<MailRichText html={item.html} text={item.text} />
			) : item.text ? (
				<div className={styles.text}>{item.text}</div>
			) : item.bodyStatus === 'COMPLETE' ? (
				<p className={styles.muted}>В письме нет текста.</p>
			) : null}
			{item.attachments.length ? (
				<ul className={styles.list} aria-label="Вложения">
					{item.attachments.map(attachment => (
						<li className={styles.item} key={attachment.id}>
							{unmatchedMailboxId ? (
								<div>
									{attachment.fileName}
									<p className={styles.muted}>
										Для скачивания привяжите письмо к контакту.
									</p>
								</div>
							) : (
								<AttachmentDownload
									key={`${context.key.join(':')}:${attachment.id}`}
									attachment={attachment}
									messageId={item.id}
								/>
							)}
						</li>
					))}
				</ul>
			) : null}
			{item.direction === 'INBOUND' && item.sourceKind === 'IMAP' ? (
				<MailIntakeCopyControl messageId={item.id} />
			) : null}
			<MailProcessingHistory
				messageId={item.id}
				showIntake={
					item.direction === 'INBOUND' && item.sourceKind === 'IMAP'
				}
			/>
			{onReply &&
			(!replyMailboxIds || replyMailboxIds.includes(item.mailboxId)) ? (
				<Button variant="secondary" onClick={() => onReply(item)}>
					Ответить
				</Button>
			) : null}
		</article>
	)
}

const MailProcessingHistory = ({
	messageId,
	showIntake
}: {
	messageId: string
	showIntake: boolean
}) => {
	const context = useMailContext()
	const intake = useIntakeAccess()
	const canRead =
		!!context.session &&
		!context.capabilities.isError &&
		context.capabilities.data?.enabled === true &&
		context.capabilities.data.mailPermissions.includes('mail:read')
	const employeeName = useEmployeeNames({
		workspaceId: context.workspace.workspaceId,
		session: context.session,
		revision: context.sessionRevision,
		scopeKey: JSON.stringify(
			context.capabilities.data?.mailPermissions ?? []
		),
		canRead
	})
	const replies = useQuery({
		queryKey: ['mail-processing', ...context.key, messageId],
		enabled: canRead,
		queryFn: () =>
			getMailProcessing(
				context.session!.accessToken,
				context.workspace.workspaceId,
				messageId
			),
		gcTime: 0,
		staleTime: 0,
		retry: false,
		refetchInterval: query =>
			!query.state.error && canRead ? 5000 : false
	})
	const copy = useQuery({
		queryKey: [
			'crm-intake-mail-processing',
			...context.key,
			intake.scopeKey,
			messageId
		],
		enabled: showIntake && intake.canRead && !!intake.session && canRead,
		queryFn: () =>
			getMailIntakeProcessing(
				intake.session!.accessToken,
				intake.workspaceId,
				messageId
			),
		gcTime: 0,
		staleTime: 0,
		retry: false,
		refetchInterval: query =>
			!query.state.error && showIntake && intake.canRead ? 5000 : false
	})
	const date = (value: string) => new Date(value).toLocaleString('ru-RU')
	const pending =
		replies.isPending ||
		(showIntake &&
			!intake.permissions.isError &&
			(!intake.confirmed || (intake.canRead && copy.isPending)))
	const failed =
		replies.isError ||
		(showIntake &&
			(intake.permissions.isError || (intake.canRead && copy.isError)))
	const copied = copy.data?.copy
	const acceptanceStatus = {
		QUEUED: 'ожидает обработки',
		RUNNING: 'создаём контакт и сделку',
		RETRY_WAIT: 'ожидает повторной обработки',
		BLOCKED: 'нужна проверка доступа',
		FAILED: 'требуется внимание',
		RECOVERING: 'проверяем и останавливаем обработку',
		CANCELLED: 'обработка остановлена',
		COMPLETED: 'принято в работу'
	} as const
	return (
		<section className={styles.processing} aria-label="Обработка письма">
			<h4 className={styles.title}>История обработки</h4>
			{replies.data?.replies.length || copied ? (
				<ul className={styles.list}>
					{replies.data?.replies.map(reply => (
						<li className={styles.item} key={reply.sendId}>
							Ответ: {employeeName(reply.actorSubject)} ·{' '}
							{reply.state === 'ACCEPTED'
								? 'Ответ отправлен (принят почтовым сервером)'
								: mailStateLabel[reply.state]}
							{' · '}
							{date(
								reply.settledAt ?? reply.submittedAt ?? reply.createdAt
							)}
						</li>
					))}
					{copied ? (
						<li className={styles.item}>
							Обращение создал: {employeeName(copied.actorSubject)} ·{' '}
							{date(copied.createdAt)}
							{copied.canOpen && copied.entryId ? (
								<>
									{' · '}
									<Link
										href={`/inbox?workspaceId=${encodeURIComponent(intake.workspaceId)}&entry=${copied.entryId}`}
									>
										Открыть обращение
									</Link>
								</>
							) : null}
							{copied.acceptance ? (
								<div>
									{copied.acceptance.status === 'COMPLETED'
										? 'Принял'
										: 'Обработку начал'}
									: {employeeName(copied.acceptance.actorSubject)} ·{' '}
									{date(copied.acceptance.claimedAt)} · Статус:{' '}
									{acceptanceStatus[copied.acceptance.status]}
								</div>
							) : null}
						</li>
					) : null}
				</ul>
			) : null}
			{replies.data?.hasMore ? (
				<p className={styles.muted}>Показаны последние 100 ответов.</p>
			) : null}
			{pending ? (
				<p className={styles.muted}>Проверяем действия…</p>
			) : null}
			{showIntake && intake.confirmed && !intake.canRead ? (
				<p className={styles.muted}>
					Сведения об обращении недоступны по правам раздела «Входящие».
				</p>
			) : null}
			{failed ? (
				<div className={styles.stack} role="alert">
					<p>Не удалось загрузить все действия по письму.</p>
					<Button
						variant="secondary"
						onClick={() => {
							if (replies.isError) void replies.refetch()
							if (copy.isError) void copy.refetch()
							if (intake.permissions.isError)
								void intake.permissions.refetch()
						}}
					>
						Повторить
					</Button>
				</div>
			) : null}
			{!pending &&
			!failed &&
			(!showIntake || intake.canRead) &&
			!replies.data?.replies.length &&
			!copied ? (
				<p className={styles.muted}>Действий по письму пока нет.</p>
			) : null}
		</section>
	)
}

const AttachmentDownload = ({
	attachment,
	messageId
}: {
	attachment: MailAttachment
	messageId: string
}) => {
	const context = useMailContext()
	const [prepared, setPrepared] = useState(false)
	const [downloading, setDownloading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const abort = useRef<AbortController | null>(null)
	useEffect(() => () => abort.current?.abort(), [])
	const record = useQuery({
		queryKey: ['mail-attachment', ...context.key, attachment.id],
		enabled: prepared && !!context.session,
		queryFn: () =>
			getMailAttachment(
				context.session!.accessToken,
				context.workspace.workspaceId,
				attachment.id
			),
		refetchInterval: query =>
			['DEFERRED', 'QUARANTINED', 'UPLOADING'].includes(
				query.state.data?.item.state ?? ''
			)
				? 2000
				: false,
		gcTime: 0,
		staleTime: 0,
		retry: false
	})
	const current = record.data?.item ?? attachment
	const build = () => ({
		...newMailCommand(context.workspace.workspaceId),
		messageId
	})
	const command = useMailCommand(
		context,
		`mail-prepare:${attachment.id}`,
		'mail:read',
		(token, data: ReturnType<typeof build>) =>
			mailCommand(
				token,
				`/attachments/${attachment.id}/prepare`,
				data,
				parseMailAttachmentResult
			),
		() => {
			setPrepared(true)
			void record.refetch()
		}
	)
	const download = async () => {
		if (!context.session || downloading) return
		setDownloading(true)
		setError(null)
		const controller = new AbortController()
		abort.current = controller
		try {
			if (!current.sha256) throw new Error('Файл ещё не подготовлен.')
			const blob = await downloadMailAttachment(
				context.session.accessToken,
				context.workspace.workspaceId,
				{ ...current, sha256: current.sha256 },
				controller.signal
			)
			if (controller.signal.aborted) return
			const url = URL.createObjectURL(blob)
			const anchor = document.createElement('a')
			anchor.href = url
			anchor.download = current.fileName
			anchor.click()
			setTimeout(() => URL.revokeObjectURL(url), 1000)
		} catch {
			if (!controller.signal.aborted)
				setError(
					'Не удалось получить файл. Проверьте доступ и повторите попытку.'
				)
		} finally {
			if (!controller.signal.aborted) setDownloading(false)
		}
	}
	return (
		<div className={styles.stack}>
			<div>
				{current.fileName}{' '}
				<span className={styles.muted}>
					({Math.ceil(current.byteSize / 1024)} КБ)
				</span>
			</div>
			{current.state === 'VALIDATED' ? (
				<Button
					variant="secondary"
					disabled={downloading || record.isError}
					onClick={() => void download()}
				>
					{downloading ? 'Скачиваем…' : 'Скачать'}
				</Button>
			) : ['REJECTED', 'UNAVAILABLE'].includes(current.state) ? (
				<p role="status">
					Файл недоступен: формат, размер или источник не прошли проверку.
				</p>
			) : prepared ? (
				<p role="status">Файл подготавливается…</p>
			) : (
				<Button
					variant="secondary"
					disabled={command.locked}
					onClick={() => void command.execute(build)}
				>
					Подготовить для скачивания
				</Button>
			)}
			<MailCommandNotice command={command} />
			{error ? <p role="alert">{error}</p> : null}
			{record.isError ? (
				<Button variant="secondary" onClick={() => void record.refetch()}>
					Повторить проверку файла
				</Button>
			) : null}
		</div>
	)
}
