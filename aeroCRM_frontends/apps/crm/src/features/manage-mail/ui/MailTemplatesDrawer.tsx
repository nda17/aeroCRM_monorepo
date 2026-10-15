'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { saveMailTemplates } from '@/entities/mail/api/mail-templates.api'
import type {
	MailTemplatesSnapshot,
	SaveMailTemplatesCommand
} from '@/entities/mail/model/mail-templates.contract'
import { useDirtyForm } from '@/shared/lib/dirty-form'
import {
	Button,
	Drawer,
	ScreenState,
	TextareaField,
	TextField
} from '@/shared/ui'
import { useMailCommand } from '../model/use-mail-context'
import { useMailTemplates } from '../model/use-mail-templates'
import { MailCommandNotice } from './MailCommandNotice'
import styles from './Mail.module.scss'

const copy = (snapshot: MailTemplatesSnapshot): MailTemplatesSnapshot => ({
	...snapshot,
	templates: snapshot.templates.map(item => ({ ...item }))
})

export const MailTemplatesDrawer = ({
	onClose
}: {
	onClose: () => void
}) => {
	const state = useMailTemplates()
	return (
		<MailTemplatesContent
			key={state.context.key.join(':')}
			state={state}
			onClose={onClose}
		/>
	)
}

const MailTemplatesContent = ({
	state,
	onClose
}: {
	state: ReturnType<typeof useMailTemplates>
	onClose: () => void
}) =>
	state.query.data ? (
		<MailTemplatesForm
			state={state}
			initial={state.query.data}
			onClose={onClose}
		/>
	) : (
		<Drawer isOpen title="Шаблоны писем" onClose={onClose} size="lg">
			{state.query.isError || state.context.capabilities.isError ? (
				<ScreenState
					variant="error"
					description="Не удалось загрузить шаблоны писем."
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

const MailTemplatesForm = ({
	state,
	initial,
	onClose
}: {
	state: ReturnType<typeof useMailTemplates>
	initial: MailTemplatesSnapshot
	onClose: () => void
}) => {
	const { context, query, queryKey, canRead, canManage } = state
	const [baseline, setBaseline] = useState(() => copy(initial))
	const [draft, setDraft] = useState(() => copy(initial))
	const [newTitle, setNewTitle] = useState('')
	const [newSubject, setNewSubject] = useState('')
	const [newBody, setNewBody] = useState('')
	const [showArchived, setShowArchived] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [refreshing, setRefreshing] = useState(false)
	const client = useQueryClient()
	const dirty =
		JSON.stringify(draft) !== JSON.stringify(baseline) ||
		!!newTitle ||
		!!newSubject ||
		!!newBody
	const form = useDirtyForm({ dirty, label: 'Шаблоны писем' })
	const command = useMailCommand<
		SaveMailTemplatesCommand,
		MailTemplatesSnapshot
	>(
		context,
		'mail-templates',
		'mail:manage',
		saveMailTemplates,
		result => {
			client.setQueryData<MailTemplatesSnapshot>(queryKey, current =>
				current && current.version > result.version
					? current
					: copy(result)
			)
			setBaseline(copy(result))
			setDraft(copy(result))
			setError(null)
			form.markClean()
			void client.invalidateQueries({ queryKey: ['mail-templates'] })
			toast.success('Шаблоны писем сохранены')
		},
		canManage
	)
	const stale = !!query.data && query.data.version > baseline.version
	const locked =
		!canManage ||
		command.locked ||
		refreshing ||
		stale ||
		query.isError ||
		(!!command.error &&
			!command.uncertain &&
			command.error.kind !== 'validation')
	const update = (templates: MailTemplatesSnapshot['templates']) => {
		setDraft(current => ({ ...current, templates }))
		setError(null)
	}
	const refresh = () => {
		if (command.locked || refreshing) return
		form.confirmDiscard(() => {
			setRefreshing(true)
			void query
				.refetch()
				.then(result => {
					if (result.isError || !result.data || !context.current()) return
					setBaseline(copy(result.data))
					setDraft(copy(result.data))
					setNewTitle('')
					setNewSubject('')
					setNewBody('')
					setError(null)
					command.reset()
					form.markClean()
				})
				.finally(() => setRefreshing(false))
		})
	}
	const add = () => {
		if (
			locked ||
			draft.templates.length >= 100 ||
			!newTitle.trim() ||
			!newSubject.trim() ||
			!newBody.trim()
		)
			return
		update([
			...draft.templates,
			{
				id: crypto.randomUUID(),
				title: newTitle.trim(),
				subject: newSubject.trim(),
				body: newBody.replace(/\r\n?/g, '\n').trim(),
				archived: false
			}
		])
		setNewTitle('')
		setNewSubject('')
		setNewBody('')
	}
	const save = () => {
		if (locked) return
		if (newTitle.trim() || newSubject.trim() || newBody.trim()) {
			setError(
				'Сначала добавьте новый шаблон в список либо очистите поля.'
			)
			return
		}
		const templates = draft.templates.map(item => ({
			...item,
			title: item.title.trim(),
			subject: item.subject.trim(),
			body: item.body.replace(/\r\n?/g, '\n').trim()
		}))
		if (
			templates.some(item => !item.title || !item.subject || !item.body)
		) {
			setError('Заполните название, тему и текст каждого шаблона.')
			return
		}
		void command.execute(() => ({
			schemaVersion: 1,
			workspaceId: context.workspace.workspaceId,
			commandId: crypto.randomUUID(),
			expectedVersion: baseline.version,
			templates
		}))
	}
	if (!canRead)
		return (
			<Drawer
				isOpen
				title="Шаблоны писем"
				onClose={onClose}
				dirtyFormIds={[form.id]}
			>
				<p role="status">
					Данные доступны после проверки текущих прав. Черновик сохранён.
				</p>
			</Drawer>
		)
	return (
		<Drawer
			isOpen
			title="Шаблоны писем"
			size="lg"
			onClose={onClose}
			description="Общие заготовки темы и текста. Шаблон вставляется только по выбору в черновике письма."
			dirtyFormIds={[form.id]}
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
			<div className={styles.stack}>
				{!canManage ? (
					<p role="status">
						Менять общие шаблоны могут владелец и администраторы.
					</p>
				) : null}
				{stale ? (
					<p role="alert">
						Шаблоны изменились. Загрузите актуальную версию перед
						сохранением.
					</p>
				) : null}
				{query.isError ? (
					<p role="alert">
						Не удалось проверить актуальные шаблоны. Черновик сохранён.
					</p>
				) : null}
				{error ? <p role="alert">{error}</p> : null}
				<MailCommandNotice command={command} />
				<label>
					<input
						type="checkbox"
						checked={showArchived}
						onChange={event => setShowArchived(event.target.checked)}
					/>{' '}
					Показывать архивные
				</label>
				{draft.templates.map((item, index) =>
					!item.archived || showArchived ? (
						<div className={styles.item} key={item.id}>
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
							<TextField
								label={`Тема шаблона ${index + 1}`}
								value={item.subject}
								maxLength={300}
								disabled={locked}
								onChange={event =>
									update(
										draft.templates.map(row =>
											row.id === item.id
												? { ...row, subject: event.target.value }
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
				<div className={styles.item}>
					<TextField
						label="Название нового шаблона"
						value={newTitle}
						maxLength={200}
						disabled={locked || draft.templates.length >= 100}
						onChange={event => setNewTitle(event.target.value)}
					/>
					<TextField
						label="Тема нового шаблона"
						value={newSubject}
						maxLength={300}
						disabled={locked || draft.templates.length >= 100}
						onChange={event => setNewSubject(event.target.value)}
					/>
					<TextareaField
						label="Текст нового шаблона"
						value={newBody}
						maxLength={4000}
						rows={4}
						disabled={locked || draft.templates.length >= 100}
						onChange={event => setNewBody(event.target.value)}
					/>
					<Button
						variant="secondary"
						disabled={
							locked ||
							draft.templates.length >= 100 ||
							!newTitle.trim() ||
							!newSubject.trim() ||
							!newBody.trim()
						}
						onClick={add}
					>
						Добавить шаблон
					</Button>
					{draft.templates.length >= 100 ? (
						<p className={styles.muted}>
							Достигнут лимит 100 шаблонов с учётом архива.
						</p>
					) : null}
				</div>
			</div>
		</Drawer>
	)
}
