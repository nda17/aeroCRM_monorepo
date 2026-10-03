'use client'

import { usePlannerSettings } from '@/entities/crm-planner/model/use-planner-settings'
import { Button } from '@/shared/ui'
import styles from './PlannerSettings.module.scss'

export const ActionTemplatePicker = ({
	onSelect,
	disabled = false
}: {
	onSelect: (title: string) => void
	disabled?: boolean
}) => {
	const { data, query, context } = usePlannerSettings()
	if (!context.canRead) return null
	if (query.isError)
		return (
			<p className={styles.hint} role="status">
				Типовые действия не загрузились. Название задачи можно ввести
				вручную.{' '}
				<Button
					size="sm"
					variant="secondary"
					onClick={() => void query.refetch()}
				>
					Повторить
				</Button>
			</p>
		)
	const templates = data?.templates.filter(item => !item.archived) ?? []
	if (!templates.length) return null
	return (
		<div
			className={styles.actions}
			aria-label="Шаблоны следующего действия"
		>
			{templates.map(item => (
				<Button
					key={item.id}
					size="sm"
					variant="secondary"
					disabled={disabled || query.isFetching}
					onClick={() => {
						if (context.current()) onSelect(item.title)
					}}
				>
					{item.title}
				</Button>
			))}
		</div>
	)
}
