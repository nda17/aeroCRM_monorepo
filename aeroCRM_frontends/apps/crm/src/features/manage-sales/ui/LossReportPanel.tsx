'use client'

import { useQuery } from '@tanstack/react-query'
import {
	getLossReport,
	type LossReportQuery
} from '@/entities/sales/api/sales-productivity.api'
import { Button, DataTable, ScreenState } from '@/shared/ui'
import { salesMoney, useSalesSession } from '@/features/manage-sales'
import styles from './SalesWorkflow.module.scss'

export const LossReportPanel = ({
	context,
	enabled,
	query
}: {
	context: ReturnType<typeof useSalesSession>
	enabled: boolean
	query: LossReportQuery
}) => {
	const report = useQuery({
		queryKey: ['sales', 'loss-report', ...context.key, query],
		enabled,
		retry: false,
		gcTime: 0,
		queryFn: () =>
			getLossReport(
				context.session!.accessToken,
				context.workspace.workspaceId,
				query
			)
	})
	if (!enabled) return null
	return (
		<section className={styles.section}>
			<h2>Причины потери сделок</h2>
			<p className={styles.muted}>
				Текущие неархивные сделки со статусом «Отказ». Период выше
				применяется к дате последнего отказа. Повторно открытые сделки в
				этот отчёт не входят.
			</p>
			{report.isError ? (
				<ScreenState
					variant="error"
					compact
					description="Не удалось загрузить причины потери сделок."
					action={
						<Button onClick={() => void report.refetch()}>
							Повторить
						</Button>
					}
				/>
			) : report.isPending || !report.data ? (
				<ScreenState variant="loading" compact />
			) : (
				<>
					<p>
						Сделок с известной датой отказа:{' '}
						<strong>{report.data.totals.count}</strong> · Сумма:{' '}
						<strong>{salesMoney(report.data.totals.amountMinor)}</strong>
					</p>
					<DataTable
						caption="Потери по причинам"
						mobileLayout="cards"
						rows={report.data.reasons}
						getRowKey={row => row.reasonId ?? 'unspecified'}
						emptyMessage="Отказов с известной датой за выбранный период нет."
						columns={[
							{
								id: 'reason',
								header: 'Причина',
								render: row => row.title
							},
							{
								id: 'count',
								header: 'Сделок',
								align: 'right',
								render: row => row.count
							},
							{
								id: 'amount',
								header: 'Сумма сделок',
								align: 'right',
								render: row => salesMoney(row.amountMinor)
							}
						]}
					/>
					{report.data.unknownDate.count ? (
						<p className={styles.muted}>
							Дата отказа неизвестна: {report.data.unknownDate.count}{' '}
							сделок на {salesMoney(report.data.unknownDate.amountMinor)}.
							Они показаны отдельно и не входят в итог выбранного периода.
						</p>
					) : null}
				</>
			)}
		</section>
	)
}
