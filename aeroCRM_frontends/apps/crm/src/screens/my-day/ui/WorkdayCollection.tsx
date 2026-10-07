'use client'

import { useRef, useState } from 'react'
import type {
	PlannerSettings,
	PlannerColumn
} from '@/entities/crm-planner/model/planner.types'
import {
	closestCenter,
	DndContext,
	DragOverlay,
	KeyboardSensor,
	PointerSensor,
	pointerWithin,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
	type DropAnimation
} from '@dnd-kit/core'
import toast from 'react-hot-toast'
import {
	assigneeDisplayName,
	useAssigneeLabels
} from '@/entities/crm-team'
import {
	useWorkdayTasks,
	type WorkdayFilters,
	type WorkdayTask,
	type WorkdayStatus
} from '@/entities/crm-workday'
import {
	useWorkdayTaskCommandState,
	type WorkdayCommandContext
} from '@/features/manage-workday'
import {
	Button,
	DataTable,
	ScreenState,
	SelectField,
	AppIcon,
	type DataTableColumn
} from '@/shared/ui'
import {
	isWorkdayOverdue,
	groupWorkdayTasks,
	workdayDate,
	WORKDAY_BOARD_STATUSES,
	WORKDAY_STATUS_LABELS,
	type WorkdayView
} from '../model/workday-view'
import { WorkdayPagination } from './WorkdayPagination'
import {
	useWorkdayReducedMotion,
	createWorkdayKeyboardCoordinates
} from '../model/workday-drag'
import styles from './MyDayScreen.module.scss'

const useWorkdayNames = (
	context: ReturnType<typeof useWorkdayTasks>['context'],
	tasks: readonly WorkdayTask[]
) => {
	const labels = useAssigneeLabels(
		{
			workspaceId: context.workspace.workspaceId,
			subject: context.session?.userId,
			accessToken: context.session?.accessToken,
			sessionRevision: context.sessionRevision,
			canRead: context.canRead,
			isCurrent: context.current,
			authority: context.permissions.data
		},
		tasks
			.filter(task => task.assignedToSubject !== context.session?.userId)
			.map(task => ({
				subject: task.assignedToSubject,
				membershipId: task.assignedToMembershipId
			}))
	)
	return {
		...labels,
		name: (task: WorkdayTask) => {
			if (task.assignedToSubject === context.session?.userId) return 'Вы'
			const row = labels.lookup({
				subject: task.assignedToSubject,
				membershipId: task.assignedToMembershipId
			})
			if (row)
				return row.employee
					? assigneeDisplayName(row.employee)
					: 'Ответственный недоступен'
			return labels.error ? 'Имя временно недоступно' : 'Имя загружается…'
		}
	}
}

const NamesError = ({
	names
}: {
	names: ReturnType<typeof useWorkdayNames>
}) =>
	names.error ? (
		<div className={styles.error} role="alert">
			<span>
				Не удалось загрузить имена ответственных. Задачи остаются доступны.
			</span>
			<Button
				variant="secondary"
				size="sm"
				onClick={() => void names.refetch()}
			>
				Повторить загрузку имён
			</Button>
		</div>
	) : null

const TaskStatus = ({
	task,
	enabled,
	onStatus,
	onOpen,
	onReschedule,
	commandContext
}: {
	task: WorkdayTask
	enabled: boolean
	onStatus: (task: WorkdayTask, status: WorkdayStatus) => void
	onOpen: (task: WorkdayTask) => void
	onReschedule?: (task: WorkdayTask) => void
	commandContext: WorkdayCommandContext
}) => {
	const { unresolved } = useWorkdayTaskCommandState(
		commandContext,
		task.id
	)
	return (
		<div className={styles.copy}>
			{task.status === 'OPEN' || task.status === 'IN_PROGRESS' ? (
				<div className={styles.quickActions}>
					<Button
						size="sm"
						disabled={!enabled || unresolved}
						aria-label={`Готово: ${task.title}`}
						onClick={() => {
							if (!unresolved) onStatus(task, 'COMPLETED')
						}}
					>
						Готово
					</Button>
					{onReschedule ? (
						<Button
							size="sm"
							variant="secondary"
							disabled={!enabled || unresolved}
							aria-label={`Изменить срок: ${task.title}`}
							onClick={() => {
								if (!unresolved) onReschedule(task)
							}}
						>
							Изменить срок
						</Button>
					) : null}
				</div>
			) : null}
			<SelectField
				label={`Статус задачи «${task.title}»`}
				labelHidden
				value={task.status}
				disabled={!enabled || unresolved}
				onChange={event => {
					if (!unresolved)
						onStatus(task, event.target.value as WorkdayStatus)
				}}
			>
				{Object.entries(WORKDAY_STATUS_LABELS).map(([value, title]) => (
					<option key={value} value={value}>
						{title}
					</option>
				))}
			</SelectField>
			{unresolved ? (
				<Button variant="secondary" size="sm" onClick={() => onOpen(task)}>
					Проверить сохранение
				</Button>
			) : null}
		</div>
	)
}

