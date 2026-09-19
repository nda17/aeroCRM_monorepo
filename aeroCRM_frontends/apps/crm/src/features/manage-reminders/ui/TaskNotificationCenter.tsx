'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { CombinedNotificationCenter } from './CombinedNotificationCenter'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
	listTaskNotifications,
	setTaskNotificationRead,
	type TaskNotification,
	type TaskNotificationPage
} from '@/entities/crm-task-notifications'
import { invalidContractError } from '@/shared/api/authenticated-http-client'
import { AppIcon, Button, Drawer, useTooltip } from '@/shared/ui'
import {
	useReminderSession,
	type ReminderContext
} from '../model/use-reminder-session'
import styles from './TaskNotificationCenter.module.scss'

export const TaskNotificationCenter = () => {
	const context = useReminderSession()
	return <TaskNotificationSession key={context.key} context={context} />
}
const TaskNotificationSession = ({
	context
}: {
	context: ReminderContext
}) => {
	// Keep only drawer visibility while actor verification recovers. A new
	// workspace/session/scope resets it; the panel still remounts per actor.
	const [open, setOpen] = useState(false)
	const [tab, setTab] = useState<'intake' | 'support' | 'tasks'>('intake')
	return (
		<TaskNotificationPanel
			key={JSON.stringify([context.key, context.actor])}
			context={context}
			isOpen={open}
			onOpenChange={setOpen}
			render={({ count, content, latest }) => (
				<CombinedNotificationCenter
					context={context}
					open={open}
					setOpen={setOpen}
					taskCount={count}
					taskSnapshot={latest}
					taskContent={content}
					tab={tab}
					setTab={setTab}
				/>
			)}
		/>
	)
}
export const TaskNotificationPanel = ({
	context,
	isOpen,
	onOpenChange,
	render
}: {
	context: ReminderContext
	isOpen?: boolean
	onOpenChange?: (open: boolean) => void
	render?: (value: {
		count: number | null
		content: ReactNode
		latest: TaskNotificationPage | null
	}) => ReactNode
}) => {
	const [localOpen, setLocalOpen] = useState(false)
	const open = isOpen ?? localOpen
	const setOpen = onOpenChange ?? setLocalOpen
	const hint = useTooltip<HTMLButtonElement>(
		'Открыть ваши назначения и напоминания о сроках задач.',
		!open
	)
	const [page, setPage] = useState(1)
	const [unreadOnly, setUnreadOnly] = useState(false)
	const [busy, setBusy] = useState(false)
	const client = useQueryClient()
	const ready =
		context.canRead && context.actorConfirmed && !!context.actor
	const permissionDenied =
		!context.canRead &&
		!!context.session &&
		!!context.authority &&
		context.permissions.isSuccess &&
		!context.permissions.isFetching &&
		context.authority.subject === context.session.userId &&
		context.authority.workspaceId === context.workspace.workspaceId &&
		(context.authority.role === 'ANALYST' ||
			!context.authority.permissions.includes('sales:read'))
	const permissionError = !context.canRead && context.permissions.isError
	const actorError =
		context.canRead &&
		!context.actorConfirmed &&
		(context.self.error || (context.self.enabled && !context.self.loading))
	const load = async (requestedPage: number, requestedUnread: boolean) => {
		if (!context.current() || !context.actor || !context.session)
			throw invalidContractError()
		const result = await listTaskNotifications(
			context.session.accessToken,
			{
				workspaceId: context.workspace.workspaceId,
				actorMembershipId: context.actor.membershipId,
				page: requestedPage,
				pageSize: 10,
				unreadOnly: requestedUnread
			}
		)
		if (!context.current()) throw invalidContractError()
		return result
	}
	const query = useQuery({
		queryKey: [
			'crm-task-notifications',
			context.key,
			context.actor,
			page,
			unreadOnly
		],
		enabled: ready,
		retry: false,
		staleTime: 0,
		gcTime: 0,
		refetchInterval: 60000,
		refetchOnWindowFocus: true,
		queryFn: () => load(page, unreadOnly)
	})
	// Keep the first page observed while the open drawer browses older pages.
	// The usual first-page view shares this query, including its HTTP request.
	const head = useQuery({
		queryKey: [
			'crm-task-notifications',
			context.key,
			context.actor,
			1,
			false
		],
		queryFn: () => load(1, false),
		enabled: ready && !!render,
		retry: false,
		gcTime: 0,
		refetchInterval: 60000
	})
	const visible = ready && query.isSuccess
	const latest = ready && head.isSuccess ? head.data : null
	const count = render
		? (latest?.unreadCount ?? null)
		: visible
			? query.data.unreadCount
			: null
	const mark = async (item: TaskNotification) => {
		if (
			busy ||
			!ready ||
			!context.current() ||
			!context.actor ||
			!context.session
		)
			return
		setBusy(true)
		try {
			await setTaskNotificationRead(context.session.accessToken, {
				workspaceId: context.workspace.workspaceId,
				actorMembershipId: context.actor.membershipId,
				id: item.id,
				read: item.readAt === null
			})
			if (!context.current()) return
			toast.success(
				item.readAt === null
					? 'Отмечено прочитанным'
					: 'Отмечено непрочитанным'
			)
		} catch {
			if (context.current())
				toast.error(
					'Не удалось подтвердить отметку. Обновляем список; при необходимости повторите действие.'
				)
		} finally {
			if (context.current()) {
				await client.invalidateQueries({
					queryKey: ['crm-task-notifications']
				})
				setBusy(false)
			}
		}
	}
	const content = (
		<div className={styles.content}>
			<div className={styles.controls}>
				<label>
					<input
						type="checkbox"
						checked={unreadOnly}
						disabled={busy || !ready}
						onChange={event => {
							setUnreadOnly(event.target.checked)
							setPage(1)
							toast('Фильтр уведомлений изменён')
						}}
					/>
					Только непрочитанные
				</label>
				<Button
					variant="secondary"
					disabled={busy || !ready || query.isFetching}
					onClick={() => {
						void query.refetch()
						toast('Обновляем уведомления')
					}}
				>
					Обновить
				</Button>
			</div>
			{permissionDenied ? (
				<p role="alert">
					Недостаточно прав для просмотра уведомлений о задачах.
				</p>
			) : permissionError ? (
				<>
					<p role="alert">
						Не удалось проверить доступ к уведомлениям. Повторите проверку.
					</p>
					<Button
						variant="secondary"
						disabled={context.permissions.isFetching}
						onClick={() => {
							void context.permissions.refetch()
							toast('Повторно проверяем доступ к уведомлениям')
						}}
					>
						Проверить доступ
					</Button>
				</>
			) : actorError ? (
				<>
					<p role="alert">
						Не удалось подтвердить текущего сотрудника. Повторите проверку,
						чтобы загрузить его уведомления.
					</p>
					<Button
						variant="secondary"
						disabled={context.self.loading}
						onClick={() => {
							void context.self.refetch()
							toast('Повторно проверяем текущего сотрудника')
						}}
					>
						Проверить сотрудника
					</Button>
				</>
			) : !ready ? (
				<p role="status">Проверяем доступ к вашим уведомлениям…</p>
			) : query.isError ? (
				<p role="alert">
					Не удалось загрузить уведомления. Попробуйте обновить список.
				</p>
			) : !visible ? (
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
										item.readAt === null ? styles.unread : undefined
									}
								>
									<span className={styles.kind}>
										{item.kind === 'ASSIGNED'
											? 'Вам назначена задача'
											: 'Наступил срок задачи'}
									</span>
									<Link
										href={item.href}
										onClick={event => {
											if (!context.current() || busy) {
												event.preventDefault()
												return
											}
											setOpen(false)
											toast('Открываем задачу')
										}}
									>
										{item.title}
									</Link>
									<span>
										Срок: {new Date(item.dueAt).toLocaleString('ru-RU')}
									</span>
									<Button
										variant="secondary"
										disabled={busy}
										onClick={() => void mark(item)}
									>
										{item.readAt === null
											? 'Отметить прочитанным'
											: 'Отметить непрочитанным'}
									</Button>
								</li>
							))}
						</ul>
					) : (
						<p>
							{query.data.total
								? 'На этой странице уведомлений больше нет.'
								: 'Уведомлений пока нет.'}
						</p>
					)}
					<div className={styles.controls}>
						<Button
							variant="secondary"
							disabled={busy || page <= 1}
							onClick={() => {
								setPage(value => value - 1)
								toast('Предыдущая страница')
							}}
						>
							Назад
						</Button>
						<span>
							{page} / {Math.max(1, Math.ceil(query.data.total / 10))}
						</span>
						<Button
							variant="secondary"
							disabled={busy || page * 10 >= query.data.total}
							onClick={() => {
								setPage(value => value + 1)
								toast('Следующая страница')
							}}
						>
							Далее
						</Button>
					</div>
				</>
			)}
		</div>
	)
	if (render)
		return render({ count: permissionDenied ? 0 : count, content, latest })
	return (
		<>
			<button
				{...hint.triggerProps}
				type="button"
				className={styles.trigger}
				aria-label={
					count === null
						? 'Уведомления'
						: `Уведомления, непрочитанных: ${count}`
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
				{count !== null && count > 0 ? (
					<span className={styles.badge} aria-hidden="true">
						{count > 99 ? '99+' : count}
					</span>
				) : null}
			</button>
			{hint.tooltip}
			<Drawer
				isOpen={open}
				onClose={() => setOpen(false)}
				title="Уведомления"
				description="Ваши назначения и сроки задач. Почта и Telegram для этого раздела не нужны."
				size="md"
			>
				{content}
			</Drawer>
		</>
	)
}
