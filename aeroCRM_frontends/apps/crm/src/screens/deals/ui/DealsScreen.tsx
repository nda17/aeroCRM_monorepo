'use client'

import {
	listSalesDeals,
	listSalesPipelines,
	type SalesDeal
} from '@/entities/sales'
import {
	CreateDealDrawer,
	DealDetailsDrawer,
	salesDate,
	salesMoney,
	useSalesSession
} from '@/features/manage-sales'
import {
	ActionMenu,
	AppIcon,
	Button,
	DataTable,
	PageHeader,
	ReadOnlyBanner,
	ScreenState,
	SelectField,
	StatusBadge,
	TextField,
	type DataTableColumn
} from '@/shared/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
	Suspense,
	useEffect,
	useState,
	useSyncExternalStore,
	type FormEvent
} from 'react'
import toast from 'react-hot-toast'
import { useSearchParams } from 'next/navigation'
import styles from './DealsScreen.module.scss'
import { ExportRecordsControl } from '@/features/export-records'
import { useSalesAssignees } from '@/features/manage-sales/model/use-sales-assignees'
import { isUuidV4 } from '@/shared/lib/contract'
import { DealPipelineBoard } from './DealPipelineBoard'
import {
	defaultDealView,
	dealViewFromSearch,
	sameDealView,
	readStoredDealViews,
	writeDealViewLocation,
	requestDealFilters,
	type DealView
} from './deal-views'

const subscribe = () => () => {}
const clientSnapshot = () => true
const serverSnapshot = () => false

