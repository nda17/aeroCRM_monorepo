'use client'

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { saveActivityTextTemplates } from '@/entities/sales/api/activity-text-templates.api'
import {
	type ActivityTextTemplatesSnapshot,
	type SaveActivityTextTemplatesCommand
} from '@/entities/sales/model/activity-text-templates.contract'
import { useActivityTextTemplates } from '@/entities/sales/model/use-activity-text-templates'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { useDirtyForm } from '@/shared/lib/dirty-form'
import {
	commandOwner,
	useMemoryCommand
} from '@/shared/lib/pending-command'
import {
	Button,
	Drawer,
	ScreenState,
	TextareaField,
	TextField
} from '@/shared/ui'
import styles from './ActivityTextTemplatesDrawer.module.scss'

const copy = (
	value: ActivityTextTemplatesSnapshot
): ActivityTextTemplatesSnapshot => ({
	...value,
	templates: value.templates.map(item => ({ ...item }))
})

export const ActivityTextTemplatesDrawer = ({
	onClose
}: {
	onClose: () => void
}) => {
	const state = useActivityTextTemplates()
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
	state: ReturnType<typeof useActivityTextTemplates>
	onClose: () => void
}) =>
	state.query.data ? (
		<SettingsForm
			state={state}
			initial={state.query.data}
			onClose={onClose}
		/>
	) : (
		<Drawer isOpen onClose={onClose} title="Шаблоны результатов" size="lg">
			{state.query.isError || state.context.permissions.isError ? (
				<ScreenState
					variant="error"
					description="Не удалось загрузить шаблоны результатов."
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

const SettingsForm = ({
	state,
	initial,
	onClose
}: {
	state: ReturnType<typeof useActivityTextTemplates>
	initial: ActivityTextTemplatesSnapshot
	onClose: () => void
}) => {
	const { context, query, canManage } = state
	const [baseline, setBaseline] = useState(() => copy(initial))
	const [draft, setDraft] = useState(() => copy(initial))
	const [showArchived, setShowArchived] = useState(false)
	const [newTitle, setNewTitle] = useState('')
	const [newBody, setNewBody] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [refreshing, setRefreshing] = useState(false)
	const refreshingRef = useRef(false)
	const mountedRef = useRef(true)
	useEffect(() => {
		mountedRef.current = true
		return () => {
			mountedRef.current = false
		}
	}, [])
	const client = useQueryClient()
	const queryKey = ['crm-activity-text-templates', ...context.key] as const
	const dirty =
		JSON.stringify(draft) !== JSON.stringify(baseline) ||
		!!newTitle ||
		!!newBody
	const form = useDirtyForm({ dirty, label: 'Шаблоны результатов' })
	const command = useMemoryCommand<
		SaveActivityTextTemplatesCommand,
		ActivityTextTemplatesSnapshot
	>(
		{
			owner: commandOwner(
				context.session?.userId,
				context.sessionRevision
			),
			workspaceId: context.workspace.workspaceId,
			view: context.scopeKey
		},
		'activity:text-templates',
		canManage,
		async () => {
			if (!canManage)
				throw new AuthenticatedApiError(
					'forbidden',
					'Шаблонами могут управлять владелец и администраторы.'
				)
			return context.authorize()
		},
		saveActivityTextTemplates,
		result => {
			client.setQueryData<ActivityTextTemplatesSnapshot>(
				queryKey,
				current =>
					current && current.version > result.version
						? current
						: copy(result)
			)
			setBaseline(copy(result))
			setDraft(copy(result))
			setError(null)
			form.markClean()
			void client.invalidateQueries({
				queryKey: ['crm-activity-text-templates']
			})
			toast.success('Шаблоны результатов сохранены')
		}
	)
	const stale = !!query.data && query.data.version > baseline.version
	const blocked =
		!!command.error &&
		!command.uncertain &&
		command.error.kind !== 'validation'
	const locked =
		!canManage ||
		command.locked ||
		blocked ||
		stale ||
		query.isError ||
		refreshing
	const update = (
		templates: ActivityTextTemplatesSnapshot['templates']
	) => {
		if (refreshingRef.current) return
		setDraft(current => ({ ...current, templates }))
		setError(null)
	}
	const refresh = () => {
		if (refreshingRef.current || command.locked) return
		form.confirmDiscard(() => {
			if (refreshingRef.current || command.locked) return
			refreshingRef.current = true
			setRefreshing(true)
			void query
				.refetch()
				.then(result => {
					if (
						result.isError ||
						!result.data ||
						!mountedRef.current ||
						!context.current()
					)
						return
					setBaseline(copy(result.data))
					setDraft(copy(result.data))
					setNewTitle('')
					setNewBody('')
					setError(null)
					command.reset()
					form.markClean()
				})
				.finally(() => {
					refreshingRef.current = false
					if (mountedRef.current) setRefreshing(false)
				})
		})
	}
	const add = () => {
		if (
			locked ||
			refreshingRef.current ||
			!newTitle.trim() ||
			!newBody.trim()
		)
			return
		update([
			...draft.templates,
			{
				id: crypto.randomUUID(),
				title: newTitle.trim(),
				body: newBody.replace(/\r\n?/g, '\n').trim(),
				archived: false
			}
		])
		setNewTitle('')
		setNewBody('')
	}
	const save = () => {
		if (locked || refreshingRef.current) return
		if (newTitle.trim() || newBody.trim()) {
			setError(
				'Сначала добавьте новый шаблон в список либо очистите поля.'
			)
			return
		}
		const templates = draft.templates.map(item => ({
			...item,
			title: item.title.trim(),
			body: item.body.replace(/\r\n?/g, '\n').trim()
		}))
		if (templates.some(item => !item.title || !item.body)) {
			setError('Заполните название и текст каждого шаблона.')
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
				) as unknown as typeof templates
			})
		)
	}
	return (
		<Drawer
			isOpen
			onClose={() => {
				if (!command.locked && !refreshingRef.current) onClose()
			}}
			dirtyFormIds={[form.id]}
			title="Шаблоны результатов"
			description="Общие текстовые заготовки для результатов общения и записи о работе по сделке."
			size="lg"
			footer={
				<div className={styles.actions}>
					<Button onClick={save} disabled={locked || !dirty}>
						Сохранить шаблоны
					</Button>
					<Button
						variant="secondary"
						disabled={command.locked || refreshing}
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
						Менять общие шаблоны могут владелец и администраторы.
					</p>
				) : null}
				{stale ? (
					<p role="alert" className={styles.error}>
						Шаблоны изменились. Загрузите актуальную версию перед
						сохранением.
					</p>
				) : null}
				{query.isError ? (
					<p role="alert" className={styles.error}>
						Не удалось проверить актуальные шаблоны. Черновик сохранён.
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
				<div hidden={!context.canRead} inert={!context.canRead}>
					<label className={styles.hint}>
						<input
							type="checkbox"
							checked={showArchived}
							onChange={event => setShowArchived(event.target.checked)}
						/>{' '}
						Показывать архивные
					</label>
					<p className={styles.hint}>
						Шаблон вставляется по кнопке в редактируемый текст. Уже
						сохранённые результаты не меняются.
					</p>
					{draft.templates.map((item, index) =>
						!item.archived || showArchived ? (
							<div
								key={item.id}
								className={`${styles.row} ${item.archived ? styles.archived : ''}`}
							>
								<TextField
									label={`Название шаблона ${index + 1}`}
									value={item.title}
									maxLength={200}
									disabled={locked}
									onChange={event =>
										update(
											draft.templates.map(row =>
												row.id === item.id
													? { ...row, title: event.target.value }
													: row
											)
										)
									}
								/>
								<TextareaField
									label={`Текст шаблона ${index + 1}`}
									value={item.body}
									maxLength={4000}
									rows={4}
									disabled={locked}
									onChange={event =>
										update(
											draft.templates.map(row =>
												row.id === item.id
													? { ...row, body: event.target.value }
													: row
											)
										)
									}
								/>
								<Button
									variant="secondary"
									size="sm"
									disabled={locked}
									onClick={() =>
										update(
											draft.templates.map(row =>
												row.id === item.id
													? { ...row, archived: !row.archived }
													: row
											)
										)
									}
								>
									{item.archived ? 'Восстановить' : 'В архив'}
								</Button>
							</div>
						) : null
					)}
					<div className={styles.row}>
						<TextField
							label="Название нового шаблона"
							value={newTitle}
							maxLength={200}
							disabled={locked || draft.templates.length >= 100}
							onChange={event => {
								if (!refreshingRef.current) setNewTitle(event.target.value)
							}}
						/>
						<TextareaField
							label="Текст нового шаблона"
							value={newBody}
							maxLength={4000}
							rows={4}
							disabled={locked || draft.templates.length >= 100}
							onChange={event => {
								if (!refreshingRef.current) setNewBody(event.target.value)
							}}
						/>
						<Button
							variant="secondary"
							disabled={
								locked ||
								!newTitle.trim() ||
								!newBody.trim() ||
								draft.templates.length >= 100
							}
							onClick={add}
						>
							Добавить шаблон
						</Button>
						{draft.templates.length >= 100 ? (
							<p className={styles.hint}>
								Достигнут лимит 100 шаблонов с учётом архива.
							</p>
						) : null}
					</div>
				</div>
			</div>
		</Drawer>
	)
}
