'use client'

import {
	isWorkdayDate,
	isWorkdayTimeZone,
	validWorkdayFilters,
	type WorkdayFilters as Filters,
	type WorkdayPeriod,
	type WorkdayScope,
	type WorkdayStatus
} from '@/entities/crm-workday'
import { Button, HelpHint, SelectField, TextField } from '@/shared/ui'
import { useRef, useState, type FormEvent } from 'react'
import type { AssigneeDirectoryContext } from '@/entities/crm-team'
import toast from 'react-hot-toast'
import {
	WORKDAY_STATUS_LABELS,
	type WorkdayView
} from '../model/workday-view'
import styles from './MyDayScreen.module.scss'
import { WorkdayTimeZoneSelect } from './WorkdayTimeZoneSelect'
import {
	WorkdayPeopleFilters,
	type WorkdayPeopleFilterValue,
	type WorkdayPeopleFiltersHandle
} from './WorkdayPeopleFilters'

const periods: Record<WorkdayPeriod, string> = {
	TODAY: 'Сегодня',
	TOMORROW: 'Завтра',
	WEEK: 'Неделя',
	DAY: 'Выбрать день',
	RANGE: 'Период',
	ALL: 'Все задачи',
	OVERDUE: 'Просроченные'
}
const scopes: Record<WorkdayScope, string> = {
	MINE: 'Мои задачи',
	TEAM: 'Мои отделы',
	ALL: 'Вся команда'
}

