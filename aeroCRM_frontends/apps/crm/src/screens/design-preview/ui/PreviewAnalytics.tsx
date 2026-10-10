'use client'

import { useMemo, useState } from 'react'
import { AppIcon } from '@/shared/ui/app-icon'
import { PREVIEW_DEALS, PREVIEW_STAGES } from '../model/preview-data'
import type { PreviewDeal } from '../model/preview-data'
import { previewMoney as money } from './PreviewPrimitives'
import styles from './DesignPreview.module.scss'

const number = new Intl.NumberFormat('ru-RU')
const sum = (deals: PreviewDeal[]) =>
	deals.reduce((total, deal) => total + deal.amount, 0)

type Measure = 'amount' | 'count'
const periods = [
	['all', 'За всё время'],
	['today', 'Сегодня'],
	['7days', 'Последние 7 дней'],
	['30days', 'Последние 30 дней'],
	['month', 'Этот месяц'],
	['previousMonth', 'Прошлый месяц'],
	['custom', 'Свой период']
] as const
const dateKey = (value: Date, timeZone: string) => {
	if (!Number.isFinite(value.getTime())) return ''
	const parts = new Intl.DateTimeFormat('en-GB', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		timeZone
	}).formatToParts(value)
	return ['year', 'month', 'day']
		.map(type => parts.find(part => part.type === type)?.value)
		.join('-')
}
const validDate = (value: string) =>
	/^\d{4}-\d{2}-\d{2}$/.test(value) &&
	value >= '0001-01-01' &&
	value <= '9999-12-31' &&
	Number.isFinite(Date.parse(`${value}T00:00:00Z`))
