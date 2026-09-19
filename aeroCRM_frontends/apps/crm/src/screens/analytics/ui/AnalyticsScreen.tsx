'use client'

import {
	getSalesAnalyticsOverview,
	type DealStatus,
	type SalesAnalyticsPeriod
} from '@/entities/sales'
import {
	assigneeDisplayName,
	useAssigneeLabels
} from '@/entities/crm-team'
import { useSessionStore } from '@/entities/session'
import { salesMoney, useSalesSession } from '@/features/manage-sales'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import {
	AppIcon,
	Button,
	PageHeader,
	ScreenState,
	SelectField,
	StatusBadge,
	TextField,
	type StatusBadgeTone
} from '@/shared/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'
import toast from 'react-hot-toast'
import styles from './AnalyticsScreen.module.scss'

const statuses: {
	status: DealStatus
	label: string
	tone: StatusBadgeTone
	hint: string
}[] = [
	{
		status: 'OPEN',
		label: 'В работе',
		tone: 'info',
		hint: 'Потенциальная сумма открытых сделок'
	},
	{
		status: 'WON',
		label: 'Успешно закрыты',
		tone: 'success',
		hint: 'Сумма успешных сделок, не поступившая оплата'
	},
	{
		status: 'LOST',
		label: 'Закрыты с отказом',
		tone: 'neutral',
		hint: 'Сумма сделок, завершённых без продажи'
	}
]
const number = new Intl.NumberFormat('ru-RU')
const dateFormat = new Intl.DateTimeFormat('ru-RU', {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
	timeZone: 'Europe/Moscow'
})
const day = 86400000
const dateInput = (date: Date) =>
	new Date(date.getTime() + 3 * 3600000).toISOString().slice(0, 10)
const periodForDays = (days: number): SalesAnalyticsPeriod => {
	const midnight = new Date(
		`${dateInput(new Date())}T00:00:00+03:00`
	).getTime()
	return {
		createdFrom: new Date(midnight - (days - 1) * day).toISOString(),
		createdTo: new Date(midnight + day).toISOString()
	}
}
const periodLabel = (period: SalesAnalyticsPeriod) =>
	`${dateFormat.format(new Date(period.createdFrom))} — ${dateFormat.format(new Date(Date.parse(period.createdTo) - 1))}`
const difference = (current: number, previous: number) => {
	const delta = current - previous
	return `${delta > 0 ? '+' : ''}${number.format(delta)} к прошлому периоду${previous > 0 ? ` (${delta > 0 ? '+' : ''}${number.format(Math.round((delta / previous) * 100))}%)` : ''}`
}
const dealsHref = (filters: Record<string, string | undefined>) => {
	const params = new URLSearchParams()
	for (const [key, value] of Object.entries(filters))
		if (value) params.set(key, value)
	return `/deals?${params.toString()}`
}

