import type { StageDurationInfo } from '@/entities/sales/model/stage-duration.contract'
import { StatusBadge } from '@/shared/ui'
import styles from './SalesWorkflow.module.scss'

export const StageDurationLabel = ({
	item
}: {
	item: StageDurationInfo | null | undefined
}) => {
	if (!item || (item.elapsedDays === null && item.enteredAt !== null))
		return null
	return (
		<span className={styles.stageDuration}>
			<StatusBadge tone={item.overdue ? 'danger' : 'neutral'}>
				{item.elapsedDays === null
					? 'Дата входа на этап неизвестна'
					: `На этапе: ${item.elapsedDays === 0 ? '<1' : item.elapsedDays} дн.${item.limitDays === null ? '' : ` / ${item.limitDays} дн.`}`}
			</StatusBadge>
			{item.overdue ? <span>Просрочен срок этапа</span> : null}
			{item.deadlineAt ? (
				<time dateTime={item.deadlineAt}>
					Срок:{' '}
					{new Date(item.deadlineAt).toLocaleString('ru-RU', {
						day: '2-digit',
						month: '2-digit',
						year: 'numeric',
						hour: '2-digit',
						minute: '2-digit'
					})}
				</time>
			) : null}
		</span>
	)
}