const TaskDue = ({
	task,
	timeZone,
	asOf
}: {
	task: WorkdayTask
	timeZone: string
	asOf: string
}) => (
	<div className={styles.copy}>
		<time dateTime={task.dueAt}>{workdayDate(task.dueAt, timeZone)}</time>
		{isWorkdayOverdue(task, asOf) ? (
			<span className={styles.overdueBadge}>
				<AppIcon name="alert" size={18} />
				<span>Просрочено</span>
			</span>
		) : null}
	</div>
)

interface CollectionProps {
	onReschedule?: (task: WorkdayTask) => void
	onResetFilters?: () => void
	planner?: PlannerSettings
	settingsPending?: boolean
	settingsError?: boolean
	onReloadSettings?: () => void
	onColumn?: (task: WorkdayTask, column: PlannerColumn) => void
	filters: WorkdayFilters
	view: WorkdayView
	canWrite: boolean
	onOpen: (task: WorkdayTask) => void
	onStatus: (task: WorkdayTask, status: WorkdayStatus) => void
	onPage: (page: number) => void
}

export const WorkdayCollection = (props: CollectionProps) =>
	props.view === 'board' ? (
		props.onColumn && (!props.planner || props.settingsError) ? (
			<ScreenState
				variant={props.settingsError ? 'error' : 'loading'}
				description={
					props.settingsError
						? 'Не удалось загрузить колонки доски.'
						: 'Загружаем колонки доски.'
				}
				action={
					props.settingsError ? (
						<Button onClick={props.onReloadSettings}>Повторить</Button>
					) : undefined
				}
			/>
		) : (
			<WorkdayBoard {...props} />
		)
	) : (
		<WorkdayList {...props} />
	)

const WorkdayList = ({
	filters,
	canWrite,
	onOpen,
	onReschedule,
	onResetFilters,
	onStatus,
	onPage
}: CollectionProps) => {
	const { query, data, context } = useWorkdayTasks(filters)
	const names = useWorkdayNames(context, data?.items ?? [])
	const columns: DataTableColumn<WorkdayTask>[] = [
		{
			id: 'title',
			header: 'Задача',
			render: task => (
				<div className={styles.copy}>
					<button
						className={styles.taskTitle}
						onClick={() => onOpen(task)}
					>
						{task.title}
					</button>
					<span className={styles.hint}>
						{task.dealId ? 'По сделке' : 'Самостоятельная задача'}
					</span>
				</div>
			)
		},
		{
			id: 'due',
			header: 'Срок',
			render: task => (
				<TaskDue
					task={task}
					timeZone={filters.timeZone}
					asOf={data!.asOf}
				/>
			)
		},
		{
			id: 'assignee',
			header: 'Ответственный',
			render: task => names.name(task)
		},
		{
			id: 'status',
			header: 'Статус',
			cellClassName: styles.mobileWide,
			render: task => (
				<TaskStatus
					task={task}
					enabled={canWrite && !query.isFetching}
					onStatus={onStatus}
					onOpen={onOpen}
					onReschedule={onReschedule}
					commandContext={context}
				/>
			)
		}
	]
	return (
		<div className={styles.screen} aria-busy={query.isFetching}>
			<NamesError names={names} />
			{query.isError ? (
				<ScreenState
					variant="error"
					description="Не удалось загрузить задачи. Это не означает, что задач нет."
					action={
						<Button onClick={() => void query.refetch()}>Повторить</Button>
					}
				/>
			) : !data ? (
				<ScreenState variant="loading" />
			) : !data.items.length ? (
				<ScreenState
					variant="empty"
					title={
						data.total > 0
							? 'На этой странице задач больше нет'
							: 'Нет задач по выбранным условиям'
					}
					description={
						data.total > 0
							? 'Список изменился. Остальные задачи доступны на предыдущих страницах.'
							: canWrite
								? 'Измените фильтры или создайте задачу кнопкой «Новая задача».'
								: 'Измените фильтры, чтобы найти доступные вам задачи.'
					}
					action={
						data.total > 0 ? (
							<Button
								disabled={query.isFetching}
								onClick={() =>
									onPage(
										Math.max(1, Math.ceil(data.total / filters.pageSize))
									)
								}
							>
								Вернуться к задачам
							</Button>
						) : onResetFilters ? (
							<Button variant="secondary" onClick={onResetFilters}>
								Сбросить фильтры
							</Button>
						) : undefined
					}
				/>
			) : filters.status === 'ACTIVE' ? (
				<>
					{data.total > filters.pageSize ? (
						<p className={styles.hint}>
							Задачи идут по сроку, начиная с самых ранних. Показаны{' '}
							{(filters.page - 1) * filters.pageSize + 1}–
							{(filters.page - 1) * filters.pageSize + data.items.length}{' '}
							из {data.total}; остальные — на следующих или предыдущих
							страницах.
						</p>
					) : null}
					{groupWorkdayTasks(data.items, data.asOf, filters.timeZone).map(
						group => (
							<section
								key={group.id}
								className={styles.taskGroup}
								aria-label={group.title}
							>
								<h2 className={styles.groupHeading}>{group.title}</h2>
								<DataTable
									caption={group.title}
									mobileLayout="cards"
									rows={group.items}
									columns={columns}
									getRowKey={task => task.id}
									rowClassName={task =>
										isWorkdayOverdue(task, data.asOf)
											? styles.overdueRow
											: undefined
									}
								/>
							</section>
						)
					)}
				</>
			) : (
				<DataTable
					caption="Задачи выбранного периода"
					mobileLayout="cards"
					rows={data.items}
					columns={columns}
					getRowKey={task => task.id}
					rowClassName={task =>
						isWorkdayOverdue(task, data.asOf)
							? styles.overdueRow
							: undefined
					}
				/>
			)}
			{data ? (
				<WorkdayPagination
					page={filters.page}
					pageSize={filters.pageSize}
					total={data.total}
					pending={query.isFetching}
					onPage={onPage}
					label="Страницы списка задач"
				/>
			) : null}
		</div>
	)
}

