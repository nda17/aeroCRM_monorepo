'use client'

import {
	getBillingHistory,
	type BillingOrder
} from '@/entities/crm-billing'
import { invalidContractError } from '@/shared/api/authenticated-http-client'
import { Button, DataTable, type DataTableColumn } from '@/shared/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import toast from 'react-hot-toast'
import type { useBillingContext } from '../model/use-billing-context'
import { useBillingActor } from '../model/use-billing-actor'
import {
	billingDate,
	billingMoney,
	billingOrderLabel
} from '../model/billing-display'
import styles from './BillingFlow.module.scss'

export const BillingHistoryPanel = ({
	context,
	onSelect
}: {
	context: ReturnType<typeof useBillingContext>
	onSelect: (orderId: string) => void
}) => {
	const actor = useBillingActor(context.actor.workspaceId)
	const [page, setPage] = useState(1)
	const history = useQuery({
		queryKey: ['crm-billing-history', ...actor.key, page],
		queryFn: async () => {
			const result = await getBillingHistory(
				actor.session!.accessToken,
				actor.workspaceId,
				page
			)
			if (!actor.current()) throw invalidContractError()
			return result
		},
		enabled: context.ready,
		retry: false,
		staleTime: 0,
		gcTime: 0,
		refetchOnWindowFocus: false
	})
	const visible = context.ready && !history.isFetching && !history.isError
	const columns: DataTableColumn<BillingOrder>[] = [
		{
			id: 'date',
			header: 'Создан',
			render: row => billingDate(row.createdAt)
		},
		{
			id: 'amount',
			header: 'Сумма',
			render: row => billingMoney(row.amountMinor)
		},
		{
			id: 'kind',
			header: 'Тип',
			render: row =>
				row.kind === 'RECURRING' ? 'Автопродление' : 'Разовая оплата'
		},
		{
			id: 'state',
			header: 'Статус',
			render: row => billingOrderLabel(row.state)
		},
		{
			id: 'open',
			header: 'Заказ',
			render: row => (
				<Button
					size="sm"
					variant="ghost"
					disabled={!visible}
					onClick={() => {
						onSelect(row.id)
						toast('Открываем статус выбранного заказа')
					}}
				>
					Подробнее
				</Button>
			)
		}
	]
	const pages = Math.max(1, Math.ceil((history.data?.total ?? 0) / 20))
	return (
		<section className={styles.card} aria-label="История платежей aeroCRM">
			<div className={styles.sectionHeading}>
				<h2>История платежей aeroCRM</h2>
			</div>
			{history.isError ? (
				<p className={styles.error}>
					История временно недоступна. Другие настройки оплаты остаются
					независимыми.
				</p>
			) : null}
			<DataTable
				caption="Платежи выбранного рабочего пространства aeroCRM"
				rows={visible ? (history.data?.items ?? []) : []}
				columns={columns}
				getRowKey={row => row.id}
				emptyMessage={
					history.isFetching
						? 'Загружаем платежи…'
						: history.isError
							? 'Не удалось загрузить историю'
							: 'Платежей пока нет'
				}
			/>
			<div className={styles.actions}>
				<Button
					variant="secondary"
					size="sm"
					disabled={!visible || page <= 1}
					onClick={() => {
						setPage(value => value - 1)
						toast('Открываем предыдущую страницу платежей')
					}}
				>
					Назад
				</Button>
				<span>
					Страница {page} из {pages}
				</span>
				<Button
					variant="secondary"
					size="sm"
					disabled={!visible || page >= pages}
					onClick={() => {
						setPage(value => value + 1)
						toast('Открываем следующую страницу платежей')
					}}
				>
					Далее
				</Button>
				<Button
					variant="ghost"
					size="sm"
					disabled={!context.ready || history.isFetching}
					onClick={async () => {
						toast('Обновляем историю платежей')
						const result = await history.refetch()
						if (actor.current()) {
							if (result.isError) toast.error('История пока недоступна')
							else toast.success('История обновлена')
						}
					}}
				>
					Обновить историю
				</Button>
			</div>
		</section>
	)
}
