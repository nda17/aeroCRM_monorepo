'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, ScreenState } from '@/shared/ui'
import { listMailboxes, mailCommand } from '@/entities/mail/api/mail.api'
import {
	parseMailMailboxResult,
	type MailMailbox
} from '@/entities/mail/model/mail.contract'
import { ConnectMailbox } from './ConnectMailbox'
import { MailboxFolders } from './MailboxFolders'
import { MailboxGrants } from './MailboxGrants'
import { UnmatchedMail } from './UnmatchedMail'
import { MailCommandNotice } from './MailCommandNotice'
import {
	newMailCommand,
	isMailAccessDenied,
	useMailCommand,
	useMailContext
} from '../model/use-mail-context'
import styles from './Mail.module.scss'

export const MailSettings = () => {
	const context = useMailContext()
	const client = useQueryClient()
	const [connecting, setConnecting] = useState(false)
	const [selected, setSelected] = useState<{
		mailbox: MailMailbox
		tab: 'folders' | 'grants' | 'unmatched' | 'connection'
	} | null>(null)
	const mailboxes = useQuery({
		queryKey: ['mail-mailboxes', ...context.key],
		enabled:
			!!context.session && context.capabilities.data?.enabled === true,
		queryFn: () =>
			listMailboxes(
				context.session!.accessToken,
				context.workspace.workspaceId
			),
		gcTime: 0,
		staleTime: 0,
		retry: false
	})
	const refresh = () => {
		void client.invalidateQueries({
			queryKey: ['mail-mailboxes', context.workspace.workspaceId]
		})
	}
	const choose = (
		mailbox: MailMailbox,
		tab: 'folders' | 'grants' | 'unmatched' | 'connection'
	) => setSelected({ mailbox, tab })
	const capabilities = context.capabilities.data
	const denied =
		isMailAccessDenied(context.capabilities.error) ||
		isMailAccessDenied(mailboxes.error)
	return (
		<section id="mail" className={styles.panel} aria-label="Почта">
			<h2 className={styles.title}>Почта</h2>
			<p className={styles.muted}>
				Подключите рабочий ящик по IMAP/SMTP, чтобы видеть переписку в
				карточках клиентов и отвечать из CRM.
			</p>
			{context.capabilities.isPending ? (
				<p role="status">Проверяем доступ к почте…</p>
			) : context.capabilities.isError ? (
				<ScreenState
					variant="error"
					compact
					title="Не удалось проверить доступ к почте"
					action={
						<Button
							variant="secondary"
							onClick={() => void context.capabilities.refetch()}
						>
							Повторить
						</Button>
					}
				/>
			) : !capabilities?.enabled ? (
				<p>Подключение почты пока недоступно в этом пространстве.</p>
			) : (
				<>
					<div className={styles.actions}>
						{capabilities.connectionAvailable &&
						(capabilities.canCreatePersonal ||
							capabilities.canCreateShared) ? (
							<Button onClick={() => setConnecting(true)}>
								Подключить ящик
							</Button>
						) : null}
						<Button
							variant="secondary"
							onClick={refresh}
							disabled={mailboxes.isFetching}
						>
							Обновить
						</Button>
					</div>
					{mailboxes.isError ? (
						<ScreenState
							compact
							variant="error"
							title="Не удалось загрузить ящики"
						/>
					) : mailboxes.isPending ? (
						<p role="status">Загружаем ящики…</p>
					) : !mailboxes.data?.items.length ? (
						<p>Пока нет подключённых ящиков.</p>
					) : (
						<ul className={styles.list}>
							{mailboxes.data.items.map(mailbox => (
								<li key={mailbox.id} className={styles.item}>
									<div className={styles.row}>
										<div>
											<strong>{mailbox.displayName}</strong>
											<div>{mailbox.address}</div>
											<span className={styles.muted}>
												{mailbox.kind === 'PERSONAL'
													? 'Личный рабочий ящик'
													: 'Общий ящик'}
											</span>
										</div>
										<div>
											{mailbox.state === 'DISCONNECTED'
												? 'Отключён'
												: mailbox.state === 'REAUTH_REQUIRED'
													? 'Нужно переподключить'
													: mailbox.syncStatus === 'ERROR'
														? 'Ошибка синхронизации'
														: mailbox.syncStatus === 'SYNCING' ||
															  mailbox.syncStatus === 'BACKFILL'
															? 'Загружается история'
															: mailbox.syncStatus === 'NOT_CONFIGURED'
																? 'Выберите папки для импорта'
																: 'Подключён'}
											{mailbox.lastSyncAt ? (
												<div className={styles.muted}>
													Обновлён:{' '}
													{new Date(mailbox.lastSyncAt).toLocaleString(
														'ru-RU'
													)}
												</div>
											) : null}
										</div>
									</div>
									<div className={styles.actions}>
										{mailbox.permissions.includes('manage') &&
										capabilities.connectionAvailable ? (
											<Button
												variant="secondary"
												onClick={() => choose(mailbox, 'connection')}
											>
												Переподключить
											</Button>
										) : null}
										{mailbox.permissions.includes('manage') &&
										mailbox.state !== 'DISCONNECTED' ? (
											<Button
												variant="secondary"
												onClick={() => choose(mailbox, 'folders')}
											>
												Папки и импорт
											</Button>
										) : null}
										{mailbox.kind === 'SHARED' &&
										mailbox.permissions.includes('manage') ? (
											<Button
												variant="secondary"
												onClick={() => choose(mailbox, 'grants')}
											>
												Доступ сотрудников
											</Button>
										) : null}
										{mailbox.permissions.includes('read') ? (
											<Button
												variant="secondary"
												onClick={() => choose(mailbox, 'unmatched')}
											>
												Непривязанные письма
											</Button>
										) : null}
										{mailbox.permissions.includes('manage') &&
										mailbox.state !== 'DISCONNECTED' ? (
											<DisconnectMailbox
												key={`${mailbox.id}:${mailbox.version}`}
												mailbox={mailbox}
												onDone={refresh}
											/>
										) : null}
									</div>
								</li>
							))}
						</ul>
					)}
				</>
			)}
			{connecting && !denied ? (
				<ConnectMailbox
					key={context.key.join(':')}
					onClose={() => setConnecting(false)}
					onConnected={mailbox => {
						setConnecting(false)
						choose(mailbox, 'folders')
						refresh()
					}}
				/>
			) : null}
			{selected?.tab === 'connection' && !denied ? (
				<ConnectMailbox
					key={`${context.key.join(':')}:${selected.mailbox.id}`}
					mailbox={selected.mailbox}
					onClose={() => setSelected(null)}
					onConnected={mailbox => {
						setSelected({ mailbox, tab: 'folders' })
						refresh()
					}}
				/>
			) : null}
			{selected?.tab === 'folders' && !denied ? (
				<MailboxFolders
					key={`${context.key.join(':')}:${selected.mailbox.id}`}
					mailbox={selected.mailbox}
					onClose={() => setSelected(null)}
					onSaved={() => {
						setSelected(null)
						refresh()
					}}
				/>
			) : null}
			{selected?.tab === 'grants' && !denied ? (
				<MailboxGrants
					key={`${context.key.join(':')}:${selected.mailbox.id}`}
					mailbox={selected.mailbox}
					onClose={() => setSelected(null)}
					onSaved={() => {
						setSelected(null)
						refresh()
					}}
				/>
			) : null}
			{selected?.tab === 'unmatched' && !denied ? (
				<UnmatchedMail
					key={`${context.key.join(':')}:${selected.mailbox.id}`}
					mailbox={selected.mailbox}
					onClose={() => setSelected(null)}
				/>
			) : null}
		</section>
	)
}

