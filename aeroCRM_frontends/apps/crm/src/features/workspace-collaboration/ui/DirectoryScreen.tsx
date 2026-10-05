'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
	archiveDirectoryEntry,
	listDirectory,
	restoreDirectoryEntry,
	updateDirectoryEntry,
	type DirectoryCommand,
	type DirectoryEntry,
	type DirectoryFields
} from '@/entities/workspace-collaboration'
import { invalidContractError } from '@/shared/api/authenticated-http-client'
import { useDirtyValue } from '@/shared/lib/dirty-form'
import {
	Button,
	Drawer,
	PageHeader,
	ScreenState,
	TextField
} from '@/shared/ui'
import {
	useCollaboration,
	useCollaborationCommand,
	type CollaborationContext
} from '../model/use-collaboration'
import { CommandNotice } from './CommandNotice'
import styles from './Collaboration.module.scss'

const labels: Record<keyof DirectoryFields, string> = {
	lastName: 'Фамилия',
	firstName: 'Имя',
	middleName: 'Отчество',
	phone: 'Рабочий телефон',
	extension: 'Добавочный номер',
	email: 'Рабочая почта',
	position: 'Должность',
	department: 'Подразделение',
	telegram: 'Telegram'
}
const limits: Record<keyof DirectoryFields, number> = {
	firstName: 100,
	lastName: 100,
	middleName: 100,
	phone: 64,
	email: 254,
	position: 100,
	department: 100,
	extension: 20,
	telegram: 100
}
const statuses: Record<DirectoryEntry['status'], string> = {
	REGISTERING: 'Приглашён · ожидает регистрации',
	INVITED: 'Приглашён',
	WAITING: 'Ожидает активации',
	ACTIVE: 'Активен',
	DISABLED: 'Доступ отключён',
	EXPIRED: 'Приглашение истекло',
	REVOKED: 'Приглашение отозвано'
}
const fieldNames = Object.keys(labels) as (keyof DirectoryFields)[]

export function DirectoryScreen() {
	const context = useCollaboration()
	return <DirectoryContent key={context.identity} context={context} />
}

