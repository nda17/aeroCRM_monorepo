'use client'

import { useAuthStore, useUser, UserRole } from '@/entities/user'
import {
	adminSupportApi,
	supportActorIsCurrent,
	SupportAdminError,
	supportStatusLabels,
	SUPPORT_STATUSES,
	SUPPORT_UUID,
	validateSupportFile,
	type SupportAttachment,
	type SupportMessage,
	type SupportReplyCommand,
	type SupportStatus
} from '@/features/admin-support'
import AdminNavigation from '@/screens/admin/ui/common/admin-navigation/AdminNavigation'
import AdminSectionHeading from '@/screens/admin/ui/common/admin-section-heading/AdminSectionHeading'
import Heading from '@/shared/ui/heading/Heading'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import SupportNotificationSettings from './SupportNotificationSettings'
import styles from './AdminSupport.module.scss'

type DraftFile = {
	commandId: string
	file: File
	preview: string
	attachment?: SupportAttachment
	state: 'uploading' | 'ready' | 'error'
	error?: string
}
type ReplyDraft = {
	text: string
	files: DraftFile[]
	pending?: SupportReplyCommand
	busy: boolean
	error?: string
}
type StatusCommand = Parameters<typeof adminSupportApi.status>[2]
const dateLabel = (value: string) =>
	new Date(value).toLocaleString('ru-RU')
const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : 'Не удалось выполнить действие.'

