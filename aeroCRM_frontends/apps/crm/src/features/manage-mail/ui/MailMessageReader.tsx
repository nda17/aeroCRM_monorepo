'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, ScreenState } from '@/shared/ui'
import {
	getMailMessage,
	getUnmatchedMailMessage,
	getMailAttachment,
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
import styles from './Mail.module.scss'

export const MailMessageReader = ({
	id,
	unmatchedMailboxId,
	onReply
}: {
	id: string
	unmatchedMailboxId?: string
	onReply?: (message: MailMessageDetail) => void
}) => {
	const context = useMailContext()
	const message = useQuery({
		queryKey: [
			unmatchedMailboxId ? 'mail-unmatched-message' : 'mail-message',
			...context.key,
			id
		],
		enabled: !!context.session,
		queryFn: () =>
			unmatchedMailboxId
				? getUnmatchedMailMessage(
						context.session!.accessToken,
						context.workspace.workspaceId,
						unmatchedMailboxId,
						id
					)
				: getMailMessage(
						context.session!.accessToken,
						context.workspace.workspaceId,
						id
					),
		gcTime: 0,
		staleTime: 0,
		retry: false
	})
	if (message.isError || !message.data)
		return (
			<ScreenState
				compact
				variant={message.isError ? 'error' : 'loading'}
				title={message.isError ? 'Письмо недоступно' : 'Загружаем письмо…'}
				action={
					message.isError ? (
						<Button onClick={() => void message.refetch()}>
							Повторить
						</Button>
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
			{item.text ? (
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
			{onReply ? (
				<Button variant="secondary" onClick={() => onReply(item)}>
					Ответить
				</Button>
			) : null}
		</article>
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