const DealsWorkspaceScreen = ({
	context
}: {
	context: ReturnType<typeof useSalesSession>
}) => {
	const queryClient = useQueryClient()
	const routeSearch = useSearchParams().toString()
	const storageKey = `crm:deal-views:v1:${context.workspace.workspaceId}:${context.session?.userId}`
	const [stored] = useState(() => readStoredDealViews(storageKey))
	const [routeView, setRouteView] = useState(() => ({
		search: routeSearch,
		filters: dealViewFromSearch(routeSearch, stored.last)
	}))
	const filters = routeView.filters
	const [savedViews, setSavedViews] = useState(stored.saved)
	const [viewName, setViewName] = useState('')
	const [savingView, setSavingView] = useState(false)
	const [page, setPage] = useState(1)
	const { search, pipelineId, status, withoutNextAction, layout } = filters
	const [searchInput, setSearchInput] = useState(search)
	const selectedValue = new URLSearchParams(routeSearch).get('dealId')
	const selected = isUuidV4(selectedValue) ? selectedValue : null
	const [createOpen, setCreateOpen] = useState(false)
	// Next client navigation can reactivate this screen with previous React state.
	// The route is the source of filters; UI actions only update that route.
	if (routeView.search !== routeSearch) {
		const next = dealViewFromSearch(routeSearch)
		setRouteView({ search: routeSearch, filters: next })
		if (!sameDealView(filters, next)) {
			setSearchInput(next.search)
			setPage(1)
		}
	}
	const setSelected = (id: string | null) =>
		writeDealViewLocation(filters, id)
	const setFilters = (next: DealView) =>
		writeDealViewLocation(next, selected)
	const updateFilters = (patch: Partial<DealView>) => {
		setFilters({ ...filters, ...patch })
		setPage(1)
	}
	const persistViews = (next = savedViews) => {
		try {
			window.localStorage.setItem(
				storageKey,
				JSON.stringify({ last: filters, saved: next })
			)
			return true
		} catch {
			return false
		}
	}
	useEffect(() => {
		try {
			window.localStorage.setItem(
				storageKey,
				JSON.stringify({ last: filters, saved: savedViews })
			)
		} catch {
			/* Browsers can disable storage; current filters remain usable. */
		}
	}, [filters, savedViews, storageKey])

	const applyView = (next: DealView, name: string) => {
		setFilters(next)
		setSearchInput(next.search)
		setPage(1)
		toast(`Представление «${name}» открыто`)
	}
	const pipelines = useQuery({
		queryKey: ['sales', 'pipelines', ...context.key],
		enabled: context.canRead && !!context.session,
		queryFn: () =>
			listSalesPipelines(
				context.session!.accessToken,
				context.workspace.workspaceId
			),
		retry: false,
		gcTime: 0
	})
	const deals = useQuery({
		queryKey: [
			'sales',
			'deals',
			...context.key,
			page,
			search,
			pipelineId,
			status,
			filters
		],
		enabled: context.canRead && !!context.session && layout === 'list',
		queryFn: () =>
			listSalesDeals(
				context.session!.accessToken,
				context.workspace.workspaceId,
				page,
				20,
				search,
				pipelineId,
				status,
				withoutNextAction,
				requestDealFilters(filters)
			),
		retry: false,
		gcTime: 0
	})
	const assigneeLabel = useSalesAssignees(
		context,
		layout === 'list' && !deals.isError
			? (deals.data?.items.map(deal => deal.assignedToSubject) ?? [])
			: []
	)
	const activePipeline = pipelines.data?.find(
		item => item.id === pipelineId
	)
	const emptyPage =
		!!deals.data && deals.data.total > 0 && deals.data.items.length === 0
	const reload = async () => {
		const result = await Promise.all([
			context.permissions.refetch(),
			pipelines.refetch(),
			...(layout === 'list' ? [deals.refetch()] : [])
		])
		if (layout === 'board')
			await queryClient.invalidateQueries({
				queryKey: ['sales', 'deals', 'stage']
			})
		if (result.every(item => !item.isError)) {
			toast.success('Данные обновлены')
		} else toast.error('Не удалось обновить данные')
	}
	const saved = () => {
		void queryClient.invalidateQueries({ queryKey: ['sales'] })
	}
	const submitSearch = (event: FormEvent) => {
		event.preventDefault()
		updateFilters({ search: searchInput.trim() })
		toast('Поиск применён')
	}
	const columns: DataTableColumn<SalesDeal>[] = [
		{
			id: 'deal',
			header: 'Сделка / клиент',
			render: deal => (
				<button
					type="button"
					className={styles.record}
					onClick={() => setSelected(deal.id)}
				>
					<strong>{deal.title}</strong>
					<span>{deal.contactName}</span>
				</button>
			)
		},
		{
			id: 'stage',
			header: 'Этап',
			render: deal => (
				<StatusBadge
					tone={
						deal.status === 'WON'
							? 'success'
							: deal.status === 'LOST'
								? 'danger'
								: 'info'
					}
				>
					{pipelines.data
						?.find(item => item.id === deal.pipelineId)
						?.stages.find(item => item.id === deal.stageId)?.name ||
						{ OPEN: 'В работе', WON: 'Успешно', LOST: 'Отказ' }[
							deal.status
						]}
				</StatusBadge>
			)
		},
		{
			id: 'amount',
			header: 'Сумма',
			render: deal => salesMoney(deal.amountMinor),
			align: 'right'
		},
		{
			id: 'assignee',
			header: 'Ответственный',
			render: deal => assigneeLabel(deal.assignedToSubject)
		},
		{
			id: 'next',
			header: 'Следующее действие',
			render: deal =>
				deal.nextTask ? (
					<div className={styles.copy}>
						<strong>{deal.nextTask.title}</strong>
						<span>{salesDate(deal.nextTask.dueAt)}</span>
						{Date.parse(deal.nextTask.dueAt) < Date.now() ? (
							<StatusBadge tone="danger">Просрочено</StatusBadge>
						) : null}
					</div>
				) : (
					<span className={styles.muted}>
						{deal.status === 'OPEN'
							? 'Нет следующего действия'
							: 'Сделка закрыта'}
					</span>
				)
		}
	]
	return (
		<div className={styles.screen}>
			<PageHeader
				title="Сделки"
				description="Клиенты, этапы продаж и следующее действие по каждой открытой сделке."
				actions={
					<>
						<ActionMenu>
							<ExportRecordsControl entity="deals" />
							<Button
								variant="secondary"
								tooltip="Загрузить актуальные сделки, этапы воронок и права доступа"
								onClick={() => void reload()}
								leadingIcon={<AppIcon name="refresh" size={18} />}
							>
								Обновить
							</Button>
						</ActionMenu>
						<Button
							tooltip="Выбрать клиента, сумму сделки и первое действие по ней"
							disabledTooltip="Для новой сделки нужны права изменения сделок, просмотра контактов и доступная воронка."
							disabled={
								!context.canWrite ||
								!context.permissions.data?.permissions.includes(
									'customers:read'
								) ||
								pipelines.isError ||
								pipelines.isFetching ||
								!pipelines.data?.length
							}
							onClick={() => setCreateOpen(true)}
							leadingIcon={<AppIcon name="plus" size={18} />}
						>
							Новая сделка
						</Button>
					</>
				}
			/>
			{context.permissions.isError ? (
				<ScreenState
					variant="error"
					description="Не удалось проверить права. Данные скрыты до успешной проверки."
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
					description="Ваша роль не даёт доступа к карточкам сделок. Аналитика доступна в отдельном разделе."
				/>
			) : (
				<>
					{!context.workspace.canWrite ||
					context.permissions.data?.state === 'READ_ONLY' ? (
						<ReadOnlyBanner description="Вы можете просматривать сделки и историю. Изменения возобновятся после активации подписки." />
					) : null}
					<div className={styles.toolbar}>
						<div
							className={styles.quickViews}
							aria-label="Быстрые представления сделок"
						>
							<Button
								size="sm"
								variant="secondary"
								onClick={() => applyView(defaultDealView, 'Все сделки')}
							>
								Все сделки
							</Button>
							<Button
								size="sm"
								variant="secondary"
								aria-pressed={
									filters.assignedToSubject === context.session?.userId
								}
								onClick={() =>
									applyView(
										{
											...defaultDealView,
											layout,
											pipelineId: layout === 'board' ? pipelineId : '',
											assignedToSubject: context.session?.userId,
											status: 'OPEN'
										},
										'Мои сделки'
									)
								}
							>
								Мои сделки
							</Button>
							<Button
								size="sm"
								variant="secondary"
								aria-pressed={!!filters.overdue}
								onClick={() =>
									applyView(
										{
											...defaultDealView,
											layout,
											pipelineId: layout === 'board' ? pipelineId : '',
											overdue: true,
											status: 'OPEN',
											sort: 'next_action_asc'
										},
										'Просроченные'
									)
								}
							>
								Просроченные
							</Button>
							<Button
								size="sm"
								variant="secondary"
								aria-pressed={withoutNextAction}
								onClick={() =>
									applyView(
										{
											...defaultDealView,
											layout,
											pipelineId: layout === 'board' ? pipelineId : '',
											withoutNextAction: true,
											status: 'OPEN'
										},
										'Без следующего действия'
									)
								}
							>
								Без следующего действия
							</Button>
						</div>
						<div className={styles.layoutToggle} aria-label="Вид сделок">
							<Button
								size="sm"
								variant={layout === 'list' ? 'primary' : 'secondary'}
								aria-pressed={layout === 'list'}
								onClick={() => {
									updateFilters({ layout: 'list' })
									toast('Сделки: список')
								}}
							>
								Список
							</Button>
							<Button
								size="sm"
								variant={layout === 'board' ? 'primary' : 'secondary'}
								aria-pressed={layout === 'board'}
								disabled={!pipelines.data?.length}
								onClick={() => {
									updateFilters({
										layout: 'board',
										pipelineId: pipelineId || pipelines.data?.[0]?.id || ''
									})
									toast('Сделки: воронка')
								}}
							>
								Воронка
							</Button>
						</div>
					</div>
					<form className={styles.filters} onSubmit={submitSearch}>
						<TextField
							label="Поиск по сделке или клиенту"
							value={searchInput}
							onChange={event => setSearchInput(event.target.value)}
							maxLength={200}
						/>
						<SelectField
							label="Воронка"
							value={pipelineId}
							onChange={event => {
								updateFilters({
									pipelineId: event.target.value,
									stageId: undefined
								})
							}}
							disabled={pipelines.isError || pipelines.isFetching}
						>
							{layout === 'list' ? (
								<option value="">Все воронки</option>
							) : (
								<option value="" disabled>
									Выберите воронку
								</option>
							)}
							{pipelines.data?.map(item => (
								<option key={item.id} value={item.id}>
									{item.name}
								</option>
							))}
						</SelectField>
						<SelectField
							label="Статус"
							value={status}
							onChange={event => {
								updateFilters({
									status: event.target.value,
									stageId: undefined
								})
							}}
						>
							<option value="">Все статусы</option>
							<option value="OPEN">В работе</option>
							<option value="WON">Успешно</option>
							<option value="LOST">Отказ</option>
						</SelectField>
						<Button
							type="submit"
							variant="secondary"
							tooltip="Найти сделки по введённому запросу с учётом выбранных фильтров"
						>
							Найти
						</Button>
						<details className={styles.moreFilters}>
							<summary>Фильтры и сохранённые виды</summary>
							<div className={styles.filterOptions}>
								<SelectField
									label="Сортировка"
									value={filters.sort}
									onChange={event =>
										updateFilters({
											sort: event.target.value as DealView['sort']
										})
									}
								>
									<option value="created_desc">Сначала новые</option>
									<option value="updated_desc">Недавно изменённые</option>
									<option value="amount_desc">По убыванию суммы</option>
									<option value="next_action_asc">
										По сроку действия
									</option>
								</SelectField>
								<div className={styles.savedViews}>
									<SelectField
										label="Сохранённые представления"
										value=""
										onChange={event => {
											const savedView = savedViews.find(
												view => view.id === event.target.value
											)
											if (savedView)
												applyView(savedView.filters, savedView.name)
										}}
									>
										<option value="">Выберите представление</option>
										{savedViews.map(view => (
											<option key={view.id} value={view.id}>
												{view.name}
											</option>
										))}
									</SelectField>
									<Button
										size="sm"
										variant="ghost"
										onClick={() => setSavingView(value => !value)}
									>
										{savingView ? 'Скрыть' : 'Сохранить вид'}
									</Button>
								</div>
								<label className={styles.nextActionFilter}>
									<input
										type="checkbox"
										checked={withoutNextAction}
										disabled={!context.canRead}
										onChange={event => {
											if (!context.canRead) return
											const enabled = event.target.checked
											updateFilters({ withoutNextAction: enabled })
											toast(
												enabled
													? 'Фильтр «Без следующего действия» включён'
													: 'Фильтр «Без следующего действия» выключен'
											)
										}}
									/>
									<span>Без следующего действия</span>
								</label>
							</div>
						</details>
					</form>
					{savingView ? (
						<form
							className={styles.saveViewForm}
							onSubmit={event => {
								event.preventDefault()
								const name = viewName.trim()
								if (!name) return
								if (
									savedViews.length >= 10 &&
									!savedViews.some(view => view.name === name)
								) {
									toast.error('Можно сохранить до 10 представлений')
									return
								}
								const existing = savedViews.find(
									view => view.name === name
								)
								const next = [
									...savedViews.filter(view => view.name !== name),
									{
										id: existing?.id || crypto.randomUUID(),
										name,
										filters
									}
								]
								if (!persistViews(next)) {
									toast.error(
										'Браузер не разрешил сохранить представление'
									)
									return
								}
								setSavedViews(next)
								setViewName('')
								setSavingView(false)
								toast.success('Представление сохранено в этом браузере')
							}}
						>
							<TextField
								label="Название представления"
								value={viewName}
								onChange={event => setViewName(event.target.value)}
								maxLength={60}
								required
								placeholder="Например, мои крупные сделки"
							/>
							<Button type="submit" size="sm">
								Сохранить представление
							</Button>
							{savedViews.length ? (
								<SelectField
									label="Удалить представление"
									value=""
									onChange={event => {
										const next = savedViews.filter(
											view => view.id !== event.target.value
										)
										if (!persistViews(next)) {
											toast.error('Не удалось сохранить изменение')
											return
										}
										setSavedViews(next)
										toast.success('Представление удалено')
									}}
								>
									<option value="">Выберите для удаления</option>
									{savedViews.map(view => (
										<option key={view.id} value={view.id}>
											{view.name}
										</option>
									))}
								</SelectField>
							) : null}
						</form>
					) : null}
					{filters.createdFrom ||
					filters.createdTo ||
					filters.stageId ||
					filters.assignedToSubject ||
					filters.overdue ? (
						<div className={styles.activeFilters}>
							<span>
								{filters.createdFrom && filters.createdTo
									? `Дата создания: ${new Date(filters.createdFrom).toLocaleDateString('ru-RU')} — ${new Date(Date.parse(filters.createdTo) - 1).toLocaleDateString('ru-RU')}. `
									: ''}
								{filters.assignedToSubject
									? filters.assignedToSubject === context.session?.userId
										? 'Только мои сделки. '
										: 'Выбран сотрудник. '
									: ''}
								{filters.overdue ? 'Есть просроченное действие. ' : ''}
								{filters.stageId ? 'Выбран этап. ' : ''}
							</span>
							<Button
								size="sm"
								variant="ghost"
								onClick={() =>
									applyView(
										{
											...defaultDealView,
											layout,
											pipelineId: layout === 'board' ? pipelineId : ''
										},
										'Все сделки'
									)
								}
							>
								Сбросить фильтры
							</Button>
						</div>
					) : null}

					{pipelines.isError || (layout === 'list' && deals.isError) ? (
						<ScreenState
							variant="error"
							description="Не удалось загрузить актуальные сделки и этапы."
							action={
								<Button onClick={() => void reload()}>Повторить</Button>
							}
						/>
					) : pipelines.isPending ? (
						<ScreenState variant="loading" />
					) : layout === 'board' ? (
						activePipeline ? (
							<DealPipelineBoard
								context={context}
								pipeline={activePipeline}
								filters={filters}
								onSelect={setSelected}
							/>
						) : (
							<ScreenState
								variant="empty"
								title="Выберите воронку"
								description="Выберите воронку в фильтре, чтобы увидеть сделки по этапам."
							/>
						)
					) : deals.isPending || !deals.data ? (
						<ScreenState variant="loading" />
					) : emptyPage ? (
						<ScreenState
							variant="empty"
							title="На этой странице больше нет сделок"
							description="Список изменился. Подходящие сделки есть на других страницах — вернитесь на первую страницу."
							action={
								<Button
									disabled={!context.canRead || deals.isFetching}
									onClick={() => {
										if (!context.canRead || deals.isFetching) return
										if (page === 1) void deals.refetch()
										else setPage(1)
										toast('Переход на первую страницу сделок')
									}}
								>
									На первую страницу
								</Button>
							}
						/>
					) : deals.data.total === 0 ? (
						<ScreenState
							variant="empty"
							title={
								search ||
								status ||
								pipelineId ||
								withoutNextAction ||
								filters.assignedToSubject ||
								filters.overdue ||
								filters.stageId ||
								filters.createdFrom
									? 'Подходящих сделок нет'
									: 'Создайте первую сделку'
							}
							description={
								withoutNextAction
									? 'Нет открытых сделок без запланированных задач по выбранным условиям. Измените фильтры, чтобы увидеть другие сделки.'
									: 'Выберите контакт, сумму и первое действие — и начните работу с клиентом.'
							}
							action={
								<Button
									tooltip="Выбрать клиента, сумму сделки и первое действие по ней"
									disabledTooltip="Для новой сделки нужны права изменения сделок, просмотра контактов и доступная воронка."
									disabled={!context.canWrite || !pipelines.data?.length}
									onClick={() => setCreateOpen(true)}
								>
									Новая сделка
								</Button>
							}
						/>
					) : (
						<DataTable
							mobileLayout="cards"
							caption="Сделки компании"
							rows={deals.data.items}
							columns={columns}
							getRowKey={deal => deal.id}
							onRowClick={deal => setSelected(deal.id)}
						/>
					)}
					{layout === 'list' && deals.data && !deals.isError ? (
						<div className={styles.pagination}>
							<span>
								Всего {deals.data.total} ·{' '}
								{emptyPage
									? `страница ${page} больше не содержит сделок`
									: `страница ${page}`}
							</span>
							<div className={styles.actions}>
								<Button
									variant="secondary"
									size="sm"
									disabled={page === 1 || deals.isFetching}
									onClick={() => setPage(value => value - 1)}
								>
									Назад
								</Button>
								<Button
									variant="secondary"
									size="sm"
									disabled={
										page * 20 >= deals.data.total || deals.isFetching
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
			{createOpen && pipelines.data ? (
				<CreateDealDrawer
					key={context.key.join(':')}
					pipelines={pipelines.data}
					onClose={() => setCreateOpen(false)}
					onSaved={saved}
				/>
			) : null}
			{selected ? (
				<DealDetailsDrawer
					key={`${context.key.join(':')}:${selected}`}
					id={selected}
					pipelines={pipelines.isError ? [] : pipelines.data || []}
					onClose={() => setSelected(null)}
					onSaved={saved}
				/>
			) : null}
		</div>
	)
}

const DealsScreen = () => {
	const context = useSalesSession()
	const hydrated = useSyncExternalStore(
		subscribe,
		clientSnapshot,
		serverSnapshot
	)
	return hydrated ? (
		<Suspense fallback={<ScreenState variant="loading" />}>
			<DealsWorkspaceScreen
				key={context.key.join(':')}
				context={context}
			/>
		</Suspense>
	) : (
		<ScreenState variant="loading" />
	)
}

export default DealsScreen
