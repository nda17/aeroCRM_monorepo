'use client'

import { listCommerceHistory } from '@/entities/sales/api/commerce.api'
import { Button, Drawer, ScreenState } from '@/shared/ui'
import { useQuery } from '@tanstack/react-query'
import type { CommerceContext } from '../model/use-commerce-command'
import { useSalesAssignees } from '../model/use-sales-assignees'
import { salesDate, salesMoney } from './DealDetailsDrawer'
import styles from './Commerce.module.scss'

const labels: Record<string, string> = {
	CATALOG_CREATED: 'Создана позиция каталога',
	CATALOG_UPDATED: 'Изменена позиция каталога',
	CATALOG_ARCHIVED: 'Позиция перенесена в архив',
	CATALOG_IMPORTED: 'Применён импорт каталога',
	PIPELINE_CREATED: 'Создана воронка',
	PIPELINE_RENAMED: 'Переименована воронка',
	STAGE_ADDED: 'Добавлен этап',
	STAGE_RENAMED: 'Переименован этап',
	STAGES_REORDERED: 'Изменён порядок этапов'
}
const describe = (input: unknown) => {
	if (!input || typeof input !== 'object') return null
	const value = input as Record<string, unknown>
	const after =
		value.after && typeof value.after === 'object'
			? (value.after as Record<string, unknown>)
			: null
	const before =
		value.before && typeof value.before === 'object'
			? (value.before as Record<string, unknown>)
			: null
	if (after && typeof after.name === 'string') {
		const name =
			typeof after.code === 'string'
				? `${after.code} · ${after.name}`
				: after.name
		const price = (record: Record<string, unknown>) =>
			typeof record.basePriceMinor === 'number'
				? salesMoney(record.basePriceMinor)
				: 'цена не указана'
		return before && before.basePriceMinor !== after.basePriceMinor
			? `${name}. ${price(before)} → ${price(after)}.`
			: name
	}
	if (
		typeof value.created === 'number' &&
		typeof value.updated === 'number'
	)
		return `Создано: ${value.created}. Обновлено: ${value.updated}. Без изменений: ${Number(value.unchanged || 0)}.`
	if (typeof value.before === 'string' && typeof value.after === 'string')
		return `${value.before} → ${value.after}`
	return typeof value.name === 'string' ? value.name : null
}

export const CommerceHistoryDrawer = ({
	context,
	onClose
}: {
	context: CommerceContext
	onClose: () => void
}) => {
	const history = useQuery({
		queryKey: ['sales', 'commerce-workspace-history', ...context.key],
		enabled: context.canRead,
		queryFn: () =>
			listCommerceHistory(
				context.session!.accessToken,
				context.workspace.workspaceId
			),
		retry: false,
		gcTime: 0
	})
	const author = useSalesAssignees(
		context,
		history.data?.map(item => item.actorSubject) || []
	)
	return (
		<Drawer
			isOpen
			title="История каталога и воронок"
			description="Последние 100 изменений рабочего пространства. Изменения состава, КП и оплат находятся в истории соответствующей сделки."
			onClose={onClose}
		>
			{!context.canRead ? (
				<ScreenState
					variant={
						context.permissions.isFetching ? 'loading' : 'permission'
					}
				/>
			) : history.isError ? (
				<ScreenState
					variant="error"
					action={
						<Button onClick={() => void history.refetch()}>
							Повторить
						</Button>
					}
				/>
			) : history.isPending ? (
				<ScreenState variant="loading" />
			) : history.data.length ? (
				<ol className={styles.history}>
					{history.data.map(item => (
						<li key={item.id}>
							<strong>
								{labels[item.kind] || 'Изменение рабочего пространства'}
							</strong>
							{describe(item.details) && <p>{describe(item.details)}</p>}
							<p>
								<time dateTime={item.createdAt}>
									{salesDate(item.createdAt)}
								</time>{' '}
								· {author(item.actorSubject)}
							</p>
						</li>
					))}
				</ol>
			) : (
				<p className={styles.muted}>Изменений пока нет.</p>
			)}
		</Drawer>
	)
}
