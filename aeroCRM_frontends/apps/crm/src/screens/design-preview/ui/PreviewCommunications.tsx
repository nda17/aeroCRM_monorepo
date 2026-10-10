'use client'

import { useState } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { AppIcon } from '@/shared/ui/app-icon'
import { Drawer } from '@/shared/ui/drawer'
import type { PreviewThread } from '../model/workspace-data'
import {
	PreviewEmpty,
	PreviewHeading,
	PreviewSearch,
	PreviewStatus,
	previewInitials,
	previewMatches
} from './PreviewPrimitives'
import styles from './DesignPreview.module.scss'

type Channel = PreviewThread['channel']
type MailFolder = 'incoming' | 'sent' | 'archived'
type InboxFolder = 'all' | PreviewThread['status']
type LocalMessage = { id: string; body: string; time: string }

type PreviewCommunicationsProps = {
	active?: boolean
	channel: Channel
	threads: PreviewThread[]
	setThreads: Dispatch<SetStateAction<PreviewThread[]>>
	selectedId: string | null
	onSelect: (id: string | null) => void
	onOpenDeal: (id: string) => void
	onAccept: (thread: PreviewThread) => void
	onCopyToInbox: (thread: PreviewThread) => void
}

const channelCopy = {
	mail: {
		eyebrow: 'КОММУНИКАЦИИ',
		title: 'Корпоративная почта',
		description: 'Письма клиентов и переписка команды',
		empty: 'Писем пока нет'
	},
	inbox: {
		eyebrow: 'КОММУНИКАЦИИ',
		title: 'Обращения',
		description: 'Новые запросы и принятые в работу обращения',
		empty: 'Обращений пока нет'
	},
	chat: {
		eyebrow: 'КОММУНИКАЦИИ',
		title: 'Сообщения',
		description: 'Личные диалоги с коллегами и общий чат команды',
		empty: 'Диалогов пока нет'
	}
} as const

const statusLabel = {
	new: 'Новое',
	accepted: 'В работе',
	archived: 'В архиве'
} as const

