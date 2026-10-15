'use client'

import { useState } from 'react'
import { useActivityTextTemplates } from '@/entities/sales/model/use-activity-text-templates'
import { Button, SelectField } from '@/shared/ui'
import styles from './SalesWorkflow.module.scss'

export const ActivityTextTemplatePicker = ({
	value,
	onInsert,
	disabled
}: {
	value: string
	onInsert: (value: string) => void
	disabled: boolean
}) => {
	const { data, query, context } = useActivityTextTemplates()
	const [selectedId, setSelectedId] = useState('')
	const [error, setError] = useState<string | null>(null)
	const templates = data?.templates.filter(item => !item.archived) ?? []
	const selected = templates.find(item => item.id === selectedId)
	const insert = () => {
		if (disabled || !selected || !context.canRead) return
		const next = value ? `${value}\n\n${selected.body}` : selected.body
		if (next.length > 4000) {
			setError(
				'Текст с шаблоном превышает 4000 символов. Сократите черновик перед вставкой.'
			)
			return
		}
		onInsert(next)
		setError(null)
	}
	if (!context.canRead) return null
	if (query.isError)
		return (
			<div className={styles.templatePicker}>
				<p className={styles.muted}>
					Не удалось загрузить текстовые шаблоны.
				</p>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					onClick={() => void query.refetch()}
				>
					Повторить загрузку шаблонов
				</Button>
			</div>
		)
	if (!templates.length) return null
	return (
		<div className={styles.templatePicker}>
			<SelectField
				label="Текстовый шаблон"
				value={selected?.id ?? ''}
				disabled={disabled}
				onChange={event => {
					setSelectedId(event.target.value)
					setError(null)
				}}
			>
				<option value="">Выберите шаблон</option>
				{templates.map(item => (
					<option key={item.id} value={item.id}>
						{item.title}
					</option>
				))}
			</SelectField>
			<Button
				type="button"
				variant="secondary"
				size="sm"
				disabled={disabled || !selected}
				onClick={insert}
			>
				{value ? 'Добавить в текст' : 'Вставить шаблон'}
			</Button>
			{error ? (
				<p role="alert" className={styles.error}>
					{error}
				</p>
			) : null}
		</div>
	)
}
