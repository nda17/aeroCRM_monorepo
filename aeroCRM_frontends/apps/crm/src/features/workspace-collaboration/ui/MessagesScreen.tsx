'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import {
	ensureDirectConversation,
	listChatMessagesV2,
	listConversations,
	listDirectory,
	readChatConversation,
	sendChatMessageV2,
	lookupChatSendV2,
	downloadChatAttachment,
	type ChatConversation
} from '@/entities/workspace-collaboration'
import {
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { isUuidV4 } from '@/shared/lib/contract'
import { useDirtyFormGuard, useDirtyValue } from '@/shared/lib/dirty-form'
import {
	Button,
	Drawer,
	PageHeader,
	ScreenState,
	TextareaField,
	TextField
} from '@/shared/ui'
import {
	useCollaboration,
	useCollaborationCommand,
	type CollaborationContext
} from '../model/use-collaboration'
import { useChatAttachments } from '../model/use-chat-attachments'
import { CommandNotice } from './CommandNotice'
import styles from './Collaboration.module.scss'

const chatReadError = (error: unknown, thread = false) => {
	if (error instanceof AuthenticatedApiError) {
		if (error.kind === 'forbidden')
			return {
				variant: 'permission' as const,
				title: thread
					? 'Нет доступа к этому диалогу'
					: 'Нет доступа к диалогам',
				description:
					'Сервер отклонил доступ. Проверьте выбранное пространство и свои права.'
			}
		if (error.kind === 'unauthorized')
			return {
				variant: 'error' as const,
				title: 'Не удалось подтвердить сессию',
				description:
					'Повторите проверку доступа. Если ошибка сохраняется, войдите снова.'
			}
		if (error.kind === 'notFound')
			return {
				variant: 'error' as const,
				title: 'Диалог не найден или недоступен',
				description:
					'Обновите список диалогов и выберите доступную переписку.'
			}
	}
	return {
		variant: 'error' as const,
		title: thread
			? 'Не удалось загрузить переписку'
			: 'Не удалось загрузить диалоги',
		description: 'Возникла временная ошибка загрузки. Повторите попытку.'
	}
}

export function MessagesScreen() {
	return (
		<Suspense
			fallback={
				<ScreenState variant="loading" title="Загружаем сообщения…" />
			}
		>
			<MessagesSession />
		</Suspense>
	)
}
function MessagesSession() {
	const context = useCollaboration()
	const params = useSearchParams() ?? new URLSearchParams()
	const sameWorkspace =
		!params.get('workspaceId') ||
		params.get('workspaceId') === context.workspace.workspaceId
	const conversation =
		sameWorkspace && isUuidV4(params.get('conversationId'))
			? params.get('conversationId')
			: null
	const recipient = sameWorkspace ? params.get('recipient') : null
	return (
		<MessagesContent
			key={`${context.identity}:${conversation ?? ''}:${recipient ?? ''}`}
			context={context}
			initialId={conversation}
			initialRecipient={recipient}
		/>
	)
}
function MessagesContent({
	context,
	initialId,
	initialRecipient
}: {
	context: CollaborationContext
	initialId: string | null
	initialRecipient: string | null
}) {
	const guard = useDirtyFormGuard()
	const [selected, setSelected] = useState(initialId)
	const [picking, setPicking] = useState(!!initialRecipient)
	const [page, setPage] = useState(1)
	const [search, setSearch] = useState('')
	const [q, setQ] = useState('')
	const conversations = useQuery({
		queryKey: ['workspace-chat-conversations', ...context.key, page, q],
		enabled: context.ready,
		queryFn: async () => {
			const result = await listConversations(
				context.session!.accessToken,
				{ ...context.binding, page, pageSize: 30, q }
			)
			if (!context.current()) throw invalidContractError()
			return result
		},
		retry: false,
		gcTime: 0,
		refetchInterval: 30000
	})
	const choose = (id: string | null) =>
		guard.confirmDiscard(() => setSelected(id))
	return (
		<div className={styles.stack}>
			<PageHeader
				title="Сообщения"
				description="Личные диалоги с коллегами и общий чат пространства."
				actions={
					<Button
						disabled={!context.canWrite}
						onClick={() => setPicking(true)}
					>
						Написать коллеге
					</Button>
				}
			/>
			<div className={styles.chatLayout}>
				<aside
					className={clsx(styles.sidebar, selected && styles.hiddenMobile)}
					aria-label="Диалоги"
				>
					<form
						onSubmit={event => {
							event.preventDefault()
							setQ(search.trim())
							setPage(1)
						}}
						className={styles.stack}
					>
						<TextField
							label="Найти диалог"
							value={search}
							maxLength={100}
							onChange={event => setSearch(event.target.value)}
						/>
						<Button type="submit" variant="secondary" size="sm">
							Найти
						</Button>
					</form>
					{(context.permissions.isFetching && !context.ready) ||
					(conversations.isFetching && !conversations.data) ? (
						<p role="status" className={styles.muted}>
							Проверяем доступ и загружаем диалоги…
						</p>
					) : context.permissions.isError || conversations.isError ? (
						<ScreenState
							{...chatReadError(
								context.permissions.error ?? conversations.error
							)}
							compact
							action={
								<Button
									onClick={async () => {
										const access = await context.permissions.refetch()
										if (!access.isError && context.current())
											await conversations.refetch()
									}}
								>
									Повторить
								</Button>
							}
						/>
					) : !context.ready || !conversations.data ? (
						<p role="status" className={styles.muted}>
							Загружаем диалоги…
						</p>
					) : (
						<>
							<div className={styles.conversations}>
								{conversations.data.items.map(conversation => (
									<button
										type="button"
										key={conversation.id}
										className={clsx(
											styles.conversation,
											selected === conversation.id && styles.selected
										)}
										aria-pressed={selected === conversation.id}
										onClick={() => choose(conversation.id)}
									>
										<span className={styles.row}>
											<span className={styles.name}>
												{conversation.title}
											</span>
											{conversation.unreadCount > 0 ? (
												<span
													className={styles.badge}
													aria-label={`Непрочитанных: ${conversation.unreadCount}`}
												>
													{conversation.unreadCount > 99
														? '99+'
														: conversation.unreadCount}
												</span>
											) : null}
										</span>
										<span className={styles.preview}>
											{conversation.lastMessage?.text ??
												(conversation.kind === 'WORKSPACE'
													? 'Общий чат команды'
													: 'Начните переписку')}
										</span>
										{conversation.lastMessageAt ? (
											<span className={styles.meta}>
												{new Date(
													conversation.lastMessageAt
												).toLocaleString('ru-RU', {
													day: 'numeric',
													month: 'short',
													hour: '2-digit',
													minute: '2-digit'
												})}
											</span>
										) : null}
									</button>
								))}
							</div>
							{!conversations.data.items.length ? (
								<p className={styles.muted}>Диалоги не найдены.</p>
							) : null}
							<div className={styles.row}>
								<Button
									size="sm"
									variant="ghost"
									disabled={page <= 1}
									onClick={() => setPage(value => value - 1)}
								>
									Назад
								</Button>
								<span className={styles.meta}>{page}</span>
								<Button
									size="sm"
									variant="ghost"
									disabled={page * 30 >= conversations.data.total}
									onClick={() => setPage(value => value + 1)}
								>
									Далее
								</Button>
							</div>
						</>
					)}
				</aside>
				{selected ? (
					<ChatThread
						key={selected}
						context={context}
						id={selected}
						onBack={() => choose(null)}
					/>
				) : (
					<section className={clsx(styles.thread, styles.hiddenMobile)}>
						<p className={styles.empty}>
							Выберите диалог или напишите коллеге.
						</p>
					</section>
				)}
			</div>
			{picking ? (
				<RecipientPicker
					context={context}
					initialRecipient={initialRecipient}
					onClose={() => setPicking(false)}
					onSelected={conversation => {
						setPicking(false)
						choose(conversation.id)
					}}
				/>
			) : null}
		</div>
	)
}

function RecipientPicker({
	context,
	initialRecipient,
	onClose,
	onSelected
}: {
	context: CollaborationContext
	initialRecipient: string | null
	onClose: () => void
	onSelected: (conversation: ChatConversation) => void
}) {
	const [search, setSearch] = useState('')
	const [q, setQ] = useState('')
	const [page, setPage] = useState(1)
	const people = useQuery({
		queryKey: [
			'workspace-directory',
			...context.key,
			'recipients',
			q,
			page
		],
		enabled: context.ready,
		queryFn: async () => {
			const result = await listDirectory(context.session!.accessToken, {
				...context.binding,
				page,
				pageSize: 30,
				q,
				activeOnly: true,
				includeArchived: true
			})
			if (!context.current()) throw invalidContractError()
			return result
		},
		retry: false,
		gcTime: 0
	})
	const command = useCollaborationCommand(
		context,
		'chat:direct',
		ensureDirectConversation,
		result => onSelected(result.conversation)
	)
	const write = (subject: string) =>
		void command.execute(() => ({
			...context.binding,
			recipientSubject: subject,
			commandId: crypto.randomUUID()
		}))
	return (
		<Drawer isOpen title="Написать коллеге" onClose={onClose}>
			<div className={styles.stack}>
				{initialRecipient &&
				initialRecipient !== context.binding.subject ? (
					<Button
						disabled={command.locked || !context.canWrite}
						onClick={() => write(initialRecipient)}
					>
						Открыть диалог с выбранным сотрудником
					</Button>
				) : null}
				<form
					className={styles.toolbar}
					onSubmit={event => {
						event.preventDefault()
						setQ(search.trim())
						setPage(1)
					}}
				>
					<TextField
						label="Поиск сотрудника"
						value={search}
						maxLength={100}
						onChange={event => setSearch(event.target.value)}
						containerClassName={styles.search}
					/>
					<Button type="submit" variant="secondary">
						Найти
					</Button>
				</form>
				<CommandNotice command={command} />
				{people.isError ? (
					<ScreenState
						variant="error"
						title="Не удалось загрузить сотрудников"
						action={
							<Button onClick={() => void people.refetch()}>
								Повторить
							</Button>
						}
					/>
				) : !people.data ? (
					<p role="status">Загружаем сотрудников…</p>
				) : (
					<>
						{people.data.items
							.filter(
								person =>
									person.subject !== context.binding.subject &&
									person.canMessage
							)
							.map(person => (
								<Button
									key={person.id}
									variant="secondary"
									disabled={command.locked || !context.canWrite}
									onClick={() => {
										if (person.subject) write(person.subject)
									}}
								>
									{person.displayName}
								</Button>
							))}
						{people.data.total <= 1 ? (
							<p className={styles.muted}>
								Других активных сотрудников пока нет.
							</p>
						) : null}
						<div className={styles.row}>
							<Button
								variant="ghost"
								disabled={page <= 1}
								onClick={() => setPage(value => value - 1)}
							>
								Назад
							</Button>
							<span>{page}</span>
							<Button
								variant="ghost"
								disabled={page * 30 >= people.data.total}
								onClick={() => setPage(value => value + 1)}
							>
								Далее
							</Button>
						</div>
					</>
				)}
			</div>
		</Drawer>
	)
}

function MessageText({ text }: { text: string }) {
	return (
		<>
			{text.split(/(https?:\/\/[^\s<>]+)/gu).map((part, index) =>
				/^https?:\/\//u.test(part) ? (
					<a
						key={index}
						href={part}
						target="_blank"
						rel="noopener noreferrer"
					>
						{part}
					</a>
				) : (
					part
				)
			)}
		</>
	)
}

