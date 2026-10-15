'use client'

import { useState } from 'react'
import type { MailTemplate } from '@/entities/mail/model/mail-templates.contract'
import { Button, SelectField } from '@/shared/ui'
import { useMailTemplates } from '../model/use-mail-templates'
import styles from './Mail.module.scss'

export const MailTemplatePicker = ({
	disabled,
	onInsert
}: {
	disabled: boolean
	onInsert: (template: MailTemplate) => void
}) => {
	const { data, query, canRead } = useMailTemplates()
	const [selectedId, setSelectedId] = useState('')
	const templates = data?.templates.filter(item => !item.archived) ?? []
	const selected = templates.find(item => item.id === selectedId)
	if (!canRead) return null
	if (query.isError)
		return (
			<div className={styles.stack}>
				<p className={styles.muted}>Не удалось загрузить шаблоны писем.</p>
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
		<div className={styles.stack}>
			<SelectField
				label="Шаблон письма"
				value={selected?.id ?? ''}
				disabled={disabled}
				onChange={event => setSelectedId(event.target.value)}
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
				onClick={() => selected && onInsert(selected)}
			>
				Вставить тему и текст
			</Button>
		</div>
	)
}
