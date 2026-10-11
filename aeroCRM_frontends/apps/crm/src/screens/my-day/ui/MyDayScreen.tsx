'use client'

import { useDirtyFormGuard } from '@/shared/lib/dirty-form'
import { SavedViewsControl } from '@/features/manage-saved-views/ui/SavedViewsControl'
import type { SavedTaskParameters } from '@/entities/crm-saved-views'
import { usePlannerSettings } from '@/entities/crm-planner/model/use-planner-settings'
import type { PlannerColumn } from '@/entities/crm-planner/model/planner.types'
import { PlannerSettingsDrawer } from '@/features/manage-planner/ui/PlannerSettingsDrawer'

import { useState, useSyncExternalStore } from 'react'
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
	workdayLayoutStorageKey,
	readStoredWorkdayLayout,
	writeStoredWorkdayLayout,
	workdayCalendarDay,
	workdayCalendarWeek,
	workdayCalendarFilters,
	type WorkdayView
} from '../model/workday-view'
import { WorkdayCollection } from './WorkdayCollection'
import { WorkdayFilters } from './WorkdayFilters'
import { WorkdayInboxSummary } from './WorkdayInboxSummary'
import styles from './MyDayScreen.module.scss'

const subscribeHydration = () => () => {}

const MyDayContent = ({
	initialTaskId
}: {
	initialTaskId: string | null
}) => {
	const context = useWorkdaySession()
	const planner = usePlannerSettings()
	// Keep the bound collection mounted while access is being reverified.
	const boundPlanner = planner.query.isError
		? undefined
		: planner.query.data
	const [settingsOpen, setSettingsOpen] = useState(false)
	const draftGuard = useDirtyFormGuard()
	const client = useQueryClient()
	const [filters, setFilters] = useState<Filters>(initialWorkdayFilters)
	const hydrated = useSyncExternalStore(
		subscribeHydration,
		() => true,
		() => false
	)
	const storageKey =
		context.session?.userId && context.workspace.workspaceId
			? workdayLayoutStorageKey(
					context.workspace.workspaceId,
					context.session.userId
				)
			: null
	const [layout, setLayout] = useState<{
		key: string | null
		view: WorkdayView
	}>({ key: null, view: 'list' })
	if (hydrated && storageKey && layout.key !== storageKey) {
		const storedView = readStoredWorkdayLayout(storageKey)
		setLayout({
			key: storageKey,
			view: storedView
		})
		if (storedView === 'calendar') {
			const day = workdayCalendarDay(
				new Date().toISOString(),
				filters.timeZone
			)
			const weekFilters = day && workdayCalendarFilters(filters, day)
			if (weekFilters) setFilters(weekFilters)
		}
	}
	const view = layout.view
	const setView = (next: WorkdayView) => {
		setLayout({ key: storageKey, view: next })
		if (storageKey) writeStoredWorkdayLayout(storageKey, next)
	}
	const [selected, setSelected] = useState<string | null>(initialTaskId)
	const [taskMode, setTaskMode] = useState<'details' | 'reschedule'>(
		'details'
	)
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
	const savedParameters: SavedTaskParameters = {
		layout: view === 'calendar' ? 'list' : view,
		period: filters.period,
		timeZone: filters.timeZone,
		scope: filters.scope,
		...(filters.from ? { from: filters.from } : {}),
		...(filters.to ? { to: filters.to } : {}),
		...(filters.status ? { status: filters.status } : {}),
		...(filters.search ? { search: filters.search } : {}),
		...(filters.teamId ? { teamId: filters.teamId } : {}),
		...(filters.assigneeSubject
			? { assigneeSubject: filters.assigneeSubject }
			: {})
	}
	const overview = useWorkdayTasks({
		...filters,
		status: undefined,
		page: 1,
		pageSize: 1
	})
	const selectCalendarDate = (day: string) => {
		const next = workdayCalendarFilters(filters, day)
		if (!next || !command.canClose() || !context.current()) return
		draftGuard.confirmDiscard(() => {
			if (!command.canClose() || !context.current()) return
			setSelected(null)
			setFilters(next)
			// "Today" may revisit the same week after midnight; refresh its snapshot.
			if (
				filters.period === 'RANGE' &&
				filters.from === next.from &&
				filters.to === next.to &&
				filters.page === 1
			)
				void client.invalidateQueries({
					queryKey: ['crm-workday', 'list', ...context.key],
					refetchType: 'active'
				})
		})
	}
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
	const moveToColumn = (task: WorkdayTask, column: PlannerColumn) => {
		if (command.locked || !planner.data || planner.query.isFetching) return
		if (command.hasPendingTask(task.id)) {
			setSelected(task.id)
			return
		}
		void command.execute({
			kind: 'column',
			id: task.id,
			expectedVersion: task.version,
			columnId: column.id,
			settingsVersion: planner.data.version,
			targetStatus: column.status,
			sourceStatus: task.status
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
			{ queryKey: ['crm-planner'], refetchType: 'active' },
			{ throwOnError: true }
		)
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
	const periodSummary = (
		<>
			{overview.data ? (
				<p className={styles.hint}>
					Данные на{' '}
					{new Intl.DateTimeFormat('ru-RU', {
						dateStyle: 'medium',
						timeStyle: 'medium',
						timeZone: filters.timeZone
					}).format(new Date(overview.data.asOf))}{' '}
					({filters.timeZone}). Для актуальных сроков и счётчиков нажмите
					«Обновить».
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
								draftGuard.confirmDiscard(() => {
									if (!command.canClose() || !context.current()) return
									setSelected(null)
									setView('list')
									setFilters(value => ({ ...value, status, page: 1 }))
									toast(`Показаны задачи: ${label.toLowerCase()}`)
								})
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
							if (!command.canClose()) return
							draftGuard.confirmDiscard(() => {
								if (!command.canClose() || !context.current()) return
								setSelected(null)
								if (view === 'calendar') setView('list')
								setFilters(value => ({
									...value,
									period: 'OVERDUE',
									from: undefined,
									to: undefined,
									status: 'ACTIVE',
									page: 1
								}))
								toast('Показаны просроченные задачи')
							})
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
		</>
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
						title="Задачи"
						description={
							<HelpHint
								label="Задачи"
								description="По умолчанию показаны незавершённые задачи по сроку. Задача по сделке здесь и в её карточке — одна запись. Завершённые и отменённые задачи доступны во вкладке «История»."
							>
								Что сделать по клиентам и другим делам.
							</HelpHint>
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
								{planner.canManage ? (
									<Button
										variant="secondary"
										disabled={command.locked}
										onClick={() => setSettingsOpen(true)}
									>
										Настройки задач
									</Button>
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
					{context.workspace.canWrite && !context.canWrite ? (
						<ReadOnlyBanner description="Ваша роль разрешает просмотр задач. Для изменения обратитесь к администратору пространства." />
					) : null}
					{settingsOpen ? (
						<PlannerSettingsDrawer
							onClose={() => setSettingsOpen(false)}
						/>
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
					<SavedViewsControl
						context={context}
						scope="TASKS"
						parameters={savedParameters}
						saveNotice={
							view === 'calendar'
								? 'Календарный вид запоминается в этом браузере. Сохранённое представление запомнит фильтры недели и откроется списком.'
								: undefined
						}
						onOpen={parameters => {
							if (!command.canClose() || !context.current()) return false
							const next = parameters as SavedTaskParameters
							if (
								!context.scopes.some(scope => scope === next.scope) ||
								(next.teamId &&
									!context.permissions.data?.teamIds.includes(next.teamId))
							) {
								toast.error(
									'Параметры представления недоступны при текущих правах. Выберите другие фильтры.'
								)
								return false
							}
							draftGuard.confirmDiscard(() => {
								const { layout: nextView, ...nextFilters } = next
								setSelected(null)
								setView(nextView)
								setFilters({
									...nextFilters,
									page: 1,
									pageSize: 20
								} as Filters)
							})
						}}
					/>
					<WorkdayFilters
						key={JSON.stringify([filters, view])}
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
							if (!command.canClose() || !context.current()) return false
							draftGuard.confirmDiscard(() => {
								if (!command.canClose() || !context.current()) return
								if (view === 'calendar') {
									const week = next.from && workdayCalendarWeek(next.from)
									if (
										next.period !== 'RANGE' ||
										!week ||
										next.from !== week.from ||
										next.to !== week.to
									)
										setView('list')
								}
								setSelected(null)
								setFilters(next)
							})
						}}
						onViewChange={next => {
							if (!command.canClose() || !context.current()) return false
							draftGuard.confirmDiscard(() => {
								if (!command.canClose() || !context.current()) return
								if (next === 'calendar') {
									const day =
										filters.from ??
										workdayCalendarDay(
											overview.data?.range?.from ??
												overview.data?.asOf ??
												new Date().toISOString(),
											filters.timeZone
										)
									const weekFilters =
										day && workdayCalendarFilters(filters, day)
									if (!weekFilters) {
										toast.error('Не удалось определить неделю календаря')
										return
									}
									setSelected(null)
									setView(next)
									setFilters(weekFilters)
									return
								}
								setSelected(null)
								setView(next)
								setFilters(value => ({
									...value,
									status:
										next === 'board' &&
										value.status &&
										value.status !== 'ACTIVE' &&
										value.status !== 'TERMINAL'
											? value.status === 'OPEN' ||
												value.status === 'IN_PROGRESS'
												? 'ACTIVE'
												: 'TERMINAL'
											: value.status,
									page: 1
								}))
							})
						}}
					/>
					{view !== 'calendar' ? periodSummary : null}
					<WorkdayCollection
						key={JSON.stringify([
							context.key,
							{ ...filters, page: undefined },
							view,
							view === 'board' ? boundPlanner?.version : undefined
						])}
						planner={boundPlanner}
						settingsPending={planner.query.isFetching}
						settingsError={planner.query.isError}
						onReloadSettings={() => void planner.query.refetch()}
						onColumn={moveToColumn}
						filters={filters}
						view={view}
						onCalendarDate={selectCalendarDate}
						calendarNavigationDisabled={
							command.pending || command.ambiguous || !context.canRead
						}
						canWrite={context.canWrite && !command.locked}
						onOpen={task => {
							if (command.canClose())
								draftGuard.confirmDiscard(() => {
									setTaskMode('details')
									setSelected(task.id)
								})
						}}
						onReschedule={task => {
							if (command.canClose() && context.canWrite)
								draftGuard.confirmDiscard(() => {
									setTaskMode('reschedule')
									setSelected(task.id)
								})
						}}
						onResetFilters={() => {
							if (command.canClose())
								draftGuard.confirmDiscard(() => {
									if (!command.canClose() || !context.current()) return
									setSelected(null)
									if (view === 'calendar') setView('list')
									setFilters({
										...initialWorkdayFilters(),
										status: undefined,
										scope: context.scopes.some(scope => scope === 'MINE')
											? 'MINE'
											: context.scopes[0],
										timeZone: filters.timeZone
									})
								})
						}}
						onStatus={updateStatus}
						onPage={page => {
							if (command.canClose())
								setFilters(value => ({ ...value, page }))
						}}
					/>
					{view === 'calendar' ? periodSummary : null}
					{selected ? (
						<WorkdayTaskDrawer
							taskId={selected}
							mode={taskMode}
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
