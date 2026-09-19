'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
	listSalesDeals,
	type SalesPipeline,
	type SalesStage
} from '@/entities/sales'
import {
	salesDate,
	salesMoney,
	useSalesSession
} from '@/features/manage-sales'
import { useSalesAssignees } from '@/features/manage-sales/model/use-sales-assignees'
import { Button, ScreenState, StatusBadge } from '@/shared/ui'
import { requestDealFilters, type DealView } from './deal-views'
import styles from './DealsScreen.module.scss'

const StageColumn = ({
	context,
	pipeline,
	stage,
	filters,
	onSelect
}: {
	context: ReturnType<typeof useSalesSession>
	pipeline: SalesPipeline
	stage: SalesStage
	filters: DealView
	onSelect: (id: string) => void
}) => {
	const [page, setPage] = useState(1)
	const [openedAt] = useState(() => Date.now())
	const deals = useQuery({
		queryKey: [
			'sales',
			'deals',
			'stage',
			...context.key,
			pipeline.id,
			stage.id,
			filters,
			page
		],
		enabled: context.canRead && !!context.session,
		queryFn: () =>
			listSalesDeals(
				context.session!.accessToken,
				context.workspace.workspaceId,
				page,
				20,
				filters.search,
				pipeline.id,
				filters.status,
				filters.withoutNextAction,
				{ ...requestDealFilters(filters), stageId: stage.id }
			),
		retry: false,
		gcTime: 0
	})
	const name = useSalesAssignees(
		context,
		!deals.isError
			? (deals.data?.items.map(deal => deal.assignedToSubject) ?? [])
			: []
	)
	return (
		<section
			className={styles.stageColumn}
			aria-label={`Этап ${stage.name}`}
		>
			<header className={styles.stageHeading}>
				<h3>{stage.name}</h3>
				<StatusBadge
					tone={
						stage.state === 'WON'
							? 'success'
							: stage.state === 'LOST'
								? 'danger'
								: 'neutral'
					}
				>
					{deals.isError ? '—' : (deals.data?.total ?? '…')}
				</StatusBadge>
			</header>
			{deals.isError ? (
				<ScreenState
					compact
					variant="error"
					description="Не удалось загрузить этап."
					action={
						<Button
							size="sm"
							variant="secondary"
							onClick={() => void deals.refetch()}
						>
							Повторить
						</Button>
					}
				/>
			) : deals.isPending ? (
				<ScreenState compact variant="loading" />
			) : deals.data?.items.length ? (
				<ol className={styles.dealCards}>
					{deals.data.items.map(deal => (
						<li key={deal.id}>
							<button
								type="button"
								className={styles.dealCard}
								onClick={() => onSelect(deal.id)}
							>
								<strong>{deal.title}</strong>
								<span className={styles.muted}>{deal.contactName}</span>
								<span className={styles.cardAmount}>
									{salesMoney(deal.amountMinor)}
								</span>
								<span className={styles.muted}>
									{name(deal.assignedToSubject)}
								</span>
								{deal.nextTask ? (
									<span className={styles.cardTask}>
										<span>{deal.nextTask.title}</span>
										<time dateTime={deal.nextTask.dueAt}>
											{salesDate(deal.nextTask.dueAt)}
										</time>
										{Date.parse(deal.nextTask.dueAt) < openedAt ? (
											<StatusBadge tone="danger">Просрочено</StatusBadge>
										) : null}
									</span>
								) : deal.status === 'OPEN' ? (
									<StatusBadge tone="warning">
										Нет следующего действия
									</StatusBadge>
								) : null}
							</button>
						</li>
					))}
				</ol>
			) : (
				<p className={styles.stageEmpty}>
					{deals.data?.total
						? 'На этой странице больше нет сделок.'
						: 'Нет сделок по выбранным условиям'}
				</p>
			)}
			{!deals.isError &&
			deals.data &&
			(deals.data.total > 20 || page > 1) ? (
				<div className={styles.stagePagination}>
					<Button
						size="sm"
						variant="secondary"
						aria-label={`Предыдущая страница: ${stage.name}`}
						disabled={page === 1 || deals.isFetching}
						onClick={() => {
							setPage(value => value - 1)
							toast('Страница этапа изменена')
						}}
					>
						Назад
					</Button>
					<span>
						{page} / {Math.max(page, Math.ceil(deals.data.total / 20))}
					</span>
					<Button
						size="sm"
						variant="secondary"
						aria-label={`Следующая страница: ${stage.name}`}
						disabled={page * 20 >= deals.data.total || deals.isFetching}
						onClick={() => {
							setPage(value => value + 1)
							toast('Страница этапа изменена')
						}}
					>
						Далее
					</Button>
				</div>
			) : null}
		</section>
	)
}

export const DealPipelineBoard = ({
	context,
	pipeline,
	filters,
	onSelect
}: {
	context: ReturnType<typeof useSalesSession>
	pipeline: SalesPipeline
	filters: DealView
	onSelect: (id: string) => void
}) => (
	<div className={styles.boardRegion}>
		<p className={styles.muted}>
			Нажмите на сделку, чтобы записать результат и изменить этап.
		</p>
		<div
			className={styles.board}
			aria-label={`Воронка ${pipeline.name}`}
			tabIndex={0}
		>
			{[...pipeline.stages]
				.sort((a, b) => a.position - b.position)
				.filter(
					stage =>
						(!filters.status || stage.state === filters.status) &&
						(!filters.stageId || stage.id === filters.stageId)
				)
				.map(stage => (
					<StageColumn
						key={`${stage.id}:${JSON.stringify(filters)}`}
						context={context}
						pipeline={pipeline}
						stage={stage}
						filters={filters}
						onSelect={onSelect}
					/>
				))}
		</div>
	</div>
)