const DisconnectMailbox = ({
	mailbox,
	onDone
}: {
	mailbox: MailMailbox
	onDone: () => void
}) => {
	const context = useMailContext()
	const [confirming, setConfirming] = useState(false)
	const build = () => ({
		...newMailCommand(context.workspace.workspaceId),
		expectedVersion: mailbox.version
	})
	const command = useMailCommand(
		context,
		`mail-disconnect:${mailbox.id}`,
		'mail:manage',
		(token, data: ReturnType<typeof build>) =>
			mailCommand(
				token,
				`/mailboxes/${mailbox.id}/disconnect`,
				data,
				parseMailMailboxResult
			),
		() => {
			setConfirming(false)
			onDone()
		}
	)
	return (
		<div>
			{confirming ? (
				<>
					<p>
						Остановить новые синхронизации и отправки? История сохранится.
						Уже начатая отправка может завершиться.
					</p>
					<div className={styles.actions}>
						<Button
							variant="danger"
							disabled={command.locked}
							onClick={() => void command.execute(build)}
						>
							Отключить ящик
						</Button>
						<Button
							variant="secondary"
							disabled={command.locked}
							onClick={() => setConfirming(false)}
						>
							Отмена
						</Button>
					</div>
				</>
			) : (
				<Button variant="secondary" onClick={() => setConfirming(true)}>
					Отключить
				</Button>
			)}
			<MailCommandNotice command={command} />
		</div>
	)
}