function SupportWorkspace({
	actor,
	isDev,
	sessionReady
}: {
	actor: string
	isDev: boolean
	sessionReady: boolean
}) {
	const search = useSearchParams()
	const router = useRouter()
	const incoming = search.getAll('conversationId')
	const linked =
		incoming.length === 1 && SUPPORT_UUID.test(incoming[0])
			? incoming[0]
			: null
	const [selected, setSelected] = useState<string | null>(linked)
	const workspace = useRef<HTMLDivElement>(null)
	const previousSelection = useRef<string | null>(null)
	useEffect(() => {
		const changed = selected !== previousSelection.current
		previousSelection.current = selected
		if (changed && window.matchMedia?.('(max-width: 991px)').matches)
			workspace.current?.scrollIntoView({ block: 'start' })
	}, [selected])
	const [page, setPage] = useState(1)
	const [searchDraft, setSearchDraft] = useState('')
	const [filter, setFilter] = useState<{
		status: SupportStatus | ''
		q: string
		unreadOnly: boolean
	}>({ status: '', q: '', unreadOnly: false })
	const [visible, setVisible] = useState(true)
	const [validActor, setValidActor] = useState(true)
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
	const [loadingFile, setLoadingFile] = useState(false)
	const drafts = useRef(new Map<string, ReplyDraft>())
	const statuses = useRef(
		new Map<
			string,
			{
				command: StatusCommand
				busy: boolean
				error?: string
				conflict?: boolean
			}
		>()
	)
	const [, redraw] = useState(0)
	const mounted = useRef(true)
	const current = useCallback(
		() =>
			mounted.current &&
			supportActorIsCurrent(actor) &&
			useAuthStore.getState().auth,
		[actor]
	)
	const render = () => {
		if (current()) redraw(value => value + 1)
	}
	const client = useQueryClient()
	const prefix = ['admin-support', actor]
	const invalidate = () => {
		void client.invalidateQueries({ queryKey: prefix })
		void client.invalidateQueries({ queryKey: ['admin-event-log'] })
	}
	useEffect(() => {
		if (linked) {
			setSelected(linked)
			setOlder(null)
		}
	}, [linked])
	useEffect(() => {
		const check = () => {
			setVisible(document.visibilityState !== 'hidden')
			const matches =
				supportActorIsCurrent(actor) && useAuthStore.getState().auth
			setValidActor(matches)
			if (!matches) {
				drafts.current.forEach(draft =>
					draft.files.forEach(item => URL.revokeObjectURL(item.preview))
				)
				drafts.current.clear()
				statuses.current.clear()
				setPreview(null)
			}
		}
		check()
		const timer = setInterval(check, 1000)
		document.addEventListener('visibilitychange', check)
		window.addEventListener('focus', check)
		return () => {
			clearInterval(timer)
			document.removeEventListener('visibilitychange', check)
			window.removeEventListener('focus', check)
		}
	}, [actor])
	useEffect(() => {
		mounted.current = true
		const ownDrafts = drafts.current
		return () => {
			mounted.current = false
			ownDrafts.forEach(draft =>
				draft.files.forEach(item => URL.revokeObjectURL(item.preview))
			)
			ownDrafts.clear()
		}
	}, [])
	useEffect(
		() => () => {
			if (preview) URL.revokeObjectURL(preview.url)
		},
		[preview]
	)
	const polling = {
		enabled: sessionReady && validActor && visible,
		retry: false as const,
		staleTime: 0,
		gcTime: 0,
		refetchInterval: 5000,
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: 'always' as const,
		refetchOnReconnect: 'always' as const
	}
	const list = useQuery({
		queryKey: [...prefix, 'list', page, filter],
		queryFn: () =>
			adminSupportApi.list(actor, {
				page,
				limit: 20,
				...(filter.status ? { status: filter.status } : {}),
				...(filter.q ? { q: filter.q } : {}),
				...(filter.unreadOnly ? { unreadOnly: true } : {})
			}),
		...polling
	})
	const detail = useQuery({
		queryKey: [...prefix, selected, 'detail'],
		queryFn: () => adminSupportApi.detail(actor, selected!),
		...polling,
		enabled: polling.enabled && !!selected
	})
	const history = useQuery({
		queryKey: [...prefix, selected, 'history'],
		queryFn: () => adminSupportApi.history(actor, selected!),
		...polling,
		enabled: polling.enabled && !!selected && detail.isSuccess
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
	const settings = useQuery({
		queryKey: [...prefix, 'settings'],
		queryFn: () => adminSupportApi.settings(actor),
		enabled: sessionReady && validActor,
		retry: false
	})
	const through = history.data?.items.at(-1)?.sequence ?? 0
	const marked = useRef(new Map<string, number>())
	useEffect(() => {
		if (
			!visible ||
			!validActor ||
			!selected ||
			!through ||
			through <= (marked.current.get(selected) ?? 0)
		)
			return
		let active = true
		void adminSupportApi
			.read(actor, selected, through)
			.then(() => {
				if (active && current()) {
					marked.current.set(selected, through)
					void client.invalidateQueries({
						queryKey: ['admin-support', actor, 'list']
					})
				}
			})
			.catch(() => undefined)
		return () => {
			active = false
		}
	}, [
		actor,
		selected,
		visible,
		validActor,
		through,
		current,
		client,
		history.dataUpdatedAt
	])
	const select = (id: string | null) => {
		setSelected(id)
		setOlder(null)
		const params = new URLSearchParams(search.toString())
		if (id) params.set('conversationId', id)
		else params.delete('conversationId')
		router.replace(`/admin/support${params.size ? `?${params}` : ''}`, {
			scroll: false
		})
	}
	const getDraft = (id: string) => {
		let draft = drafts.current.get(id)
		if (!draft) {
			draft = { text: '', files: [], busy: false }
			drafts.current.set(id, draft)
		}
		return draft
	}
	const draft = selected ? getDraft(selected) : null
	const send = async () => {
		if (
			!selected ||
			!draft ||
			!sessionReady ||
			draft.busy ||
			!current() ||
			!useAuthStore.getState().isAuthResolved
		)
			return
		const id = selected
		try {
			if (
				!draft.text.trim() ||
				draft.files.some(item => item.state !== 'ready')
			)
				throw new Error('Введите ответ и дождитесь загрузки изображений.')
			draft.pending ??= {
				commandId: crypto.randomUUID(),
				expectedActorSubject: actor,
				text: draft.text.trim(),
				attachmentIds: draft.files.map(item => item.attachment!.id)
			}
			draft.busy = true
			draft.error = undefined
			render()
			await adminSupportApi.reply(actor, id, draft.pending)
			if (!current()) return
			draft.files.forEach(item => URL.revokeObjectURL(item.preview))
			drafts.current.delete(id)
			invalidate()
			clearFeedback()
		} catch (error) {
			if (!current()) return
			draft.error = errorMessage(error)
			setViewError(draft.error)
			if (
				error instanceof SupportAdminError &&
				[400, 403, 404, 413].includes(error.status ?? 0)
			)
				draft.pending = undefined
		} finally {
			draft.busy = false
			render()
		}
	}
	const upload = async (id: string, item: DraftFile) => {
		if (!current()) return
		if (!useAuthStore.getState().isAuthResolved) {
			item.state = 'error'
			item.error =
				'Сессия обновляется. Повторите загрузку после её восстановления.'
			render()
			return
		}
		item.state = 'uploading'
		item.error = undefined
		render()
		try {
			const attachment = await adminSupportApi.upload(
				actor,
				id,
				item.file,
				item.commandId
			)
			if (current()) {
				item.attachment = attachment
				item.state = 'ready'
				clearFeedback()
			}
		} catch (error) {
			if (current()) {
				item.state = 'error'
				item.error = errorMessage(error)
			}
		}
		render()
	}
	const addFiles = async (files: FileList | null) => {
		if (!files || !selected || !draft || draft.pending) return
		try {
			const chosen = Array.from(files)
			if (chosen.length + draft.files.length > 3)
				throw new Error('Можно добавить до трёх изображений.')
			chosen.forEach(validateSupportFile)
			const id = selected
			const added = chosen.map(file => ({
				commandId: crypto.randomUUID(),
				file,
				preview: URL.createObjectURL(file),
				state: 'uploading' as const
			}))
			draft.files.push(...added)
			render()
			for (const item of added) await upload(id, item)
		} catch (error) {
			if (current()) setViewError(errorMessage(error))
		}
	}
	const removeFile = async (item: DraftFile) => {
		if (
			!draft ||
			draft.pending ||
			item.state === 'uploading' ||
			!useAuthStore.getState().isAuthResolved
		)
			return
		try {
			if (item.attachment)
				await adminSupportApi.remove(actor, item.attachment.id)
			if (!current()) return
			draft.files = draft.files.filter(file => file !== item)
			URL.revokeObjectURL(item.preview)
			render()
			clearFeedback()
		} catch (error) {
			if (current()) setViewError(errorMessage(error))
		}
	}
	const changeStatus = async (status?: SupportStatus) => {
		if (
			!selected ||
			!detail.data ||
			!current() ||
			!useAuthStore.getState().isAuthResolved
		)
			return
		const id = selected
		let pending = statuses.current.get(id)
		if (pending?.busy || pending?.conflict) return
		if (!pending) {
			if (!status || status === detail.data.status) return
			pending = {
				command: {
					commandId: crypto.randomUUID(),
					expectedActorSubject: actor,
					expectedVersion: detail.data.version,
					status
				},
				busy: false
			}
			statuses.current.set(id, pending)
		}
		pending.busy = true
		pending.error = undefined
		render()
		try {
			await adminSupportApi.status(actor, id, pending.command)
			if (!current()) return
			statuses.current.delete(id)
			invalidate()
			clearFeedback()
		} catch (error) {
			if (!current()) return
			pending.error = errorMessage(error)
			pending.conflict =
				error instanceof SupportAdminError && error.status === 409
			setViewError(pending.error)
		} finally {
			pending.busy = false
			render()
		}
	}
	const loadOlder = async () => {
		if (!selected || loadingOlder) return
		const id = selected
		const first =
			older?.id === id
				? older.items[0]?.sequence
				: history.data?.items[0]?.sequence
		if (!first) return
		setLoadingOlder(true)
		try {
			const result = await adminSupportApi.history(actor, id, first)
			if (current())
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
			if (current()) setViewError(errorMessage(error))
		} finally {
			if (current()) setLoadingOlder(false)
		}
	}
	const viewFile = async (attachment: SupportAttachment) => {
		if (loadingFile) return
		setLoadingFile(true)
		try {
			const blob = await adminSupportApi.content(actor, attachment)
			if (current()) {
				setPreview({
					url: URL.createObjectURL(blob),
					name: attachment.fileName
				})
			}
		} catch (error) {
			if (current()) setViewError(errorMessage(error))
		} finally {
			if (current()) setLoadingFile(false)
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
	const statusCommand = selected
		? statuses.current.get(selected)
		: undefined
	const historyPanel = useRef<HTMLDivElement>(null)
	useEffect(() => {
		const panel = historyPanel.current
		if (through && panel) panel.scrollTop = panel.scrollHeight
	}, [selected, through])
	if (!validActor)
		return (
			<p className={styles.error}>
				Учётная запись изменилась. Перезагрузите страницу поддержки.
			</p>
		)
	return (
		<>
			{viewError && (
				<p className={styles.error} role="alert">
					{viewError}
				</p>
			)}
			{!sessionReady && (
				<p className={styles.hint} role="status">
					Продлеваем сессию. Черновик сохранён; отправка станет доступна
					после проверки.
				</p>
			)}
			<form
				className={styles.filters}
				data-thread-open={!!selected}
				onSubmit={event => {
					event.preventDefault()
					setPage(1)
					setFilter(value => ({ ...value, q: searchDraft.trim() }))
				}}
			>
				<label>
					Поиск
					<input
						maxLength={160}
						placeholder="Номер, тема, автор или компания"
						value={searchDraft}
						onChange={event => setSearchDraft(event.target.value)}
					/>
				</label>
				<label>
					Статус
					<select
						value={filter.status}
						onChange={event => {
							setPage(1)
							setFilter(value => ({
								...value,
								status: event.target.value as SupportStatus | ''
							}))
						}}
					>
						<option value="">Все</option>
						{SUPPORT_STATUSES.map(status => (
							<option key={status} value={status}>
								{supportStatusLabels[status]}
							</option>
						))}
					</select>
				</label>
				<label className={styles.checkbox}>
					<input
						type="checkbox"
						checked={filter.unreadOnly}
						onChange={event => {
							setPage(1)
							setFilter(value => ({
								...value,
								unreadOnly: event.target.checked
							}))
						}}
					/>
					Непрочитанные
				</label>
				<button type="submit" className={styles.primary}>
					Найти
				</button>
			</form>
			<div
				ref={workspace}
				className={styles.workspace}
				data-thread-open={!!selected}
			>
				<section className={styles.list} aria-label="Обращения поддержки">
					{list.isPending && <p>Загружаем обращения…</p>}
					{list.isError && (
						<p role="alert">
							Не удалось получить список.{' '}
							<button
								onClick={() => {
									void list.refetch()
									clearFeedback()
								}}
							>
								Повторить
							</button>
						</p>
					)}
					{list.data?.items.length === 0 && (
						<p className={styles.hint}>Обращения не найдены.</p>
					)}
					{list.data?.items.map(item => (
						<button
							key={item.id}
							type="button"
							className={
								item.id === selected
									? styles.selectedTicket
									: styles.ticket
							}
							onClick={() => select(item.id)}
						>
							<span className={styles.ticketMeta}>
								№ {item.number} · {supportStatusLabels[item.status]}
								{item.unreadCount > 0 && <b>{item.unreadCount} новых</b>}
							</span>
							<strong>{item.subject}</strong>
							<span>{item.authorName || item.authorSubject}</span>
							<span>{item.companyName || 'Без компании'}</span>
							<time dateTime={item.lastMessageAt}>
								{dateLabel(item.lastMessageAt)}
							</time>
						</button>
					))}
					{list.data && list.data.total > 20 && (
						<div className={styles.pagination}>
							<button
								type="button"
								disabled={page <= 1}
								onClick={() => {
									setPage(value => value - 1)
								}}
							>
								Назад
							</button>
							<span>
								{page} / {Math.ceil(list.data.total / 20)}
							</span>
							<button
								type="button"
								disabled={page * 20 >= list.data.total}
								onClick={() => {
									setPage(value => value + 1)
								}}
							>
								Далее
							</button>
						</div>
					)}
				</section>
				<section
					className={styles.conversation}
					aria-label="Переписка поддержки"
				>
					{!selected && (
						<div className={styles.empty}>
							Выберите обращение, чтобы прочитать переписку и ответить.
						</div>
					)}
					{selected && (
						<>
							<header className={styles.threadHeader}>
								<button type="button" onClick={() => select(null)}>
									← К списку
								</button>
								<h3>
									{detail.data
										? `№ ${detail.data.number} · ${detail.data.subject}`
										: 'Обращение'}
								</h3>
								{detail.data && (
									<>
										<p>
											{detail.data.authorName || detail.data.authorSubject}{' '}
											· {detail.data.companyName || 'Без компании'}
										</p>
										<p className={styles.hint}>
											Раздел: {detail.data.section} · CRM{' '}
											{detail.data.appVersion}
										</p>
										<label>
											Статус
											<select
												value={
													statusCommand?.command.status ??
													detail.data.status
												}
												disabled={!!statusCommand || !sessionReady}
												onChange={event =>
													void changeStatus(
														event.target.value as SupportStatus
													)
												}
											>
												{SUPPORT_STATUSES.map(status => (
													<option key={status} value={status}>
														{supportStatusLabels[status]}
													</option>
												))}
											</select>
										</label>
									</>
								)}
								{statusCommand?.error && (
									<p role="alert" className={styles.error}>
										{statusCommand.error}{' '}
										{statusCommand.conflict ? (
											<button
												onClick={async () => {
													const fresh = await detail.refetch()
													if (fresh.isSuccess && selected && current()) {
														statuses.current.delete(selected)
														render()
														clearFeedback()
													}
												}}
											>
												Проверить актуальный статус
											</button>
										) : (
											<button
												disabled={statusCommand.busy || !sessionReady}
												onClick={() => void changeStatus()}
											>
												Повторить изменение
											</button>
										)}
									</p>
								)}
							</header>
							<div
								ref={historyPanel}
								className={styles.history}
								aria-live="polite"
								aria-relevant="additions"
							>
								{(detail.isPending || history.isPending) && (
									<p>Загружаем переписку…</p>
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
								{(older?.id === selected
									? older.hasMore
									: history.data?.hasMore) && (
									<button
										className={styles.older}
										disabled={loadingOlder}
										onClick={() => void loadOlder()}
									>
										Предыдущие сообщения
									</button>
								)}
								{messages.map(message => (
									<article
										key={message.id}
										className={
											message.senderKind === 'OPERATOR'
												? styles.ownMessage
												: styles.message
										}
									>
										<div className={styles.messageMeta}>
											<strong>
												{message.senderKind === 'OPERATOR'
													? 'Специалист поддержки'
													: message.senderName || 'Клиент'}
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
												className={styles.attachment}
												disabled={loadingFile}
												onClick={() => void viewFile(attachment)}
											>
												▧ {attachment.fileName}
											</button>
										))}
									</article>
								))}
							</div>
							{draft && detail.isSuccess && (
								<form
									className={styles.composer}
									onSubmit={event => {
										event.preventDefault()
										void send()
									}}
								>
									<label>
										Ответ клиенту
										<textarea
											rows={3}
											maxLength={10000}
											required
											disabled={!!draft.pending}
											value={draft.text}
											onChange={event => {
												draft.text = event.target.value
												render()
											}}
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
															onClick={() => void upload(selected, item)}
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
												' Повтор сохранит исходное сообщение без дубля.'}
										</p>
									)}
									<div className={styles.actions}>
										<label className={styles.fileButton}>
											Добавить скриншоты
											<input
												type="file"
												multiple
												accept="image/png,image/jpeg,image/webp"
												disabled={
													!sessionReady ||
													!!draft.pending ||
													draft.files.length >= 3
												}
												onChange={event => {
													void addFiles(event.target.files)
													event.target.value = ''
												}}
											/>
										</label>
										<button
											type="submit"
											className={styles.primary}
											disabled={
												!sessionReady ||
												draft.busy ||
												!draft.text.trim() ||
												draft.files.some(item => item.state !== 'ready')
											}
										>
											{draft.busy
												? 'Отправляем…'
												: draft.pending
													? 'Повторить ответ'
													: 'Отправить ответ'}
										</button>
									</div>
									<p className={styles.hint}>
										До 3 PNG/JPEG/WebP по 5 МБ. Письмо клиенту не содержит
										текст ответа.
									</p>
								</form>
							)}
						</>
					)}
				</section>
			</div>
			{settings.data && (
				<SupportNotificationSettings
					actor={actor}
					isDev={isDev}
					sessionReady={sessionReady}
					initial={settings.data}
					current={current}
					onSaved={invalidate}
				/>
			)}
			{settings.isError && (
				<p className={styles.error}>
					Настройки уведомлений недоступны.{' '}
					<button
						onClick={() => {
							void settings.refetch()
							clearFeedback()
						}}
					>
						Повторить
					</button>
				</p>
			)}
			{preview && (
				<SupportImagePreview
					preview={preview}
					onClose={() => setPreview(null)}
				/>
			)}
		</>
	)
}
function SupportImagePreview({
	preview,
	onClose
}: {
	preview: { url: string; name: string }
	onClose: () => void
}) {
	const dialog = useRef<HTMLDialogElement>(null)
	useEffect(() => {
		const element = dialog.current
		const previous =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null
		element?.showModal()
		return () => {
			element?.close()
			if (previous?.isConnected) previous.focus()
		}
	}, [])
	return (
		<dialog
			ref={dialog}
			className={styles.preview}
			aria-label="Скриншот"
			onCancel={event => {
				event.preventDefault()
				onClose()
			}}
		>
			<button
				type="button"
				onClick={onClose}
				aria-label="Закрыть скриншот"
			>
				×
			</button>
			{/* eslint-disable-next-line @next/next/no-img-element */}
			<img src={preview.url} alt={preview.name} />
			<a href={preview.url} download={preview.name}>
				Скачать изображение
			</a>
		</dialog>
	)
}

