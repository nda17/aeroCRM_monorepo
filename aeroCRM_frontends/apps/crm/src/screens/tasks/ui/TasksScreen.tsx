'use client'

import { listSalesTasks, type SalesTask } from '@/entities/sales'
import {
	CompleteTaskDrawer,
	salesDate,
	useSalesSession
} from '@/features/manage-sales'
import {
	Button,
	DataTable,
	PageHeader,
	ReadOnlyBanner,
	ScreenState,
	StatusBadge,
	TextField,
	type DataTableColumn
} from '@/shared/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import styles from './TasksScreen.module.scss'
import { ExportRecordsControl } from '@/features/export-records'

const TasksScreen = () => {
	const context = useSalesSession()
	const queryClient = useQueryClient()
	const [page, setPage] = useState(1)
	const [searchInput, setSearchInput] = useState('')
	const [search, setSearch] = useState('')
	const [selected, setSelected] = useState<SalesTask | null>(null)
	const tasks = useQuery({
		queryKey: ['sales', 'tasks', ...context.key, page, search],
		enabled: context.canRead && !!context.session,
		queryFn: () =>
			listSalesTasks(
				context.session!.accessToken,
				context.workspace.workspaceId,
				page,
				20,
				search
			),
		retry: false,
		gcTime: 0
	})
	const reload = async () => {
		const [auth, list] = await Promise.all([
			context.permissions.refetch(),
			tasks.refetch()
		])
		if (auth.isError || list.isError)
			toast.error('Не удалось обновить список')
		else toast.success('Список обновлён')
	}
	const submit = (event: FormEvent) => {
		event.preventDefault()
		setPage(1)
		setSearch(searchInput.trim())
	}
	const columns: DataTableColumn<SalesTask>[] = [
		{
			id: 'title',
			header: 'Действие',
			render: task => (
				<strong className={styles.title}>{task.title}</strong>
			)
		},
		{
			id: 'due',
			header: 'Срок',
			render: task => (
				<div className={styles.copy}>
					<span>{salesDate(task.dueAt)}</span>
					<StatusBadge
						tone={Date.parse(task.dueAt) < Date.now() ? 'danger' : 'info'}
					>
						{Date.parse(task.dueAt) < Date.now()
							? 'Просрочено'
							: 'Запланировано'}
					</StatusBadge>
				</div>
			)
		},
		{
			id: 'owner',
			header: 'Ответственный',
			render: task =>
				task.assignedToSubject === context.permissions.data?.subject
					? 'Вы'
					: task.assignedToSubject
		},
		{
			id: 'action',
			header: 'Результат',
			render: task => (
				<Button
					size="sm"
					disabled={!context.canWrite || tasks.isFetching}
					tooltip="Указать результат действия по сделке и запланировать следующий шаг."
					disabledTooltip="Завершение доступно при правах на изменение после загрузки актуальных задач."
					onClick={() => setSelected(task)}
				>
					Завершить действие
				</Button>
			)
		}
	]
	return (
		<div className={styles.screen}>
			<PageHeader
				eyebrow="Следующие действия"
				title="Задачи"
				description="Ближайшие и просроченные действия по открытым сделкам. После завершения запланируйте следующий шаг."
				actions={
					<>
						<ExportRecordsControl entity="tasks" />
						<Button
							variant="secondary"
							tooltip="Получить актуальные задачи и их состояния с сервера."
							onClick={() => void reload()}
						>
							Обновить
						</Button>
					</>
				}
			/>
			{context.permissions.isError ? (
				<ScreenState
					variant="error"
					description="Не удалось проверить права. Список скрыт до успешной проверки."
					action={
						<Button onClick={() => void context.permissions.refetch()}>
							Повторить
						</Button>
					}
				/>
			) : context.permissions.isPending ? (
				<ScreenState variant="loading" />
			) : !context.canRead ? (
				<ScreenState
					variant="permission"
					description="Ваша роль не даёт доступа к задачам сотрудников."
				/>
			) : (
				<>
					{!context.workspace.canWrite ||
					context.permissions.data?.state === 'READ_ONLY' ? (
						<ReadOnlyBanner description="Задачи доступны для просмотра. Для изменений нужна действующая подписка." />
					) : null}
					<form className={styles.filters} onSubmit={submit}>
						<TextField
							label="Найти действие"
							value={searchInput}
							onChange={event => setSearchInput(event.target.value)}
							maxLength={200}
						/>
						<Button type="submit" variant="secondary">
							Найти
						</Button>
					</form>
					{tasks.isError ? (
						<ScreenState
							variant="error"
							action={
								<Button onClick={() => void reload()}>Повторить</Button>
							}
						/>
					) : tasks.isPending ? (
						<ScreenState variant="loading" />
					) : !tasks.data?.items.length ? (
						<ScreenState
							variant="empty"
							title="Открытых действий нет"
							description="Действия создаются вместе со сделками и при переходе на следующий этап."
						/>
					) : (
						<DataTable
							mobileLayout="cards"
							caption="Актуальные следующие действия"
							columns={columns}
							rows={tasks.data.items}
							getRowKey={task => task.id}
						/>
					)}
					{tasks.data && !tasks.isError ? (
						<div className={styles.pagination}>
							<span>
								Всего {tasks.data.total} · страница {page}
							</span>
							<div className={styles.actions}>
								<Button
									variant="secondary"
									size="sm"
									disabled={page === 1 || tasks.isFetching}
									onClick={() => setPage(value => value - 1)}
								>
									Назад
								</Button>
								<Button
									variant="secondary"
									size="sm"
									disabled={
										page * 20 >= tasks.data.total || tasks.isFetching
									}
									onClick={() => setPage(value => value + 1)}
								>
									Далее
								</Button>
							</div>
						</div>
					) : null}
				</>
			)}
			{selected ? (
				<CompleteTaskDrawer
					key={`${context.key.join(':')}:${selected.id}`}
					task={selected}
					onClose={() => setSelected(null)}
					onSaved={() => {
						void queryClient.invalidateQueries({ queryKey: ['sales'] })
					}}
				/>
			) : null}
		</div>
	)
}

export default TasksScreen