export const WorkdayFilters = ({
	value,
	allowedScopes,
	view,
	peopleContext,
	onChange,
	onViewChange
}: {
	value: Filters
	allowedScopes: readonly WorkdayScope[]
	view: WorkdayView
	peopleContext?: AssigneeDirectoryContext
	onChange: (filters: Filters) => boolean | void
	onViewChange: (view: WorkdayView) => boolean | void
}) => {
	const [period, setPeriod] = useState(value.period)
	const [scope, setScope] = useState(value.scope)
	const [from, setFrom] = useState(value.from ?? '')
	const [to, setTo] = useState(value.to ?? '')
	const [timeZone, setTimeZone] = useState(value.timeZone)
	const [search, setSearch] = useState(value.search ?? '')
	const [status, setStatus] = useState<WorkdayStatus | ''>(
		value.status ?? ''
	)
	const [people, setPeople] = useState<WorkdayPeopleFilterValue>({
		teamId: value.teamId,
		assigneeSubject: value.assigneeSubject
	})
	const peopleRef = useRef<WorkdayPeopleFiltersHandle>(null)
	const validDates =
		(period !== 'DAY' && period !== 'RANGE') ||
		(isWorkdayDate(from) &&
			(period !== 'RANGE' || (isWorkdayDate(to) && from <= to)))
	const submit = (event: FormEvent) => {
		event.preventDefault()
		if (
			!validDates ||
			!isWorkdayTimeZone(timeZone) ||
			!allowedScopes.includes(scope)
		)
			return
		const selectedPeople = peopleContext
			? peopleRef.current?.resolve()
			: {}
		if (!selectedPeople) {
			toast.error(
				'Подтвердите выбранного сотрудника и отдел или сбросьте фильтр'
			)
			return
		}
		const date =
			period === 'DAY'
				? ({ period, from } as const)
				: period === 'RANGE'
					? ({ period, from, to } as const)
					: { period }
		const next: Filters = {
			...date,
			scope,
			timeZone,
			page: 1,
			pageSize: 20,
			...selectedPeople,
			...(search.trim() ? { search: search.trim() } : {}),
			...(status && view === 'list' ? { status } : {})
		}
		if (!validWorkdayFilters(next)) {
			toast.error('Проверьте даты и параметры выбранного периода')
			return
		}
		if (onChange(next) !== false) toast.success('Фильтры применены')
	}
	return (
		<section className={styles.filters} aria-label="Период и вид задач">
			<div className={styles.toolbar}>
				<div
					className={styles.viewSwitch}
					role="group"
					aria-label="Быстрый выбор периода"
				>
					{(['TODAY', 'TOMORROW', 'WEEK', 'OVERDUE'] as const).map(
						nextPeriod => (
							<Button
								key={nextPeriod}
								size="sm"
								variant={value.period === nextPeriod ? 'primary' : 'ghost'}
								aria-pressed={value.period === nextPeriod}
								onClick={() => {
									const next: Filters = {
										...value,
										period: nextPeriod,
										from: undefined,
										to: undefined,
										page: 1,
										...(nextPeriod === 'OVERDUE'
											? { status: undefined }
											: {})
									}
									if (onChange(next) !== false)
										toast(
											`Показаны задачи: ${periods[nextPeriod].toLowerCase()}`
										)
								}}
							>
								{periods[nextPeriod]}
							</Button>
						)
					)}
				</div>
				<div
					className={styles.viewSwitch}
					role="group"
					aria-label="Представление задач"
				>
					{(['list', 'board'] as const).map(mode => (
						<Button
							key={mode}
							variant={view === mode ? 'primary' : 'secondary'}
							aria-pressed={view === mode}
							onClick={() => {
								if (onViewChange(mode) !== false)
									toast(mode === 'list' ? 'Задачи списком' : 'Доска задач')
							}}
						>
							{mode === 'list' ? 'Список' : 'Доска'}
						</Button>
					))}
				</div>
			</div>
			<form className={styles.filterGrid} onSubmit={submit}>
				<SelectField
					label="Период"
					value={period}
					onChange={e => setPeriod(e.target.value as WorkdayPeriod)}
				>
					{Object.entries(periods).map(([key, label]) => (
						<option key={key} value={key}>
							{label}
						</option>
					))}
				</SelectField>
				<SelectField
					label="Чьи задачи"
					hint={
						<>
							Область зависит от вашей роли.{' '}
							<HelpHint
								label="Область задач"
								description="«Мои задачи» показывает назначенные вам. «Мои отделы» добавляет задачи доступных отделов, «Вся команда» — все разрешённые вашей ролью задачи."
							/>
						</>
					}
					value={scope}
					onChange={e => setScope(e.target.value as WorkdayScope)}
				>
					{allowedScopes.map(key => (
						<option key={key} value={key}>
							{scopes[key]}
						</option>
					))}
				</SelectField>
				{period === 'DAY' || period === 'RANGE' ? (
					<TextField
						label={period === 'DAY' ? 'День' : 'С даты'}
						type="date"
						required
						value={from}
						onChange={e => setFrom(e.target.value)}
					/>
				) : null}
				{period === 'RANGE' ? (
					<TextField
						label="По дату включительно"
						type="date"
						required
						min={from}
						value={to}
						onChange={e => setTo(e.target.value)}
					/>
				) : null}
				<details className={styles.advanced}>
					<summary>Поиск и дополнительные фильтры</summary>
					<div className={styles.advancedGrid}>
						<WorkdayTimeZoneSelect
							value={timeZone}
							onChange={setTimeZone}
						/>
						{view === 'list' ? (
							<SelectField
								label="Статус"
								value={status}
								onChange={e =>
									setStatus(e.target.value as WorkdayStatus | '')
								}
							>
								<option value="">Все статусы</option>
								{Object.entries(WORKDAY_STATUS_LABELS).map(
									([key, label]) => (
										<option key={key} value={key}>
											{label}
										</option>
									)
								)}
							</SelectField>
						) : null}
						<TextField
							label="Поиск по задаче"
							value={search}
							maxLength={200}
							onChange={e => setSearch(e.target.value)}
						/>
						{peopleContext ? (
							<WorkdayPeopleFilters
								ref={peopleRef}
								context={peopleContext}
								scope={scope}
								value={people}
								onChange={setPeople}
							/>
						) : null}
					</div>
				</details>
				<Button
					type="submit"
					variant="secondary"
					disabled={!validDates || !isWorkdayTimeZone(timeZone)}
				>
					Применить
				</Button>
			</form>
			{view === 'board' ? (
				<p className={styles.hint}>
					Отменённые задачи доступны в списке. На доске каждая колонка
					имеет свои страницы.
				</p>
			) : null}
		</section>
	)
}
