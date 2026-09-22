'use client'

import { getCommerceAnalytics } from '@/entities/sales/api/commerce.api'
import { Button, ScreenState, TextField } from '@/shared/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import toast from 'react-hot-toast'
import type { CommerceContext } from '../model/use-commerce-command'
import styles from './Commerce.module.scss'

// Aggregate amounts are strings and may exceed Number's precise integer range.
const aggregateMoney = (value: string) => {
	const amount = BigInt(value)
	const negative = amount < BigInt(0)
	const positive = negative ? -amount : amount
	const rubles = (positive / BigInt(100)).toLocaleString('ru-RU')
	const kopecks = String(positive % BigInt(100)).padStart(2, '0')
	return `${negative ? '−' : ''}${rubles},${kopecks} ₽`
}
const moscowDay = (date: Date) =>
	new Date(date.getTime() + 3 * 3600000).toISOString().slice(0, 10)
const initialDates = () => {
	const to = moscowDay(new Date())
	const last = new Date(`${to}T00:00:00+03:00`).getTime()
	return { from: moscowDay(new Date(last - 29 * 86400000)), to }
}
const range = (from: string, to: string) => ({
	from: new Date(`${from}T00:00:00+03:00`).toISOString(),
	to: new Date(
		new Date(`${to}T00:00:00+03:00`).getTime() + 86400000
	).toISOString()
})

export const CommerceAnalyticsPanel = ({
	context,
	pipelineId,
	canRead
}: {
	context: CommerceContext
	pipelineId: string
	canRead: boolean
}) => {
	const [dates, setDates] = useState(initialDates)
	const [period, setPeriod] = useState(() => {
		const dates = initialDates()
		return range(dates.from, dates.to)
	})
	const report = useQuery({
		queryKey: [
			'sales',
			'commerce-analytics',
			...context.key,
			pipelineId,
			period
		],
		enabled: canRead,
		queryFn: () =>
			getCommerceAnalytics(
				context.session!.accessToken,
				context.workspace.workspaceId,
				{ ...period, ...(pipelineId ? { pipelineId } : {}) }
			),
		retry: false,
		gcTime: 0
	})
	const apply = () => {
		try {
			const next = range(dates.from, dates.to)
			const length = Date.parse(next.to) - Date.parse(next.from)
			if (
				length <= 0 ||
				length > 366 * 86400000 ||
				moscowDay(new Date(next.from)) !== dates.from ||
				moscowDay(new Date(Date.parse(next.to) - 86400000)) !== dates.to
			)
				throw new Error()
			setPeriod(next)
		} catch {
			toast.error('Выберите корректный период до 366 дней.')
		}
	}
	if (!canRead) return null
	return (
		<section
			className={styles.section}
			aria-labelledby="commerce-receipts-title"
		>
			<h2 id="commerce-receipts-title">Поступления и возвраты</h2>
			<p className={styles.muted}>
				Ручные записи по дате денежной операции, независимо от даты
				создания и этапа сделки. Исправленные записи учитываются в
				актуальном виде. Применяется выбранная выше воронка.
			</p>
			<form
				className={styles.filters}
				onSubmit={event => {
					event.preventDefault()
					apply()
				}}
			>
				<TextField
					label="Операции с"
					type="date"
					value={dates.from}
					onChange={event =>
						setDates(value => ({ ...value, from: event.target.value }))
					}
				/>
				<TextField
					label="Операции по"
					type="date"
					value={dates.to}
					onChange={event =>
						setDates(value => ({ ...value, to: event.target.value }))
					}
				/>
				<Button
					type="submit"
					variant="secondary"
					disabled={report.isFetching}
				>
					Применить период оплат
				</Button>
			</form>
			<p className={styles.muted}>
				Даты по Москве (UTC+3). Период оплат задаётся отдельно от периода
				создания сделок.
			</p>
			{report.isError ? (
				<ScreenState
					variant="error"
					compact
					description="Не удалось получить денежные показатели. Данные не подменяются нулями."
					action={
						<Button
							variant="secondary"
							onClick={() => void report.refetch()}
						>
							Повторить
						</Button>
					}
				/>
			) : report.isPending || report.isFetching ? (
				<ScreenState variant="loading" compact />
			) : (
				<dl className={styles.metrics}>
					<div>
						<dt>Поступления клиентов</dt>
						<dd>{aggregateMoney(report.data.receiptsMinor)}</dd>
					</div>
					<div>
						<dt>Возвраты клиентам</dt>
						<dd>{aggregateMoney(report.data.refundsMinor)}</dd>
					</div>
					<div>
						<dt>Чистые поступления за период</dt>
						<dd>{aggregateMoney(report.data.netPaidMinor)}</dd>
					</div>
				</dl>
			)}
		</section>
	)
}
