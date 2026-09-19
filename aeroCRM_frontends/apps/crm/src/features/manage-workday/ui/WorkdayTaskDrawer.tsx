'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
	useWorkdayTask,
	useWorkdayTimeline,
	useWorkdaySession,
	WORKDAY_STATUSES,
	type WorkdayTask
} from '@/entities/crm-workday'
import {
	AssigneeSelect,
	useAssigneeOptions,
	assigneeDisplayName,
	type AssigneeBinding
} from '@/entities/crm-team'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import type { SalesDeal } from '@/entities/sales'
import { Button, Drawer, ScreenState, TextField } from '@/shared/ui'
import { useWorkdayCommand } from '../model/use-workday-command'
import {
	deviceTimeZone,
	taskDueIso,
	taskLocalDate,
	workdayDateLabel,
	workdayDirectoryContext,
	workdayStatusLabels
} from '../model/workday-form'
import { WorkdayCommandState } from './WorkdayCommandState'
import {
	WorkdayNextTaskSuggestion,
	type WorkdayCompletion
} from './WorkdayNextTaskSuggestion'
import styles from './WorkdayTaskDrawer.module.scss'

export interface WorkdayTaskDrawerProps {
	taskId: string
	onClose: () => void
	timeZone?: string
	onCreateNextTask?: (deal: SalesDeal | null) => boolean | void
}
export const WorkdayTaskDrawer = (props: WorkdayTaskDrawerProps) => {
	const context = useWorkdaySession()
	return (
		<TaskFrame
			key={JSON.stringify([...context.key, props.taskId])}
			{...props}
		/>
	)
}
const TaskFrame = ({
	taskId,
	onClose,
	timeZone,
	onCreateNextTask
}: WorkdayTaskDrawerProps) => {
	const read = useWorkdayTask(taskId)
	const temporary =
		read.query.error instanceof AuthenticatedApiError &&
		read.query.error.kind === 'temporary'
	const verifyingBoundAccess =
		(!read.query.isError || temporary) &&
		read.context.permissions.isFetching &&
		read.context.permissions.isSuccess &&
		read.context.permissions.data?.subject ===
			read.context.session?.userId &&
		read.context.permissions.data?.workspaceId ===
			read.context.workspace.workspaceId
	// Keep a bound draft through a transient read outage, never through an auth,
	// workspace, scope or permission boundary. All writes wait for a fresh read.
	const task =
		read.data ??
		((read.context.canRead && temporary) || verifyingBoundAccess
			? read.query.data
			: undefined)
	return task ? (
		<TaskEditor
			read={read}
			initial={task}
			onClose={onClose}
			timeZone={timeZone}
			onCreateNextTask={onCreateNextTask}
		/>
	) : (
		<Drawer isOpen onClose={onClose} title="Задача">
			<ScreenState
				variant={
					!read.context.canRead
						? 'permission'
						: read.query.isError
							? 'error'
							: 'loading'
				}
				description="Получаем актуальную задачу в пределах вашего доступа."
				action={
					read.context.canRead && read.query.isError ? (
						<Button onClick={() => void read.query.refetch()}>
							Повторить загрузку
						</Button>
					) : undefined
				}
			/>
		</Drawer>
	)
}
const TaskEditor = ({
	read,
	initial,
	onClose,
	timeZone,
	onCreateNextTask
}: {
	read: ReturnType<typeof useWorkdayTask>
	initial: WorkdayTask
	onClose: () => void
	timeZone?: string
	onCreateNextTask?: WorkdayTaskDrawerProps['onCreateNextTask']
}) => {
	const [draft, setDraft] = useState({
		baseline: initial,
		title: initial.title,
		due: taskLocalDate(initial.dueAt)
	})
	const [assignee, setAssignee] = useState<AssigneeBinding | null>(null)
	const [historyPage, setHistoryPage] = useState(1)
	const [completion, setCompletion] = useState<WorkdayCompletion | null>(
		null
	)
	const mounted = useRef(true)
	useLayoutEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
		}
	}, [])
	const command = useWorkdayCommand(
		`task:${initial.id}`,
		(task, confirmed) => {
			setDraft({
				baseline: task,
				title: task.title,
				due: taskLocalDate(task.dueAt)
			})
			setAssignee(null)
			setCompletion({
				task,
				command: confirmed,
				scopeKey: read.context.scopeKey
			})
		}
	)
	const edited =
		draft.title !== draft.baseline.title ||
		draft.due !== taskLocalDate(draft.baseline.dueAt)
	const assigneeEdited =
		!!assignee &&
		(assignee.subject !== draft.baseline.assignedToSubject ||
			assignee.membershipId !== draft.baseline.assignedToMembershipId)
	const newer = initial.version > draft.baseline.version
	const baseline =
		!edited &&
		!assigneeEdited &&
		!command.pending &&
		!command.ambiguous &&
		newer
			? initial
			: draft.baseline
	const title = edited ? draft.title : baseline.title
	const due = edited ? draft.due : taskLocalDate(baseline.dueAt)
	const dueAt = taskDueIso(due, {
		local: taskLocalDate(baseline.dueAt),
		iso: baseline.dueAt
	})
	const conflict = (edited || assigneeEdited) && newer
	const locked =
		command.locked ||
		read.query.isFetching ||
		read.query.isError ||
		conflict
	const selected = assignee ?? {
		subject: baseline.assignedToSubject,
		membershipId: baseline.assignedToMembershipId
	}
	const options = useAssigneeOptions(
		workdayDirectoryContext(command.context),
		{
			selectedSubject: selected.subject,
			...(baseline.teamId ? { teamId: baseline.teamId } : {})
		}
	)
	const resolved = options.resolveBinding(selected)
	const changedAssignee =
		!!assignee &&
		(assignee.subject !== baseline.assignedToSubject ||
			assignee.membershipId !== baseline.assignedToMembershipId)
	const timeline = useWorkdayTimeline(initial.id, historyPage)
	const close = () => {
		if (command.canClose()) {
			mounted.current = false
			onClose()
		}
	}
	const reload = async () => {
		if (command.pending || command.ambiguous) return
		const result = await read.query.refetch()
		if (
			!mounted.current ||
			!command.context.current() ||
			result.error ||
			!result.data
		)
			return
		setDraft({
			baseline: result.data,
			title: result.data.title,
			due: taskLocalDate(result.data.dueAt)
		})
		setAssignee(null)
		command.resetAfterReview()
		toast('Актуальная задача загружена')
	}
	return (
		<Drawer
			isOpen
			onClose={close}
			title="Задача"
			description={
				baseline.dealId ? 'Задача по сделке' : 'Самостоятельная задача'
			}
			size="lg"
		>
			{command.context.permissions.isFetching ? (
				<ScreenState
					variant="loading"
					description="Проверяем права доступа. Ваш черновик сохранён в открытой форме."
				/>
			) : null}
			<div
				hidden={command.context.permissions.isFetching}
				inert={command.context.permissions.isFetching}
				aria-hidden={command.context.permissions.isFetching}
			>
				<div className={styles.content}>
					{!command.context.canWrite ? (
						<p className={styles.note}>
							Режим чтения. Просмотр задачи и истории остаётся доступным.
						</p>
					) : null}
					{read.query.isError ? (
						<div className={styles.warning}>
							Не удалось обновить задачу. Несохранённые поля сохранены;
							изменения временно недоступны.
							<Button
								variant="secondary"
								onClick={() => void read.query.refetch()}
							>
								Повторить загрузку
							</Button>
						</div>
					) : null}
					{conflict || command.blocked ? (
						<div className={styles.warning}>
							Задача или права изменились. Загрузите актуальные данные
							перед новым сохранением; несохранённые поля будут заменены.
							<Button
								variant="secondary"
								disabled={
									command.pending ||
									command.ambiguous ||
									read.query.isFetching
								}
								onClick={() => void reload()}
							>
								Загрузить актуальную задачу
							</Button>
						</div>
					) : null}
					<section
						className={styles.section}
						aria-label="Параметры задачи"
					>
						<TextField
							label="Название задачи"
							value={title}
							maxLength={200}
							disabled={locked || changedAssignee}
							onChange={event =>
								setDraft({ baseline, title: event.target.value, due })
							}
						/>
						<TextField
							label="Срок выполнения"
							type="datetime-local"
							value={due}
							disabled={locked || changedAssignee}
							onChange={event =>
								setDraft({ baseline, title, due: event.target.value })
							}
							hint={`Часовой пояс устройства: ${deviceTimeZone()}.`}
							error={
								!dueAt ? 'Укажите существующую дату и время.' : undefined
							}
						/>
						<p className={styles.note}>
							Текущий срок: {workdayDateLabel(baseline.dueAt, timeZone)}
							{timeZone ? ` (${timeZone})` : ''}
						</p>
						<div className={styles.actions}>
							<Button
								disabled={locked || !edited || !title.trim() || !dueAt}
								tooltip="Сохранить название и срок задачи. Статус и ответственный изменяются отдельно."
								onClick={() => {
									if (dueAt && !locked && edited)
										void command.execute({
											kind: 'edit',
											id: baseline.id,
											expectedVersion: baseline.version,
											title,
											dueAt
										})
								}}
							>
								Сохранить название и срок
							</Button>
						</div>
					</section>
					<section className={styles.section} aria-label="Статус задачи">
						<h3 className={styles.heading}>
							Статус: {workdayStatusLabels[baseline.status]}
						</h3>
						<div className={styles.actions}>
							{WORKDAY_STATUSES.map(status => (
								<Button
									key={status}
									tooltip={`Перевести задачу в состояние «${workdayStatusLabels[status]}». Срок и ответственный сохранятся.`}
									variant="secondary"
									disabled={
										locked ||
										edited ||
										changedAssignee ||
										status === baseline.status
									}
									onClick={() =>
										void command.execute({
											kind: 'status',
											id: baseline.id,
											expectedVersion: baseline.version,
											status
										})
									}
								>
									{workdayStatusLabels[status]}
								</Button>
							))}
						</div>
						{edited ? (
							<p className={styles.note}>
								Сначала сохраните изменение названия или срока.
							</p>
						) : null}
					</section>
					{completion &&
					onCreateNextTask &&
					baseline.status === 'COMPLETED' &&
					baseline.version === completion.task.version ? (
						<WorkdayNextTaskSuggestion
							key={completion.command.commandId}
							completion={completion}
							context={command.context}
							disabled={locked || edited || changedAssignee}
							onDismiss={() => setCompletion(null)}
							onCreate={deal => {
								if (
									!command.context.canWrite ||
									!command.context.current() ||
									!command.canClose()
								)
									return false
								return onCreateNextTask(deal)
							}}
						/>
					) : null}
					<section
						className={styles.section}
						aria-label="Назначение ответственного"
					>
						<h3 className={styles.heading}>Ответственный</h3>
						<p className={styles.note}>
							{resolved && !changedAssignee
								? assigneeDisplayName(resolved)
								: 'Текущее назначение сохраняется до явного выбора сотрудника.'}
						</p>
						<AssigneeSelect
							options={options}
							value={selected}
							disabled={locked || edited}
							onChange={value =>
								setAssignee({
									subject: value.subject,
									membershipId: value.membershipId
								})
							}
						/>
						<Button
							disabled={locked || edited || !changedAssignee || !resolved}
							tooltip="Назначить выбранного сотрудника ответственным за эту задачу."
							onClick={() => {
								if (resolved && !locked && !edited)
									void command.execute({
										kind: 'assignee',
										id: baseline.id,
										expectedVersion: baseline.version,
										assignee: {
											subject: resolved.subject,
											membershipId: resolved.membershipId
										}
									})
							}}
						>
							Назначить ответственного
						</Button>
						{changedAssignee ? (
							<p className={styles.note}>
								Сначала сохраните назначение ответственного или выберите
								текущее назначение обратно.
							</p>
						) : null}
					</section>
					<WorkdayCommandState command={command} />
					<section className={styles.section} aria-label="История задачи">
						<h3 className={styles.heading}>История задачи</h3>
						{timeline.data ? (
							<>
								<ol className={styles.history}>
									{timeline.data.items.map(item => (
										<li key={item.id}>
											<strong>
												{
													{
														CREATED: 'Задача создана',
														EDITED: 'Название или срок изменены',
														STATUS_CHANGED: 'Статус изменён',
														ASSIGNED: 'Ответственный изменён'
													}[item.kind]
												}
											</strong>
											<p className={styles.note}>
												<time dateTime={item.createdAt}>
													{workdayDateLabel(item.createdAt, timeZone)}
												</time>
											</p>
											<p className={styles.note}>
												{item.kind === 'STATUS_CHANGED'
													? `${item.before ? workdayStatusLabels[item.before.status] : '—'} → ${workdayStatusLabels[item.after.status]}`
													: item.after.title}
											</p>
										</li>
									))}
								</ol>
								{timeline.data.total === 0 ? (
									<p className={styles.note}>
										История изменений пока пуста.
									</p>
								) : null}
								<nav
									className={styles.pagination}
									aria-label="Страницы истории"
								>
									<Button
										variant="secondary"
										disabled={
											historyPage === 1 || timeline.query.isFetching
										}
										onClick={() => {
											setHistoryPage(historyPage - 1)
											toast('Предыдущая страница истории')
										}}
									>
										Назад
									</Button>
									<span>
										{historyPage} /{' '}
										{Math.max(1, Math.ceil(timeline.data.total / 25))}
									</span>
									<Button
										variant="secondary"
										disabled={
											historyPage * 25 >= timeline.data.total ||
											timeline.query.isFetching
										}
										onClick={() => {
											setHistoryPage(historyPage + 1)
											toast('Следующая страница истории')
										}}
									>
										Далее
									</Button>
								</nav>
							</>
						) : (
							<ScreenState
								compact
								variant={timeline.query.isError ? 'error' : 'loading'}
								description="История загружается отдельно с сервера."
								action={
									timeline.query.isError ? (
										<Button onClick={() => void timeline.query.refetch()}>
											Повторить загрузку истории
										</Button>
									) : undefined
								}
							/>
						)}
					</section>
					<div className={styles.footer}>
						<Button variant="secondary" onClick={close}>
							Закрыть
						</Button>
					</div>
				</div>
			</div>
		</Drawer>
	)
}
