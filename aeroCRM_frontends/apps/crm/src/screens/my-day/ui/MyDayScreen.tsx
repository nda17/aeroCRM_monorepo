'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
	useWorkdaySession,
	useWorkdayTasks,
	type WorkdayFilters as Filters,
	type WorkdayTask,
	type WorkdayStatus
} from '@/entities/crm-workday'
import {
	useWorkdayCommand,
	WorkdayCreateTaskDrawer,
	WorkdayTaskDrawer,
	WorkdayNextTaskSuggestion,
	TaskSeriesPanel,
	type WorkdayCompletion
} from '@/features/manage-workday'
import type { SalesDeal } from '@/entities/sales'
import { isUuidV4 } from '@/shared/lib/contract'
import { WorkdayExportControl } from '@/features/export-records'
import {
	Button,
	ActionMenu,
	HelpHint,
	PageHeader,
	ReadOnlyBanner,
	ScreenState
} from '@/shared/ui'
import {
	initialWorkdayFilters,
	type WorkdayView
} from '../model/workday-view'
import { WorkdayCollection } from './WorkdayCollection'
import { WorkdayFilters } from './WorkdayFilters'
import { WorkdayInboxSummary } from './WorkdayInboxSummary'
import styles from './MyDayScreen.module.scss'

const MyDayContent = ({
	initialTaskId
}: {
	initialTaskId: string | null
}) => {
	const context = useWorkdaySession()
	const client = useQueryClient()
	const [filters, setFilters] = useState<Filters>(initialWorkdayFilters)
	const [view, setView] = useState<WorkdayView>('list')
	const [selected, setSelected] = useState<string | null>(initialTaskId)
	const [seriesOpen, setSeriesOpen] = useState(false)
	const [creating, setCreating] = useState<{
		deal: SalesDeal | null
	} | null>(null)
	const [completion, setCompletion] = useState<WorkdayCompletion | null>(
		null
	)
	const command = useWorkdayCommand('quick-status', (task, confirmed) => {
		setSelected(null)
		setCompletion({ task, command: confirmed, scopeKey: context.scopeKey })
	})
	const createNextTask = (deal: SalesDeal | null) => {
		if (
			!context.canWrite ||
			!context.current() ||
			!command.canClose() ||
			creating
		)
			return false
		setSelected(null)
		setCompletion(null)
		setCreating({ deal })
		return true
	}
	const overview = useWorkdayTasks({
		...filters,
		status: undefined,
		page: 1,
		pageSize: 1
	})
	// A newly mounted child observes the same stale permissions query and may
	// trigger a background refetch. Keep that bound subtree mounted (but hidden
	// and inert) until verification finishes; unmounting would refetch forever.
	const verifyingBoundAccess =
		context.permissions.isFetching &&
		context.permissions.isSuccess &&
		context.session !== null &&
		context.permissions.data.subject === context.session.userId &&
		context.permissions.data.workspaceId ===
			context.workspace.workspaceId &&
		context.permissions.data.role !== 'ANALYST' &&
		context.permissions.data.permissions.includes('sales:read')
	const updateStatus = (task: WorkdayTask, status: WorkdayStatus) => {
		if (command.locked || task.status === status) return
		if (command.hasPendingTask(task.id)) {
			setSelected(task.id)
			toast('Сначала подтвердите исходное сохранение этой задачи')
			return
		}
		void command.execute({
			kind: 'status',
			id: task.id,
			expectedVersion: task.version,
			status
		})
	}
	const reload = async () => {
		const auth = await context.permissions.refetch()
		if (auth.isError) {
			toast.error('Не удалось проверить доступ')
			return
		}
		if (
			auth.data?.subject !== context.session?.userId ||
			auth.data?.workspaceId !== context.workspace.workspaceId
		)
			return
		await client.invalidateQueries(
			{ queryKey: ['crm-workday'], refetchType: 'active' },
			{ throwOnError: true }
		)
		if (!context.current()) return
		await client.invalidateQueries(
			{
				queryKey: ['crm-inbox', context.workspace.workspaceId],
				refetchType: 'active'
			},
			{ throwOnError: true }
		)
		if (!context.current()) return
		command.resetAfterReview()
		toast.success('Задачи обновлены')
	}
	if (context.permissions.isError)
		return (
			<ScreenState
				variant="error"
				description="Не удалось проверить права на задачи."
				action={
					<Button onClick={() => void context.permissions.refetch()}>
						Повторить
					</Button>
				}
			/>
		)
	if (context.permissions.isPending)
		return <ScreenState variant="loading" />
	if (!context.canRead && !verifyingBoundAccess)
		return (
			<ScreenState
				variant="permission"
				description="Ваша роль не даёт доступа к задачам сотрудников."
			/>
		)
	return (
		<>
			{verifyingBoundAccess ? (
				<ScreenState
					variant="loading"
					description="Проверяем актуальные права доступа. Несохранённые поля остаются в открытой форме."
				/>
			) : null}
			<div
				hidden={verifyingBoundAccess}
				inert={verifyingBoundAccess}
				aria-hidden={verifyingBoundAccess}
			>
				<div className={styles.screen}>
					<PageHeader
						title="Планировщик"
						description={
							<>
								Задачи на день, просрочки и новые обращения.{' '}
								<HelpHint
									label="Планировщик"
									description="Фильтры меняют только список задач. Завершение задачи сохраняется отдельно; повторяющиеся задачи создаются по расписанию."
								/>
							</>
						}
						actions={
							<>
								{context.permissions.data?.permissions.includes(
									'sales:analytics'
								) && context.permissions.data.dataScope !== 'OWN' ? (
									<Link href="/analytics" className={styles.overviewLink}>
										Обзор команды
									</Link>
								) : null}
								<ActionMenu
									disabled={command.pending || command.ambiguous}
								>
									<Button
										variant="secondary"
										disabled={command.pending || command.ambiguous}
										tooltip="Открыть серии задач, которые создаются по расписанию, и управлять их повторением."
										disabledTooltip="Сначала подтвердите результат текущего изменения задачи."
										onClick={() => {
											setSeriesOpen(true)
											toast('Повторяющиеся задачи')
										}}
									>
										Повторяющиеся
									</Button>
									<WorkdayExportControl
										disabled={command.pending || command.ambiguous}
									/>
									<Button
										variant="secondary"
										disabled={command.pending || command.ambiguous}
										onClick={() =>
											void reload().catch(() =>
												toast.error('Не удалось обновить задачи')
											)
										}
										tooltip="Загрузить актуальные задачи с сервера, сохранив выбранные период и фильтры."
										disabledTooltip="Дождитесь подтверждения текущего изменения перед обновлением списка."
									>
										Обновить
									</Button>
								</ActionMenu>
								<Button
									disabled={!context.canWrite || command.locked}
									tooltip="Создать самостоятельную задачу или связать её со сделкой, указав срок и ответственного."
									disabledTooltip="Нужны права на изменение и подтверждённый результат предыдущей команды."
									onClick={() => setCreating({ deal: null })}
								>
									Новая задача
								</Button>
							</>
						}
					/>
					{!context.canWrite ? (
						<ReadOnlyBanner description="Задачи доступны для просмотра. Изменения требуют соответствующих прав и действующего доступа." />
					) : null}
					{seriesOpen ? (
						<TaskSeriesPanel onClose={() => setSeriesOpen(false)} />
					) : null}
					{command.error ? (
						<div className={styles.error} role="alert">
							<p>{command.error.message}</p>
							{command.ambiguous ? (
								<>
									<p>
										Результат ещё не подтверждён. Повторная проверка
										использует ту же команду, без второго изменения.
									</p>
									<Button
										variant="secondary"
										disabled={!command.canRetry}
										tooltip="Повторить прежнюю команду с теми же данными, чтобы подтвердить результат без второго изменения."
										isLoading={command.pending}
										onClick={() => void command.execute()}
									>
										Проверить сохранение
									</Button>
								</>
							) : command.blocked ? (
								<Button
									variant="secondary"
									onClick={() =>
										void reload().catch(() =>
											toast.error('Не удалось обновить задачи')
										)
									}
								>
									Обновить данные и проверить
								</Button>
							) : null}
						</div>
					) : null}
					{completion ? (
						<WorkdayNextTaskSuggestion
							key={completion.command.commandId}
							completion={completion}
							context={context}
							disabled={
								command.locked || selected !== null || creating !== null
							}
							onCreate={createNextTask}
							onDismiss={() => setCompletion(null)}
						/>
					) : null}
					<WorkdayFilters
						key={JSON.stringify(filters)}
						value={filters}
						view={view}
						allowedScopes={context.scopes}
						peopleContext={{
							workspaceId: context.workspace.workspaceId,
							subject: context.session?.userId,
							accessToken: context.session?.accessToken,
							sessionRevision: context.sessionRevision,
							canRead: context.canRead,
							isCurrent: context.current,
							authority: context.permissions.data
						}}
						onChange={next => {
							if (!command.canClose()) return false
							setSelected(null)
							setFilters(next)
							return true
						}}
						onViewChange={next => {
							if (!command.canClose()) return false
							setSelected(null)
							setView(next)
							setFilters(value => ({
								...value,
								status: undefined,
								page: 1
							}))
							return true
						}}
					/>
					{overview.data ? (
						<p className={styles.hint}>
							Данные на{' '}
							{new Intl.DateTimeFormat('ru-RU', {
								dateStyle: 'medium',
								timeStyle: 'medium',
								timeZone: filters.timeZone
							}).format(new Date(overview.data.asOf))}{' '}
							({filters.timeZone}). Для актуальных сроков и счётчиков
							нажмите «Обновить».
						</p>
					) : null}
					{overview.query.isError ? (
						<div role="alert" className={styles.error}>
							Счётчики временно недоступны.
							<Button
								variant="secondary"
								onClick={() => void overview.query.refetch()}
							>
								Повторить
							</Button>
						</div>
					) : (
						<section
							className={styles.summary}
							aria-label="Сводка по выбранному периоду"
							aria-busy={overview.query.isFetching}
						>
							{(
								[
									['OPEN', 'К выполнению'],
									['IN_PROGRESS', 'В работе'],
									['COMPLETED', 'Готово']
								] as const
							).map(([status, label]) => (
								<button
									type="button"
									className={styles.summaryItem}
									key={status}
									disabled={command.pending || command.ambiguous}
									onClick={() => {
										if (!command.canClose()) return
										setSelected(null)
										setView('list')
										setFilters(value => ({ ...value, status, page: 1 }))
										toast(`Показаны задачи: ${label.toLowerCase()}`)
									}}
								>
									<span className={styles.hint}>{label}</span>
									<strong className={styles.summaryValue}>
										{overview.data?.counts[status] ?? '—'}
									</strong>
								</button>
							))}
							<button
								className={`${styles.summaryItem} ${styles.overdue}`}
								disabled={command.pending || command.ambiguous}
								onClick={() => {
									setFilters(value => ({
										...value,
										period: 'OVERDUE',
										from: undefined,
										to: undefined,
										status: undefined,
										page: 1
									}))
									toast('Показаны просроченные задачи')
								}}
							>
								<span>Просрочено за все дни</span>
								<strong className={styles.summaryValue}>
									{overview.data?.overdueCount ?? '—'}
								</strong>
							</button>
						</section>
					)}
					<WorkdayInboxSummary
						disabled={command.pending || command.ambiguous}
					/>
					<WorkdayCollection
						key={JSON.stringify([
							context.key,
							{ ...filters, page: undefined },
							view
						])}
						filters={filters}
						view={view}
						canWrite={context.canWrite && !command.locked}
						onOpen={task => {
							if (command.canClose()) setSelected(task.id)
						}}
						onStatus={updateStatus}
						onPage={page => {
							if (command.canClose())
								setFilters(value => ({ ...value, page }))
						}}
					/>
					{selected ? (
						<WorkdayTaskDrawer
							taskId={selected}
							timeZone={filters.timeZone}
							onCreateNextTask={createNextTask}
							onClose={() => {
								if (command.canClose()) setSelected(null)
							}}
						/>
					) : null}
					{creating ? (
						<WorkdayCreateTaskDrawer
							initialDeal={creating.deal}
							onClose={() => setCreating(null)}
						/>
					) : null}
				</div>
			</div>
		</>
	)
}

const MyDayScreen = ({
	initialTaskId
}: {
	initialTaskId?: string | null
}) => {
	const context = useWorkdaySession()
	const entryBinding = JSON.stringify([
		context.workspace.workspaceId,
		context.session?.userId,
		context.sessionRevision
	])
	const scope = JSON.stringify(context.key)
	// Bind a link once to its entry session/workspace and first verified scope.
	// The drawer still performs a fresh read; a URL supplies no task snapshot.
	const [link, setLink] = useState(() =>
		isUuidV4(initialTaskId)
			? {
					taskId: initialTaskId,
					binding: entryBinding,
					scope: null as string | null
				}
			: null
	)
	if (
		link?.scope === null &&
		link.binding === entryBinding &&
		context.canRead
	)
		setLink({ ...link, scope })
	else if (link?.scope && link.scope !== scope) setLink(null)
	const linkedTaskId = link?.scope === scope ? link.taskId : null
	return (
		<MyDayContent
			key={JSON.stringify([context.key, linkedTaskId])}
			initialTaskId={linkedTaskId}
		/>
	)
}
export default MyDayScreen
