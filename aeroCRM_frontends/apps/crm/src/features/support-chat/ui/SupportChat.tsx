'use client'

import { useSessionStore } from '@/entities/session'
import type { CrmAccessBootstrapResponse } from '@/entities/crm-access'
import {
	supportApi,
	supportSection,
	supportStatusLabels,
	SUPPORT_UUID,
	validateSupportFile,
	type SupportAttachment,
	type SupportMessage
} from '@/entities/support'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { AppIcon, Button } from '@/shared/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
	disposeSupportDraft,
	SupportDrafts,
	prepareSupportCommand,
	type SupportDraft,
	type SupportDraftFile
} from '../model/support-draft'
import styles from './SupportChat.module.scss'

const dateLabel = (date: string) =>
	new Date(date).toLocaleString('ru-RU', {
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit'
	})
const messageError = (error: unknown) =>
	error instanceof Error
		? error.message
		: 'Поддержка временно недоступна. Повторите действие.'
const SupportChatSession = () => {
	const session = useSessionStore(state => state.session)!
	const revision = useSessionStore(state => state.sessionRevision)
	const owner = `${session.userId}:${revision}`
	const current = useCallback(() => {
		const state = useSessionStore.getState()
		return (
			state.status === 'authenticated' &&
			state.session?.userId === session.userId &&
			state.sessionRevision === revision
		)
	}, [session.userId, revision])
	const pathname = usePathname()
	const search = useSearchParams()
	const router = useRouter()
	const incoming = search.getAll('supportConversation')
	const linked =
		incoming.length === 1 && SUPPORT_UUID.test(incoming[0])
			? incoming[0]
			: null
	const [open, setOpen] = useState(Boolean(linked))
	const [closing, setClosing] = useState(false)
	const chatActive = open && !closing
	const finishClose = useCallback(() => {
		setOpen(false)
		setClosing(false)
	}, [])
	const [selected, setSelected] = useState<string | null>(linked)
	const currentSelection = useRef(selected)
	useEffect(() => {
		currentSelection.current = selected
	}, [selected])
	const [creating, setCreating] = useState(false)
	const [previousLink, setPreviousLink] = useState(linked)
	if (previousLink !== linked) {
		setPreviousLink(linked)
		if (linked) {
			setClosing(false)
			setSelected(linked)
			setCreating(false)
			setOpen(true)
		}
	}
	const [page, setPage] = useState(1)
	const [older, setOlder] = useState<{
		id: string
		items: SupportMessage[]
		hasMore: boolean
	} | null>(null)
	const [loadingOlder, setLoadingOlder] = useState(false)
	const [preview, setPreview] = useState<{
		url: string
		name: string
	} | null>(null)
	const [viewError, setViewError] = useState('')
	const clearFeedback = () => setViewError('')
	const [loadingFile, setLoadingFile] = useState<string | null>(null)
	const [visible, setVisible] = useState(true)
	const [drafts] = useState(() => new SupportDrafts())
	const [, rerender] = useState(0)
	const redraw = () => {
		if (current()) rerender(value => value + 1)
	}
	const mounted = useRef(true)
	const alive = () => mounted.current && current()
	const client = useQueryClient()
	const dialog = useRef<HTMLDialogElement>(null)
	const trigger = useRef<HTMLButtonElement>(null)

	const queryKey = ['support-chat', owner]
	const invalidate = () => void client.invalidateQueries({ queryKey })
	const token = session.accessToken
	const draftKey = selected ?? 'new'
	const getDraft = (key = draftKey) => drafts.get(key)
	const draft = getDraft()
	const updateDraft = (patch: Partial<SupportDraft>) => {
		Object.assign(getDraft(), patch)
		redraw()
	}
	const updateLocation = (id: string | null) => {
		const location = new URL(window.location.href)
		const params = location.searchParams
		if (id) params.set('supportConversation', id)
		else params.delete('supportConversation')
		router.replace(
			`${location.pathname}${params.size ? `?${params}` : ''}`,
			{
				scroll: false
			}
		)
	}
	const select = (id: string | null, isNew = false) => {
		setSelected(id)
		setCreating(isNew)
		setOlder(null)
		setClosing(false)
		setOpen(true)
		updateLocation(id)
	}

	useEffect(() => {
		const onVisibility = () =>
			setVisible(document.visibilityState !== 'hidden')
		onVisibility()
		document.addEventListener('visibilitychange', onVisibility)
		return () =>
			document.removeEventListener('visibilitychange', onVisibility)
	}, [])
	useEffect(() => {
		mounted.current = true
		const ownDrafts = drafts
		return () => {
			mounted.current = false
			ownDrafts.clear()
		}
	}, [drafts])
	useEffect(
		() => () => {
			if (preview) URL.revokeObjectURL(preview.url)
		},
		[preview]
	)
	useEffect(() => {
		if (!closing) return
		// Complete closing even when a browser cancels the CSS animation.
		const timeout = window.setTimeout(finishClose, 220)
		return () => window.clearTimeout(timeout)
	}, [closing, finishClose])
	useEffect(() => {
		const element = dialog.current
		if (!open || !element) return
		const launcher = trigger.current
		const mobile = window.matchMedia('(max-width: 639px)')
		const resize = () => {
			if (element.open) element.close()
			if (mobile.matches) {
				element.showModal()
			} else element.show()
		}
		const viewport = () => {
			if (window.visualViewport) {
				element.style.setProperty(
					'--support-height',
					`${window.visualViewport.height}px`
				)
				element.style.setProperty(
					'--support-top',
					`${window.visualViewport.offsetTop}px`
				)
			}
		}
		resize()
		viewport()
		mobile.addEventListener('change', resize)
		window.visualViewport?.addEventListener('resize', viewport)
		window.visualViewport?.addEventListener('scroll', viewport)
		return () => {
			if (element.open) element.close()
			launcher?.focus()
			mobile.removeEventListener('change', resize)
			window.visualViewport?.removeEventListener('resize', viewport)
			window.visualViewport?.removeEventListener('scroll', viewport)
		}
	}, [open])
	const polling = {
		retry: false as const,
		staleTime: 0,
		gcTime: 0,
		refetchOnWindowFocus: 'always' as const,
		refetchOnReconnect: 'always' as const,
		refetchIntervalInBackground: false
	}
	const unread = useQuery({
		queryKey: [...queryKey, 'unread'],
		queryFn: () => supportApi.unread(token),
		enabled: visible,
		refetchInterval: chatActive ? 5000 : 60000,
		...polling
	})
	const list = useQuery({
		queryKey: [...queryKey, 'list', page],
		queryFn: () => supportApi.list(token, page),
		enabled: chatActive && visible && !selected && !creating,
		refetchInterval: 5000,
		...polling
	})
	const detail = useQuery({
		queryKey: [...queryKey, selected, 'detail'],
		queryFn: () => supportApi.detail(token, selected!),
		enabled: chatActive && visible && !!selected,
		refetchInterval: 5000,
		...polling
	})
	const history = useQuery({
		queryKey: [...queryKey, selected, 'history'],
		queryFn: () => supportApi.history(token, selected!),
		enabled: chatActive && visible && !!selected && detail.isSuccess,
		refetchInterval: 5000,
		...polling
	})
	const [previousHistory, setPreviousHistory] = useState(history.data)
	if (previousHistory !== history.data) {
		setPreviousHistory(history.data)
		const incoming = history.data?.items
		if (selected && incoming?.length)
			setOlder(previous => {
				if (previous?.id !== selected) return previous
				// A long hidden interval can skip a page; restart pagination at the
				// latest contiguous window instead of displaying a gap in the thread.
				if (
					incoming[0].sequence >
					(previous.items.at(-1)?.sequence ?? 0) + 1
				)
					return null
				return {
					...previous,
					items: Array.from(
						new Map(
							[...previous.items, ...incoming].map(item => [
								item.sequence,
								item
							])
						).values()
					).sort((a, b) => a.sequence - b.sequence)
				}
			})
	}
	const through = history.data?.items.at(-1)?.sequence ?? 0
	const marked = useRef(new Map<string, number>())
	useEffect(() => {
		if (
			!chatActive ||
			!visible ||
			!selected ||
			!through ||
			through <= (marked.current.get(selected) ?? 0)
		)
			return
		let active = true
		void supportApi
			.read(token, selected, through)
			.then(() => {
				if (!active || !current()) return
				marked.current.set(selected, through)
				void client.invalidateQueries({
					queryKey: ['support-chat', owner, 'unread']
				})
			})
			.catch(() => undefined)
		return () => {
			active = false
		}
	}, [
		chatActive,
		visible,
		selected,
		through,
		token,
		current,
		client,
		owner,
		history.dataUpdatedAt
	])
	const upload = async (
		item: SupportDraftFile,
		boundDraft: SupportDraft,
		conversationId: string | null
	) => {
		item.state = 'uploading'
		item.error = undefined
		redraw()
		try {
			const attachment = await supportApi.upload(
				token,
				session.userId,
				item.file,
				item.commandId,
				conversationId
					? { conversationId }
					: { draftId: boundDraft.draftId }
			)
			if (!alive()) return
			item.attachment = attachment
			item.state = 'ready'
			clearFeedback()
		} catch (error) {
			if (!alive()) return
			item.state = 'error'
			item.error = messageError(error)
		}
		redraw()
	}
	const addFiles = async (files: FileList | null) => {
		const draft = getDraft()
		if (!files || draft.pending || draft.sending) return
		const chosen = Array.from(files)
		if (chosen.length + draft.files.length > 3) {
			setViewError('Можно добавить до трёх изображений.')
			return
		}
		try {
			chosen.forEach(validateSupportFile)
		} catch (error) {
			setViewError(messageError(error))
			return
		}
		const added = chosen.map(file => ({
			commandId: crypto.randomUUID(),
			file,
			preview: URL.createObjectURL(file),
			state: 'uploading' as const
		}))
		draft.files.push(...added)
		redraw()
		for (const item of added) await upload(item, draft, selected)
	}
	const removeFile = async (item: SupportDraftFile) => {
		const draft = getDraft()
		if (draft.pending || item.state === 'uploading') return
		try {
			if (item.attachment)
				await supportApi.remove(token, item.attachment.id)
			if (!alive()) return
			draft.files = draft.files.filter(file => file !== item)
			URL.revokeObjectURL(item.preview)
			redraw()
			clearFeedback()
		} catch (error) {
			if (alive()) setViewError(messageError(error))
		}
	}
	const send = async () => {
		const draft = getDraft()
		if (draft.sending || !alive()) return
		try {
			const workspaceIds = search.getAll('workspaceId')
			let workspaceId =
				workspaceIds.length === 1 && SUPPORT_UUID.test(workspaceIds[0])
					? workspaceIds[0]
					: undefined
			// Reuse the current gate's confirmed company context, without invoking
			// CRM access or depending on its paid entitlement to open support.
			if (workspaceIds.length === 0) {
				const activeAccess = client
					.getQueryCache()
					.findAll({ queryKey: ['crm-access', session.userId, revision] })
					.filter(
						query => query.isActive() && query.state.status === 'success'
					)
				if (activeAccess.length === 1) {
					const context = activeAccess[0].state.data as
						| CrmAccessBootstrapResponse
						| undefined
					if (
						context?.selectedWorkspaceId &&
						SUPPORT_UUID.test(context.selectedWorkspaceId)
					)
						workspaceId = context.selectedWorkspaceId
				}
			}
			draft.pending = prepareSupportCommand(
				draft,
				session.userId,
				selected
					? undefined
					: {
							...(workspaceId ? { workspaceId } : {}),
							section: supportSection(pathname),
							appVersion:
								process.env.NEXT_PUBLIC_CRM_APP_VERSION || '0.1.0'
						}
			)
			draft.sending = true
			draft.error = undefined
			redraw()
			const result = await supportApi.send(
				token,
				draft.pending,
				selected ?? undefined
			)
			if (!alive()) return
			disposeSupportDraft(draft)
			drafts.delete(draftKey)
			if (currentSelection.current === selected) {
				setSelected(result.conversation.id)
				setCreating(false)
				updateLocation(result.conversation.id)
				setOlder(null)
			}
			invalidate()
			clearFeedback()
		} catch (error) {
			if (!alive()) return
			draft.error = messageError(error)
			if (
				error instanceof AuthenticatedApiError &&
				['validation', 'forbidden', 'notFound'].includes(error.kind)
			)
				draft.pending = undefined
			setViewError(draft.error)
		} finally {
			draft.sending = false
			redraw()
		}
	}
	const loadOlder = async () => {
		if (!selected || loadingOlder) return
		const first =
			older?.id === selected
				? older.items[0]?.sequence
				: history.data?.items[0]?.sequence
		if (!first) return
		const id = selected
		setLoadingOlder(true)
		try {
			const result = await supportApi.history(token, id, first)
			if (alive())
				setOlder(previous => ({
					id,
					items: [
						...result.items,
						...(previous?.id === id
							? previous.items
							: (history.data?.items ?? []))
					],
					hasMore: result.hasMore
				}))
		} catch (error) {
			if (alive()) setViewError(messageError(error))
		} finally {
			if (alive()) setLoadingOlder(false)
		}
	}
	const viewFile = async (attachment: SupportAttachment) => {
		if (loadingFile) return
		setLoadingFile(attachment.id)
		try {
			const blob = await supportApi.content(
				token,
				attachment,
				new AbortController().signal
			)
			if (alive()) {
				setPreview({
					url: URL.createObjectURL(blob),
					name: attachment.fileName
				})
			}
		} catch (error) {
			if (alive()) setViewError(messageError(error))
		} finally {
			if (alive()) setLoadingFile(null)
		}
	}
	const messages = Array.from(
		new Map(
			[
				...(older?.id === selected ? older.items : []),
				...(history.data?.items ?? [])
			].map(item => [item.sequence, item])
		).values()
	).sort((a, b) => a.sequence - b.sequence)
	const hasOlder =
		older?.id === selected ? older.hasMore : history.data?.hasMore
	const historyEnd = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (chatActive && through)
			historyEnd.current?.scrollIntoView({ block: 'end' })
	}, [chatActive, selected, through])
	const close = () => {
		if (closing) return
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
			finishClose()
		else setClosing(true)
		setPreview(null)
		updateLocation(null)
	}
	return (
		<>
			<button
				type="button"
				ref={trigger}
				className={styles.launcher}
				hidden={open}
				onClick={() => {
					setClosing(false)
					setOpen(true)
				}}
				aria-label={`Поддержка${unread.data ? `, непрочитанных: ${unread.data}` : ''}`}
				aria-expanded={open}
			>
				<AppIcon name="inbox" size={20} />
				{!!unread.data && (
					<span className={styles.badge}>
						{unread.data > 99 ? '99+' : unread.data}
					</span>
				)}
			</button>
			<dialog
				ref={dialog}
				className={styles.dialog}
				data-state={closing ? 'closing' : open ? 'open' : 'closed'}
				inert={closing}
				aria-labelledby="support-title"
				onAnimationEnd={event => {
					if (closing && event.target === event.currentTarget)
						finishClose()
				}}
				onCancel={event => {
					event.preventDefault()
					close()
				}}
			>
				<div className={styles.panel}>
					{viewError && viewError !== draft.error && (
						<p className={styles.error} role="alert">
							{viewError}
						</p>
					)}
					<header className={styles.header}>
						<div>
							<h2 id="support-title">Поддержка</h2>
							<p>Мы поможем с работой в aeroCRM</p>
						</div>
						<button
							type="button"
							className={styles.iconButton}
							onClick={close}
							aria-label="Свернуть поддержку"
						>
							<AppIcon name="close" />
						</button>
					</header>
					{selected || creating ? (
						<div className={styles.threadHeading}>
							<button
								type="button"
								className={styles.backButton}
								onClick={() => select(null)}
							>
								← Все обращения
							</button>
							<h3>
								{creating
									? 'Новое обращение'
									: detail.data
										? `№ ${detail.data.number} · ${detail.data.subject}`
										: 'Переписка'}
							</h3>
							{detail.data && (
								<span>{supportStatusLabels[detail.data.status]}</span>
							)}
						</div>
					) : (
						<div className={styles.threadHeading}>
							<h3>Ваши обращения</h3>
							<Button
								className={styles.newTicket}
								leadingIcon={<AppIcon name="plus" size={16} />}
								onClick={() => select(null, true)}
							>
								Новое обращение
							</Button>
						</div>
					)}
					<div
						className={styles.history}
						aria-live="polite"
						aria-relevant="additions"
					>
						{!selected && !creating && (
							<>
								{list.isPending && (
									<p className={styles.hint}>Загружаем обращения…</p>
								)}
								{list.isError && (
									<p role="alert">
										Не удалось загрузить обращения.{' '}
										<button
											type="button"
											onClick={() => {
												clearFeedback()
												void list.refetch()
											}}
										>
											Повторить
										</button>
									</p>
								)}
								{list.data?.items.length === 0 && (
									<div className={styles.empty}>
										<AppIcon name="inbox" size={36} />
										<h3>Чем можем помочь?</h3>
										<p>
											Создайте обращение — ответы и история останутся
											здесь.
										</p>
									</div>
								)}
								{list.data?.items.map(item => (
									<button
										key={item.id}
										type="button"
										className={styles.ticket}
										onClick={() => select(item.id)}
									>
										<span className={styles.ticketMeta}>
											№ {item.number} · {supportStatusLabels[item.status]}
											<time dateTime={item.lastMessageAt}>
												{dateLabel(item.lastMessageAt)}
											</time>
										</span>
										<strong>{item.subject}</strong>
										{item.unreadCount > 0 && (
											<span className={styles.unread}>
												Новых ответов: {item.unreadCount}
											</span>
										)}
									</button>
								))}
								{list.data && list.data.total > list.data.limit && (
									<div className={styles.pagination}>
										<button
											disabled={page <= 1}
											onClick={() => {
												setPage(value => value - 1)
											}}
										>
											Назад
										</button>
										<span>
											{page} /{' '}
											{Math.ceil(list.data.total / list.data.limit)}
										</span>
										<button
											disabled={page * list.data.limit >= list.data.total}
											onClick={() => {
												setPage(value => value + 1)
											}}
										>
											Далее
										</button>
									</div>
								)}
							</>
						)}
						{creating && (
							<p className={styles.hint}>
								Опишите вопрос. Обращение появится после отправки первого
								сообщения.
							</p>
						)}
						{selected && (
							<>
								{(detail.isPending || history.isPending) && (
									<p className={styles.hint}>Загружаем переписку…</p>
								)}
								{(detail.isError || history.isError) && (
									<p role="alert">
										Переписка недоступна.{' '}
										<button
											onClick={() => {
												invalidate()
												clearFeedback()
											}}
										>
											Повторить
										</button>
									</p>
								)}
								{hasOlder && (
									<button
										className={styles.olderButton}
										disabled={loadingOlder}
										onClick={() => void loadOlder()}
									>
										{loadingOlder ? 'Загружаем…' : 'Предыдущие сообщения'}
									</button>
								)}
								{messages.map(message => (
									<article
										key={message.id}
										className={
											message.senderKind === 'CLIENT'
												? styles.ownMessage
												: styles.message
										}
									>
										<div className={styles.messageMeta}>
											<strong>
												{message.senderKind === 'CLIENT'
													? 'Вы'
													: 'Специалист поддержки'}
											</strong>
											<time dateTime={message.createdAt}>
												{dateLabel(message.createdAt)}
											</time>
										</div>
										<p>{message.text}</p>
										{message.attachments.map(attachment => (
											<button
												type="button"
												key={attachment.id}
												className={styles.attachmentLink}
												disabled={loadingFile !== null}
												onClick={() => void viewFile(attachment)}
											>
												{loadingFile === attachment.id
													? 'Загружаем…'
													: `▧ ${attachment.fileName}`}
											</button>
										))}
									</article>
								))}
								<div ref={historyEnd} />
							</>
						)}
					</div>
					{(creating || selected) && (!selected || detail.isSuccess) && (
						<form
							className={styles.composer}
							onSubmit={event => {
								event.preventDefault()
								void send()
							}}
						>
							{creating && (
								<label>
									Тема
									<input
										aria-label="Тема обращения"
										maxLength={160}
										value={draft.subject}
										disabled={!!draft.pending}
										onChange={event =>
											updateDraft({ subject: event.target.value })
										}
										required
									/>
								</label>
							)}
							<label className={styles.messageLabel}>
								Сообщение
								<textarea
									maxLength={10000}
									rows={3}
									value={draft.text}
									disabled={!!draft.pending}
									onChange={event =>
										updateDraft({ text: event.target.value })
									}
									placeholder="Напишите, что случилось…"
									required
								/>
							</label>
							{draft.files.length > 0 && (
								<ul className={styles.files}>
									{draft.files.map(item => (
										<li key={item.commandId}>
											{/* eslint-disable-next-line @next/next/no-img-element */}
											<img
												src={item.preview}
												alt={`Скриншот: ${item.file.name}`}
											/>
											<span>
												{item.state === 'uploading'
													? 'Загрузка…'
													: item.state === 'error'
														? item.error || 'Ошибка загрузки'
														: item.file.name}
											</span>
											{item.state === 'error' && (
												<button
													type="button"
													onClick={() =>
														void upload(item, draft, selected)
													}
												>
													Повторить
												</button>
											)}
											<button
												type="button"
												disabled={
													!!draft.pending || item.state === 'uploading'
												}
												onClick={() => void removeFile(item)}
												aria-label={`Удалить ${item.file.name}`}
											>
												×
											</button>
										</li>
									))}
								</ul>
							)}
							{draft.error && (
								<p className={styles.error} role="alert">
									{draft.error}
									{draft.pending &&
										' Повтор использует то же сообщение и не создаст дубль.'}
								</p>
							)}
							<div className={styles.composerActions}>
								<label className={styles.fileButton}>
									▧ Скриншоты
									<input
										type="file"
										accept="image/png,image/jpeg,image/webp"
										multiple
										disabled={!!draft.pending || draft.files.length >= 3}
										onChange={event => {
											void addFiles(event.target.files)
											event.target.value = ''
										}}
									/>
								</label>
								<Button
									type="submit"
									isLoading={draft.sending}
									disabled={
										draft.files.some(item => item.state !== 'ready') ||
										!draft.text.trim()
									}
								>
									{draft.pending && !draft.sending
										? 'Повторить отправку'
										: 'Отправить'}
								</Button>
							</div>
							<p className={styles.limit}>
								До 3 изображений по 5 МБ · PNG, JPEG, WebP
							</p>
						</form>
					)}
					{preview && (
						<div
							className={styles.preview}
							role="dialog"
							aria-label="Просмотр скриншота"
						>
							<button
								type="button"
								className={styles.iconButton}
								onClick={() => setPreview(null)}
								aria-label="Закрыть изображение"
							>
								<AppIcon name="close" />
							</button>
							{/* eslint-disable-next-line @next/next/no-img-element */}
							<img src={preview.url} alt={preview.name} />
							<a
								href={preview.url}
								download={preview.name}
								onClick={() => clearFeedback()}
							>
								Скачать изображение
							</a>
						</div>
					)}
				</div>
			</dialog>
		</>
	)
}
const SupportChatBound = () => {
	const { session, sessionRevision } = useSessionStore()
	return session ? (
		<SupportChatSession key={`${session.userId}:${sessionRevision}`} />
	) : null
}
export const SupportChat = () => (
	<Suspense fallback={null}>
		<SupportChatBound />
	</Suspense>
)