function DirectoryContent({ context }: { context: CollaborationContext }) {
	const [search, setSearch] = useState('')
	const [q, setQ] = useState('')
	const [page, setPage] = useState(1)
	const [includeArchived, setIncludeArchived] = useState(false)
	const [editing, setEditing] = useState<DirectoryEntry | null>(null)
	const directory = useQuery({
		queryKey: [
			'workspace-directory',
			...context.key,
			q,
			page,
			includeArchived
		],
		enabled: context.ready,
		queryFn: async () => {
			const result = await listDirectory(context.session!.accessToken, {
				...context.binding,
				q,
				page,
				pageSize: 30,
				includeArchived
			})
			if (!context.current()) throw invalidContractError()
			return result
		},
		retry: false,
		gcTime: 0,
		refetchInterval: 60000
	})
	return (
		<div className={styles.stack}>
			<PageHeader
				title="Справочник"
				description="Рабочие контакты команды. Любой сотрудник может уточнить данные коллеги."
			/>
			<form
				className={styles.toolbar}
				onSubmit={event => {
					event.preventDefault()
					setQ(search.trim())
					setPage(1)
				}}
			>
				<TextField
					label="Найти сотрудника"
					placeholder="Имя, телефон, почта или подразделение"
					maxLength={100}
					value={search}
					onChange={event => setSearch(event.target.value)}
					containerClassName={styles.search}
				/>
				<Button type="submit" variant="secondary">
					Найти
				</Button>
				<Button
					variant="secondary"
					onClick={() => void directory.refetch()}
					disabled={directory.isFetching || !context.ready}
				>
					Обновить
				</Button>
			</form>
			<label className={styles.muted}>
				<input
					type="checkbox"
					checked={includeArchived}
					onChange={event => {
						setIncludeArchived(event.target.checked)
						setPage(1)
					}}
				/>{' '}
				Показывать архивные карточки
			</label>
			{context.workspace.isReadOnly ? (
				<p className={styles.muted}>
					Пространство доступно только для чтения.
				</p>
			) : null}
			{context.permissions.isError || directory.isError ? (
				<ScreenState
					variant="error"
					title="Не удалось загрузить справочник"
					description="Повторите проверку доступа и загрузку."
					action={
						<Button
							onClick={() => {
								void context.permissions.refetch()
								void directory.refetch()
							}}
						>
							Повторить
						</Button>
					}
				/>
			) : !context.ready || !directory.data ? (
				<ScreenState variant="loading" title="Загружаем сотрудников…" />
			) : (
				<>
					<p className={styles.muted}>
						Сотрудников: {directory.data.total}
					</p>
					{directory.data.items.length ? (
						<div className={styles.cards}>
							{directory.data.items.map(entry => (
								<article className={styles.card} key={entry.id}>
									<div className={styles.identity}>
										<span className={styles.avatar} aria-hidden="true">
											{entry.displayName
												.slice(0, 1)
												.toLocaleUpperCase('ru-RU')}
										</span>
										<div>
											<h2 className={styles.name}>{entry.displayName}</h2>
											<p className={styles.muted}>
												{[entry.fields.position, entry.fields.department]
													.filter(Boolean)
													.join(' · ') ||
													(entry.isOwner
														? 'Владелец пространства'
														: 'Сотрудник')}
											</p>
										</div>
									</div>
									<span className={styles.status}>
										{entry.archivedAt ? 'В архиве · ' : ''}
										{statuses[entry.status]}
										{entry.isOwner ? ' · Владелец' : ''}
									</span>
									<dl className={styles.contacts}>
										{(
											['phone', 'email', 'extension', 'telegram'] as const
										).map(name =>
											entry.fields[name] ? (
												<div key={name}>
													<dt>{labels[name]}</dt>
													<dd>
														{name === 'email' ? (
															<a href={`mailto:${entry.fields[name]}`}>
																{entry.fields[name]}
															</a>
														) : name === 'phone' ? (
															<a href={`tel:${entry.fields[name]}`}>
																{entry.fields[name]}
															</a>
														) : (
															entry.fields[name]
														)}
													</dd>
												</div>
											) : null
										)}
										{!entry.fields.phone && !entry.fields.email ? (
											<div>
												<dd className={styles.muted}>
													Рабочие контакты пока не заполнены.
												</dd>
											</div>
										) : null}
									</dl>
									<div className={styles.actions}>
										{entry.canMessage &&
										entry.subject &&
										entry.subject !== context.binding.subject ? (
											<Link
												href={`/messages?workspaceId=${context.workspace.workspaceId}&recipient=${encodeURIComponent(entry.subject)}`}
												className="text-sm font-semibold text-primary"
											>
												Написать
											</Link>
										) : null}
										{entry.canEdit || entry.canArchive ? (
											<Button
												size="sm"
												variant="secondary"
												onClick={() => setEditing(entry)}
												disabled={!context.canWrite}
											>
												Редактировать
											</Button>
										) : null}
										{entry.fields.phone || entry.fields.email ? (
											<Button
												size="sm"
												variant="ghost"
												onClick={() => {
													void navigator.clipboard
														.writeText(
															[
																entry.displayName,
																...fieldNames
																	.filter(
																		key =>
																			![
																				'firstName',
																				'lastName',
																				'middleName'
																			].includes(key) && entry.fields[key]
																	)
																	.map(
																		key =>
																			`${labels[key]}: ${entry.fields[key]}`
																	)
															].join('\n')
														)
														.then(
															() => toast.success('Контакты скопированы'),
															() =>
																toast.error(
																	'Не удалось скопировать контакты'
																)
														)
												}}
											>
												Скопировать
											</Button>
										) : null}
									</div>
								</article>
							))}
						</div>
					) : (
						<ScreenState
							variant="empty"
							title="Сотрудники не найдены"
							description="Попробуйте изменить запрос или показать архивные карточки."
						/>
					)}
					<div className={styles.toolbar}>
						<Button
							variant="secondary"
							disabled={page === 1 || directory.isFetching}
							onClick={() => setPage(value => value - 1)}
						>
							Назад
						</Button>
						<span className={styles.muted}>
							Страница {page} из{' '}
							{Math.max(1, Math.ceil(directory.data.total / 30))}
						</span>
						<Button
							variant="secondary"
							disabled={
								page * 30 >= directory.data.total || directory.isFetching
							}
							onClick={() => setPage(value => value + 1)}
						>
							Далее
						</Button>
					</div>
				</>
			)}
			{editing ? (
				<DirectoryEditor
					key={editing.id}
					context={context}
					initial={editing}
					onClose={() => setEditing(null)}
					onRefresh={async () => {
						const fresh = await directory.refetch()
						return (
							fresh.data?.items.find(item => item.id === editing.id) ??
							null
						)
					}}
				/>
			) : null}
		</div>
	)
}

