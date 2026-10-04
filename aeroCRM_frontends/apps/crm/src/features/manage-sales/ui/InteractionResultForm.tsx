'use client'

import { useEffect, useState, type FormEvent } from 'react'
import type { SalesDeal, SalesInteractionResult } from '@/entities/sales'
import { useDirtyForm } from '@/shared/lib/dirty-form'
import { SelectField, TextareaField } from '@/shared/ui'
import { taskDueIso } from '@/features/manage-workday/model/workday-form'
import type { useSalesCommand } from '../model/use-sales-command'
import { NextActionFields } from './NextActionFields'
import styles from './SalesWorkflow.module.scss'

export const InteractionResultForm = ({
	deal,
	command,
	enabled,
	onDirtyChange
}: {
	deal: SalesDeal
	command: ReturnType<typeof useSalesCommand>
	enabled: boolean
	onDirtyChange: (dirty: boolean) => void
}) => {
	const [expectedVersion, setExpectedVersion] = useState(deal.version)
	const [result, setResult] = useState<SalesInteractionResult | ''>('')
	const [comment, setComment] = useState('')
	const [createNext, setCreateNext] = useState(false)
	const [title, setTitle] = useState('')
	const [due, setDue] = useState('')
	const dirty = Boolean(result || comment || createNext || title || due)
	// A pristine form follows a confirmed refresh; a draft keeps the version
	// against which it was written, so another update still produces a conflict.
	if (!dirty && !command.locked && expectedVersion !== deal.version)
		setExpectedVersion(deal.version)
	useDirtyForm({ dirty, label: 'Результат общения' })
	useEffect(() => {
		onDirtyChange(dirty)
	}, [dirty, onDirtyChange])
	useEffect(() => () => onDirtyChange(false), [onDirtyChange])
	const submit = (event: FormEvent) => {
		event.preventDefault()
		if (!enabled || command.locked || !result) return
		const dueAt = createNext ? taskDueIso(due) : null
		if (createNext && (deal.status !== 'OPEN' || !title.trim() || !dueAt))
			return
		void command.execute({
			kind: 'interaction',
			id: deal.id,
			expectedVersion,
			result,
			comment: comment.trim(),
			...(createNext && dueAt
				? { nextTask: { title: title.trim(), dueAt } }
				: {})
		})
	}
	return (
		<form
			id="deal-interaction-form"
			className={styles.section}
			onSubmit={submit}
		>
			<h3>Результат общения</h3>
			<fieldset
				className={styles.fields}
				disabled={!enabled || command.locked}
			>
				<SelectField
					label="Итог звонка или встречи"
					required
					value={result}
					onChange={event =>
						setResult(event.target.value as SalesInteractionResult)
					}
				>
					<option value="">Выберите результат</option>
					<option value="CALL_REACHED">Дозвонился</option>
					<option value="CALL_NO_ANSWER">Не ответил</option>
					<option value="MEETING_HELD">Встреча состоялась</option>
				</SelectField>
				<TextareaField
					label="Комментарий"
					value={comment}
					onChange={event => setComment(event.target.value)}
					maxLength={4000}
					rows={3}
					placeholder="О чём договорились с клиентом"
				/>
				{deal.status === 'OPEN' ? (
					<label className={styles.nextTaskToggle}>
						<input
							type="checkbox"
							checked={createNext}
							onChange={event => setCreateNext(event.target.checked)}
						/>
						Запланировать следующее действие
					</label>
				) : null}
				{createNext ? (
					<>
						<p className={styles.muted}>
							Новая задача станет следующим действием. Ранее созданные
							задачи останутся открытыми до отдельного завершения.
						</p>
						<NextActionFields
							title={title}
							onTitleChange={setTitle}
							due={due}
							onDueChange={setDue}
						/>
						{due && !taskDueIso(due) ? (
							<p role="alert" className={styles.error}>
								Укажите существующую дату и время.
							</p>
						) : null}
					</>
				) : (
					<p className={styles.muted}>
						Результат попадёт в историю сделки. Текущие задачи и этап
						сохранятся.
					</p>
				)}
			</fieldset>
		</form>
	)
}