const periodBounds = (period: string, today: string) => {
	const value = new Date(`${today}T00:00:00Z`)
	const iso = (date: Date) => date.toISOString().slice(0, 10)
	if (period === 'today') return [today, today]
	if (period === '7days' || period === '30days') {
		value.setUTCDate(value.getUTCDate() - (period === '7days' ? 6 : 29))
		return [iso(value), today]
	}
	if (period === 'month') return [`${today.slice(0, 7)}-01`, today]
	if (period === 'previousMonth') {
		value.setUTCDate(0)
		return [`${iso(value).slice(0, 7)}-01`, iso(value)]
	}
	return ['', '']
}
const displayDate = (value: string) =>
	new Intl.DateTimeFormat('ru-RU', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(new Date(`${value}T00:00:00Z`))

export default function PreviewAnalytics({
	deals,
	timeZone
}: {
	deals: PreviewDeal[]
	timeZone: string
}) {
	const [owner, setOwner] = useState('')
	const [period, setPeriod] = useState('all')
	const [stage, setStage] = useState('')
	const [source, setSource] = useState('')
	const [customFrom, setCustomFrom] = useState('')
	const [customTo, setCustomTo] = useState('')
	const today = dateKey(new Date(), timeZone)
	const timeZoneLabel = new Intl.DateTimeFormat('ru-RU', {
		timeZone,
		timeZoneName: 'shortOffset'
	})
		.formatToParts(new Date())
		.find(part => part.type === 'timeZoneName')
		?.value.replace('GMT', 'UTC')
	const [from, to] =
		period === 'custom'
			? [customFrom, customTo]
			: periodBounds(period, today)
	const rangeError =
		period === 'custom'
			? !from || !to
				? 'Укажите начало и конец периода.'
				: !validDate(from) || !validDate(to)
					? 'Введите корректные даты с четырёхзначным годом.'
					: from > to
						? 'Начало периода не может быть позже окончания.'
						: ''
			: ''
	const periodLabel =
		from && to && !rangeError
			? `${displayDate(from)} — ${displayDate(to)}`
			: 'За всё время'
	const hasFilters = period !== 'all' || Boolean(owner || stage || source)
	const reset = () => {
		setOwner('')
		setPeriod('all')
		setStage('')
		setSource('')
		setCustomFrom('')
		setCustomTo('')
	}
	const choosePeriod = (value: string) => {
		if (value === 'custom' && !customFrom && !customTo) {
			const [start, end] = periodBounds(
				period === 'all' ? '30days' : period,
				today
			)
			setCustomFrom(start)
			setCustomTo(end)
		}
		setPeriod(value)
	}
	const availableSources = [
		...new Set(deals.map(deal => deal.source))
	].sort((a, b) => a.localeCompare(b, 'ru'))
	const [measure, setMeasure] = useState<Measure>('amount')
	const [teamSort, setTeamSort] = useState<'amount' | 'overdue'>('amount')
	const team = useMemo(
		() => [
			...new Set([...PREVIEW_DEALS, ...deals].map(deal => deal.owner))
		],
		[deals]
	)
	const filtered = rangeError
		? []
		: deals.filter(deal => {
				const created = dateKey(new Date(deal.createdAt), timeZone)
				return (
					(!owner || deal.owner === owner) &&
					(stage === '' || deal.stage === Number(stage)) &&
					(!source || deal.source === source) &&
					(!from || created >= from) &&
					(!to || created <= to)
				)
			})
	const total = sum(filtered)
	const overdue = filtered.filter(deal => deal.overdue)
	const payment = filtered.filter(deal => deal.stage === 4)
	const stages = PREVIEW_STAGES.map((name, index) => {
		const items = filtered.filter(deal => deal.stage === index)
		return { name, count: items.length, amount: sum(items) }
	})
	const sources = [...new Set(filtered.map(deal => deal.source))]
		.map(name => {
			const items = filtered.filter(deal => deal.source === name)
			return { name, count: items.length, amount: sum(items) }
		})
		.sort((left, right) => right[measure] - left[measure])
	const largestStage = Math.max(1, ...stages.map(stage => stage[measure]))
	const basis = measure === 'amount' ? total : filtered.length
	const teamRows = team
		.filter(name => !owner || name === owner)
		.map(name => {
			const items = filtered.filter(deal => deal.owner === name)
			return {
				name,
				initials: name
					.split(' ')
					.slice(0, 2)
					.map(part => part[0])
					.join(''),
				count: items.length,
				amount: sum(items),
				overdue: items.filter(deal => deal.overdue).length
			}
		})
		.sort(
			(left, right) =>
				right[teamSort] - left[teamSort] ||
				left.name.localeCompare(right.name, 'ru')
		)
	const display = (value: number) =>
		measure === 'amount' ? money(value) : number.format(value)

	return (
		<>
			<div className={styles.pageHeading}>
				<div>
					<div className={styles.eyebrow}>РЕЗУЛЬТАТЫ КОМАНДЫ</div>
					<h1>Аналитика</h1>
					<p>Основная воронка · текущие сделки</p>
				</div>
			</div>
			<section
				className={styles.analyticsFilters}
				aria-label="Фильтры аналитики"
			>
				<div className={styles.analyticsFilterGrid}>
					<label className={styles.analyticsFilter}>
						<span>Период создания</span>
						<span className={styles.selectWrap}>
							<select
								aria-label="Период создания сделок"
								value={period}
								onChange={event => choosePeriod(event.target.value)}
							>
								{periods.map(([value, label]) => (
									<option key={value} value={value}>
										{label}
									</option>
								))}
							</select>
							<AppIcon name="chevronDown" size={13} />
						</span>
					</label>
					<label className={styles.analyticsFilter}>
						<span>Ответственный</span>
						<span className={styles.selectWrap}>
							<select
								aria-label="Сотрудник в аналитике"
								value={owner}
								onChange={event => setOwner(event.target.value)}
							>
								<option value="">Вся команда</option>
								{team.map(name => (
									<option key={name}>{name}</option>
								))}
							</select>
							<AppIcon name="chevronDown" size={13} />
						</span>
					</label>
					<label className={styles.analyticsFilter}>
						<span>Этап</span>
						<span className={styles.selectWrap}>
							<select
								aria-label="Этап в аналитике"
								value={stage}
								onChange={event => setStage(event.target.value)}
							>
								<option value="">Все этапы</option>
								{PREVIEW_STAGES.map((name, index) => (
									<option key={name} value={index}>
										{name}
									</option>
								))}
							</select>
							<AppIcon name="chevronDown" size={13} />
						</span>
					</label>
					<label className={styles.analyticsFilter}>
						<span>Источник</span>
						<span className={styles.selectWrap}>
							<select
								aria-label="Источник в аналитике"
								value={source}
								onChange={event => setSource(event.target.value)}
							>
								<option value="">Все источники</option>
								{availableSources.map(name => (
									<option key={name}>{name}</option>
								))}
							</select>
							<AppIcon name="chevronDown" size={13} />
						</span>
					</label>
				</div>
				{period === 'custom' && (
					<div className={styles.analyticsDates}>
						<label className={styles.analyticsFilter}>
							<span>С даты</span>
							<input
								type="date"
								aria-label="Начало периода"
								value={customFrom}
								min="0001-01-01"
								max="9999-12-31"
								onInput={event => setCustomFrom(event.currentTarget.value)}
								onChange={event => setCustomFrom(event.target.value)}
								aria-invalid={Boolean(rangeError)}
								aria-describedby={
									rangeError ? 'analytics-range-error' : undefined
								}
							/>
						</label>
						<label className={styles.analyticsFilter}>
							<span>По дату включительно</span>
							<input
								type="date"
								aria-label="Конец периода"
								value={customTo}
								min="0001-01-01"
								max="9999-12-31"
								onInput={event => setCustomTo(event.currentTarget.value)}
								onChange={event => setCustomTo(event.target.value)}
								aria-invalid={Boolean(rangeError)}
								aria-describedby={
									rangeError ? 'analytics-range-error' : undefined
								}
							/>
						</label>
					</div>
				)}
				<div className={styles.analyticsFilterFooter}>
					<p className={styles.analyticsNote} role="status">
						{rangeError
							? 'Уточните период для расчёта'
							: `${periodLabel} · Сделок: ${filtered.length} из ${deals.length}`}
					</p>
					{hasFilters && (
						<button className={styles.clearButton} onClick={reset}>
							Сбросить фильтры
						</button>
					)}
				</div>
				<p className={styles.analyticsNote}>
					Период — по дате создания сделки. Показатели отражают её текущее
					состояние. Часовой пояс: {timeZoneLabel}.
				</p>
			</section>
			{rangeError ? (
				<p
					className={styles.overdue}
					id="analytics-range-error"
					role="alert"
				>
					{rangeError}
				</p>
			) : filtered.length === 0 ? (
				<div className={styles.empty}>
					<AppIcon name="analytics" size={26} />
					<h2>Нет сделок по выбранным условиям</h2>
					<p>Измените период или сбросьте фильтры.</p>
					<button className={styles.secondaryButton} onClick={reset}>
						Показать все сделки
					</button>
				</div>
			) : (
				<>
					<section
						className={styles.metrics}
						aria-label="Показатели продаж"
					>
						<div>
							<span>Объём воронки</span>
							<strong>{money(total)}</strong>
							<small>
								Активных сделок: {number.format(filtered.length)}
							</small>
						</div>
						<div>
							<span>Средняя сумма</span>
							<strong>
								{filtered.length ? money(total / filtered.length) : '—'}
							</strong>
							<small>На одну активную сделку</small>
						</div>
						<div>
							<span>Ожидаем оплату</span>
							<strong>{money(sum(payment))}</strong>
							<small>
								На этапе оплаты: {number.format(payment.length)}
							</small>
						</div>
						<div>
							<span>
								Просрочен следующий шаг
								<AppIcon name="clock" size={14} />
							</span>
							<strong className={overdue.length ? styles.attention : ''}>
								{number.format(overdue.length)}
							</strong>
							<small>Сумма сделок: {money(sum(overdue))}</small>
						</div>
					</section>
					<div className={styles.toolbar}>
						<p className={styles.analyticsNote}>
							{owner || 'Вся команда'} · показатели выбранных сделок
						</p>
						<div
							className={styles.viewToggle}
							aria-label="Единица измерения графиков"
						>
							<button
								aria-pressed={measure === 'amount'}
								onClick={() => setMeasure('amount')}
							>
								Сумма, ₽
							</button>
							<button
								aria-pressed={measure === 'count'}
								onClick={() => setMeasure('count')}
							>
								Количество
							</button>
						</div>
					</div>
					<div className={styles.analyticsGrid}>
						<section
							className={styles.analyticsPanel}
							aria-labelledby="preview-stage-title"
						>
							<div className={styles.analyticsPanelHeading}>
								<div>
									<h2 id="preview-stage-title">Сделки по этапам</h2>
									<p>Где сейчас сосредоточена работа команды</p>
								</div>
								<AppIcon name="analytics" size={19} />
							</div>
							<div className={styles.analyticsChart}>
								{stages.map((stage, index) => (
									<div
										className={styles.analyticsStage}
										key={stage.name}
										data-stage={index}
									>
										<div className={styles.analyticsLegend}>
											<span>{stage.name}</span>
											<strong>{display(stage[measure])}</strong>
										</div>
										<div
											className={styles.analyticsTrack}
											aria-hidden="true"
										>
											<span
												className={styles.analyticsFill}
												style={{
													width: `${(stage[measure] / largestStage) * 100}%`
												}}
											/>
										</div>
										<small>
											{measure === 'amount'
												? `Сделок: ${number.format(stage.count)}`
												: money(stage.amount)}
										</small>
									</div>
								))}
							</div>
							<p className={styles.analyticsNote}>
								Суммы отражают потенциал открытых сделок. Этап «Оплата»
								означает ожидание платежа.
							</p>
						</section>
						<section
							className={styles.analyticsPanel}
							aria-labelledby="preview-source-title"
						>
							<div className={styles.analyticsPanelHeading}>
								<div>
									<h2 id="preview-source-title">Источники сделок</h2>
									<p>
										Доля в{' '}
										{measure === 'amount'
											? 'сумме воронки'
											: 'количестве сделок'}
									</p>
								</div>
								<AppIcon name="inbox" size={19} />
							</div>
							{sources.length ? (
								<div className={styles.analyticsChart}>
									{sources.map(source => (
										<div
											className={styles.analyticsStage}
											key={source.name}
										>
											<div className={styles.analyticsLegend}>
												<span>{source.name}</span>
												<strong>{display(source[measure])}</strong>
											</div>
											<div
												className={styles.analyticsTrack}
												aria-hidden="true"
											>
												<span
													className={styles.analyticsFill}
													style={{
														width: `${basis ? (source[measure] / basis) * 100 : 0}%`
													}}
												/>
											</div>
											<small>
												{number.format(
													basis
														? Math.round((source[measure] / basis) * 100)
														: 0
												)}
												% · Сделок: {number.format(source.count)}
											</small>
										</div>
									))}
								</div>
							) : (
								<div className={styles.empty}>
									<AppIcon name="analytics" size={26} />
									<h2>Пока нет сделок</h2>
									<p>
										Новые сделки появятся в отчёте сразу после создания.
									</p>
								</div>
							)}
						</section>
					</div>
					<section
						className={styles.analyticsPanel}
						aria-labelledby="preview-team-title"
					>
						<div className={styles.analyticsPanelHeading}>
							<div>
								<h2 id="preview-team-title">Загрузка команды</h2>
								<p>Открытые сделки и следующие шаги по сотрудникам</p>
							</div>
							<label className={styles.selectWrap}>
								<select
									aria-label="Сортировка сотрудников"
									value={teamSort}
									onChange={event =>
										setTeamSort(event.target.value as 'amount' | 'overdue')
									}
								>
									<option value="amount">По сумме сделок</option>
									<option value="overdue">По просрочкам</option>
								</select>
								<AppIcon name="chevronDown" size={13} />
							</label>
						</div>
						<div className={styles.tableScroll}>
							<table
								className={`${styles.table} ${styles.analyticsTable}`}
							>
								<caption className={styles.srOnly}>
									Показатели текущих сделок команды
								</caption>
								<thead>
									<tr>
										<th scope="col">Сотрудник</th>
										<th scope="col">Сделки</th>
										<th scope="col">Сумма в работе</th>
										<th scope="col">Средняя сумма</th>
										<th scope="col">Просрочен шаг</th>
									</tr>
								</thead>
								<tbody>
									{teamRows.map(row => (
										<tr key={row.name}>
											<td>
												<button
													className={`${styles.tableOwner} ${styles.recordLink}`}
													onClick={() => setOwner(row.name)}
													aria-label={`Показать аналитику: ${row.name}`}
												>
													<span className={styles.avatar}>
														{row.initials}
													</span>
													{row.name}
												</button>
											</td>
											<td data-label="Сделок">
												{number.format(row.count)}
											</td>
											<td
												className={styles.amountCell}
												data-label="Сумма в работе"
											>
												{money(row.amount)}
											</td>
											<td data-label="Средняя сумма">
												{row.count ? money(row.amount / row.count) : '—'}
											</td>
											<td
												className={row.overdue ? styles.attention : ''}
												data-label="Просрочен шаг"
											>
												{number.format(row.overdue)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</section>
					<div className={styles.analyticsSummary}>
						<AppIcon name={overdue.length ? 'clock' : 'check'} size={20} />
						<div>
							<strong>
								{overdue.length
									? 'Следующие шаги требуют внимания'
									: 'Просроченных шагов нет'}
							</strong>
							<p>
								{overdue.length
									? overdue.map(deal => deal.company).join(' · ')
									: 'У выбранных сделок нет просроченных следующих шагов.'}
							</p>
						</div>
					</div>
				</>
			)}
		</>
	)
}