export default function AdminSupport() {
	const auth = useAuthStore(state => state.auth)
	const resolved = useAuthStore(state => state.isAuthResolved)
	const { user, isLoading } = useUser()
	const permitted =
		auth &&
		user.id &&
		supportActorIsCurrent(user.id) &&
		user.rights?.some(
			role => role === UserRole.ADMIN || role === UserRole.DEV
		)
	return (
		<section className={styles.wrapper}>
			<Heading text="Панель администратора" />
			<AdminNavigation />
			<AdminSectionHeading
				text="Поддержка"
				title="Обращения из CRM"
				description="Личная переписка клиента с командой сервиса. Доступ к обращениям не зависит от роли клиента в компании."
				risk="medium"
				riskText="Ответы и изменения статуса фиксируются в Журнале событий. Содержимое переписки и скриншоты не включаются в технический аудит."
			/>
			{permitted ? (
				<Suspense fallback={<p>Загружаем поддержку…</p>}>
					<SupportWorkspace
						key={user.id}
						actor={user.id!}
						isDev={!!user.rights?.includes(UserRole.DEV)}
						sessionReady={resolved && !isLoading}
					/>
				</Suspense>
			) : (
				<p>
					{isLoading || !resolved
						? 'Проверяем доступ…'
						: 'Поддержка доступна ADMIN и DEV сервиса.'}
				</p>
			)}
		</section>
	)
}