const WorkdayBoard = (props: CollectionProps) => {
	const allColumns: PlannerColumn[] =
		props.planner?.columns.filter(column => !column.archived) ??
		WORKDAY_BOARD_STATUSES.map(status => ({
			id: status,
			name: WORKDAY_STATUS_LABELS[status],
			status,
			isDefault: true,
			archived: false
		}))
	const columns = allColumns.filter(column => {
		const active =
			column.status === 'OPEN' || column.status === 'IN_PROGRESS'
		return props.filters.status === 'ACTIVE'
			? active
			: props.filters.status === 'TERMINAL'
				? !active
				: !props.filters.status || props.filters.status === column.status
	})
	const [sourceColumnId, setSourceColumnId] = useState<string | null>(null)
	const canWrite = props.canWrite && !props.settingsPending
	const selectColumn = (task: WorkdayTask, id: string) => {
		const column = allColumns.find(item => item.id === id)
		if (!column || !canWrite) return
		if (props.onColumn) props.onColumn(task, column)
		else props.onStatus(task, column.status)
	}

	const [dragged, setDragged] = useState<WorkdayTask | null>(null)
	const reducedMotion = useWorkdayReducedMotion()
	const destination = useRef<{ left: number; top: number } | null>(null)
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: createWorkdayKeyboardCoordinates(
				columns.map(column => column.id)
			),
			scrollBehavior: reducedMotion ? 'auto' : 'smooth'
		})
	)
	const dropAnimation: DropAnimation = {
		duration: reducedMotion ? 0 : 240,
		easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
		keyframes: ({ transform, dragOverlay }) => {
			const target = destination.current
			const end = target
				? {
						x: transform.initial.x + target.left - dragOverlay.rect.left,
						y: transform.initial.y + target.top - dragOverlay.rect.top
					}
				: transform.final
			return [
				{
					transform: `translate3d(${transform.initial.x}px, ${transform.initial.y}px, 0)`,
					opacity: 1
				},
				{
					transform: `translate3d(${end.x}px, ${end.y}px, 0)`,
					opacity: target ? 0 : 1
				}
			]
		}
	}
	return (
		<DndContext
			sensors={sensors}
			collisionDetection={args =>
				args.pointerCoordinates ? pointerWithin(args) : closestCenter(args)
			}
			accessibility={{
				screenReaderInstructions: {
					draggable:
						'Нажмите пробел, чтобы поднять задачу. Стрелками выберите колонку. Пробел — переместить, Escape — отменить.'
				},
				announcements: {
					onDragStart: () => 'Задача поднята. Выберите колонку стрелками.',
					onDragOver: ({ over }) =>
						over
							? `Колонка: ${columns.find(column => column.id === over.id)?.name ?? 'недоступна'}.`
							: 'За пределами доски.',
					onDragEnd: ({ over }) =>
						over
							? 'Перемещение передано на сохранение. Результат будет показан после ответа сервера.'
							: 'Перемещение отменено.',
					onDragCancel: () =>
						'Перемещение отменено. Задача осталась на месте.'
				}
			}}
			onDragStart={({ active }) => {
				destination.current = null
				if (canWrite && active.data.current?.task) {
					setSourceColumnId(
						active.data.current.columnId ?? active.data.current.task.status
					)
					setDragged(Object.freeze({ ...active.data.current.task }))
				}
			}}
			onDragCancel={() => {
				destination.current = null
				setDragged(null)
				toast('Перемещение отменено')
			}}
			onDragEnd={({ active, over }) => {
				const task = dragged
				if (
					canWrite &&
					task &&
					active.id === task.id &&
					over &&
					over.data.current?.ready &&
					columns.some(column => column.id === over.id) &&
					sourceColumnId !== over.id
				) {
					destination.current = {
						left: over.rect.left + 16,
						top: over.rect.top + 64
					}
					selectColumn(task, String(over.id))
				} else destination.current = null
				setDragged(null)
			}}
		>
			<div
				className={`${styles.board} ${columns.length <= 2 ? styles.compactBoard : ''}`}
				role="region"
				aria-label="Доска задач"
			>
				{columns.map(column => (
					<WorkdayColumn
						key={column.id}
						{...props}
						canWrite={canWrite}
						column={column}
						columns={allColumns}
						onSelectColumn={selectColumn}
						sourceColumnId={sourceColumnId}
						dragged={dragged}
					/>
				))}
			</div>
			<DragOverlay
				dropAnimation={dropAnimation}
				zIndex={70}
				transition={event =>
					reducedMotion
						? 'none'
						: event instanceof KeyboardEvent
							? 'transform 200ms ease'
							: undefined
				}
			>
				{dragged ? (
					<div
						className={`${styles.card} ${styles.dragOverlay}`}
						aria-hidden="true"
					>
						<strong className={styles.overlayTitle}>
							{dragged.title}
						</strong>
						<span className={styles.hint}>
							{workdayDate(dragged.dueAt, props.filters.timeZone)}
						</span>
						<span className={styles.hint}>Отпустите в нужной колонке</span>
					</div>
				) : null}
			</DragOverlay>
		</DndContext>
	)
}

