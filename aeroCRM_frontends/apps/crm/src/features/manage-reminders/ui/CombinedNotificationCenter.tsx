'use client'
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type ReactNode
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { useSessionStore } from '@/entities/session'
import type { TaskNotification } from '@/entities/crm-task-notifications'
import { AppIcon, Button, Drawer, useTooltip } from '@/shared/ui'
import { invalidContractError } from '@/shared/api/authenticated-http-client'
import {
	listCrmNotifications,
	readCrmNotification,
	type CrmNotification,
	type NotificationSource
} from '../api/crm-notifications.api'
import type { ReminderContext } from '../model/use-reminder-session'
import styles from './TaskNotificationCenter.module.scss'

type NotificationHead = {
	items: readonly (Pick<CrmNotification, 'id' | 'createdAt' | 'readAt'> &
		Partial<Pick<TaskNotification, 'kind' | 'dueAt'>>)[]
}
type HeadMarker = { at: number; ids: Set<string> }
type HeadObservation = {
	intake: NotificationHead | null
	support: NotificationHead | null
	tasks: NotificationHead | null
	open: boolean
	markers: Partial<Record<NotificationSource | 'tasks', HeadMarker>>
	notice: number
}

// DUE records are created ahead of time and become visible at their deadline.
const eventTime = (item: NotificationHead['items'][number]) =>
	Date.parse(
		item.kind === 'DUE' && item.dueAt ? item.dueAt : item.createdAt
	)

export function inspectNotificationHead(
	head: NotificationHead,
	previous?: HeadMarker
) {
	const at = Math.max(previous?.at ?? 0, ...head.items.map(eventTime))
	const ids = new Set(previous?.at === at ? previous.ids : [])
	const newEvent =
		!!previous &&
		head.items.some(
			item =>
				item.readAt === null &&
				(eventTime(item) > previous.at ||
					(eventTime(item) === previous.at && !previous.ids.has(item.id)))
		)
	for (const item of head.items)
		if (eventTime(item) === at) ids.add(item.id)
	return { marker: { at, ids: new Set([...ids].slice(-100)) }, newEvent }
}