function DirectoryEditor({
	context,
	initial,
	onClose,
	onRefresh
}: {
	context: CollaborationContext
	initial: DirectoryEntry
	onClose: () => void
	onRefresh: () => Promise<DirectoryEntry | null>
}) {
	const [entry, setEntry] = useState(initial)
	const [fields, setFields] = useState<DirectoryFields>(initial.fields)
	const dirty = useDirtyValue(fields, 'Контакты сотрудника')
	type EditCommand = DirectoryCommand & {
		action: 'update' | 'archive' | 'restore'
		fields: DirectoryFields
	}
	const command = useCollaborationCommand(
		context,
		`directory:${entry.id}`,
		(token: string, value: EditCommand) => {
			if (value.action === 'archive')
				return archiveDirectoryEntry(token, value)
			if (value.action === 'restore')
				return restoreDirectoryEntry(token, value)
			return updateDirectoryEntry(token, value)
		},
		result => {
			dirty.resetBaseline(result.item.fields)
			toast.success('Карточка сохранена')
			onClose()
		}
	)
	const completeNameRequired =
		!!entry.subject &&
		(entry.status === 'ACTIVE' || entry.status === 'DISABLED') &&
		!!entry.fields.firstName &&
		!!entry.fields.lastName
	const blocked = command.locked || !context.canWrite
	const execute = (action: EditCommand['action']) =>
		void command.execute(() => ({
			...context.binding,
			commandId: crypto.randomUUID(),
			entryId: entry.id,
			expectedVersion: entry.version,
			action,
			fields: Object.fromEntries(
				fieldNames.map(name => [name, fields[name]?.trim() || null])
			) as unknown as DirectoryFields
		}))
	return (
		<Drawer
			isOpen
			title={entry.displayName}
			description="Изменения видны всем сотрудникам пространства."
			onClose={onClose}
			dirtyFormIds={[dirty.id]}
			size="lg"
		>
			<form
				className={styles.stack}
				onSubmit={event => {
					event.preventDefault()
					if (!blocked && entry.canEdit) execute('update')
				}}
			>
				<div className={styles.fields}>
					{fieldNames.map(name => (
						<TextField
							key={name}
							label={labels[name]}
							value={fields[name] ?? ''}
							type={
								name === 'email'
									? 'email'
									: name === 'phone'
										? 'tel'
										: 'text'
							}
							maxLength={limits[name]}
							required={
								completeNameRequired &&
								(name === 'firstName' || name === 'lastName')
							}
							disabled={blocked || !entry.canEdit}
							onChange={event => {
								command.reset()
								setFields(value => ({
									...value,
									[name]: event.target.value || null
								}))
							}}
						/>
					))}
				</div>
				<p className={styles.muted}>
					Рабочая почта в карточке не меняет адрес входа или приглашения.
				</p>
				<CommandNotice command={command} />
				{command.error?.kind === 'conflict' && !command.uncertain ? (
					<p className={styles.muted}>
						Карточка могла измениться. Загрузите актуальные данные перед
						повторным сохранением.
					</p>
				) : null}
				{command.error && !command.uncertain ? (
					<Button
						variant="secondary"
						disabled={command.running}
						onClick={() =>
							dirty.confirmDiscard(() => {
								void onRefresh().then(fresh => {
									if (fresh) {
										setEntry(fresh)
										setFields(fresh.fields)
										dirty.resetBaseline(fresh.fields)
										command.reset()
									} else
										toast.error(
											'Карточка недоступна. Закройте редактор и обновите список.'
										)
								})
							})
						}
					>
						Загрузить актуальную карточку
					</Button>
				) : null}
				<div className={styles.actions}>
					<Button type="submit" disabled={blocked || !entry.canEdit}>
						Сохранить
					</Button>
					{entry.canArchive ? (
						<Button
							variant={entry.archivedAt ? 'secondary' : 'danger'}
							disabled={blocked}
							onClick={() =>
								dirty.confirmDiscard(() =>
									execute(entry.archivedAt ? 'restore' : 'archive')
								)
							}
						>
							{entry.archivedAt
								? 'Вернуть в справочник'
								: 'Убрать в архив'}
						</Button>
					) : null}
				</div>
				{entry.canArchive ? (
					<p className={styles.muted}>
						Архивирование скрывает карточку. Доступ сотрудника к
						пространству и переписка сохраняются.
					</p>
				) : null}
			</form>
		</Drawer>
	)
}