export default function PreviewCommunications({
	active = true,
	channel,
	threads,
	setThreads,
	selectedId,
	onSelect,
	onOpenDeal,
	onAccept,
	onCopyToInbox
}: PreviewCommunicationsProps) {
	const [search, setSearch] = useState('')
	const [mailFolder, setMailFolder] = useState<MailFolder>('incoming')
	const [inboxFolder, setInboxFolder] = useState<InboxFolder>('all')
	const [sentThreadIds, setSentThreadIds] = useState<string[]>([])
	const [composedIds, setComposedIds] = useState<string[]>([])
	const [copiedThreadIds, setCopiedThreadIds] = useState<string[]>([])
	const [beforeArchive, setBeforeArchive] = useState<
		Record<string, Exclude<PreviewThread['status'], 'archived'>>
	>({})
	const [messages, setMessages] = useState<Record<string, LocalMessage[]>>(
		{}
	)
	const [originalTimes, setOriginalTimes] = useState<
		Record<string, string>
	>({})
	const [drafts, setDrafts] = useState<Record<string, string>>({})
	const [composing, setComposing] = useState(false)
	const [newMail, setNewMail] = useState({
		recipient: '',
		subject: '',
		body: ''
	})
	const [createError, setCreateError] = useState('')
	const [notice, setNotice] = useState('')
	const copy = channelCopy[channel]
	const channelThreads = threads.filter(
		thread => thread.channel === channel
	)
	const selected = channelThreads.find(thread => thread.id === selectedId)
	const unreadCount = channelThreads.filter(thread => thread.unread).length
	const filtered = channelThreads.filter(thread => {
		const folderMatches =
			channel === 'mail'
				? mailFolder === 'sent'
					? sentThreadIds.includes(thread.id)
					: mailFolder === 'archived'
						? thread.status === 'archived'
						: thread.status !== 'archived' &&
							!composedIds.includes(thread.id)
				: channel === 'inbox'
					? inboxFolder === 'all' || thread.status === inboxFolder
					: true
		return (
			folderMatches &&
			previewMatches(
				search,
				thread.name,
				thread.company,
				thread.subject,
				thread.preview
			)
		)
	})

	const selectThread = (thread: PreviewThread) => {
		onSelect(thread.id)

		setNotice('')
		if (thread.unread) {
			setThreads(items =>
				items.map(item =>
					item.id === thread.id ? { ...item, unread: false } : item
				)
			)
		}
	}

	const changeSearch = (value: string) => {
		setSearch(value)
		onSelect(null)
		setNotice('')
	}

	const changeMailFolder = (folder: MailFolder) => {
		setMailFolder(folder)
		onSelect(null)

		setNotice('')
	}

	const changeInboxFolder = (folder: InboxFolder) => {
		setInboxFolder(folder)
		onSelect(null)

		setNotice('')
	}

	const changeStatus = (thread: PreviewThread) => {
		const status =
			thread.status === 'archived'
				? (beforeArchive[thread.id] ??
					(channel === 'inbox' && !thread.dealId ? 'new' : 'accepted'))
				: 'archived'
		if (thread.status !== 'archived') {
			const previous = thread.status
			setBeforeArchive(items => ({ ...items, [thread.id]: previous }))
		}
		setThreads(items =>
			items.map(item =>
				item.id === thread.id ? { ...item, status } : item
			)
		)
		setNotice(
			status === 'archived'
				? 'Перемещено в архив демоверсии'
				: 'Возвращено из архива демоверсии'
		)
		if (
			(status === 'archived' &&
				(channel === 'mail'
					? mailFolder !== 'archived'
					: inboxFolder !== 'archived')) ||
			(thread.status === 'archived' &&
				(channel === 'mail'
					? mailFolder === 'archived'
					: inboxFolder === 'archived'))
		) {
			onSelect(null)
		}
	}

	const acceptThread = (thread: PreviewThread) => {
		setThreads(items =>
			items.map(item =>
				item.id === thread.id
					? { ...item, status: 'accepted', unread: false }
					: item
			)
		)
		onAccept(thread)
		setNotice('Обращение принято в демоверсии')
	}

	const copyToInbox = (thread: PreviewThread) => {
		if (copiedThreadIds.includes(thread.id)) return
		onCopyToInbox(thread)
		setCopiedThreadIds(items => [...items, thread.id])
		setNotice('Письмо скопировано в обращения демоверсии')
	}

	const sendReply = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!selected) return
		const body = (drafts[selected.id] ?? '').trim()
		if (!body) return
		setOriginalTimes(items =>
			items[selected.id] === undefined
				? { ...items, [selected.id]: selected.time }
				: items
		)
		const entry = { id: `reply-${Date.now()}`, body, time: 'Сейчас' }
		setMessages(items => ({
			...items,
			[selected.id]: [...(items[selected.id] ?? []), entry]
		}))
		setDrafts(items => ({ ...items, [selected.id]: '' }))
		setThreads(items =>
			items.map(item =>
				item.id === selected.id
					? { ...item, preview: body, time: 'Сейчас', unread: false }
					: item
			)
		)
		if (channel === 'mail') {
			setSentThreadIds(items =>
				items.includes(selected.id) ? items : [...items, selected.id]
			)
		}
		setNotice(
			channel === 'chat'
				? 'Сообщение добавлено в демоверсии'
				: 'Ответ добавлен в демоверсии'
		)
	}

	const sendMail = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const recipient = newMail.recipient.trim()
		const subject = newMail.subject.trim()
		const body = newMail.body.trim()
		if (!recipient || !subject || !body) {
			setCreateError('Заполните адресата, тему и текст письма')
			return
		}
		const id = `demo-mail-${Date.now()}`
		const thread: PreviewThread = {
			id,
			name: recipient,
			company: 'Исходящее письмо',
			subject,
			preview: body,
			body,
			channel: 'mail',
			time: 'Сейчас',
			unread: false,
			status: 'accepted',
			dealId: null
		}
		setThreads(items => [thread, ...items])
		setComposedIds(items => [...items, id])
		setSentThreadIds(items => [...items, id])
		setMailFolder('sent')
		onSelect(id)

		setComposing(false)
		setNewMail({ recipient: '', subject: '', body: '' })
		setCreateError('')
		setNotice('Письмо добавлено в отправленные демоверсии')
	}

	return (
		<main className={styles.content}>
			<PreviewHeading
				eyebrow={copy.eyebrow}
				title={copy.title}
				description={copy.description}
				action={
					channel === 'mail' ? (
						<button
							className={styles.primaryButton}
							onClick={() => setComposing(true)}
						>
							<AppIcon name="plus" size={17} />
							Новое письмо
						</button>
					) : undefined
				}
			/>
			{channel !== 'chat' && (
				<div className={styles.viewBar}>
					<div
						className={`${styles.tabs} ${styles.folderTabs}`}
						aria-label={
							channel === 'mail' ? 'Папки почты' : 'Статусы обращений'
						}
					>
						{channel === 'mail'
							? (
									[
										['incoming', 'Входящие'],
										['sent', 'Отправленные'],
										['archived', 'Архив']
									] as const
								).map(([folder, label]) => (
									<button
										key={folder}
										className={
											mailFolder === folder ? styles.activeTab : ''
										}
										aria-pressed={mailFolder === folder}
										onClick={() => changeMailFolder(folder)}
									>
										{label}
									</button>
								))
							: (
									[
										['all', 'Все'],
										['new', 'Новые'],
										['accepted', 'В работе'],
										['archived', 'Архив']
									] as const
								).map(([folder, label]) => (
									<button
										key={folder}
										className={
											inboxFolder === folder ? styles.activeTab : ''
										}
										aria-pressed={inboxFolder === folder}
										onClick={() => changeInboxFolder(folder)}
									>
										{label}
									</button>
								))}
					</div>
				</div>
			)}
			<div className={styles.toolbar}>
				<PreviewSearch
					value={search}
					onChange={changeSearch}
					label={
						channel === 'chat' ? 'Поиск диалогов' : 'Поиск по переписке'
					}
					placeholder="Имя, компания или тема"
				/>
				<span className={styles.conversationMeta}>
					{unreadCount > 0
						? `Непрочитано: ${unreadCount}`
						: `${channel === 'chat' ? 'Диалогов' : 'Переписок'}: ${filtered.length}`}
				</span>
			</div>
			<div
				className={`${styles.communications} ${selected ? styles.mobileDetail : ''}`}
			>
				<section
					className={styles.conversationList}
					aria-label={channel === 'chat' ? 'Диалоги' : 'Переписки'}
				>
					{filtered.length === 0 ? (
						<PreviewEmpty
							title={search ? 'Ничего не найдено' : copy.empty}
							description={
								search
									? 'Попробуйте другой запрос.'
									: 'Здесь появятся сообщения демоверсии.'
							}
							reset={search ? () => changeSearch('') : undefined}
						/>
					) : (
						filtered.map(thread => (
							<button
								key={thread.id}
								type="button"
								className={`${styles.conversationItem} ${selected?.id === thread.id ? styles.conversationActive : ''}`}
								aria-current={
									selected?.id === thread.id ? 'true' : undefined
								}
								onClick={() => selectThread(thread)}
							>
								<span className={styles.avatar}>
									{previewInitials(thread.name)}
								</span>
								<span className={styles.conversationBody}>
									<span className={styles.conversationHeader}>
										<strong>{thread.name}</strong>
										<time>{thread.time}</time>
									</span>
									<span className={styles.conversationSubject}>
										{thread.subject}
									</span>
									<span className={styles.conversationSnippet}>
										{thread.preview}
									</span>
									<span className={styles.conversationMeta}>
										{thread.company}
									</span>
								</span>
								{thread.unread && (
									<span
										className={styles.unreadDot}
										aria-label="Не прочитано"
									/>
								)}
							</button>
						))
					)}
				</section>
				<section
					className={styles.conversationDetail}
					aria-label="Содержимое переписки"
				>
					{selected ? (
						<>
							<div className={styles.conversationHeader}>
								<button
									className={styles.mobileBack}
									type="button"
									onClick={() => {
										onSelect(null)
									}}
									aria-label="К списку переписок"
								>
									←
								</button>
								<span className={styles.avatar}>
									{previewInitials(selected.name)}
								</span>
								<div>
									<strong>{selected.name}</strong>
									<span className={styles.conversationMeta}>
										{selected.company}
									</span>
								</div>
								<PreviewStatus
									tone={
										selected.status === 'new'
											? 'purple'
											: selected.status === 'archived'
												? 'neutral'
												: 'success'
									}
								>
									{statusLabel[selected.status]}
								</PreviewStatus>
							</div>
							<div className={styles.conversationActions}>
								{selected.dealId && (
									<button
										className={styles.textButton}
										type="button"
										onClick={() => onOpenDeal(selected.dealId!)}
									>
										Открыть сделку
									</button>
								)}
								{channel === 'mail' &&
									!composedIds.includes(selected.id) && (
										<button
											className={styles.textButton}
											type="button"
											disabled={copiedThreadIds.includes(selected.id)}
											onClick={() => copyToInbox(selected)}
										>
											{copiedThreadIds.includes(selected.id)
												? 'В обращениях'
												: 'В обращения'}
										</button>
									)}
								{channel === 'inbox' && selected.status === 'new' && (
									<button
										className={styles.secondaryButton}
										type="button"
										onClick={() => acceptThread(selected)}
									>
										<AppIcon name="check" size={15} />
										Принять в работу
									</button>
								)}
								{channel !== 'chat' && (
									<button
										className={styles.textButton}
										type="button"
										onClick={() => changeStatus(selected)}
									>
										{selected.status === 'archived'
											? 'Вернуть из архива'
											: 'В архив'}
									</button>
								)}
							</div>
							<div className={styles.conversationBody}>
								<h2>{selected.subject}</h2>
								<div className={styles.replyMeta}>
									{composedIds.includes(selected.id)
										? 'Вы'
										: selected.name}
									<time className={styles.messageDate}>
										{originalTimes[selected.id] ?? selected.time}
									</time>
								</div>
								<p
									className={`${styles.messageBubble} ${composedIds.includes(selected.id) ? styles.messageOwn : ''}`}
								>
									{selected.body}
								</p>
								{(messages[selected.id] ?? []).map(message => (
									<div key={message.id} className={styles.messageOwn}>
										<div className={styles.replyMeta}>
											Вы
											<time className={styles.messageDate}>
												{message.time}
											</time>
										</div>
										<p className={styles.messageBubble}>{message.body}</p>
									</div>
								))}
							</div>
							<form className={styles.composer} onSubmit={sendReply}>
								<label htmlFor={`reply-${selected.id}`}>
									{channel === 'chat' ? 'Сообщение' : 'Ответить'}
								</label>
								<textarea
									id={`reply-${selected.id}`}
									value={drafts[selected.id] ?? ''}
									onChange={event =>
										setDrafts(items => ({
											...items,
											[selected.id]: event.target.value
										}))
									}
									rows={3}
									maxLength={4000}
									placeholder={
										channel === 'chat'
											? 'Напишите сообщение…'
											: 'Напишите ответ…'
									}
								/>
								<div className={styles.composerFooter}>
									<small>
										Сообщения сохраняются до перезагрузки страницы
									</small>
									<button
										className={styles.primaryButton}
										type="submit"
										disabled={!(drafts[selected.id] ?? '').trim()}
									>
										{channel === 'chat'
											? 'Отправить сообщение'
											: 'Отправить ответ'}
									</button>
								</div>
							</form>
						</>
					) : (
						<div className={styles.conversationPlaceholder}>
							<AppIcon
								name={channel === 'chat' ? 'chat' : 'mail'}
								size={28}
							/>
							<p>Выберите переписку из списка</p>
						</div>
					)}
				</section>
			</div>
			<p className={styles.notice} role="status" aria-live="polite">
				{notice}
			</p>
			<Drawer
				isOpen={active && composing && channel === 'mail'}
				onClose={() => setComposing(false)}
				title="Новое письмо"
				description="Исходящее письмо в демоверсии"
				className={styles.previewDrawer}
			>
				<form className={styles.createForm} onSubmit={sendMail}>
					<label>
						Кому
						<input
							type="email"
							required
							autoComplete="email"
							value={newMail.recipient}
							onChange={event => {
								setNewMail(value => ({
									...value,
									recipient: event.target.value
								}))
								setCreateError('')
							}}
							placeholder="name@example.com"
						/>
					</label>
					<label>
						Тема
						<input
							required
							maxLength={150}
							value={newMail.subject}
							onChange={event => {
								setNewMail(value => ({
									...value,
									subject: event.target.value
								}))
								setCreateError('')
							}}
							placeholder="Тема письма"
						/>
					</label>
					<label>
						Текст письма
						<textarea
							required
							maxLength={10000}
							rows={8}
							value={newMail.body}
							onChange={event => {
								setNewMail(value => ({
									...value,
									body: event.target.value
								}))
								setCreateError('')
							}}
							placeholder="Напишите письмо…"
						/>
					</label>
					{createError && (
						<p className={styles.notice} role="alert">
							{createError}
						</p>
					)}
					<p>
						Письмо появится в папке «Отправленные» только в этой
						демоверсии.
					</p>
					<div>
						<button
							className={styles.secondaryButton}
							type="button"
							onClick={() => setComposing(false)}
						>
							Закрыть черновик
						</button>
						<button className={styles.primaryButton} type="submit">
							Отправить в демоверсии
						</button>
					</div>
				</form>
			</Drawer>
		</main>
	)
}
