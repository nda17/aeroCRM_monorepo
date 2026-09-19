'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
	AssigneeSelect,
	TeamSelect,
	assigneeDisplayName,
	useAssigneeLabels,
	useAssigneeOptions,
	useTeamOptions,
	type AssigneeBinding
} from '@/entities/crm-team'
import {
	listTaskSeries,
	validSeriesContent,
	validSeriesDate,
	type SeriesFrequency,
	type SeriesStatus,
	type TaskSeries
} from '@/entities/crm-task-series'
import { useWorkdaySession } from '@/entities/crm-workday'
import { getSalesDeal, type SalesDeal } from '@/entities/sales'
import {
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import {
	Button,
	Drawer,
	ReadOnlyBanner,
	ScreenState,
	SelectField,
	StatusBadge,
	TextField,
	TimeZoneSelect
} from '@/shared/ui'
import { useTaskSeriesCommand } from '../model/use-task-series-command'
import {
	workdayDateLabel,
	workdayDirectoryContext
} from '../model/workday-form'
import { WorkdayDealChoice } from './WorkdayCreateTaskDrawer'
import styles from './TaskSeriesPanel.module.scss'

export const seriesFrequencyLabels = {
	DAILY: 'Ежедневно',
	WEEKLY: 'Еженедельно',
	MONTHLY: 'Ежемесячно'
} as const
const statusLabels = {
	ACTIVE: 'Активна',
	PAUSED: 'На паузе',
	CANCELLED: 'Отменена'
} as const
const blockedLabels = {
	READ_ONLY: 'Доступ к CRM доступен только для чтения.',
	CREATOR_REVOKED: 'У создателя серии изменился доступ.',
	ASSIGNEE_REVOKED: 'Ответственный больше недоступен.',
	SCOPE_CHANGED: 'Изменились права или отдел.',
	DEAL_CLOSED: 'Связанная сделка закрыта или архивирована.'
} as const
export const TaskSeriesPanel = ({ onClose }: { onClose: () => void }) => {
	const context = useWorkdaySession()
	return <Panel key={JSON.stringify(context.key)} onClose={onClose} />
}
const Panel = ({ onClose }: { onClose: () => void }) => {
	const [editor, setEditor] = useState<TaskSeries | 'new' | null>(null)
	const [cancel, setCancel] = useState<TaskSeries | null>(null)
	const [status, setStatus] = useState<SeriesStatus | 'ALL'>('ACTIVE')
	const [page, setPage] = useState(1),
		[search, setSearch] = useState(''),
		[applied, setApplied] = useState('')
	const command = useTaskSeriesCommand(() => {
		setEditor(null)
		setCancel(null)
		setPage(1)
	})
	const context = command.context
	const records = useQuery({
		queryKey: ['crm-task-series', ...context.key, status, page, applied],
		enabled: context.canRead,
		retry: false,
		staleTime: 0,
		gcTime: 0,
		refetchOnWindowFocus: false,
		queryFn: async () => {
			if (!context.session || !context.current())
				throw invalidContractError()
			const result = await listTaskSeries(context.session.accessToken, {
				workspaceId: context.workspace.workspaceId,
				page,
				pageSize: 10,
				status,
				...(applied ? { search: applied } : {})
			})
			if (!context.current()) throw invalidContractError()
			return result
		}
	})
	const data =
		context.canRead && !records.isError ? records.data : undefined
	const labels = useAssigneeLabels(
		workdayDirectoryContext(context),
		data?.items.map(row => row.assignee) ?? []
	)
	const close = () => {
		if (command.canClose()) onClose()
	}
	const switchStatus = (row: TaskSeries, next: SeriesStatus) => {
		if (!command.locked)
			void command.execute({
				kind: 'status',
				id: row.id,
				expectedVersion: row.version,
				status: next
			})
	}
	const review = () => {
		if (command.canClose()) {
			command.reset()
			setEditor(null)
			setCancel(null)
			void records.refetch()
			toast('Список серий обновляется')
		}
	}
	return (
		<Drawer
			isOpen
			title={
				editor
					? editor === 'new'
						? 'Новая повторяющаяся задача'
						: 'Изменить серию'
					: 'Повторяющиеся задачи'
			}
			size="lg"
			onClose={close}
			description="Регулярные дела создаются автоматически и появляются в Планировщике как обычные задачи."
		>
			<div className={styles.content}>
				{!context.canWrite ? (
					<ReadOnlyBanner description="Серии доступны для просмотра. Изменение требует действующего доступа и соответствующих прав." />
				) : null}
				{context.canWrite && !command.actorConfirmed ? (
					<div className={styles.warning}>
						<p>
							{command.actorLoading
								? 'Проверяем ваш профиль сотрудника…'
								: 'Не удалось подтвердить ваш профиль. Просмотр доступен, изменения временно заблокированы.'}
						</p>
						{!command.actorLoading ? (
							<Button
								variant="secondary"
								onClick={() => void command.recheckActor()}
							>
								Проверить профиль
							</Button>
						) : null}
					</div>
				) : null}
				{command.error ? (
					<p role="alert" className={styles.error}>
						{command.error.message}
					</p>
				) : null}
				{command.uncertain ? (
					<div className={styles.warning}>
						<p>
							Результат сохранения ещё неизвестен. Проверка повторит
							исходную команду, без второй серии или изменения.
						</p>
						<Button
							disabled={!command.canRetry}
							onClick={() => void command.execute()}
						>
							Проверить результат
						</Button>
					</div>
				) : command.blocked ? (
					<Button variant="secondary" onClick={review}>
						Обновить список и проверить данные
					</Button>
				) : null}
				{editor ? (
					<SeriesForm
						key={
							editor === 'new' ? 'new' : `${editor.id}:${editor.version}`
						}
						series={editor === 'new' ? null : editor}
						command={command}
						onBack={review}
					/>
				) : (
					<>
						<div className={styles.toolbar}>
							<SelectField
								label="Статус серий"
								value={status}
								disabled={
									command.locked && (command.running || command.uncertain)
								}
								onChange={event => {
									setStatus(event.target.value as SeriesStatus | 'ALL')
									setPage(1)
									toast('Фильтр серий обновлён')
								}}
							>
								<option value="ACTIVE">Активные</option>
								<option value="PAUSED">На паузе</option>
								<option value="CANCELLED">Отменённые</option>
								<option value="ALL">Все серии</option>
							</SelectField>
							<Button
								disabled={command.locked}
								onClick={() => {
									setEditor('new')
									toast('Создание повторяющейся задачи')
								}}
							>
								Новая серия
							</Button>
						</div>
						<form
							className={styles.toolbar}
							onSubmit={event => {
								event.preventDefault()
								if (command.running || command.uncertain) return
								setApplied(search.trim())
								setPage(1)
								toast('Поиск серий обновлён')
							}}
						>
							<TextField
								label="Поиск серии"
								placeholder="Название задачи"
								maxLength={200}
								value={search}
								onChange={event => setSearch(event.target.value)}
							/>
							<Button
								type="submit"
								variant="secondary"
								disabled={
									records.isFetching ||
									command.running ||
									command.uncertain
								}
							>
								Найти
							</Button>
						</form>
						<p className={styles.note}>
							Пауза останавливает новые повторы, но не меняет созданные
							задачи. После возобновления или простоя появится одна
							актуальная задача, без накопившегося списка.
						</p>
						{records.isError ? (
							<ScreenState
								compact
								variant="error"
								description="Не удалось загрузить серии задач."
								action={
									<Button
										variant="secondary"
										onClick={() => void records.refetch()}
									>
										Повторить загрузку
									</Button>
								}
							/>
						) : records.isPending ? (
							<ScreenState compact variant="loading" />
						) : data?.total === 0 ? (
							<ScreenState
								compact
								variant="empty"
								title="Серии не найдены"
								description="Создайте повтор для регулярного звонка, отчёта или встречи — со сделкой или без неё."
							/>
						) : null}
						{data?.items.map(row => {
							const employee = labels.lookup(row.assignee)?.employee
							return (
								<article
									key={row.id}
									className={styles.card}
									aria-label={row.title}
								>
									<div className={styles.heading}>
										<h3>{row.title}</h3>
										<StatusBadge
											tone={
												row.status === 'ACTIVE'
													? 'success'
													: row.status === 'PAUSED'
														? 'warning'
														: 'neutral'
											}
										>
											{statusLabels[row.status]}
										</StatusBadge>
									</div>
									<dl className={styles.details}>
										<div>
											<dt>Повторение</dt>
											<dd>
												{seriesFrequencyLabels[row.frequency]} · срок{' '}
												{row.localTime}
											</dd>
										</div>
										<div>
											<dt>Ответственный</dt>
											<dd>
												{employee
													? assigneeDisplayName(employee)
													: labels.loading
														? 'Загружаем имя…'
														: 'Сотрудник недоступен'}
											</dd>
										</div>
										<div>
											<dt>
												{row.status === 'ACTIVE'
													? 'Следующее появление'
													: 'Расписание'}
											</dt>
											<dd>
												{row.status === 'ACTIVE'
													? workdayDateLabel(row.nextRunAt, row.timeZone)
													: statusLabels[row.status]}
												<br />
												{row.timeZone}
											</dd>
										</div>
										<div>
											<dt>Связь</dt>
											<dd>
												{row.dealId
													? 'Задачи по сделке'
													: 'Самостоятельные задачи'}
											</dd>
										</div>
									</dl>
									{row.blockedReason && row.status === 'ACTIVE' ? (
										<p className={styles.warning}>
											{blockedLabels[row.blockedReason]} Новые задачи пока
											не создаются; после восстановления прав система
											проверит серию повторно.
										</p>
									) : null}
									{row.status !== 'CANCELLED' ? (
										<div className={styles.actions}>
											<Button
												variant="secondary"
												disabled={command.locked || records.isFetching}
												onClick={() => setEditor(row)}
											>
												Изменить
											</Button>
											<Button
												variant="secondary"
												disabled={command.locked || records.isFetching}
												onClick={() =>
													switchStatus(
														row,
														row.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
													)
												}
											>
												{row.status === 'ACTIVE'
													? 'Приостановить'
													: 'Возобновить'}
											</Button>
											<Button
												variant="ghost"
												disabled={command.locked || records.isFetching}
												onClick={() => setCancel(row)}
											>
												Отменить серию
											</Button>
										</div>
									) : null}
									{cancel?.id === row.id ? (
										<div className={styles.warning}>
											<p>
												Отменить серию «{row.title}»? Возобновить её будет
												нельзя. Все уже созданные задачи останутся.
											</p>
											<div className={styles.actions}>
												<Button
													disabled={command.locked}
													onClick={() => switchStatus(row, 'CANCELLED')}
												>
													Да, отменить серию
												</Button>
												<Button
													variant="secondary"
													disabled={command.running || command.uncertain}
													onClick={() => setCancel(null)}
												>
													Оставить серию
												</Button>
											</div>
										</div>
									) : null}
								</article>
							)
						})}
						<nav
							className={styles.pagination}
							aria-label="Страницы повторяющихся задач"
						>
							<Button
								variant="secondary"
								disabled={
									page === 1 ||
									records.isFetching ||
									command.running ||
									command.uncertain
								}
								onClick={() => {
									setPage(page - 1)
									toast('Предыдущая страница серий')
								}}
							>
								Назад
							</Button>
							<span>
								Всего: {data?.total ?? '—'} · {page} /{' '}
								{Math.max(1, Math.ceil((data?.total ?? 0) / 10))}
							</span>
							<Button
								variant="secondary"
								disabled={
									!data ||
									page * 10 >= data.total ||
									records.isFetching ||
									command.running ||
									command.uncertain
								}
								onClick={() => {
									setPage(page + 1)
									toast('Следующая страница серий')
								}}
							>
								Далее
							</Button>
						</nav>
					</>
				)}
			</div>
		</Drawer>
	)
}

const SeriesForm = ({
	series,
	command,
	onBack
}: {
	series: TaskSeries | null
	command: ReturnType<typeof useTaskSeriesCommand>
	onBack: () => void
}) => {
	const context = command.context
	const [title, setTitle] = useState(series?.title ?? ''),
		[localTime, setLocalTime] = useState(series?.localTime ?? '10:00'),
		[timeZone, setTimeZone] = useState(series?.timeZone ?? 'Europe/Moscow')
	const [frequency, setFrequency] = useState<SeriesFrequency>(
			series?.frequency ?? 'DAILY'
		),
		[startDate, setStartDate] = useState(series?.startDate ?? '')
	const [linked, setLinked] = useState(!!series?.dealId),
		[deal, setDeal] = useState<SalesDeal | null>(null),
		[teamId, setTeamId] = useState(series?.teamId ?? '')
	const [assignee, setAssignee] = useState<AssigneeBinding | null>(
			series?.assignee ?? null
		),
		[checking, setChecking] = useState(false),
		[error, setError] = useState<string | null>(null)
	const linkedDeal = useQuery({
		queryKey: ['task-series-deal', ...context.key, series?.dealId],
		enabled: !!series?.dealId && context.canRead,
		retry: false,
		staleTime: 0,
		gcTime: 0,
		refetchOnWindowFocus: false,
		queryFn: async () => {
			if (!context.current() || !context.session || !series?.dealId)
				throw invalidContractError()
			const value = await getSalesDeal(
				context.session.accessToken,
				context.workspace.workspaceId,
				series.dealId
			)
			if (!context.current()) throw invalidContractError()
			return value
		}
	})
	const currentDeal = series?.dealId ? linkedDeal.data : deal
	const effectiveTeam = linked ? (currentDeal?.teamId ?? '') : teamId
	const options = useAssigneeOptions(workdayDirectoryContext(context), {
		selectedSubject: assignee?.subject ?? context.session?.userId,
		...(effectiveTeam ? { teamId: effectiveTeam } : {})
	})
	const originalOwner =
		assignee?.membershipId === null &&
		options.selected?.subject === assignee.subject &&
		options.selected.role === 'OWNER'
			? options.selected
			: null
	const selected = assignee
		? (originalOwner ?? options.resolveBinding(assignee))
		: options.resolveBinding({ subject: context.session?.userId ?? '' })
	const teams = useTeamOptions(
		{
			workspaceId: context.workspace.workspaceId,
			subject: context.session?.userId,
			accessToken: context.session?.accessToken,
			sessionRevision: context.sessionRevision,
			permissionScope: context.scopeKey,
			teamIds: context.permissions.data?.teamIds ?? [],
			enabled: context.canRead && !linked
		},
		teamId
	)
	const content = selected
		? {
				title: title.trim(),
				localTime,
				timeZone,
				assignee: {
					subject: selected.subject,
					membershipId:
						assignee?.subject === selected.subject &&
						(assignee.membershipId === selected.membershipId ||
							(assignee.membershipId === null &&
								selected.role === 'OWNER'))
							? assignee.membershipId
							: selected.role === 'OWNER'
								? null
								: selected.membershipId
				}
			}
		: null
	const locked = command.locked || checking
	const valid =
		!!content &&
		validSeriesContent(content) &&
		validSeriesDate(startDate) &&
		(linked
			? !!currentDeal &&
				currentDeal.status === 'OPEN' &&
				!currentDeal.archivedAt
			: teams.validSelection)
	const save = async () => {
		if (
			!valid ||
			!content ||
			locked ||
			!context.current() ||
			!context.session
		)
			return
		setChecking(true)
		setError(null)
		try {
			if (linked && currentDeal) {
				const fresh = await getSalesDeal(
					context.session.accessToken,
					context.workspace.workspaceId,
					currentDeal.id
				)
				if (!context.current()) return
				if (
					fresh.status !== 'OPEN' ||
					fresh.archivedAt ||
					fresh.teamId !== currentDeal.teamId
				)
					throw new AuthenticatedApiError(
						'conflict',
						'Связанная сделка изменилась. Обновите список серий.'
					)
			}
			if (!context.current()) return
			await command.execute(
				series
					? {
							kind: 'edit',
							id: series.id,
							expectedVersion: series.version,
							content
						}
					: {
							kind: 'create',
							content,
							frequency,
							startDate,
							dealId: linked ? currentDeal!.id : null,
							teamId: linked ? null : teamId || null
						}
			)
		} catch (cause) {
			const message =
				cause instanceof AuthenticatedApiError
					? cause.message
					: 'Не удалось проверить данные. Серия не отправлена.'
			setError(message)
			toast.error(message)
		} finally {
			setChecking(false)
		}
	}
	return (
		<div className={styles.content}>
			<p className={styles.note}>
				{series
					? 'Изменения действуют только для будущих повторов. Частота, начальная дата и связь со сделкой сохраняются. Для другого календаря создайте новую серию.'
					: 'Задача появится в начале выбранного дня. Укажите её срок по местному времени и ответственного. Повторы создаются только при действующем доступе.'}
			</p>
			<fieldset disabled={locked} className={styles.form}>
				<TextField
					label="Название задачи"
					value={title}
					maxLength={200}
					onChange={event => setTitle(event.target.value)}
				/>
				<div className={styles.fieldsGrid}>
					<SelectField
						label="Повторение"
						value={frequency}
						disabled={!!series}
						onChange={event =>
							setFrequency(event.target.value as SeriesFrequency)
						}
					>
						{Object.entries(seriesFrequencyLabels).map(
							([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							)
						)}
					</SelectField>
					<TextField
						label="Дата первого повторения"
						type="date"
						value={startDate}
						disabled={!!series}
						min="2000-01-01"
						max="2099-12-31"
						onChange={event => setStartDate(event.target.value)}
					/>
				</div>
				{frequency === 'WEEKLY' ? (
					<p className={styles.note}>
						Повтор в день недели выбранной начальной даты.
					</p>
				) : frequency === 'MONTHLY' ? (
					<p className={styles.note}>
						Повтор в число начальной даты. Если его нет в месяце, задача
						появится в последний день месяца.
					</p>
				) : null}
				<div className={styles.fieldsGrid}>
					<TextField
						label="Срок каждой задачи"
						type="time"
						value={localTime}
						onChange={event => setLocalTime(event.target.value)}
					/>
					<TimeZoneSelect
						value={timeZone}
						onChange={setTimeZone}
						disabled={locked}
					/>
				</div>
				<SelectField
					label="Связь со сделкой"
					value={linked ? 'deal' : 'standalone'}
					disabled={!!series}
					onChange={event => {
						setLinked(event.target.value === 'deal')
						setAssignee(null)
					}}
				>
					<option value="standalone">Без сделки</option>
					<option value="deal">Связать со сделкой</option>
				</SelectField>
				{linked ? (
					series ? (
						<p className={styles.note}>
							{linkedDeal.isPending
								? 'Загружаем сделку…'
								: linkedDeal.isError
									? 'Не удалось проверить связанную сделку. Обновите список и повторите.'
									: currentDeal?.title}
							{currentDeal && currentDeal.status !== 'OPEN'
								? ' · сделка закрыта, редактирование серии недоступно'
								: ''}
						</p>
					) : (
						<WorkdayDealChoice
							context={context}
							value={deal}
							onChange={next => {
								setDeal(next)
								setAssignee(null)
							}}
							disabled={locked}
						/>
					)
				) : (
					<TeamSelect
						options={teams}
						value={teamId}
						onChange={value => {
							setTeamId(value)
							setAssignee(null)
						}}
						disabled={locked || !!series}
						label="Отдел задач"
					/>
				)}
				<AssigneeSelect
					options={options}
					value={
						selected
							? {
									subject: selected.subject,
									membershipId: selected.membershipId
								}
							: assignee
					}
					onChange={option =>
						setAssignee({
							subject: option.subject,
							membershipId:
								option.role === 'OWNER' ? null : option.membershipId
						})
					}
					disabled={locked}
				/>
			</fieldset>
			{error ? (
				<p className={styles.error} role="alert">
					{error}
				</p>
			) : null}
			<div className={styles.footer}>
				<Button
					variant="secondary"
					disabled={checking || command.running || command.uncertain}
					onClick={onBack}
				>
					К списку серий
				</Button>
				<Button
					disabled={locked || !valid}
					isLoading={command.running || checking}
					onClick={() => void save()}
				>
					{series ? 'Сохранить будущие повторы' : 'Создать серию'}
				</Button>
			</div>
		</div>
	)
}