function ChatThread({
	context,
	id,
	onBack
}: {
	context: CollaborationContext
	id: string
	onBack: () => void
}) {
	const [before, setBefore] = useState<number | undefined>()
	const [text, setText] = useState('')
	const bottom = useRef<HTMLDivElement>(null)
	const scroll = useRef<HTMLOListElement>(null)
	const lastMarked = useRef(0)
	const initialScroll = useRef(false)
	const attachments = useChatAttachments(context, id)
	const fileInput = useRef<HTMLInputElement>(null)
	const [downloadError, setDownloadError] = useState('')
	const dirty = useDirtyValue(
		JSON.stringify({ text, files: attachments.files.map(row => row.key) }),
		'Неотправленное сообщение и вложения'
	)
	const messages = useQuery({
		queryKey: ['workspace-chat-messages', ...context.key, id, before],
		enabled: context.ready,
		queryFn: async () => {
			const result = await listChatMessagesV2(
				context.session!.accessToken,
				{
					...context.binding,
					conversationId: id,
					beforeSequence: before,
					limit: 50
				}
			)
			if (!context.current()) throw invalidContractError()
			return result
		},
		retry: false,
		gcTime: 0,
		refetchInterval: 30000
	})
	const data =
		context.ready && !messages.isError ? messages.data : undefined
	const conversation = data?.conversation
	const send = useCollaborationCommand(
		context,
		`chat:send:${id}`,
		async (token, command: Parameters<typeof sendChatMessageV2>[1]) =>
			(await lookupChatSendV2(token, command)) ??
			(await sendChatMessageV2(token, command)),
		() => {
			setText('')
			attachments.reset()
			dirty.resetBaseline(JSON.stringify({ text: '', files: [] }))
			initialScroll.current = false
			setBefore(undefined)
			requestAnimationFrame(() =>
				bottom.current?.scrollIntoView({ block: 'end' })
			)
		}
	)
	const read = useCollaborationCommand(
		context,
		`chat:read:${id}`,
		readChatConversation,
		() => undefined,
		false
	)
	const latestSequence = data?.items.at(-1)?.sequence ?? 0
	useEffect(() => {
		const node = bottom.current
		if (
			typeof IntersectionObserver === 'undefined' ||
			!node ||
			before ||
			!conversation ||
			latestSequence <= conversation.readThroughSequence ||
			latestSequence <= lastMarked.current ||
			read.locked ||
			messages.isFetching ||
			!context.ready
		)
			return
		const mark = () => {
			if (
				document.visibilityState !== 'visible' ||
				!context.current() ||
				lastMarked.current >= latestSequence
			)
				return
			lastMarked.current = latestSequence
			void read.execute(() => ({
				...context.binding,
				conversationId: id,
				commandId: crypto.randomUUID(),
				throughSequence: latestSequence
			}))
		}
		const observer = new IntersectionObserver(
			entries => {
				if (entries.some(entry => entry.isIntersecting)) mark()
			},
			{ root: scroll.current, threshold: 1 }
		)
		observer.observe(node)
		const visible = () => {
			if (document.visibilityState === 'visible') {
				observer.unobserve(node)
				observer.observe(node)
			}
		}
		document.addEventListener('visibilitychange', visible)
		return () => {
			observer.disconnect()
			document.removeEventListener('visibilitychange', visible)
		}
	}, [
		before,
		conversation,
		latestSequence,
		messages.isFetching,
		context,
		id,
		read
	])
	useEffect(() => {
		if (
			!before &&
			messages.dataUpdatedAt &&
			scroll.current &&
			(!initialScroll.current ||
				scroll.current.scrollHeight -
					scroll.current.scrollTop -
					scroll.current.clientHeight <
					180)
		) {
			scroll.current.scrollTop = scroll.current.scrollHeight
			initialScroll.current = true
		}
	}, [before, messages.dataUpdatedAt])
	const canSend =
		context.canWrite &&
		conversation?.canSend &&
		!send.locked &&
		(!!text.trim() || attachments.files.length > 0) &&
		attachments.ready
	return (
		<section className={styles.thread} aria-label="Переписка">
			<div className={styles.threadHeader}>
				<div className={styles.row}>
					<Button className={styles.back} variant="ghost" onClick={onBack}>
						К диалогам
					</Button>
					<h2 className={styles.name}>
						{conversation?.title ?? 'Переписка'}
					</h2>
				</div>
				<Button
					size="sm"
					variant="ghost"
					disabled={messages.isFetching}
					onClick={async () => {
						if (!read.uncertain && !read.running) {
							read.reset()
							lastMarked.current = 0
						}
						const access = await context.permissions.refetch()
						if (!access.isError && context.current())
							await messages.refetch()
					}}
				>
					Обновить
				</Button>
			</div>
			{(context.permissions.isFetching && !context.ready) ||
			(messages.isFetching && !data) ? (
				<p className={styles.empty} role="status">
					Проверяем доступ и загружаем сообщения…
				</p>
			) : messages.isError || context.permissions.isError ? (
				<ScreenState
					{...chatReadError(
						context.permissions.error ?? messages.error,
						true
					)}
				/>
			) : !data ? (
				<p className={styles.empty} role="status">
					Загружаем сообщения…
				</p>
			) : (
				<>
					<div
						className={styles.toolbar}
						style={{ padding: '0.5rem 1rem' }}
					>
						{data.nextBeforeSequence ? (
							<Button
								size="sm"
								variant="secondary"
								onClick={() => setBefore(data.nextBeforeSequence!)}
							>
								Более ранние сообщения
							</Button>
						) : null}
						{before ? (
							<Button
								size="sm"
								variant="secondary"
								onClick={() => {
									initialScroll.current = false
									setBefore(undefined)
									lastMarked.current = 0
								}}
							>
								К новым сообщениям
							</Button>
						) : null}
					</div>
					<ol
						className={styles.messages}
						ref={scroll}
						aria-label="Сообщения диалога"
					>
						{data.items.length ? (
							data.items.map(message => {
								const own =
									message.senderSubject === context.binding.subject
								return (
									<li
										key={message.id}
										className={clsx(styles.message, own && styles.own)}
									>
										{!own ? (
											<span className={styles.name}>
												{message.senderName}
											</span>
										) : null}
										<p className={styles.messageText}>
											<MessageText text={message.text} />
										</p>

										{message.attachments.map(file => (
											<Button
												key={file.id}
												type="button"
												variant="secondary"
												size="sm"
												onClick={() => {
													setDownloadError('')
													void downloadChatAttachment(
														context.session!.accessToken,
														context.binding.workspaceId,
														file.id,
														file.fileName
													).catch(() => {
														if (context.current())
															setDownloadError(
																'Не удалось скачать файл. Обновите доступ и повторите.'
															)
													})
												}}
											>
												{file.fileName} ({Math.ceil(file.byteSize / 1024)}{' '}
												КБ)
											</Button>
										))}
										<div className={styles.meta}>
											<time dateTime={message.createdAt}>
												{new Date(message.createdAt).toLocaleString(
													'ru-RU',
													{
														day: 'numeric',
														month: 'short',
														hour: '2-digit',
														minute: '2-digit'
													}
												)}
											</time>
											{own ? (
												<span>
													{conversation?.peerReadThroughSequence != null &&
													conversation.peerReadThroughSequence >=
														message.sequence
														? 'Прочитано'
														: 'Отправлено'}
												</span>
											) : null}
										</div>
									</li>
								)
							})
						) : (
							<li className={styles.empty}>
								Сообщений пока нет. Начните разговор.
							</li>
						)}
						<li aria-hidden="true">
							<div ref={bottom} style={{ height: 1 }} />
						</li>
					</ol>
				</>
			)}
			<form
				className={styles.composer}
				onDragOver={event => event.preventDefault()}
				onDrop={event => {
					event.preventDefault()
					if (!send.locked && conversation?.canSend)
						attachments.add(Array.from(event.dataTransfer.files))
				}}
				onSubmit={event => {
					event.preventDefault()
					if (canSend)
						void send.execute(() => ({
							...context.binding,
							conversationId: id,
							commandId: crypto.randomUUID(),
							text: text.trim(),
							attachmentIds: attachments.attachmentIds
						}))
				}}
			>
				<TextareaField
					label="Сообщение"
					placeholder="Напишите сообщение…"
					rows={3}
					maxLength={10000}
					value={text}
					disabled={
						!context.canWrite || !conversation?.canSend || send.locked
					}
					onChange={event => {
						send.reset()
						setText(event.target.value)
					}}
					onKeyDown={event => {
						if (
							(event.metaKey || event.ctrlKey) &&
							event.key === 'Enter'
						) {
							event.preventDefault()
							event.currentTarget.form?.requestSubmit()
						}
					}}
				/>

				<input
					ref={fileInput}
					type="file"
					multiple
					hidden
					accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.csv,.docx,.xlsx"
					onChange={event => {
						attachments.add(Array.from(event.target.files ?? []))
						event.target.value = ''
					}}
				/>
				<Button
					type="button"
					variant="secondary"
					disabled={
						!attachments.enabled ||
						!context.canWrite ||
						!conversation?.canSend ||
						send.locked
					}
					onClick={() => fileInput.current?.click()}
				>
					Прикрепить файлы
				</Button>
				<span className={styles.muted}>
					До 5 МБ на файл, 10 файлов и 20 МБ на сообщение. Можно перетащить
					файлы сюда.
				</span>
				{attachments.error ? (
					<p role="alert">{attachments.error}</p>
				) : null}
				{attachments.files.map(row => (
					<div key={row.key} className={styles.stack}>
						<span>
							{row.file.name} —{' '}
							{row.attachment?.state === 'READY'
								? 'Готово'
								: `${row.progress}%`}
						</span>
						{row.running ? (
							<progress
								max={100}
								value={row.progress}
								aria-label={`Загрузка ${row.file.name}`}
							/>
						) : null}
						{row.error ? <p role="alert">{row.error}</p> : null}
						<div className={styles.row}>
							{row.error ? (
								<Button
									type="button"
									variant="secondary"
									disabled={
										!context.canWrite || send.locked || row.running
									}
									onClick={() => void attachments.upload(row)}
								>
									Проверить / повторить
								</Button>
							) : null}
							<Button
								type="button"
								variant="ghost"
								disabled={!context.canWrite || send.locked}
								onClick={() => void attachments.remove(row)}
							>
								{row.running ? 'Отменить' : 'Удалить'}
							</Button>
						</div>
					</div>
				))}
				{downloadError ? <p role="alert">{downloadError}</p> : null}
				<CommandNotice command={send} />
				<CommandNotice command={read} />
				<div className={styles.row}>
					<span className={styles.muted}>
						{context.workspace.isReadOnly
							? 'Пространство доступно только для чтения.'
							: conversation && !conversation.canSend
								? 'Отправка недоступна: у собеседника нет активного доступа.'
								: 'Ctrl / ⌘ + Enter — отправить'}
					</span>
					<Button
						type="submit"
						disabled={!canSend}
						isLoading={send.running}
					>
						Отправить
					</Button>
				</div>
			</form>
		</section>
	)
}