const AnalyticsScreen = () => {
	const context = useSalesSession()
	const client = useQueryClient()
	const [preset, setPreset] = useState('30')
	const [period, setPeriod] = useState<SalesAnalyticsPeriod | null>(() =>
		periodForDays(30)
	)
	const [from, setFrom] = useState(() =>
		dateInput(new Date(periodForDays(30).createdFrom))
	)
	const [to, setTo] = useState(() => dateInput(new Date()))
	const [assigneePage, setAssigneePage] = useState(1)
	const permissions = context.permissions
	const canRead =
		!!context.session &&
		!!permissions.data &&
		permissions.data.subject === context.session.userId &&
		permissions.data.workspaceId === context.workspace.workspaceId &&
		!permissions.isError &&
		!permissions.isFetching &&
		permissions.data.permissions.includes('sales:analytics')
	const canReadDeals = canRead && context.canRead
	const query = { ...(period || {}), assigneePage }
	const report = useQuery({
		queryKey: [
			'sales',
			'analytics',
			...context.key,
			permissions.data?.role,
			permissions.data?.dataScope,
			permissions.data?.teamIds.join(','),
			query
		],
		enabled: canRead,
		queryFn: async () => {
			const session = context.session!
			try {
				return await getSalesAnalyticsOverview(
					session.accessToken,
					context.workspace.workspaceId,
					query
				)
			} catch (error) {
				const current = useSessionStore.getState()
				if (
					error instanceof AuthenticatedApiError &&
					error.kind === 'unauthorized' &&
					current.sessionRevision === context.sessionRevision &&
					current.session?.accessToken === session.accessToken
				)
					current.setAnonymous()
				throw error
			}
		},
		retry: false,
		gcTime: 0
	})
	const data =
		canRead && !report.isFetching && !report.isError
			? report.data
			: undefined
	const labels = useAssigneeLabels(
		{
			workspaceId: context.workspace.workspaceId,
			subject: context.session?.userId,
			accessToken: context.session?.accessToken,
			sessionRevision: context.sessionRevision,
			authority: permissions.data,
			canRead: canReadDeals,
			isCurrent: () => {
				const current = useSessionStore.getState()
				return (
					current.sessionRevision === context.sessionRevision &&
					current.session?.accessToken === context.session?.accessToken
				)
			}
		},
		data?.overview.assignees?.items.map(row => ({
			subject: row.assignedToSubject,
			membershipId: null
		})) || []
	)
	const reload = async () => {
		const checked = await permissions.refetch()
		if (
			checked.isError ||
			!checked.data?.permissions.includes('sales:analytics')
		) {
			toast.error('Не удалось подтвердить доступ к отчёту')
			return
		}
		await client.invalidateQueries({
			queryKey: ['sales', 'analytics', ...context.key]
		})
		toast('Данные отчёта запрошены заново')
	}
	const changePreset = (value: string) => {
		setPreset(value)
		if (value === 'custom') return
		setPeriod(value === 'all' ? null : periodForDays(Number(value)))
		setAssigneePage(1)
		toast('Период отчёта изменён')
	}
	const applyRange = () => {
		const start = new Date(`${from}T00:00:00+03:00`)
		const end = new Date(new Date(`${to}T00:00:00+03:00`).getTime() + day)
		if (
			!Number.isFinite(start.getTime()) ||
			!Number.isFinite(end.getTime()) ||
			end.getTime() <= start.getTime() ||
			end.getTime() - start.getTime() > 366 * day ||
			dateInput(start) !== from ||
			dateInput(new Date(end.getTime() - day)) !== to
		) {
			toast.error('Выберите корректный период до 366 дней')
			return
		}
		setPeriod({
			createdFrom: start.toISOString(),
			createdTo: end.toISOString()
		})
		setAssigneePage(1)
		toast.success('Период отчёта применён')
	}
	const drilldown = (
		count: number,
		title: string,
		filters: Record<string, string | undefined>
	) =>
		canReadDeals ? (
			<Link
				className={styles.countLink}
				href={dealsHref(filters)}
				aria-label={`${title}: ${number.format(count)}, открыть сделки`}
				onClick={() => toast('Открываем выбранные сделки')}
			>
				{number.format(count)} <span aria-hidden="true">→</span>
			</Link>
		) : (
			<span>{number.format(count)}</span>
		)
	const total = data?.items.reduce((sum, item) => sum + item.count, 0) || 0
	const won = data?.items.find(item => item.status === 'WON')?.count || 0
	const lost = data?.items.find(item => item.status === 'LOST')?.count || 0
	const scope =
		permissions.data?.dataScope === 'OWN'
			? 'Только ваши сделки'
			: permissions.data?.dataScope === 'TEAM'
				? 'Ваши сделки и доступные команды'
				: 'Все доступные сделки пространства'
	return (
		<div className={styles.screen}>
			<PageHeader
				title="Аналитика"
				description="Результаты сделок и задачи, требующие внимания."
				actions={
					<Button
						variant="secondary"
						disabled={permissions.isFetching || report.isFetching}
						onClick={() => void reload()}
						leadingIcon={<AppIcon name="refresh" size={18} />}
					>
						Обновить
					</Button>
				}
			/>
			{canRead && (
				<div className={styles.filters}>
					<SelectField
						label="Создание сделок"
						value={preset}
						onChange={event => changePreset(event.target.value)}
					>
						<option value="7">Последние 7 дней</option>
						<option value="30">Последние 30 дней</option>
						<option value="90">Последние 90 дней</option>
						<option value="all">За всё время</option>
						<option value="custom">Выбрать период</option>
					</SelectField>
					{preset === 'custom' && (
						<>
							<TextField
								label="С"
								type="date"
								value={from}
								onChange={event => setFrom(event.target.value)}
							/>
							<TextField
								label="По"
								type="date"
								value={to}
								onChange={event => setTo(event.target.value)}
							/>
							<Button variant="secondary" onClick={applyRange}>
								Применить
							</Button>
						</>
					)}
					<span className={styles.timeZone}>Даты по Москве (UTC+3)</span>
				</div>
			)}
			{permissions.isError ? (
				<ScreenState
					variant="error"
					title="Не удалось проверить права"
					description="Данные скрыты до успешной проверки доступа."
				/>
			) : permissions.isPending || permissions.isFetching ? (
				<ScreenState
					variant="loading"
					title="Проверяем доступ к аналитике"
				/>
			) : !canRead ? (
				<ScreenState
					variant="permission"
					title="Аналитика недоступна"
					description="Для просмотра отчёта нужна CRM-роль с доступом к аналитике."
				/>
			) : report.isError ? (
				<ScreenState
					variant="error"
					title="Отчёт временно недоступен"
					description="Показатели не подменяются нулями. Обновите отчёт, чтобы повторить запрос."
				/>
			) : !data ? (
				<ScreenState variant="loading" title="Рассчитываем показатели" />
			) : (
				<>
					<div className={styles.reportScope}>
						<span>{scope}</span>
						<span>
							{data.overview.period
								? periodLabel(data.overview.period)
								: 'Без ограничения по дате'}
						</span>
					</div>
					<section
						className={styles.attentionSection}
						aria-labelledby="sales-attention-title"
					>
						<div className={styles.sectionHeading}>
							<h2 id="sales-attention-title">Контроль работы сейчас</h2>
							<p>Все открытые сделки независимо от выбранного периода.</p>
						</div>
						<div className={styles.attentionGrid}>
							<div>
								<span>Открытых сделок</span>
								<strong>
									{drilldown(
										data.overview.attention.open,
										'Открытые сделки',
										{ status: 'OPEN' }
									)}
								</strong>
							</div>
							<div>
								<span>С просроченными действиями</span>
								<strong>
									{drilldown(
										data.overview.attention.overdue,
										'С просроченными действиями',
										{
											status: 'OPEN',
											overdue: 'true',
											overdueBefore: data.overview.asOf
										}
									)}
								</strong>
							</div>
							<div>
								<span>Без следующего действия</span>
								<strong>
									{drilldown(
										data.overview.attention.withoutNextAction,
										'Без следующего действия',
										{ status: 'OPEN', withoutNextAction: 'true' }
									)}
								</strong>
							</div>
						</div>
					</section>
					<div className={styles.sectionHeading}>
						<h2>Сделки, созданные за период</h2>
						<p>
							Текущий статус выбранных сделок. Дата закрытия не
							используется.
						</p>
					</div>
					{total === 0 && (
						<p className={styles.emptyNote}>
							За выбранный период сделок нет. Контроль текущей работы
							показан выше.
						</p>
					)}
					<section
						className={styles.metricGrid}
						aria-label="Сделки по статусам"
					>
						{statuses.map(({ status, label, tone, hint }) => {
							const item = data.items.find(row => row.status === status)!
							const previous = data.overview.previous?.items.find(
								row => row.status === status
							)
							return (
								<article
									key={status}
									className={styles.metricCard}
									aria-label={label}
								>
									<StatusBadge tone={tone}>{label}</StatusBadge>
									<strong>
										{drilldown(item.count, label, {
											status,
											...(data.overview.period || {})
										})}
									</strong>
									{previous && (
										<span className={styles.comparison}>
											{difference(item.count, previous.count)}
										</span>
									)}
									<p className={styles.metricAmount}>
										{salesMoney(item.amountMinor)}
									</p>
									<small>{hint}</small>
								</article>
							)
						})}
					</section>
					{data.overview.previous && (
						<p className={styles.footnote}>
							Сравнение: {periodLabel(data.overview.previous.period)}.
							Сопоставляются сделки, созданные в двух равных по
							длительности периодах, по их статусу сейчас.
						</p>
					)}
					<section
						className={styles.summaryPanel}
						aria-labelledby="sales-summary-title"
					>
						<div>
							<h2 id="sales-summary-title">Успешные среди закрытых</h2>
							<p>
								В выбранной группе созданных сделок. Открытые сделки не
								входят в расчёт.
							</p>
						</div>
						<div className={styles.summaryValue}>
							<strong>
								{won + lost
									? `${number.format(Math.round((won / (won + lost)) * 100))}%`
									: '—'}
							</strong>
							<span>
								{won + lost
									? `${number.format(won)} успешных из ${number.format(won + lost)} закрытых`
									: 'Закрытых сделок пока нет'}
							</span>
						</div>
					</section>
					{canReadDeals && data.overview.assignees && (
						<section
							className={styles.teamSection}
							aria-labelledby="sales-team-title"
						>
							<div className={styles.sectionHeading}>
								<h2 id="sales-team-title">
									Результаты и загрузка сотрудников
								</h2>
								<p>
									Созданные и успешные — за период создания. Работа,
									просрочки и отсутствие действий — на текущий момент.
								</p>
							</div>
							{labels.error && (
								<p className={styles.footnote}>
									Имена временно недоступны. Показатели и переходы к
									сделкам сохранены.
								</p>
							)}
							{data.overview.assignees.items.length === 0 ? (
								<p className={styles.emptyNote}>
									Нет сотрудников со сделками на этой странице.
								</p>
							) : (
								data.overview.assignees.items.map(row => {
									const employee = labels.lookup({
										subject: row.assignedToSubject,
										membershipId: null
									})?.employee
									const name = employee
										? assigneeDisplayName(employee)
										: row.assignedToSubject === context.session?.userId
											? 'Вы'
											: labels.loading
												? 'Загрузка имени…'
												: 'Сотрудник вне текущего каталога'
									const filter = {
										assignedToSubject: row.assignedToSubject
									}
									return (
										<article
											className={styles.employeeRow}
											key={row.assignedToSubject}
											aria-label={name}
										>
											<h3>{name}</h3>
											<div>
												<span>Создано</span>
												{drilldown(
													row.items.reduce(
														(sum, item) => sum + item.count,
														0
													),
													`${name}, создано`,
													{ ...filter, ...(data.overview.period || {}) }
												)}
											</div>
											<div>
												<span>Успешно</span>
												{drilldown(
													row.items.find(item => item.status === 'WON')!
														.count,
													`${name}, успешно`,
													{
														...filter,
														status: 'WON',
														...(data.overview.period || {})
													}
												)}
											</div>
											<div>
												<span>В работе</span>
												{drilldown(row.open, `${name}, в работе`, {
													...filter,
													status: 'OPEN'
												})}
											</div>
											<div>
												<span>Просрочено</span>
												{drilldown(row.overdue, `${name}, просрочено`, {
													...filter,
													status: 'OPEN',
													overdue: 'true',
													overdueBefore: data.overview.asOf
												})}
											</div>
											<div>
												<span>Без действия</span>
												{drilldown(
													row.withoutNextAction,
													`${name}, без действия`,
													{
														...filter,
														status: 'OPEN',
														withoutNextAction: 'true'
													}
												)}
											</div>
										</article>
									)
								})
							)}
							{(assigneePage > 1 || data.overview.assignees.hasMore) && (
								<div className={styles.pagination}>
									<Button
										variant="secondary"
										disabled={assigneePage === 1}
										onClick={() => {
											setAssigneePage(page => page - 1)
											toast('Предыдущая страница сотрудников')
										}}
									>
										Назад
									</Button>
									<span>Страница {assigneePage}</span>
									<Button
										variant="secondary"
										disabled={!data.overview.assignees.hasMore}
										onClick={() => {
											setAssigneePage(page => page + 1)
											toast('Следующая страница сотрудников')
										}}
									>
										Далее
									</Button>
								</div>
							)}
						</section>
					)}
					<p className={styles.footnote}>
						В периоде: {number.format(total)}. Архивные сделки исключены.
						Суммы сделок не являются выручкой или подтверждением оплаты.
						Просрочка означает хотя бы одно незавершённое действие со
						сроком до{' '}
						{new Intl.DateTimeFormat('ru-RU', {
							dateStyle: 'short',
							timeStyle: 'short',
							timeZone: 'Europe/Moscow'
						}).format(new Date(data.overview.asOf))}{' '}
						(МСК).
					</p>
				</>
			)}
		</div>
	)
}

export default AnalyticsScreen
