'use client'

import { useMemo, useState } from 'react'
import { AppIcon } from '@/shared/ui/app-icon'
import { PREVIEW_DEALS, PREVIEW_STAGES } from '../model/preview-data'
import type { PreviewDeal } from '../model/preview-data'
import styles from './DesignPreview.module.scss'

const number = new Intl.NumberFormat('ru-RU')
const money = (value: number) => `${number.format(Math.round(value))} ₽`
const sum = (deals: PreviewDeal[]) =>
	deals.reduce((total, deal) => total + deal.amount, 0)

type Measure = 'amount' | 'count'

export default function PreviewAnalytics({
	deals
}: {
	deals: PreviewDeal[]
}) {
	const [owner, setOwner] = useState('')
	const [measure, setMeasure] = useState<Measure>('amount')
	const [teamSort, setTeamSort] = useState<'amount' | 'overdue'>('amount')
	const team = useMemo(
		() => [
			...new Set([...PREVIEW_DEALS, ...deals].map(deal => deal.owner))
		],
		[deals]
	)
	const filtered = owner
		? deals.filter(deal => deal.owner === owner)
		: deals
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
			const items = deals.filter(deal => deal.owner === name)
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
				<label className={styles.selectWrap}>
					<AppIcon name="user" size={16} />
					<select
						aria-label="Сотрудник в аналитике"
						value={owner}
						onChange={event => setOwner(event.target.value)}
					>
						<option value="">Вся команда</option>
						{team.map(name => (
							<option key={name} value={name}>
								{name}
							</option>
						))}
					</select>
					<AppIcon name="chevronDown" size={13} />
				</label>
			</div>
			<section className={styles.metrics} aria-label="Показатели продаж">
				<div>
					<span>Объём воронки</span>
					<strong>{money(total)}</strong>
					<small>Активных сделок: {number.format(filtered.length)}</small>
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
					<small>На этапе оплаты: {number.format(payment.length)}</small>
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
					{owner || 'Вся команда'} · потенциал продаж на текущий момент
				</p>
				{owner && (
					<button
						className={styles.clearButton}
						onClick={() => setOwner('')}
					>
						Сбросить фильтр
					</button>
				)}
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
								<div className={styles.analyticsTrack} aria-hidden="true">
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
								<div className={styles.analyticsStage} key={source.name}>
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
							<p>Новые сделки появятся в отчёте сразу после создания.</p>
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
					<table className={`${styles.table} ${styles.analyticsTable}`}>
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
											<span className={styles.avatar}>{row.initials}</span>
											{row.name}
										</button>
									</td>
									<td>{number.format(row.count)}</td>
									<td className={styles.amountCell}>
										{money(row.amount)}
									</td>
									<td>
										{row.count ? money(row.amount / row.count) : '—'}
									</td>
									<td className={row.overdue ? styles.attention : ''}>
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
							: 'У выбранной команды все следующие действия находятся в сроке.'}
					</p>
				</div>
			</div>
		</>
	)
}
