'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { usePlannerSettings } from '@/entities/crm-planner/model/use-planner-settings'
import { savePlannerSettings } from '@/entities/crm-planner/api/planner.api'
import type {
	PlannerSettings,
	PlannerColumn,
	SavePlannerSettingsCommand
} from '@/entities/crm-planner/model/planner.types'
import {
	WORKDAY_STATUSES,
	type WorkdayStatus
} from '@/entities/crm-workday'
import { useDirtyForm } from '@/shared/lib/dirty-form'
import {
	commandOwner,
	useMemoryCommand
} from '@/shared/lib/pending-command'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import {
	Button,
	Drawer,
	ScreenState,
	TextField,
	SelectField
} from '@/shared/ui'
import styles from './PlannerSettings.module.scss'

const statuses: Record<WorkdayStatus, string> = {
	OPEN: 'К выполнению',
	IN_PROGRESS: 'В работе',
	COMPLETED: 'Готово',
	CANCELLED: 'Отменено'
}
const copy = (value: PlannerSettings): PlannerSettings => ({
	...value,
	templates: value.templates.map(item => ({ ...item })),
	columns: value.columns.map(item => ({ ...item }))
})
const reorder = <T,>(items: T[], index: number, direction: number) => {
	const result = [...items]
	const target = index + direction
	if (target >= 0 && target < items.length)
		[result[index], result[target]] = [result[target], result[index]]
	return result
}

export const PlannerSettingsDrawer = ({
	onClose
}: {
	onClose: () => void
}) => {
	const state = usePlannerSettings()
	return (
		<SettingsContent
			key={JSON.stringify(state.context.key)}
			state={state}
			onClose={onClose}
		/>
	)
}

const SettingsContent = ({
	state,
	onClose
}: {
	state: ReturnType<typeof usePlannerSettings>
	onClose: () => void
}) => {
	return state.query.data ? (
		<SettingsForm
			state={state}
			initial={state.query.data}
			onClose={onClose}
		/>
	) : (
		<Drawer isOpen onClose={onClose} title="Настройки задач" size="lg">
			{state.query.isError || state.context.permissions.isError ? (
				<ScreenState
					variant="error"
					description="Не удалось загрузить настройки задач."
					action={
						<Button onClick={() => void state.query.refetch()}>
							Повторить
						</Button>
					}
				/>
			) : (
				<ScreenState variant="loading" />
			)}
		</Drawer>
	)
}

