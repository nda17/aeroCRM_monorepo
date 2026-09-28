'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
	listContactMail,
	listMailboxes
} from '@/entities/mail/api/mail.api'
import type { MailMessageDetail } from '@/entities/mail/model/mail.contract'
import { Button, Drawer, ScreenState } from '@/shared/ui'
import {
	isMailAccessDenied,
	useMailContext
} from '../model/use-mail-context'
import { MailComposer, mailStateLabel } from './MailComposer'
import { MailMessageReader } from './MailMessageReader'
import styles from './Mail.module.scss'

export const CustomerMailPanel = ({
	contactId,
	email
}: {
	contactId: string
	email: string | null
}) => {
	const context = useMailContext()
	const client = useQueryClient()
	const [cursor, setCursor] = useState<string | undefined>()
	const [selected, setSelected] = useState<string | null>(null)
	const [compose, setCompose] = useState<{
		reply?: MailMessageDetail
	} | null>(null)
	const readable =
		context.capabilities.data?.enabled === true &&
		context.capabilities.data.mailPermissions.includes('mail:read')
	const mailboxes = useQuery({
		queryKey: ['mail-mailboxes', ...context.key],
		enabled: readable && !!context.session,
		queryFn: () =>
			listMailboxes(
				context.session!.accessToken,
				context.workspace.workspaceId
			),
		gcTime: 0,
		retry: false
	})
	const messages = useQuery({
		queryKey: ['mail-contact-messages', ...context.key, contactId, cursor],
		enabled: readable && !!context.session,
		queryFn: () =>
			listContactMail(
				context.session!.accessToken,
				context.workspace.workspaceId,
				contactId,
				cursor
			),
		gcTime: 0,
		retry: false,
		refetchInterval: query =>
			!query.state.error &&
			query.state.data?.items.some(
				item => item.state === 'QUEUED' || item.state === 'SENDING'
			)
				? 3000
				: false
	})
	const senders =
		mailboxes.isError ||
		!context.capabilities.data?.mailPermissions.includes('mail:send')
			? []
			: (mailboxes.data?.items.filter(
					item =>
						item.state === 'ACTIVE' && item.permissions.includes('send')
				) ?? [])
	const refresh = () => {
		void client.invalidateQueries({
			queryKey: ['mail-contact-messages', context.workspace.workspaceId]
		})
	}
	if (context.capabilities.isPending)
		return <p role="status">Проверяем доступ к переписке…</p>
	if (
		context.capabilities.isError &&
		(!context.capabilities.data ||
			isMailAccessDenied(context.capabilities.error))
	)
		return (
			<ScreenState
				compact
				variant="error"
				title="Не удалось проверить доступ к переписке"
				action={
					<Button onClick={() => void context.capabilities.refetch()}>
						Повторить
					</Button>
				}
			/>
		)
	if (
		!readable ||
		isMailAccessDenied(messages.error) ||
		isMailAccessDenied(mailboxes.error)
	)
		return null
	return (
		<section className={styles.panel} aria-label="Переписка с клиентом">
			<div className={styles.row}>
				<h2 className={styles.title}>Переписка</h2>
				<div className={styles.actions}>
					{senders.length ? (
						<Button onClick={() => setCompose({})}>Написать письмо</Button>
					) : null}
					<Button
						variant="secondary"
						disabled={messages.isFetching}
						onClick={refresh}
					>
						Обновить
					</Button>
				</div>
			</div>
			{messages.isError || !messages.data ? (
				<ScreenState
					compact
					variant={messages.isError ? 'error' : 'loading'}
					title={
						messages.isError
							? 'Переписка недоступна'
							: 'Загружаем переписку…'
					}
					action={
						messages.isError ? (
							<Button onClick={() => void messages.refetch()}>
								Повторить
							</Button>
						) : undefined
					}
				/>
			) : (
				<>
					{!messages.data.items.length ? (
						<p className={styles.muted}>
							Переписки пока нет. Подключённые ящики настраиваются в
							разделе «Настройки → Почта».
						</p>
					) : (
						<ul className={styles.list}>
							{messages.data.items.map(message => (
								<li className={styles.item} key={message.id}>
									<div className={styles.row}>
										<span>
											{message.direction === 'INBOUND'
												? 'Входящее'
												: 'Исходящее'}{' '}
											·{' '}
											{new Date(
												message.sentAt ?? message.receivedAt
											).toLocaleString('ru-RU')}
										</span>
										{message.state ? (
											<span>{mailStateLabel[message.state]}</span>
										) : null}
									</div>
									<Button
										variant="ghost"
										onClick={() => setSelected(message.id)}
									>
										{message.subject || 'Без темы'}
									</Button>
									<div className={styles.muted}>
										{(message.direction === 'INBOUND'
											? message.from
											: message.to
										)
											.map(address => address.email)
											.join(', ')}
										{message.attachmentCount
											? ` · Вложений: ${message.attachmentCount}`
											: ''}
									</div>
								</li>
							))}
						</ul>
					)}
					<div className={styles.actions}>
						{cursor ? (
							<Button
								variant="secondary"
								onClick={() => setCursor(undefined)}
							>
								К началу
							</Button>
						) : null}
						{messages.data.nextCursor ? (
							<Button
								variant="secondary"
								onClick={() => setCursor(messages.data!.nextCursor!)}
							>
								Далее
							</Button>
						) : null}
					</div>
				</>
			)}
			{selected ? (
				<Drawer isOpen title="Письмо" onClose={() => setSelected(null)}>
					<MailMessageReader
						id={selected}
						onReply={
							senders.some(
								mailbox =>
									mailbox.id ===
									messages.data?.items.find(item => item.id === selected)
										?.mailboxId
							)
								? message => {
										if (
											senders.some(
												mailbox => mailbox.id === message.mailboxId
											)
										)
											setCompose({ reply: message })
									}
								: undefined
						}
					/>
				</Drawer>
			) : null}
			{compose ? (
				<MailComposer
					key={`${context.key.join(':')}:${contactId}:${compose.reply?.id ?? 'new'}`}
					contactId={contactId}
					email={email}
					mailboxes={senders}
					reply={compose.reply}
					onClose={() => {
						setCompose(null)
						refresh()
					}}
					onQueued={refresh}
				/>
			) : null}
		</section>
	)
}
