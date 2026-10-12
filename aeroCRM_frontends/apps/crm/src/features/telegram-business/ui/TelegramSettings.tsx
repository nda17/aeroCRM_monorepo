'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkspaceBranding } from '@/entities/crm-workspace-branding'
import {
	cancelTelegramConnectSession,
	confirmTelegramConnectSession,
	createTelegramConnectSession,
	disconnectTelegramChannel,
	getTelegramConnectSession,
	listTelegramChannels,
	type TelegramChannel,
	type TelegramConnectSession
} from '@/entities/telegram-business'
import { invalidContractError } from '@/shared/api/authenticated-http-client'
import { Button, ScreenState } from '@/shared/ui'
import {
	useCollaboration,
	useCollaborationCommand,
	type CollaborationContext
} from '@/features/workspace-collaboration/model/use-collaboration'
import { CommandNotice } from '@/features/workspace-collaboration/ui/CommandNotice'
import styles from './TelegramSettings.module.scss'

export function TelegramSettings() {
	const context = useCollaboration()
	return (
		<TelegramSettingsContent key={context.identity} context={context} />
	)
}

function TelegramSettingsContent({
	context
}: {
	context: CollaborationContext
}) {
	const client = useQueryClient()
	const branding = useWorkspaceBranding()
	const workspaceName =
		branding.data?.branding.displayName ??
		`Рабочее пространство ${context.binding.workspaceId.slice(-6)}`
	const [sessionId, setSessionId] = useState<string | null>(null)
	const [disconnecting, setDisconnecting] =
		useState<TelegramChannel | null>(null)
	const [acceptedAccount, setAcceptedAccount] = useState<string | null>(
		null
	)
	const channels = useQuery({
		queryKey: ['telegram-channels', ...context.key],
		enabled: context.ready,
		queryFn: async () => {
			const result = await listTelegramChannels(
				context.session!.accessToken,
				context.binding
			)
			if (!context.current()) throw invalidContractError()
			return result
		},
		retry: false,
		gcTime: 0,
		refetchInterval: 15000
	})
	const connection = useQuery({
		queryKey: ['telegram-connect-session', ...context.key, sessionId],
		enabled: context.ready && !!sessionId,
		queryFn: async () => {
			const result = await getTelegramConnectSession(
				context.session!.accessToken,
				{
					...context.binding,
					connectSessionId: sessionId!
				}
			)
			if (!context.current()) throw invalidContractError()
			return result
		},
		retry: false,
		gcTime: 0,
		refetchInterval: query =>
			query.state.data &&
			['CONNECTED', 'EXPIRED', 'CANCELLED'].includes(
				query.state.data.item.state
			)
				? false
				: 3000
	})
	const item = connection.data?.item
	const refresh = () => {
		void client.invalidateQueries({
			queryKey: ['telegram-channels', ...context.key]
		})
		void client.invalidateQueries({
			queryKey: ['telegram-connect-session', ...context.key]
		})
	}
	const saveSession = (result: { item: TelegramConnectSession }) => {
		setSessionId(result.item.id)
		client.setQueryData(
			['telegram-connect-session', ...context.key, result.item.id],
			result
		)
		refresh()
	}
	const create = useCollaborationCommand(
		context,
		'telegram:connect',
		createTelegramConnectSession,
		result => {
			setAcceptedAccount(null)
			saveSession(result)
		}
	)
	const confirm = useCollaborationCommand(
		context,
		'telegram:confirm',
		confirmTelegramConnectSession,
		saveSession
	)
	const cancel = useCollaborationCommand(
		context,
		'telegram:cancel',
		cancelTelegramConnectSession,
		saveSession
	)
	const disconnect = useCollaborationCommand(
		context,
		'telegram:disconnect',
		disconnectTelegramChannel,
		() => {
			setDisconnecting(null)
			refresh()
		}
	)
	const acceptanceKey = `${item?.id}:${item?.owner?.id}`
	const accepted = acceptedAccount === acceptanceKey
	useEffect(() => {
		if (item?.state === 'CONNECTED')
			void client.invalidateQueries({ queryKey: ['telegram-channels'] })
	}, [item?.state, client])
	const canManage = context.canWrite && channels.data?.canManage
	const busy =
		create.locked || confirm.locked || cancel.locked || disconnect.locked
	const activeSession =
		!!item && !['CONNECTED', 'EXPIRED', 'CANCELLED'].includes(item.state)
	const start = (channelId?: string) => {
		confirm.reset()
		cancel.reset()
		void create.execute(() => ({
			...context.binding,
			commandId: crypto.randomUUID(),
			...(channelId ? { channelId } : {})
		}))
	}
	return (
		<section
			id="telegram"
			className={styles.panel}
			aria-label="Telegram в Мессенджере"
		>
			<div>
				<h2>Telegram в Мессенджере</h2>
				<p>
					Клиенты пишут в личные сообщения рабочего аккаунта Telegram.
					Переписка появляется в общем чате CRM, и сотрудники отвечают
					оттуда.
				</p>
			</div>
			<p>
				<strong>{workspaceName}</strong> · Все активные сотрудники видят
				переписку и могут отвечать. Имя ответившего сохраняется в CRM.
				Заявки автоматически не создаются.
			</p>
			{channels.isError || context.permissions.isError ? (
				<ScreenState
					compact
					variant="error"
					title="Не удалось проверить подключение Telegram"
					action={
						<Button
							onClick={async () => {
								await context.permissions.refetch()
								if (context.current()) await channels.refetch()
							}}
						>
							Повторить
						</Button>
					}
				/>
			) : !channels.data ? (
				<p role="status">Проверяем подключение…</p>
			) : !channels.data.configured ? (
				<p role="status">
					Подключение Telegram пока недоступно. Здесь появится мастер
					подключения, когда сервис будет готов.
				</p>
			) : (
				<>
					{!channels.data.canManage ? (
						<p>
							Подключить или отключить аккаунт может владелец или
							администратор пространства.
						</p>
					) : null}
					{channels.data.items.map(channel => (
						<div className={styles.channel} key={channel.id}>
							<strong>
								{channel.account.displayName}
								{channel.account.username
									? ` · @${channel.account.username}`
									: ''}
							</strong>
							<p>
								{channel.status === 'ACTIVE'
									? channel.canReply
										? 'Подключён · ответы разрешены'
										: 'Подключён · в Telegram нужно разрешить ответы'
									: channel.status === 'DISCONNECTED'
										? 'Отключён в CRM'
										: channel.status === 'REVOKED'
											? 'Доступ отозван в Telegram'
											: 'Подключение требует проверки'}
							</p>
							{channel.status === 'ACTIVE' ? (
								<p className={styles.hint}>
									{channel.lastInboundAt && channel.lastOutboundAt
										? 'Обмен проверен: входящее сообщение получено, ответ из CRM отправлен.'
										: channel.lastInboundAt
											? 'Входящее сообщение получено. Ответьте на него в общем чате, чтобы проверить отправку.'
											: 'Проверка обмена: попросите написать с другого аккаунта в разрешённый чат, затем ответьте из Мессенджера.'}
								</p>
							) : null}
							{canManage ? (
								<div className={styles.actions}>
									<Button
										variant="secondary"
										disabled={busy || activeSession}
										onClick={() => start(channel.id)}
									>
										Переподключить
									</Button>
									{channel.status !== 'DISCONNECTED' ? (
										<Button
											variant="ghost"
											disabled={busy || activeSession}
											onClick={() => setDisconnecting(channel)}
										>
											Отключить
										</Button>
									) : null}
								</div>
							) : null}
						</div>
					))}
					{canManage && !activeSession ? (
						<Button disabled={busy} onClick={() => start()}>
							Подключить рабочий Telegram
						</Button>
					) : null}
					{sessionId && connection.isError ? (
						<ScreenState
							compact
							variant="error"
							title="Не удалось обновить шаг подключения"
							action={
								<Button onClick={() => void connection.refetch()}>
									Проверить ещё раз
								</Button>
							}
						/>
					) : null}
					{item ? (
						<div
							className={styles.wizard}
							aria-label="Шаги подключения Telegram"
						>
							<h3>Подключение к «{workspaceName}»</h3>
							<ol className={styles.steps}>
								<li>
									<strong>Подтвердите свой Telegram-аккаунт.</strong>{' '}
									Откройте нашего служебного бота из нужного рабочего
									аккаунта, нажмите «Старт» и подтвердите подключение.
									Создавать собственного бота и вводить токен не нужно.
									{item.deepLink && activeSession ? (
										<p>
											<a
												href={item.deepLink}
												target="_blank"
												rel="noopener noreferrer"
											>
												Открыть @{channels.data.botUsername} в Telegram ↗
											</a>
										</p>
									) : null}
									{item.owner ? (
										<p>
											Подтверждён аккаунт:{' '}
											<strong>{item.owner.displayName}</strong>
											{item.owner.username
												? ` (@${item.owner.username})`
												: ''}
											.
										</p>
									) : null}
								</li>
								<li>
									<strong>
										Разрешите боту работать с выбранными чатами.
									</strong>{' '}
									В настройках Telegram откройте раздел подключения
									чат-ботов / Telegram для бизнеса, добавьте{' '}
									<strong>@{channels.data.botUsername}</strong> и разрешите
									чтение сообщений и ответы. Выберите только рабочие чаты,
									которые должны видеть сотрудники. Название раздела
									зависит от версии Telegram.
								</li>
								<li>
									<strong>Вернитесь сюда и завершите подключение.</strong>{' '}
									Проверьте аккаунт и пространство. Лишь после
									подтверждения новые сообщения станут доступны команде.
									{item.state === 'CONNECTION_READY' ? (
										<div className={styles.stack}>
											<label className={styles.checkbox}>
												<input
													type="checkbox"
													checked={accepted}
													disabled={busy}
													onChange={event =>
														setAcceptedAccount(
															event.target.checked ? acceptanceKey : null
														)
													}
												/>{' '}
												Подключаю {item.owner?.displayName} к «
												{workspaceName}». Переписка выбранных чатов будет
												доступна всем сотрудникам этого пространства.
											</label>
											<Button
												disabled={!canManage || !accepted || busy}
												onClick={() =>
													void confirm.execute(() => ({
														...context.binding,
														commandId: crypto.randomUUID(),
														connectSessionId: item.id,
														expectedVersion: item.version
													}))
												}
											>
												Подтвердить подключение
											</Button>
										</div>
									) : null}
								</li>
								<li>
									<strong>Проверьте обмен.</strong> Попросите написать с
									другого аккаунта в разрешённый чат. Откройте общий чат в{' '}
									<Link href="/messages">Мессенджере</Link>, нажмите
									«Ответить в Telegram» у входящего сообщения и отправьте
									ответ.
								</li>
							</ol>
							<p role="status">
								{item.state === 'WAITING_TELEGRAM'
									? 'Ожидаем подтверждение аккаунта в Telegram…'
									: item.state === 'OWNER_VERIFIED'
										? 'Аккаунт подтверждён. Ожидаем разрешение на работу с чатами…'
										: item.state === 'CONNECTION_READY'
											? 'Telegram готов. Проверьте аккаунт и подтвердите подключение выше.'
											: item.state === 'CONNECTED'
												? 'Аккаунт подключён. Осталось проверить обмен сообщениями.'
												: item.state === 'EXPIRED'
													? 'Время подключения истекло. Начните заново.'
													: 'Подключение отменено.'}
							</p>
							{activeSession ? (
								<div className={styles.actions}>
									<span className={styles.hint}>
										Ссылка действует до{' '}
										{new Date(item.expiresAt).toLocaleTimeString('ru-RU', {
											hour: '2-digit',
											minute: '2-digit'
										})}
										.
									</span>
									<Button
										variant="ghost"
										disabled={busy || !canManage}
										onClick={() =>
											void cancel.execute(() => ({
												...context.binding,
												commandId: crypto.randomUUID(),
												connectSessionId: item.id,
												expectedVersion: item.version
											}))
										}
									>
										Отменить подключение
									</Button>
								</div>
							) : null}
						</div>
					) : null}
				</>
			)}
			{disconnecting ? (
				<div className={styles.wizard} role="alert">
					<p>
						Отключить {disconnecting.account.displayName}? Новые сообщения
						перестанут поступать, новые ответы из CRM будут запрещены.
						История сохранится. Уже отправляемое сообщение может быть
						доставлено.
					</p>
					<div className={styles.actions}>
						<Button
							disabled={busy || !canManage}
							onClick={() =>
								void disconnect.execute(() => ({
									...context.binding,
									commandId: crypto.randomUUID(),
									channelId: disconnecting.id,
									expectedVersion: disconnecting.version
								}))
							}
						>
							Отключить аккаунт
						</Button>
						<Button
							variant="secondary"
							disabled={busy}
							onClick={() => setDisconnecting(null)}
						>
							Оставить подключённым
						</Button>
					</div>
				</div>
			) : null}
			<CommandNotice command={create} />
			<CommandNotice command={confirm} />
			<CommandNotice command={cancel} />
			<CommandNotice command={disconnect} />
			<details>
				<summary>
					Как это работает и что делать, если сообщения не приходят
				</summary>
				<div className={styles.stack}>
					<p>
						Клиент продолжает писать вашему обычному аккаунту. Бот aeroCRM
						нужен для подключения: клиенты ему не пишут. Один аккаунт
						подключается к одному рабочему пространству.
					</p>
					<p>
						Проверьте в Telegram, что бот подключён, нужный чат разрешён и
						разрешены ответы. Сообщения появятся после завершения
						подключения; старая история Telegram не импортируется. Ответить
						можно в течение 24 часов после последнего входящего сообщения
						клиента.
					</p>
					<p>
						Сейчас из CRM отправляется текст. Для фото, документов и
						голосовых отображается тип и подпись; само вложение открывайте
						в Telegram. Клиент видит ответ от рабочего аккаунта, имя
						сотрудника сохраняется в CRM.
					</p>
					<p>
						Если Telegram не открывается на устройстве, сначала
						восстановите доступ к приложению. Подключение CRM не
						обеспечивает доступ к самому Telegram.
					</p>
				</div>
			</details>
		</section>
	)
}
