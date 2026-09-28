'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listMailboxMessages } from '@/entities/mail/api/mail.api'
import type {
	MailMailbox,
	MailMessageDetail
} from '@/entities/mail/model/mail.contract'
import { useDirtyFormGuard } from '@/shared/lib/dirty-form'
import {
	Button,
	Drawer,
	PageHeader,
	ScreenState,
	SelectField
} from '@/shared/ui'
import { useMailAvailability } from '../model/use-mail-availability'
import { MailComposer, mailStateLabel } from './MailComposer'
import { MailMessageReader } from './MailMessageReader'
import styles from './Mail.module.scss'

export const MailWorkspaceScreen = () => {
	const mail = useMailAvailability()
	return (
		<MailWorkspace key={JSON.stringify(mail.context.key)} mail={mail} />
	)
}

const MailWorkspace = ({
	mail
}: {
	mail: ReturnType<typeof useMailAvailability>
}) => {
	const { context } = mail
	const client = useQueryClient()
	const guard = useDirtyFormGuard()
	const [chosenMailboxId, setChosenMailboxId] = useState<string | null>(
		null
	)
	const [folder, setFolder] = useState<'INBOX' | 'SENT'>('INBOX')
	const [cursor, setCursor] = useState<string | undefined>()
	const [headId, setHeadId] = useState<string | null>(null)
	const [selected, setSelected] = useState<string | null>(null)
	const [compose, setCompose] = useState<{
		mailbox: MailMailbox
		reply?: MailMessageDetail
	} | null>(null)
	const mailbox = chosenMailboxId
		? mail.available.find(item => item.id === chosenMailboxId)
		: mail.available[0]
	const mailboxId = mailbox?.id
	const queryKey = [
		'mail-workspace-messages',
		...context.key,
		mailboxId,
		folder
	]
	const messages = useQuery({
		queryKey: [...queryKey, cursor],
		enabled: mail.enabled && !!mailboxId,
		queryFn: () =>
			listMailboxMessages(
				context.session!.accessToken,
				context.workspace.workspaceId,
				mailboxId!,
				folder,
				cursor
			),
		gcTime: 0,
		staleTime: 0,
		retry: false,
		refetchInterval: query =>
			!mail.enabled || !mailboxId || query.state.error
				? false
				: query.state.data?.items.some(
							item => item.state === 'QUEUED' || item.state === 'SENDING'
					  )
					? 3000
					: 5000
	})
	const head = useQuery({
		queryKey: [...queryKey, undefined],
		enabled: mail.enabled && !!mailboxId && !!cursor,
		queryFn: () =>
			listMailboxMessages(
				context.session!.accessToken,
				context.workspace.workspaceId,
				mailboxId!,
				folder
			),
		gcTime: 0,
		staleTime: 0,
		retry: false,
		refetchInterval: query =>
			mail.enabled && !!mailboxId && !query.state.error ? 5000 : false
	})
	const firstId = messages.data?.items[0]?.id ?? null
	if (!cursor && !messages.isError && messages.data && headId !== firstId)
		setHeadId(firstId)
	const newMessages =
		!!cursor &&
		!head.isError &&
		!!head.data?.items[0] &&
		head.data.items[0].id !== headId
	const senders =
		mail.enabled &&
		context.workspace.canWrite &&
		!context.capabilities.isFetching &&
		context.capabilities.data?.mailPermissions.includes('mail:send')
			? mail.available.filter(
					item =>
						item.state === 'ACTIVE' && item.permissions.includes('send')
				)
			: []
	const canSend =
		!!mailboxId && senders.some(item => item.id === mailboxId)
	const refresh = async () => {
		if (!(await mail.refresh()) || !context.current()) return
		await client.invalidateQueries({ queryKey })
	}
	const resetList = () => {
		setCursor(undefined)
		setHeadId(null)
		setSelected(null)
		setCompose(null)
	}
	const replyContacts = (compose?.reply?.links ?? [])
		.filter(link => link.state === 'LINKED' && !!link.contactId)
		.map(link => ({
			id: link.contactId!,
			label: `${link.externalEmail} · ${link.contactId}`
		}))
		.filter(
			(item, index, all) =>
				all.findIndex(other => other.id === item.id) === index
		)
	const replyContactId =
		replyContacts.length === 1 ? replyContacts[0].id : null
	return (
		<div className={styles.stack}>
			<PageHeader
				title="Почта"
				description="Входящие и отправленные письма ваших рабочих ящиков."
				actions={
					mail.enabled ? (
						<div className={styles.actions}>
							<Button
								disabled={!canSend}
								onClick={() => {
									if (mailbox && canSend) setCompose({ mailbox })
								}}
							>
								Написать письмо
							</Button>
							<Button
								variant="secondary"
								disabled={mail.mailboxes.isFetching || messages.isFetching}
								onClick={() => void refresh()}
							>
								Обновить
							</Button>
						</div>
					) : undefined
				}
			/>
			{!mail.enabled ? (
				<ScreenState
					variant={
						mail.loading
							? 'loading'
							: context.capabilities.isError || mail.mailboxes.isError
								? 'error'
								: 'empty'
					}
					title={
						mail.loading ? 'Проверяем доступ к почте…' : 'Почта недоступна'
					}
					description={mail.reason}
					action={
						!mail.loading ? (
							<Button
								variant="secondary"
								onClick={() => void mail.refresh()}
							>
								Повторить проверку
							</Button>
						) : undefined
					}
				/>
			) : (
				<section className={styles.panel} aria-label="Почтовый ящик">
					<SelectField
						label="Почтовый ящик"
						value={mailboxId ?? ''}
						onChange={event => {
							const next = event.target.value
							guard.confirmDiscard(() => {
								setChosenMailboxId(next)
								resetList()
							})
						}}
					>
						{!mailboxId ? (
							<option value="">Выберите доступный ящик</option>
						) : null}
						{mail.available.map(item => (
							<option key={item.id} value={item.id}>
								{item.displayName} — {item.address}
							</option>
						))}
					</SelectField>
					{mailbox?.state === 'REAUTH_REQUIRED' ? (
						<p role="status">
							История писем доступна. Чтобы получать новые письма и
							отправлять ответы, переподключите ящик в «Настройки → Почта».
						</p>
					) : mailbox?.syncStatus === 'ERROR' ? (
						<p role="status">
							Обновление ящика завершилось ошибкой. Сохранённая переписка
							доступна; проверьте подключение в «Настройки → Почта».
						</p>
					) : mailbox?.syncStatus === 'NOT_CONFIGURED' ? (
						<p role="status">
							Для получения новых писем выберите папки в «Настройки →
							Почта».
						</p>
					) : null}
					<div className={styles.actions} aria-label="Папки почты">
						{(['INBOX', 'SENT'] as const).map(value => (
							<Button
								key={value}
								variant={folder === value ? 'primary' : 'secondary'}
								aria-pressed={folder === value}
								onClick={() =>
									guard.confirmDiscard(() => {
										setFolder(value)
										resetList()
									})
								}
							>
								{value === 'INBOX' ? 'Входящие' : 'Отправленные'}
							</Button>
						))}
					</div>
					{newMessages ? (
						<Button
							variant="secondary"
							onClick={() => setCursor(undefined)}
						>
							Есть новые письма · К началу
						</Button>
					) : null}
					{!mailboxId ? (
						<p className={styles.muted}>
							Выбранный ящик больше недоступен. Выберите другой доступный
							ящик.
						</p>
					) : messages.isError || !messages.data ? (
						<ScreenState
							compact
							variant={messages.isError ? 'error' : 'loading'}
							title={
								messages.isError
									? 'Не удалось загрузить письма'
									: 'Загружаем письма…'
							}
							action={
								messages.isError ? (
									<Button onClick={() => void refresh()}>Повторить</Button>
								) : undefined
							}
						/>
					) : (
						<>
							{!messages.data.items.length ? (
								<p className={styles.muted}>
									{folder === 'INBOX'
										? 'Входящих писем пока нет.'
										: 'Отправленных писем пока нет.'}
								</p>
							) : (
								<ul
									className={styles.list}
									aria-label={
										folder === 'INBOX'
											? 'Входящие письма'
											: 'Отправленные письма'
									}
								>
									{messages.data.items.map(message => (
										<li className={styles.item} key={message.id}>
											<div className={styles.row}>
												<span>
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
				</section>
			)}
			{mail.enabled && mailboxId && selected ? (
				<Drawer isOpen title="Письмо" onClose={() => setSelected(null)}>
					<MailMessageReader
						key={`${mailboxId}:${selected}`}
						id={selected}
						expectedMailboxId={mailboxId}
						replyMailboxIds={senders.map(item => item.id)}
						onReply={
							canSend && mailbox
								? message => setCompose({ mailbox, reply: message })
								: undefined
						}
					/>
				</Drawer>
			) : null}
			{compose ? (
				<MailComposer
					key={`${context.key.join(':')}:${compose.mailbox.id}:${compose.reply?.id ?? 'new'}`}
					contactId={replyContactId}
					email={null}
					mailboxes={[compose.mailbox]}
					accessBlocked={
						!mail.enabled ||
						mail.mailboxes.isFetching ||
						!senders.some(item => item.id === compose.mailbox.id)
					}
					onRecheckAccess={() => void mail.refresh()}
					reply={compose.reply}
					replyContacts={replyContacts}
					onClose={() => {
						setCompose(null)
						void refresh()
					}}
					onQueued={() => void refresh()}
				/>
			) : null}
		</div>
	)
}
