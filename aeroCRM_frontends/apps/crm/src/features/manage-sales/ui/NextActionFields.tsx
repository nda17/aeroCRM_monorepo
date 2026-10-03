'use client'

import { Button, TextField } from '@/shared/ui'
import { ActionTemplatePicker } from '@/features/manage-planner/ui/ActionTemplatePicker'
import styles from './SalesWorkflow.module.scss'

export const nextActionDue = (days: number, now = new Date()) => {
	const date = new Date(now)
	date.setDate(date.getDate() + days)
	if (days === 0)
		date.setHours(
			Math.min(date.getHours() + 1, 23),
			date.getHours() === 23 ? 59 : 0,
			0,
			0
		)
	else date.setHours(10, 0, 0, 0)
	const pad = (value: number) => String(value).padStart(2, '0')
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export const NextActionFields = ({
	title,
	onTitleChange,
	due,
	onDueChange,
	titleLabel = 'Следующее действие',
	dueLabel = 'Срок следующего действия',
	disabled = false
}: {
	title: string
	onTitleChange: (value: string) => void
	due: string
	onDueChange: (value: string) => void
	titleLabel?: string
	dueLabel?: string
	disabled?: boolean
}) => (
	<>
		<TextField
			label={titleLabel}
			value={title}
			onChange={event => onTitleChange(event.target.value)}
			required
			maxLength={200}
			disabled={disabled}
		/>
		<ActionTemplatePicker onSelect={onTitleChange} disabled={disabled} />
		<TextField
			label={dueLabel}
			type="datetime-local"
			value={due}
			onChange={event => onDueChange(event.target.value)}
			required
			disabled={disabled}
		/>
		<div className={styles.presets} aria-label="Быстрый выбор срока">
			{[
				{ label: 'Сегодня', days: 0 },
				{ label: 'Завтра', days: 1 },
				{ label: 'Через неделю', days: 7 }
			].map(({ label, days }) => (
				<Button
					key={days}
					size="sm"
					variant="secondary"
					disabled={disabled}
					onClick={() => {
						onDueChange(nextActionDue(days))
					}}
				>
					{label}
				</Button>
			))}
		</div>
	</>
)
