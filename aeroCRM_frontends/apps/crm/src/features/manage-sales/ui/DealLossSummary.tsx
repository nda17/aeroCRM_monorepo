'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { SalesDeal } from '@/entities/sales'
import { getDealLoss } from '@/entities/sales/api/sales-productivity.api'
import { Button } from '@/shared/ui'
import { useSalesSession } from '../model/use-sales-session'
import { salesDate } from './DealDetailsDrawer'

export const DealLossSummary = ({
	deal,
	archive
}: {
	deal: SalesDeal
	archive: 'ACTIVE' | 'ARCHIVED'
}) => {
	const context = useSalesSession()
	const client = useQueryClient()
	const query = useQuery({
		queryKey: [
			'sales',
			'deal-loss',
			...context.key,
			deal.id,
			deal.version,
			archive
		],
		enabled: context.canRead,
		retry: false,
		gcTime: 0,
		queryFn: () =>
			getDealLoss(
				context.session!.accessToken,
				context.workspace.workspaceId,
				deal.id,
				archive
			)
	})
	if (!context.canRead) return null
	if (query.isPending)
		return <p role="status">Загружаем причину отказа…</p>
	if (
		query.isError ||
		!query.data ||
		query.data.dealVersion !== deal.version
	)
		return (
			<p role="status">
				Причина отказа пока недоступна.{' '}
				<Button
					size="sm"
					variant="ghost"
					onClick={() =>
						void client.invalidateQueries({ queryKey: ['sales'] })
					}
				>
					Повторить
				</Button>
			</p>
		)
	return (
		<p>
			Причина отказа:{' '}
			<strong>{query.data.reason?.title ?? 'Не указана'}</strong>.{' '}
			{query.data.lostAt
				? `Дата отказа: ${salesDate(query.data.lostAt)}.`
				: 'Дата отказа неизвестна.'}
		</p>
	)
}