const WorkdayColumn = ({
	filters,
	column,
	columns,
	planner,
	onSelectColumn,
	sourceColumnId,
	canWrite,
	onOpen,
	onStatus,
	dragged
}: CollectionProps & {
	column: PlannerColumn
	columns: PlannerColumn[]
	onSelectColumn: (task: WorkdayTask, id: string) => void
	sourceColumnId: string | null
	dragged: WorkdayTask | null
}) => {
	const [page, setPage] = useState(1)
	const { data, query, context } = useWorkdayTasks({
		...filters,
		status: column.status,
		...(planner
			? { columnId: column.id, settingsVersion: planner.version }
			: {}),
		page
	})
	const names = useWorkdayNames(context, data?.items ?? [])
	const { setNodeRef, isOver } = useDroppable({
		id: column.id,
		disabled: !canWrite || query.isFetching || !data,
		data: { ready: canWrite && !query.isFetching && !!data }
	})
	const canDrop =
		canWrite &&
		!query.isFetching &&
		!!data &&
		!!dragged &&
		sourceColumnId !== column.id
	return (
		<section
			ref={setNodeRef}
			className={`${styles.column} ${isOver && canDrop ? styles.columnActive : ''}`}
			aria-label={column.name}
			aria-busy={query.isFetching}
		>
			<h2 className={styles.columnHeading}>
				{column.name} <span>{data?.total ?? '—'}</span>
			</h2>
			{!column.isDefault ? (
				<p className={styles.hint}>
					Статус: {WORKDAY_STATUS_LABELS[column.status]}
				</p>
			) : null}
			<NamesError names={names} />
			{dragged && canDrop ? (
				<div
					className={`${styles.dropHint} ${isOver ? styles.dropHintActive : ''}`}
					aria-hidden="true"
				>
					{isOver
						? 'Отпустите, чтобы переместить'
						: 'Переместите задачу сюда'}
				</div>
			) : null}
			{query.isError ? (
				<div role="alert" className={styles.error}>
					Не удалось загрузить колонку.
					<Button variant="secondary" onClick={() => void query.refetch()}>
						Повторить
					</Button>
				</div>
			) : !data ? (
				<p role="status" className={styles.empty}>
					Загрузка задач…
				</p>
			) : !data.items.length ? (
				<p className={styles.empty}>В этой колонке задач нет</p>
			) : (
				<ul className={styles.cards}>
					{data.items.map(task => (
						<WorkdayCard
							key={task.id}
							task={task}
							timeZone={filters.timeZone}
							asOf={data.asOf}
							enabled={canWrite && !query.isFetching}
							onOpen={onOpen}
							onStatus={onStatus}
							commandContext={context}
							assigneeName={names.name(task)}
							columnId={column.id}
							columns={planner ? columns : undefined}
							onSelectColumn={onSelectColumn}
						/>
					))}
				</ul>
			)}
			{data ? (
				<WorkdayPagination
					label={`Страницы колонки «${column.name}»`}
					page={page}
					pageSize={filters.pageSize}
					total={data.total}
					pending={query.isFetching}
					onPage={setPage}
				/>
			) : null}
		</section>
	)
}