export function CombinedNotificationCenter({
	context,
	open,
	setOpen,
	taskCount,
	taskSnapshot,
	taskContent,
	tab,
	setTab
}: {
	context: ReminderContext
	open: boolean
	setOpen: (open: boolean) => void
	taskCount: number | null
	taskSnapshot: NotificationHead | null
	taskContent: ReactNode
	tab: 'tasks' | NotificationSource
	setTab: (tab: 'tasks' | NotificationSource) => void
}) {
	const [page, setPage] = useState(1)
	const [unread, setUnread] = useState(false)
	const [busy, setBusy] = useState(false)
	const [observed, setObserved] = useState<HeadObservation | null>(null)
	const client = useQueryClient()
	const live = useRef(true)
	useLayoutEffect(() => {
		live.current = true
		return () => {
			live.current = false
		}
	}, [])
	const session = context.session
	const current = () =>
		live.current &&
		!!session &&
		useSessionStore.getState().session?.accessToken ===
			session.accessToken &&
		useSessionStore.getState().session?.userId === session.userId &&
		useSessionStore.getState().sessionRevision === context.sessionRevision
	const canIntake =
		!!session &&
		context.permissions.isSuccess &&
		context.authority?.subject === session.userId &&
		context.authority?.permissions.includes('intake:read')
	const deniedIntake = context.permissions.isSuccess && !canIntake
	const load = async (
		source: NotificationSource,
		requestedPage: number,
		requestedUnread: boolean
	) => {
		if (!current()) throw invalidContractError()
		const result = await listCrmNotifications(
			source,
			session!.accessToken,
			context.workspace.workspaceId,
			requestedPage,
			requestedUnread
		)
		if (!current()) throw invalidContractError()
		return result
	}
	const intake = useQuery({
		queryKey: [
			'crm-intake-notifications',
			context.key,
			tab === 'intake' ? page : 1,
			tab === 'intake' && unread
		],
		queryFn: () =>
			load(
				'intake',
				tab === 'intake' ? page : 1,
				tab === 'intake' && unread
			),
		enabled: !!canIntake,
		retry: false,
		gcTime: 0,
		refetchInterval: 60000
	})
	const support = useQuery({
		queryKey: [
			'crm-support-notifications',
			context.key,
			tab === 'support' ? page : 1,
			tab === 'support' && unread
		],
		queryFn: () =>
			load(
				'support',
				tab === 'support' ? page : 1,
				tab === 'support' && unread
			),
		enabled: !!session,
		retry: false,
		gcTime: 0,
		refetchInterval: 60000
	})
	// These observers share the default list requests. They remain on the
	// newest page when the drawer changes its filter or browses older records.
	const intakeHead = useQuery({
		queryKey: ['crm-intake-notifications', context.key, 1, false],
		queryFn: () => load('intake', 1, false),
		enabled: !!canIntake,
		retry: false,
		gcTime: 0,
		refetchInterval: 60000
	})
	const supportHead = useQuery({
		queryKey: ['crm-support-notifications', context.key, 1, false],
		queryFn: () => load('support', 1, false),
		enabled: !!session,
		retry: false,
		gcTime: 0,
		refetchInterval: 60000
	})
	const latestIntake =
		canIntake && intakeHead.isSuccess ? intakeHead.data : null
	const latestSupport =
		session && supportHead.isSuccess ? supportHead.data : null
	if (
		!observed ||
		observed.intake !== latestIntake ||
		observed.support !== latestSupport ||
		observed.tasks !== taskSnapshot ||
		observed.open !== open
	) {
		let newEvent = false
		const markers = { ...observed?.markers }
		for (const [source, head] of [
			['intake', latestIntake],
			['support', latestSupport],
			['tasks', taskSnapshot]
		] as const) {
			if (!head) continue
			const result = inspectNotificationHead(head, markers[source])
			markers[source] = result.marker
			newEvent ||= result.newEvent
		}
		setObserved({
			intake: latestIntake,
			support: latestSupport,
			tasks: taskSnapshot,
			open,
			markers,
			notice: open ? 0 : (observed?.notice ?? 0) + Number(newEvent)
		})
	}
	const notice = observed?.notice ?? 0
	useEffect(() => {
		if (!notice) return
		const timer = setTimeout(
			() => setObserved(value => value && { ...value, notice: 0 }),
			4000
		)
		return () => clearTimeout(timer)
	}, [notice])
	const counts = [
		taskCount,
		deniedIntake ? 0 : (latestIntake?.unreadCount ?? null),
		latestSupport?.unreadCount ?? null
	]
	const count = counts.reduce<number>((sum, n) => sum + (n ?? 0), 0)
	const partial = counts.some(n => n === null)
	const hint = useTooltip<HTMLButtonElement>(
		'Новые заявки, ответы поддержки и ваши задачи.',
		!open
	)
	const query = tab === 'intake' ? intake : support
	const mark = async (
		source: NotificationSource,
		item: CrmNotification
	) => {
		if (!current() || busy) return
		setBusy(true)
		try {
			await readCrmNotification(
				source,
				session!.accessToken,
				context.workspace.workspaceId,
				item
			)
			if (current())
				toast.success(
					item.readAt === null
						? 'Отмечено прочитанным'
						: 'Отмечено непрочитанным'
				)
		} catch {
			if (current())
				toast.error(
					'Не удалось подтвердить отметку. Обновляем уведомления.'
				)
		} finally {
			if (current()) {
				await client.invalidateQueries({
					queryKey: [
						source === 'intake'
							? 'crm-intake-notifications'
							: 'crm-support-notifications'
					]
				})
				if (source === 'support')
					await client.invalidateQueries({ queryKey: ['support-chat'] })
				setBusy(false)
			}
		}
	}
	return (
		<>
			<div className={styles.triggerGroup}>
				<button
					{...hint.triggerProps}
					type="button"
					className={styles.trigger}
					aria-label={
						partial
							? 'Уведомления, часть счётчиков недоступна'
							: 'Уведомления, непрочитанных: ' + count
					}
					aria-haspopup="dialog"
					aria-expanded={open}
					title="Уведомления"
					onClick={() => {
						hint.close()
						setOpen(true)
					}}
				>
					<AppIcon name="bell" size={20} />
					{count > 0 || partial ? (
						<span className={styles.badge} aria-hidden="true">
							{count > 99 ? '99+' : count || '…'}
						</span>
					) : null}
				</button>
				{notice > 0 && !open ? (
					<span
						className={styles.eventNotice}
						role="status"
						aria-live="polite"
					>
						Новое событие
					</span>
				) : null}
			</div>
			{hint.tooltip}
			<Drawer
				isOpen={open}
				onClose={() => setOpen(false)}
				title="Уведомления"
				description="Заявки, ответы поддержки, назначения и сроки задач."
				size="md"
			>
				<div className={styles.content}>
					<div
						className={styles.tabs}
						role="group"
						aria-label="Виды уведомлений"
					>
						{(['intake', 'support', 'tasks'] as const).map(source => (
							<Button
								key={source}
								variant={tab === source ? 'primary' : 'secondary'}
								aria-pressed={tab === source}
								onClick={() => {
									setTab(source)
									setPage(1)
								}}
							>
								{
									{
										intake: 'Заявки',
										support: 'Поддержка',
										tasks: 'Задачи'
									}[source]
								}
							</Button>
						))}
					</div>
					{partial ? (
						<p role="status">Часть счётчиков пока недоступна.</p>
					) : null}
					{tab === 'tasks' ? (
						taskContent
					) : (
						<>
							<div className={styles.controls}>
								<label>
									<input
										type="checkbox"
										checked={unread}
										disabled={busy}
										onChange={event => {
											setUnread(event.target.checked)
											setPage(1)
											toast('Фильтр уведомлений изменён')
										}}
									/>
									Только непрочитанные
								</label>
								<Button
									variant="secondary"
									disabled={busy || query.isFetching}
									onClick={() => {
										void query.refetch()
										toast('Обновляем уведомления')
									}}
								>
									Обновить
								</Button>
							</div>
							{tab === 'intake' && deniedIntake ? (
								<p>Недостаточно прав для просмотра заявок.</p>
							) : query.isError ? (
								<p role="alert">
									Не удалось загрузить уведомления. Попробуйте обновить
									список.
								</p>
							) : !query.data ? (
								<p role="status">Загружаем уведомления…</p>
							) : (
								<>
									<p>
										Всего: {query.data.total} · Непрочитанных:{' '}
										{query.data.unreadCount}
									</p>
									{query.data.items.length ? (
										<ul className={styles.items}>
											{query.data.items.map(item => (
												<li
													key={item.id}
													className={
														item.readAt === null
															? styles.unread
															: undefined
													}
												>
													<span className={styles.kind}>
														{tab === 'intake'
															? 'Новая заявка'
															: 'Ответ поддержки'}
													</span>
													<Link
														href={
															tab === 'intake'
																? '/inbox?workspaceId=' +
																	context.workspace.workspaceId +
																	'&entry=' +
																	item.targetId
																: '/planner?workspaceId=' +
																	context.workspace.workspaceId +
																	'&supportConversation=' +
																	item.targetId
														}
														onClick={event => {
															if (!current() || busy) {
																event.preventDefault()
																return
															}
															setOpen(false)
															toast(
																tab === 'intake'
																	? 'Открываем заявку'
																	: 'Открываем поддержку'
															)
														}}
													>
														{item.title}
													</Link>
													<span>
														{new Date(item.createdAt).toLocaleString(
															'ru-RU'
														)}
													</span>
													<Button
														variant="secondary"
														disabled={
															busy ||
															(tab === 'support' && item.readAt !== null)
														}
														onClick={() => void mark(tab, item)}
													>
														{item.readAt === null
															? 'Отметить прочитанным'
															: tab === 'support'
																? 'Прочитано'
																: 'Отметить непрочитанным'}
													</Button>
												</li>
											))}
										</ul>
									) : (
										<p>Уведомлений пока нет.</p>
									)}
									<div className={styles.controls}>
										<Button
											variant="secondary"
											disabled={busy || page <= 1}
											onClick={() => {
												setPage(n => n - 1)
												toast('Предыдущая страница')
											}}
										>
											Назад
										</Button>
										<span>
											{page} /{' '}
											{Math.max(1, Math.ceil(query.data.total / 10))}
										</span>
										<Button
											variant="secondary"
											disabled={busy || page * 10 >= query.data.total}
											onClick={() => {
												setPage(n => n + 1)
												toast('Следующая страница')
											}}
										>
											Далее
										</Button>
									</div>
								</>
							)}
						</>
					)}
				</div>
			</Drawer>
		</>
	)
}
