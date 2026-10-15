'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
	saveLossReasons,
	validSaveLossReasons,
	type LossReasons,
	type SaveLossReasons
} from '@/entities/sales/api/sales-productivity.api'
import { useLossReasons } from '@/entities/sales/model/use-loss-reasons'
import { useDirtyForm } from '@/shared/lib/dirty-form'
import {
	commandOwner,
	useMemoryCommand
} from '@/shared/lib/pending-command'
import { Button, Drawer, ScreenState, TextField } from '@/shared/ui'
import styles from './SalesWorkflow.module.scss'

export const LossReasonsDrawer = ({
	onClose
}: {
	onClose: () => void
}) => {
	const state = useLossReasons()
	return state.query.data ? (
		<ReasonsForm
			key={JSON.stringify([...state.context.key, state.actorMembershipId])}
			state={state}
			initial={state.query.data}
			onClose={onClose}
		/>
	) : (
		<Drawer isOpen title="Причины потери сделок" onClose={onClose}>
			<ScreenState
				variant={state.query.isError ? 'error' : 'loading'}
				action={
					state.query.isError ? (
						<Button onClick={() => void state.query.refetch()}>
							Повторить
						</Button>
					) : undefined
				}
			/>
		</Drawer>
	)
}

const ReasonsForm = ({
	state,
	initial,
	onClose
}: {
	state: ReturnType<typeof useLossReasons>
	initial: LossReasons
	onClose: () => void
}) => {
	const { context } = state
	const client = useQueryClient()
	const [baseline, setBaseline] = useState(initial)
	const [reasons, setReasons] = useState(() =>
		initial.reasons.map(row => ({ ...row }))
	)
	const [newTitle, setNewTitle] = useState('')
	const [refreshing, setRefreshing] = useState(false)
	const dirty =
		JSON.stringify(reasons) !== JSON.stringify(baseline.reasons) ||
		!!newTitle
	const form = useDirtyForm({ dirty, label: 'Причины потери сделок' })
	const command = useMemoryCommand<SaveLossReasons, LossReasons>(
		{
			owner: commandOwner(
				context.session?.userId,
				context.sessionRevision
			),
			workspaceId: context.workspace.workspaceId,
			view: JSON.stringify([context.scopeKey, state.actorMembershipId])
		},
		'sales:loss-reasons',
		state.canManage,
		context.authorize,
		saveLossReasons,
		result => {
			client.setQueryData<LossReasons>(state.queryKey, old =>
				old && old.version > result.version ? old : result
			)
			setBaseline(result)
			setReasons(result.reasons.map(row => ({ ...row })))
			setNewTitle('')
			form.markClean()
			void client.invalidateQueries({ queryKey: ['sales'] })
			toast.success('Причины потери сохранены')
		}
	)
	const stale =
		!!state.query.data && state.query.data.version > baseline.version
	const blocked =
		!!command.error &&
		!command.uncertain &&
		command.error.kind !== 'validation'
	const locked =
		!state.canManage ||
		command.locked ||
		stale ||
		blocked ||
		state.query.isError ||
		refreshing
	const refresh = () => {
		if (command.locked || refreshing) return
		form.confirmDiscard(() => {
			setRefreshing(true)
			void state.query
				.refetch()
				.then(result => {
					if (result.isError || !result.data || !context.current()) return
					setBaseline(result.data)
					setReasons(result.data.reasons.map(row => ({ ...row })))
					setNewTitle('')
					command.reset()
					form.markClean()
				})
				.finally(() => setRefreshing(false))
		})
	}
	const close = () => {
		if (command.locked || refreshing) {
			toast('Сначала подтвердите результат сохранения.')
			return
		}
		form.confirmDiscard(onClose)
	}
	const save = () => {
		if (locked || !dirty) return
		if (newTitle.trim()) {
			toast.error('Сначала добавьте новую причину в список.')
			return
		}
		const payload: SaveLossReasons = {
			schemaVersion: 1,
			workspaceId: context.workspace.workspaceId,
			commandId: crypto.randomUUID(),
			actorMembershipId: state.actorMembershipId,
			expectedVersion: baseline.version,
			reasons
		}
		if (!validSaveLossReasons(payload)) {
			toast.error('Введите названия причин до 200 символов.')
			return
		}
		void command.execute(() => payload)
	}
	if (!context.canRead)
		return (
			<Drawer isOpen title="Причины потери сделок" onClose={close}>
				<ScreenState
					variant={
						context.permissions.isError
							? 'error'
							: context.permissions.isFetching
								? 'loading'
								: 'permission'
					}
					description="Данные доступны после проверки текущих прав."
				/>
			</Drawer>
		)
	return (
		<Drawer
			isOpen
			title="Причины потери сделок"
			description="Общий справочник рабочего пространства"
			onClose={close}
			size="lg"
		>
			<div className={styles.form}>
				<p className={styles.muted}>
					Переименование и архивирование не меняют причины в истории
					сделок. До первого сохранения доступны пять стандартных причин.
				</p>
				{stale || blocked ? (
					<p role="alert">
						Настройки или права изменились. Обновите данные перед
						сохранением.
					</p>
				) : null}
				{command.error ? (
					<p role="alert">{command.error.message}</p>
				) : null}
				{command.uncertain ? (
					<Button
						disabled={command.running || !state.canManage}
						onClick={() => void command.execute()}
					>
						Проверить результат сохранения
					</Button>
				) : null}
				{reasons.map((row, index) => (
					<div className={styles.form} key={row.id}>
						<TextField
							label={`Причина ${index + 1}${row.archived ? ' · в архиве' : ''}`}
							value={row.title}
							maxLength={200}
							disabled={locked}
							onChange={event =>
								setReasons(current =>
									current.map(item =>
										item.id === row.id
											? { ...item, title: event.target.value }
											: item
									)
								)
							}
						/>
						<Button
							variant="ghost"
							disabled={locked}
							onClick={() =>
								setReasons(current =>
									current.map(item =>
										item.id === row.id
											? { ...item, archived: !item.archived }
											: item
									)
								)
							}
						>
							{row.archived ? 'Вернуть из архива' : 'Архивировать'}
						</Button>
					</div>
				))}
				<TextField
					label="Новая причина"
					value={newTitle}
					maxLength={200}
					disabled={locked || reasons.length >= 50}
					onChange={event => setNewTitle(event.target.value)}
				/>
				<Button
					variant="secondary"
					disabled={locked || !newTitle.trim() || reasons.length >= 50}
					onClick={() => {
						setReasons(current => [
							...current,
							{
								id: crypto.randomUUID(),
								title: newTitle.trim(),
								archived: false
							}
						])
						setNewTitle('')
					}}
				>
					Добавить причину
				</Button>
				<p className={styles.muted}>
					{reasons.length} из 50 причин, включая архивные
				</p>
				<div className={styles.actions}>
					<Button disabled={locked || !dirty} onClick={save}>
						Сохранить причины
					</Button>
					<Button
						variant="secondary"
						disabled={command.locked || refreshing}
						onClick={refresh}
					>
						Обновить данные
					</Button>
				</div>
			</div>
		</Drawer>
	)
}
