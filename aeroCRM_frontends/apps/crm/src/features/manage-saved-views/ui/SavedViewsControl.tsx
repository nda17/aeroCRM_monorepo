'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import {
	parseSavedViewParameters,
	type LegacySavedView,
	type SavedDealParameters,
	type SavedView,
	type SavedViewParameters,
	type SavedViewScope
} from '@/entities/crm-saved-views'
import { useDirtyForm } from '@/shared/lib/dirty-form'
import { Button, TextField } from '@/shared/ui'
import {
	useSavedViews,
	type SavedViewsContext
} from '../model/use-saved-views'
import styles from './SavedViewsControl.module.scss'

export interface LegacyDealView {
	id: string
	name: string
	parameters: SavedDealParameters
}

export const SavedViewsControl = ({
	context,
	scope,
	parameters,
	onOpen,
	legacy,
	onImported
}: {
	context: SavedViewsContext
	scope: SavedViewScope
	parameters: SavedViewParameters
	onOpen: (parameters: SavedViewParameters) => boolean | void
	legacy?: readonly LegacyDealView[]
	onImported?: () => void
}) => {
	const [editor, setEditor] = useState<
		{ kind: 'create' } | { kind: 'rename'; view: SavedView } | null
	>(null)
	const [name, setName] = useState('')
	const [selected, setSelected] = useState<string | null>(null)
	const [preparingImport, setPreparingImport] = useState(false)
	const importAttempted = useRef(false)
	const mounted = useRef(true)
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
		}
	}, [])
	const dirty = useDirtyForm({
		dirty:
			!!editor &&
			name !== (editor.kind === 'rename' ? editor.view.name : ''),
		label: 'Название сохранённого представления'
	})
	const views = useSavedViews(context, scope, (_result, command) => {
		if (command.mutation.kind === 'import') {
			onImported?.()
			toast.success('Представления из этого браузера сохранены в CRM')
		} else {
			setEditor(null)
			setName('')
			dirty.markClean()
			if (command.mutation.kind === 'delete') setSelected(null)
			toast.success(
				command.mutation.kind === 'delete'
					? 'Представление удалено'
					: 'Представление сохранено'
			)
		}
	})
	const { command } = views
	const selectedView = views.items.find(view => view.id === selected)
	const locked = command.locked || preparingImport
	const importLegacy = async () => {
		if (!legacy?.length || !views.canManage || locked) return
		setPreparingImport(true)
		try {
			const items: LegacySavedView[] = await Promise.all(
				legacy.map(async view => {
					const digest = await crypto.subtle.digest(
						'SHA-256',
						new TextEncoder().encode(
							`${context.workspace.workspaceId}:${view.id}`
						)
					)
					return {
						legacyKey: Array.from(new Uint8Array(digest), value =>
							value.toString(16).padStart(2, '0')
						).join(''),
						name: view.name,
						parameters: view.parameters
					}
				})
			)
			if (mounted.current)
				await command.execute({ kind: 'import', views: items })
		} catch {
			if (mounted.current)
				toast.error(
					'Не удалось подготовить перенос. Представления сохранены в этом браузере.'
				)
		} finally {
			if (mounted.current) setPreparingImport(false)
		}
	}
	useEffect(() => {
		if (
			!legacy?.length ||
			!views.canManage ||
			!views.query.isSuccess ||
			command.snapshot.status !== 'idle' ||
			importAttempted.current
		)
			return
		importAttempted.current = true
		void importLegacy()
		// Import starts once per mounted workspace. Unknown results require an explicit retry of the same command.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		legacy?.length,
		views.canManage,
		views.query.isSuccess,
		command.snapshot.status
	])
	const startEditor = (next: NonNullable<typeof editor>) => {
		if (locked) return
		dirty.confirmDiscard(() => {
			setEditor(next)
			setName(next.kind === 'rename' ? next.view.name : '')
		})
	}
	const submit = (event: FormEvent) => {
		event.preventDefault()
		if (!editor || !name.trim() || locked || !views.canManage) return
		if (editor.kind === 'rename')
			void command.execute({
				kind: 'rename',
				id: editor.view.id,
				expectedVersion: editor.view.version,
				name: name.trim()
			})
		else if (parseSavedViewParameters(parameters, scope))
			void command.execute({
				kind: 'create',
				name: name.trim(),
				parameters
			})
		else
			toast.error('Параметры представления недоступны. Проверьте фильтры.')
	}
	return (
		<section
			className={styles.control}
			aria-label="Сохранённые представления"
		>
			<div className={styles.heading}>
				<span className={styles.title}>Мои фильтры</span>
				<Button
					size="sm"
					variant="secondary"
					disabled={!views.canManage || locked || views.items.length >= 20}
					onClick={() => startEditor({ kind: 'create' })}
					disabledTooltip={
						!views.canManage
							? 'Сейчас доступно только открытие представлений.'
							: views.items.length >= 20
								? 'Можно сохранить до 20 представлений.'
								: 'Сначала подтвердите результат текущей команды.'
					}
				>
					Сохранить фильтры
				</Button>
			</div>
			<p className={styles.message}>
				Сохраняются применённые фильтры и вид «Список» или «Доска». Они
				доступны только вам в этом пространстве на любом устройстве.
			</p>
			{views.query.isError ? (
				<div className={styles.message} role="alert">
					Не удалось загрузить представления.{' '}
					<Button
						size="sm"
						variant="ghost"
						onClick={() => void views.query.refetch()}
					>
						Повторить
					</Button>
				</div>
			) : views.query.isPending ? (
				<p className={styles.message} role="status">
					Загружаем представления…
				</p>
			) : views.items.length ? (
				<div className={styles.list}>
					{views.items.map(view => (
						<Button
							key={view.id}
							size="sm"
							variant={selected === view.id ? 'primary' : 'secondary'}
							disabled={!context.canRead || locked}
							aria-pressed={selected === view.id}
							onClick={() => {
								if (onOpen(view.parameters) !== false) setSelected(view.id)
							}}
						>
							{view.name}
						</Button>
					))}
				</div>
			) : (
				<p className={styles.message}>
					Выберите условия, примените их и нажмите «Сохранить фильтры».
				</p>
			)}
			{selectedView && views.canManage ? (
				<div className={styles.actions}>
					<Button
						size="sm"
						variant="ghost"
						disabled={locked}
						onClick={() =>
							startEditor({ kind: 'rename', view: selectedView })
						}
					>
						Переименовать «{selectedView.name}»
					</Button>
					<Button
						size="sm"
						variant="ghost"
						disabled={locked}
						onClick={() =>
							dirty.confirmDiscard(() => {
								void command.execute({
									kind: 'delete',
									id: selectedView.id,
									expectedVersion: selectedView.version
								})
							})
						}
					>
						Удалить представление
					</Button>
				</div>
			) : null}
			{editor ? (
				<form className={styles.editor} onSubmit={submit}>
					<TextField
						label={
							editor.kind === 'rename'
								? 'Новое название представления'
								: 'Название представления'
						}
						value={name}
						onChange={event => setName(event.target.value)}
						maxLength={60}
						required
						disabled={locked || !views.canManage}
						autoFocus
					/>
					<Button
						type="submit"
						size="sm"
						disabled={locked || !views.canManage || !name.trim()}
						isLoading={command.running}
					>
						Сохранить
					</Button>
					<Button
						size="sm"
						variant="ghost"
						disabled={locked}
						onClick={() =>
							dirty.confirmDiscard(() => {
								setEditor(null)
								setName('')
							})
						}
					>
						Отмена
					</Button>
				</form>
			) : null}
			{legacy?.length ? (
				<div className={styles.message}>
					{preparingImport
						? 'Переносим представления из этого браузера…'
						: 'Представления из этого браузера ещё не перенесены в CRM.'}
					{!locked && views.canManage ? (
						<Button
							size="sm"
							variant="ghost"
							onClick={() => void importLegacy()}
						>
							Перенести
						</Button>
					) : null}
					<div className={styles.list}>
						{legacy.map(view => (
							<Button
								key={view.id}
								size="sm"
								variant="ghost"
								disabled={!context.canRead || locked}
								onClick={() => onOpen(view.parameters)}
							>
								{view.name} · в этом браузере
							</Button>
						))}
					</div>
				</div>
			) : null}
			{command.error ? (
				<div className={styles.message} role="alert">
					<p>
						{command.uncertain
							? 'Результат сохранения пока не подтверждён. Повторите тот же запрос, чтобы проверить его без дубликатов.'
							: command.error.message}
					</p>
					{command.uncertain ? (
						<Button
							size="sm"
							variant="secondary"
							disabled={!views.canManage || command.running}
							onClick={() => void command.execute()}
						>
							Проверить результат
						</Button>
					) : command.blocked ? (
						<Button
							size="sm"
							variant="secondary"
							onClick={async () => {
								const refreshed = await views.query.refetch()
								if (mounted.current && !refreshed.isError)
									dirty.confirmDiscard(() => {
										if (command.reset()) {
											setEditor(null)
											setName('')
											dirty.markClean()
										}
									})
							}}
						>
							Обновить представления
						</Button>
					) : null}
				</div>
			) : null}
		</section>
	)
}
