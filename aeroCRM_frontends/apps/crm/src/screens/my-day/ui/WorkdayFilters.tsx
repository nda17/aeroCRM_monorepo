'use client'

import {
	isWorkdayDate,
	isWorkdayTimeZone,
	validWorkdayFilters,
	type WorkdayFilters as Filters,
	type WorkdayPeriod,
	type WorkdayScope
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
	ALL: 'Все сроки',
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
	const [status, setStatus] = useState<Filters['status'] | ''>(
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
			...(status ? { status } : {})
		}
		if (!validWorkdayFilters(next)) {
			toast.error('Проверьте даты и параметры выбранного периода')
			return
		}
		onChange(next)
	}
	const clearFilter = (patch: Partial<Filters>) => {
		const next = { ...value, ...patch, page: 1 } as Filters
		if (validWorkdayFilters(next)) onChange(next)
	}
	const hasDraftChanges =
		period !== value.period ||
		scope !== value.scope ||
		timeZone !== value.timeZone ||
		search.trim() !== (value.search ?? '') ||
		status !== (value.status ?? '') ||
		((period === 'DAY' || period === 'RANGE') &&
			from !== (value.from ?? '')) ||
		(period === 'RANGE' && to !== (value.to ?? '')) ||
		(scope !== 'MINE' &&
			(people.teamId !== value.teamId ||
				people.assigneeSubject !== value.assigneeSubject))
	const chips: { label: string; patch: Partial<Filters> }[] = [
		...(value.period !== 'ALL'
			? [
					{
						label: periods[value.period],
						patch: {
							period: 'ALL' as const,
							from: undefined,
							to: undefined
						}
					}
				]
			: []),
		...(value.scope !== 'MINE' && allowedScopes.includes('MINE')
			? [
					{
						label: scopes[value.scope],
						patch: {
							scope: 'MINE' as const,
							teamId: undefined,
							assigneeSubject: undefined
						}
					}
				]
			: []),
		...(value.search
			? [{ label: `Поиск: ${value.search}`, patch: { search: undefined } }]
			: []),
		...(value.status
			? [
					{
						label:
							value.status === 'ACTIVE'
								? 'Текущие'
								: value.status === 'TERMINAL'
									? 'История'
									: WORKDAY_STATUS_LABELS[value.status],
						patch: { status: undefined }
					}
				]
			: []),
		...(value.teamId
			? [{ label: 'Выбран отдел', patch: { teamId: undefined } }]
			: []),
		...(value.assigneeSubject
			? [
					{
						label: 'Выбран сотрудник',
						patch: { assigneeSubject: undefined }
					}
				]
			: [])
	]
	return (
		<section className={styles.filters} aria-label="Период и вид задач">
			<div className={styles.toolbar}>
				<div
					className={styles.viewSwitch}
					role="group"
					aria-label="Быстрый выбор периода"
				>
					{(['ALL', 'OVERDUE', 'TODAY', 'WEEK'] as const).map(
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
											? { status: 'ACTIVE' }
											: {})
									}
									onChange(next)
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
							onClick={() => onViewChange(mode)}
						>
							{mode === 'list' ? 'Список' : 'Доска'}
						</Button>
					))}
				</div>
			</div>
			<div
				className={styles.historySwitch}
				role="group"
				aria-label="Текущие задачи и история"
			>
				{(
					[
						['ACTIVE', 'Текущие'],
						['TERMINAL', 'История'],
						[undefined, 'Все задачи']
					] as const
				).map(([nextStatus, label]) => (
					<Button
						key={label}
						size="sm"
						variant={value.status === nextStatus ? 'primary' : 'secondary'}
						aria-pressed={value.status === nextStatus}
						onClick={() =>
							clearFilter({
								status: nextStatus,
								...(nextStatus === 'TERMINAL' && value.period === 'OVERDUE'
									? { period: 'ALL', from: undefined, to: undefined }
									: {})
							})
						}
					>
						{label}
					</Button>
				))}
			</div>
			<form className={styles.filterGrid} onSubmit={submit}>
				<TextField
					label="Поиск по задаче"
					type="search"
					placeholder="Название задачи"
					value={search}
					maxLength={200}
					onChange={e => setSearch(e.target.value)}
				/>
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
					containerClassName={styles.scopeFilter}
					labelHelp={
						<HelpHint
							label="Область задач"
							description="Область зависит от вашей роли. «Мои задачи» показывает назначенные вам. «Мои отделы» добавляет задачи доступных отделов, «Вся команда» — все разрешённые вашей ролью задачи."
						/>
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
				<div className={styles.peopleFilters}>
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
				<details className={styles.advanced}>
					<summary>Дополнительные фильтры</summary>
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
									setStatus(e.target.value as Filters['status'] | '')
								}
							>
								<option value="">Все статусы</option>
								<option value="ACTIVE">Текущие</option>
								<option value="TERMINAL">
									История: готовые и отменённые
								</option>
								{Object.entries(WORKDAY_STATUS_LABELS).map(
									([key, label]) => (
										<option key={key} value={key}>
											{label}
										</option>
									)
								)}
							</SelectField>
						) : null}
					</div>
				</details>
				<Button
					type="submit"
					variant="primary"
					disabled={!validDates || !isWorkdayTimeZone(timeZone)}
				>
					Применить
				</Button>
			</form>
			{hasDraftChanges ? (
				<p className={styles.draftNotice} role="status">
					Фильтры изменены. Нажмите «Применить», чтобы обновить задачи.
				</p>
			) : null}
			<p className={styles.appliedFilters}>
				Применено: {scopes[value.scope]} · {periods[value.period]}.
			</p>
			{chips.length ? (
				<div
					className={styles.filterChips}
					aria-label="Активные фильтры задач"
				>
					{chips.map(chip => (
						<Button
							key={chip.label}
							size="sm"
							variant="secondary"
							aria-label={`Снять фильтр: ${chip.label}`}
							onClick={() => clearFilter(chip.patch)}
						>
							{chip.label} <span aria-hidden="true">×</span>
						</Button>
					))}
					<Button
						size="sm"
						variant="ghost"
						onClick={() =>
							onChange({
								period: 'ALL',
								scope: allowedScopes.includes('MINE')
									? 'MINE'
									: allowedScopes[0],
								timeZone: value.timeZone,
								page: 1,
								pageSize: value.pageSize
							})
						}
					>
						Сбросить фильтры
					</Button>
				</div>
			) : null}
			{view === 'board' ? (
				<p className={styles.hint}>
					{value.status === 'ACTIVE'
						? 'Текущие задачи: к выполнению и в работе.'
						: value.status === 'TERMINAL'
							? 'История: готовые и отменённые задачи.'
							: 'Показаны все статусы задач.'}{' '}
					Каждая колонка имеет свои страницы.
				</p>
			) : null}
		</section>
	)
}