const WorkdayCard = ({
	task,
	enabled,
	timeZone,
	asOf,
	onOpen,
	onStatus,
	commandContext,
	assigneeName,
	columnId,
	columns,
	onSelectColumn
}: {
	task: WorkdayTask
	enabled: boolean
	timeZone: string
	asOf: string
	onOpen: (task: WorkdayTask) => void
	onStatus: CollectionProps['onStatus']
	commandContext: WorkdayCommandContext
	assigneeName: string
	columnId: string
	columns?: PlannerColumn[]
	onSelectColumn: (task: WorkdayTask, id: string) => void
}) => {
	const { unresolved } = useWorkdayTaskCommandState(
		commandContext,
		task.id
	)
	const {
		setNodeRef,
		setActivatorNodeRef,
		attributes,
		listeners,
		isDragging
	} = useDraggable({
		id: task.id,
		disabled: !enabled || unresolved,
		data: { task, columnId }
	})
	return (
		<li
			ref={setNodeRef}
			className={`${styles.card} ${isWorkdayOverdue(task, asOf) ? styles.overdueCard : ''} ${isDragging ? styles.cardDragging : ''}`}
		>
			<div className={styles.cardTop}>
				<button className={styles.taskTitle} onClick={() => onOpen(task)}>
					{task.title}
				</button>
				<button
					ref={setActivatorNodeRef}
					className={styles.dragHandle}
					{...attributes}
					{...listeners}
					disabled={!enabled || unresolved}
					aria-label={`Переместить задачу «${task.title}»`}
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 20 20"
						fill="currentColor"
						aria-hidden="true"
					>
						{[5, 10, 15].flatMap(y =>
							[7, 13].map(x => (
								<circle key={`${x}:${y}`} cx={x} cy={y} r="1.3" />
							))
						)}
					</svg>
				</button>
			</div>
			<TaskDue task={task} timeZone={timeZone} asOf={asOf} />
			<div className={styles.cardFooter}>
				<span>{task.dealId ? 'По сделке' : 'Без сделки'}</span>
				<span className={styles.assigneeName}>
					Ответственный: {assigneeName}
				</span>
			</div>
			{columns ? (
				<div className={styles.copy}>
					<SelectField
						label={`Колонка задачи «${task.title}»`}
						value={columnId}
						disabled={!enabled || unresolved}
						onChange={event => {
							if (!unresolved) onSelectColumn(task, event.target.value)
						}}
					>
						{columns.map(column => (
							<option key={column.id} value={column.id}>
								{column.name}
							</option>
						))}
					</SelectField>
					{unresolved ? (
						<Button
							variant="secondary"
							size="sm"
							onClick={() => onOpen(task)}
						>
							Проверить сохранение
						</Button>
					) : null}
				</div>
			) : (
				<TaskStatus
					task={task}
					enabled={enabled}
					onStatus={onStatus}
					onOpen={onOpen}
					commandContext={commandContext}
				/>
			)}
		</li>
	)
}
