'use client'

import { getSalesDeal, type SalesTask } from '@/entities/sales'
import { Button, Drawer, ScreenState, TextareaField } from '@/shared/ui'
import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { useSalesCommand } from '../model/use-sales-command'
import { useSalesSession } from '../model/use-sales-session'
import { SalesCommandState } from './SalesCommandState'
import { NextActionFields } from './NextActionFields'
import { salesDate } from './DealDetailsDrawer'
import styles from './SalesWorkflow.module.scss'

export const CompleteTaskDrawer = ({
	task,
	onClose,
	onSaved
}: {
	task: SalesTask
	onClose: () => void
	onSaved: () => void
}) => {
	const context = useSalesSession()
	const [outcome, setOutcome] = useState('')
	const [title, setTitle] = useState('')
	const [due, setDue] = useState('')
	const detail = useQuery({
		queryKey: ['sales', 'deal', ...context.key, task.dealId],
		enabled: context.canRead && !!context.session,
		queryFn: () =>
			getSalesDeal(
				context.session!.accessToken,
				context.workspace.workspaceId,
				task.dealId
			),
		retry: false,
		gcTime: 0
	})
	const current = detail.data?.nextTask
	const ready =
		context.canWrite &&
		!detail.isError &&
		!detail.isFetching &&
		current?.id === task.id
	const command = useSalesCommand(
		context.workspace.workspaceId,
		context.session?.accessToken || '',
		context.canWrite,
		() => {
			onSaved()
			onClose()
		},
		`deal:${task.dealId}`,
		context.scopeKey
	)
	const submit = (event: FormEvent) => {
		event.preventDefault()
		if (!ready || command.locked) return
		if (!current || !Number.isFinite(Date.parse(due))) {
			toast.error('Укажите срок следующего действия')
			return
		}
		void command.execute({
			kind: 'complete',
			id: task.id,
			dealId: task.dealId,
			expectedVersion: current.version,
			outcome: outcome.trim(),
			nextTask: { title: title.trim(), dueAt: new Date(due).toISOString() }
		})
	}
	const review = async () => {
		const [auth, record] = await Promise.all([
			context.permissions.refetch(),
			detail.refetch()
		])
		if (auth.isError || record.isError)
			throw new Error('Не удалось проверить актуальные данные')
		command.resetAfterReview()
	}
	return (
		<Drawer
			isOpen
			onClose={() => {
				if (command.canClose()) onClose()
			}}
			title="Завершить действие"
			description={
				context.canRead && !detail.isError && current?.id === task.id
					? `${current.title} · ${salesDate(current.dueAt)}`
					: 'Проверка задачи и следующего действия'
			}
			footer={
				<Button
					type="submit"
					form="complete-sales-task"
					disabled={!ready || command.locked}
					isLoading={command.pending}
				>
					Завершить и запланировать
				</Button>
			}
		>
			<SalesCommandState command={command} onReview={review} />
			{detail.isError || !context.canRead ? (
				<ScreenState
					variant="error"
					description="Не удалось проверить актуальность задачи и права."
					action={
						<Button onClick={() => void detail.refetch()}>
							Повторить
						</Button>
					}
				/>
			) : detail.isPending ? (
				<ScreenState variant="loading" />
			) : current?.id !== task.id ? (
				<ScreenState
					variant="empty"
					title="Задача уже изменилась"
					description="Обновите список, чтобы увидеть актуальное следующее действие."
					action={
						<Button
							onClick={() => {
								if (command.canClose()) {
									onSaved()
									onClose()
								}
							}}
						>
							Обновить список
						</Button>
					}
				/>
			) : (
				<form
					id="complete-sales-task"
					className={styles.form}
					onSubmit={submit}
				>
					<p className={styles.muted}>{detail.data?.title}</p>
					<fieldset className={styles.fields} disabled={command.locked}>
						<TextareaField
							label="Результат"
							required
							maxLength={4000}
							rows={4}
							value={outcome}
							onChange={event => setOutcome(event.target.value)}
						/>
						<NextActionFields
							title={title}
							onTitleChange={setTitle}
							due={due}
							onDueChange={setDue}
							disabled={!ready}
						/>
					</fieldset>
					<p className={styles.muted}>
						Чтобы закрыть сделку успешно или с отказом, измените её этап в
						карточке сделки.
					</p>
				</form>
			)}
		</Drawer>
	)
}