const SettingsForm = ({
	state,
	initial,
	onClose
}: {
	state: ReturnType<typeof usePlannerSettings>
	initial: PlannerSettings
	onClose: () => void
}) => {
	const { context, query, canManage } = state
	const [baseline, setBaseline] = useState(() => copy(initial))
	const [draft, setDraft] = useState(() => copy(initial))
	const [showArchived, setShowArchived] = useState(false)
	const [newTitle, setNewTitle] = useState('')
	const [newName, setNewName] = useState('')
	const [newStatus, setNewStatus] = useState<WorkdayStatus>('IN_PROGRESS')
	const [error, setError] = useState<string | null>(null)
	const client = useQueryClient()
	const dirty =
		JSON.stringify(draft) !== JSON.stringify(baseline) ||
		!!newTitle ||
		!!newName
	const form = useDirtyForm({ dirty, label: 'Настройки задач' })
	const command = useMemoryCommand<
		SavePlannerSettingsCommand,
		PlannerSettings
	>(
		{
			owner: commandOwner(
				context.session?.userId,
				context.sessionRevision
			),
			workspaceId: context.workspace.workspaceId,
			view: context.scopeKey
		},
		'planner:settings',
		canManage,
		async () => {
			if (!canManage)
				throw new AuthenticatedApiError(
					'forbidden',
					'Настройки доступны владельцу и администратору.'
				)
			return context.authorize()
		},
		savePlannerSettings,
		result => {
			setBaseline(copy(result))
			setDraft(copy(result))
			setError(null)
			form.markClean()
			void client.invalidateQueries({ queryKey: ['crm-planner'] })
			void client.invalidateQueries({ queryKey: ['crm-workday'] })
			toast.success('Настройки задач сохранены')
		}
	)
	const stale = !!query.data && query.data.version !== baseline.version
	const blocked =
		!!command.error &&
		!command.uncertain &&
		command.error.kind !== 'validation'
	const locked =
		!canManage || command.locked || blocked || stale || query.isError
	const update = (value: Partial<PlannerSettings>) => {
		setDraft(current => ({ ...current, ...value }))
		setError(null)
	}
	const refresh = () =>
		form.confirmDiscard(() => {
			void query.refetch().then(result => {
				if (result.isError || !result.data || !context.current()) return
				setBaseline(copy(result.data))
				setDraft(copy(result.data))
				setNewTitle('')
				setNewName('')
				setError(null)
				command.reset()
				form.markClean()
			})
		})
	const save = () => {
		if (locked) return
		if (newTitle.trim() || newName.trim()) {
			setError(
				'Сначала добавьте новое действие или колонку в список либо очистите поля.'
			)
			return
		}
		const templates = draft.templates.map(item => ({
			...item,
			title: item.title.trim()
		}))
		const columns = draft.columns.map(item => ({
			...item,
			name: item.name.trim()
		}))
		if (
			templates.some(item => !item.title) ||
			columns.some(item => !item.name)
		) {
			setError('Заполните названия всех действий и колонок.')
			return
		}
		void command.execute(() =>
			Object.freeze({
				schemaVersion: 1,
				workspaceId: context.workspace.workspaceId,
				commandId: crypto.randomUUID(),
				expectedVersion: baseline.version,
				templates: Object.freeze(
					templates.map(item => Object.freeze(item))
				) as unknown as typeof templates,
				columns: Object.freeze(
					columns.map(item => Object.freeze(item))
				) as unknown as typeof columns
			})
		)
	}
	return (
		<Drawer
			isOpen
			onClose={() => {
				if (!command.locked) onClose()
			}}
			dirtyFormIds={[form.id]}
			title="Настройки задач"
			description="Общие типовые действия и колонки для всех сотрудников рабочего пространства."
			size="lg"
			footer={
				<div className={styles.actions}>
					<Button onClick={save} disabled={locked || !dirty}>
						Сохранить настройки
					</Button>
					<Button
						variant="secondary"
						disabled={command.locked}
						onClick={refresh}
					>
						Загрузить актуальные
					</Button>
				</div>
			}
		>
			<div className={styles.content}>
				{!context.canRead ? (
					<p role="status">Проверяем доступ. Черновик сохранён.</p>
				) : null}
				{context.canRead && !canManage ? (
					<p role="status">
						Менять общие настройки могут владелец и администраторы.
					</p>
				) : null}
				{stale ? (
					<p role="alert" className={styles.error}>
						Настройки изменены другим сотрудником. Загрузите актуальную
						версию перед сохранением.
					</p>
				) : null}
				{query.isError ? (
					<p role="alert" className={styles.error}>
						Не удалось проверить актуальные настройки. Черновик сохранён.
					</p>
				) : null}
				{error || command.error ? (
					<div role="alert" className={styles.error}>
						<p>{error || command.error?.message}</p>
						{command.uncertain ? (
							<Button
								variant="secondary"
								disabled={!canManage || command.running}
								onClick={() => void command.execute()}
							>
								Проверить сохранение
							</Button>
						) : null}
					</div>
				) : null}
				<div
					hidden={!context.canRead}
					inert={!context.canRead}
					className={styles.content}
				>
					<label className={styles.hint}>
						<input
							type="checkbox"
							checked={showArchived}
							onChange={event => setShowArchived(event.target.checked)}
						/>{' '}
						Показывать архивные
					</label>
					<section
						className={styles.section}
						aria-label="Типовые действия"
					>
						<h3>Типовые действия</h3>
						<p className={styles.hint}>
							Кнопка подставляет название в редактируемую задачу. Уже
							созданные задачи не меняются.
						</p>
						{draft.templates.map(
							(item, index) =>
								(!item.archived || showArchived) && (
									<div
										key={item.id}
										className={`${styles.row} ${item.archived ? styles.archived : ''}`}
									>
										<TextField
											label={`Действие ${index + 1}`}
											value={item.title}
											maxLength={200}
											disabled={locked}
											onChange={event =>
												update({
													templates: draft.templates.map(row =>
														row.id === item.id
															? { ...row, title: event.target.value }
															: row
													)
												})
											}
										/>
										<div className={styles.actions}>
											<Button
												variant="secondary"
												size="sm"
												disabled={locked || index === 0}
												aria-label={`Поднять действие ${index + 1}`}
												onClick={() =>
													update({
														templates: reorder(draft.templates, index, -1)
													})
												}
											>
												Выше
											</Button>
											<Button
												variant="secondary"
												size="sm"
												disabled={
													locked || index === draft.templates.length - 1
												}
												aria-label={`Опустить действие ${index + 1}`}
												onClick={() =>
													update({
														templates: reorder(draft.templates, index, 1)
													})
												}
											>
												Ниже
											</Button>
											<Button
												variant="secondary"
												size="sm"
												disabled={locked}
												onClick={() =>
													update({
														templates: draft.templates.map(row =>
															row.id === item.id
																? { ...row, archived: !row.archived }
																: row
														)
													})
												}
											>
												{item.archived ? 'Восстановить' : 'В архив'}
											</Button>
										</div>
									</div>
								)
						)}
						<TextField
							label="Новое типовое действие"
							value={newTitle}
							maxLength={200}
							disabled={locked || draft.templates.length >= 100}
							onChange={event => setNewTitle(event.target.value)}
						/>
						<Button
							variant="secondary"
							disabled={
								locked || !newTitle.trim() || draft.templates.length >= 100
							}
							onClick={() => {
								update({
									templates: [
										...draft.templates,
										{
											id: crypto.randomUUID(),
											title: newTitle.trim(),
											archived: false
										}
									]
								})
								setNewTitle('')
							}}
						>
							Добавить действие
						</Button>
						{draft.templates.length >= 100 ? (
							<p className={styles.hint}>
								Достигнут лимит 100 действий с учётом архива. Можно
								изменить или восстановить существующее.
							</p>
						) : null}
					</section>
					<section className={styles.section} aria-label="Колонки доски">
						<h3>Колонки доски</h3>
						<p className={styles.hint}>
							При переносе в колонку задача получает указанный статус.
							Четыре основные колонки принимают новые задачи и задачи из
							архивных колонок. Архивирование колонки сохраняет задачи и их
							статусы. При восстановлении колонки в неё вернутся прежние
							задачи, если их статус не изменился.
						</p>
						{draft.columns.map(
							(item, index) =>
								(!item.archived || showArchived) && (
									<div
										key={item.id}
										className={`${styles.row} ${item.archived ? styles.archived : ''}`}
									>
										<TextField
											label={`Колонка ${index + 1}`}
											value={item.name}
											maxLength={100}
											disabled={locked}
											onChange={event =>
												update({
													columns: draft.columns.map(row =>
														row.id === item.id
															? { ...row, name: event.target.value }
															: row
													)
												})
											}
										/>
										<p className={styles.hint}>
											Статус: {statuses[item.status]}
											{item.isDefault ? ' · Основная колонка' : ''}
											{item.archived ? ' · В архиве' : ''}
										</p>
										<div className={styles.actions}>
											<Button
												variant="secondary"
												size="sm"
												disabled={locked || index === 0}
												aria-label={`Поднять колонку ${index + 1}`}
												onClick={() =>
													update({
														columns: reorder(draft.columns, index, -1)
													})
												}
											>
												Выше
											</Button>
											<Button
												variant="secondary"
												size="sm"
												disabled={
													locked || index === draft.columns.length - 1
												}
												aria-label={`Опустить колонку ${index + 1}`}
												onClick={() =>
													update({
														columns: reorder(draft.columns, index, 1)
													})
												}
											>
												Ниже
											</Button>
											{!item.isDefault ? (
												<Button
													variant="secondary"
													size="sm"
													disabled={locked}
													onClick={() =>
														update({
															columns: draft.columns.map(row =>
																row.id === item.id
																	? { ...row, archived: !row.archived }
																	: row
															)
														})
													}
												>
													{item.archived ? 'Восстановить' : 'В архив'}
												</Button>
											) : null}
										</div>
									</div>
								)
						)}
						<div className={styles.fields}>
							<TextField
								label="Название новой колонки"
								value={newName}
								maxLength={100}
								disabled={locked || draft.columns.length >= 50}
								onChange={event => setNewName(event.target.value)}
							/>
							<SelectField
								label="Статус задач в новой колонке"
								value={newStatus}
								disabled={locked || draft.columns.length >= 50}
								onChange={event =>
									setNewStatus(
										event.target.value as PlannerColumn['status']
									)
								}
							>
								{WORKDAY_STATUSES.map(status => (
									<option key={status} value={status}>
										{statuses[status]}
									</option>
								))}
							</SelectField>
						</div>
						<Button
							variant="secondary"
							disabled={
								locked || !newName.trim() || draft.columns.length >= 50
							}
							onClick={() => {
								update({
									columns: [
										...draft.columns,
										{
											id: crypto.randomUUID(),
											name: newName.trim(),
											status: newStatus,
											isDefault: false,
											archived: false
										}
									]
								})
								setNewName('')
							}}
						>
							Добавить колонку
						</Button>
						{draft.columns.length >= 50 ? (
							<p className={styles.hint}>
								Достигнут лимит 50 колонок с учётом архива. Можно изменить
								или восстановить существующую.
							</p>
						) : null}
					</section>
				</div>
			</div>
		</Drawer>
	)
}
