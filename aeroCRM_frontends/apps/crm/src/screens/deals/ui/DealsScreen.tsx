'use client'

import { useDirtyFormGuard } from '@/shared/lib/dirty-form'
import { SavedViewsControl } from '@/features/manage-saved-views/ui/SavedViewsControl'
import type { SavedDealParameters } from '@/entities/crm-saved-views'

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
	HelpHint,
	PageHeader,
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
import { ImportRecordsControl } from '@/features/import-records/ui/ImportRecordsControl'
import { useSalesAssignees } from '@/features/manage-sales/model/use-sales-assignees'
import { isUuidV4 } from '@/shared/lib/contract'
import { DealPipelineBoard } from './DealPipelineBoard'
import { PipelineManager } from '@/features/manage-sales/ui/PipelineManager'
import { CommerceExportControl } from '@/features/manage-sales/ui/CommerceExportControl'
import {
	defaultDealView,
	dealViewFromSearch,
	sameDealView,
	readStoredDealViews,
	writeDealViewLocation,
	requestDealFilters,
	savedDealParameters,
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
	const [legacyViews, setLegacyViews] = useState(stored.saved)
	const [page, setPage] = useState(1)
	const { search, pipelineId, status, withoutNextAction, layout } = filters
	const [searchInput, setSearchInput] = useState(search)
	const selectedValue = new URLSearchParams(routeSearch).get('dealId')
	const selected = isUuidV4(selectedValue) ? selectedValue : null
	const [createOpen, setCreateOpen] = useState(false)
	const [pipelinesOpen, setPipelinesOpen] = useState(false)
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
	const draftGuard = useDirtyFormGuard()
	const setSelected = (id: string | null) =>
		draftGuard.confirmDiscard(() => writeDealViewLocation(filters, id))
	const setFilters = (next: DealView) =>
		writeDealViewLocation(next, selected)
	const updateFilters = (patch: Partial<DealView>) => {
		setFilters({ ...filters, ...patch })
		setPage(1)
	}

	useEffect(() => {
		try {
			window.localStorage.setItem(
				storageKey,
				JSON.stringify({ last: filters, saved: legacyViews })
			)
		} catch {
			/* Browsers can disable storage; current filters remain usable. */
		}
	}, [filters, legacyViews, storageKey])

	const applyView = (next: DealView) => {
		setFilters(next)
		setSearchInput(next.search)
		setPage(1)
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
	const hasFilters = Boolean(
		search ||
		pipelineId ||
		status ||
		withoutNextAction ||
		filters.assignedToSubject ||
		filters.overdue ||
		filters.stageId ||
		filters.createdFrom ||
		filters.createdTo
	)
	const canCreate =
		context.canWrite &&
		context.permissions.data?.permissions.includes('customers:read') &&
		!pipelines.isError &&
		!pipelines.isFetching &&
		!!pipelines.data?.length
	const resetFilters = () =>
		applyView({
			...defaultDealView,
			layout,
			pipelineId: layout === 'board' ? pipelineId : ''
		})
	const activeChips: { id: string; label: string; remove: () => void }[] =
		[]
	if (search)
		activeChips.push({
			id: 'search',
			label: `Поиск: ${search}`,
			remove: () => applyView({ ...filters, search: '' })
		})
	if (pipelineId && layout === 'list')
		activeChips.push({
			id: 'pipeline',
			label: `Воронка: ${activePipeline?.name ?? 'выбрана'}`,
			remove: () => updateFilters({ pipelineId: '', stageId: undefined })
		})
	if (status)
		activeChips.push({
			id: 'status',
			label: `Статус: ${{ OPEN: 'В работе', WON: 'Успешно', LOST: 'Отказ' }[status] ?? status}`,
			remove: () => updateFilters({ status: '', stageId: undefined })
		})
	if (filters.stageId)
		activeChips.push({
			id: 'stage',
			label: `Этап: ${activePipeline?.stages.find(stage => stage.id === filters.stageId)?.name ?? 'выбран'}`,
			remove: () => updateFilters({ stageId: undefined })
		})
	if (filters.assignedToSubject)
		activeChips.push({
			id: 'assignee',
			label:
				filters.assignedToSubject === context.session?.userId
					? 'Мои сделки'
					: 'Выбран сотрудник',
			remove: () => updateFilters({ assignedToSubject: undefined })
		})
	if (withoutNextAction)
		activeChips.push({
			id: 'withoutNextAction',
			label: 'Без следующего действия',
			remove: () => updateFilters({ withoutNextAction: false })
		})
	if (filters.overdue)
		activeChips.push({
			id: 'overdue',
			label: 'Просроченные',
			remove: () =>
				updateFilters({ overdue: undefined, overdueBefore: undefined })
		})
	if (filters.overdueBefore)
		activeChips.push({
			id: 'overdueBefore',
			label: `Просрочка до: ${new Date(filters.overdueBefore).toLocaleDateString('ru-RU')}`,
			remove: () => updateFilters({ overdueBefore: undefined })
		})
	if (filters.createdFrom || filters.createdTo)
		activeChips.push({
			id: 'createdPeriod',
			label: `Дата создания: ${filters.createdFrom ? new Date(filters.createdFrom).toLocaleDateString('ru-RU') : 'начала'} — ${filters.createdTo ? new Date(Date.parse(filters.createdTo) - 1).toLocaleDateString('ru-RU') : 'сегодня'}`,
			remove: () =>
				updateFilters({ createdFrom: undefined, createdTo: undefined })
		})
	if (filters.sort && filters.sort !== 'created_desc')
		activeChips.push({
			id: 'sort',
			label: `Порядок: ${{ updated_desc: 'недавно изменённые', amount_desc: 'по сумме', next_action_asc: 'по сроку действия' }[filters.sort]}`,
			remove: () => updateFilters({ sort: 'created_desc' })
		})
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
				description={
					<HelpHint
						label="Сделки"
						description="Воронка показывает этапы работы с клиентом. Следующее действие — отдельная задача с ответственным и сроком; закрытие сделки не заменяет учёт оплаты."
					>
						Клиенты, этапы продаж и следующее действие по каждой открытой
						сделке.
					</HelpHint>
				}
				actions={
					<>
						<ImportRecordsControl entity="deals" />
						{context.canWrite &&
							context.permissions.data?.permissions.includes(
								'sales:manage-pipelines'
							) && (
								<Button
									variant="secondary"
									onClick={() => setPipelinesOpen(true)}
								>
									Управление воронками
								</Button>
							)}
						<ActionMenu>
							<ExportRecordsControl entity="deals" />
							<CommerceExportControl />
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
					<div className={styles.toolbar}>
						<div
							className={styles.quickViews}
							aria-label="Быстрые представления сделок"
						>
							<Button
								size="sm"
								variant="secondary"
								onClick={() => applyView(defaultDealView)}
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
									applyView({
										...defaultDealView,
										layout,
										pipelineId: layout === 'board' ? pipelineId : '',
										assignedToSubject: context.session?.userId,
										status: 'OPEN'
									})
								}
							>
								Мои сделки
							</Button>
							<Button
								size="sm"
								variant="secondary"
								aria-pressed={!!filters.overdue}
								onClick={() =>
									applyView({
										...defaultDealView,
										layout,
										pipelineId: layout === 'board' ? pipelineId : '',
										overdue: true,
										status: 'OPEN',
										sort: 'next_action_asc'
									})
								}
							>
								Просроченные
							</Button>
							<Button
								size="sm"
								variant="secondary"
								aria-pressed={withoutNextAction}
								onClick={() =>
									applyView({
										...defaultDealView,
										layout,
										pipelineId: layout === 'board' ? pipelineId : '',
										withoutNextAction: true,
										status: 'OPEN'
									})
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
							labelHelp={
								<HelpHint
									label="Воронка сделок"
									description="Воронка задаёт набор этапов работы. На доске сделки группируются по этапам выбранной воронки."
								/>
							}
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
							<summary>Дополнительные фильтры</summary>
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
								<label className={styles.nextActionFilter}>
									<input
										type="checkbox"
										checked={withoutNextAction}
										disabled={!context.canRead}
										onChange={event => {
											if (!context.canRead) return
											const enabled = event.target.checked
											updateFilters({ withoutNextAction: enabled })
										}}
									/>
									<span>Без следующего действия</span>
								</label>
							</div>
						</details>
					</form>
					<SavedViewsControl
						context={context}
						scope="DEALS"
						parameters={savedDealParameters(filters)}
						onOpen={parameters =>
							applyView(parameters as SavedDealParameters)
						}
						legacy={legacyViews.map(view => ({
							id: view.id,
							name: view.name,
							parameters: savedDealParameters(view.filters)
						}))}
						onImported={() => setLegacyViews([])}
					/>

					{activeChips.length ? (
						<div
							className={styles.activeFilters}
							aria-label="Применённые фильтры сделок"
						>
							{activeChips.map(chip => (
								<Button
									key={chip.id}
									size="sm"
									variant="secondary"
									onClick={chip.remove}
									aria-label={`Убрать фильтр: ${chip.label}`}
								>
									{chip.label}
									<AppIcon name="close" size={14} />
								</Button>
							))}
							<Button size="sm" variant="ghost" onClick={resetFilters}>
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
								hasFilters
									? 'Подходящих сделок нет'
									: canCreate
										? 'Создайте первую сделку'
										: 'Сделок пока нет'
							}
							description={
								hasFilters
									? 'Измените или сбросьте фильтры, чтобы увидеть другие сделки.'
									: canCreate
										? 'Выберите контакт, сумму и первое действие — и начните работу с клиентом.'
										: 'Здесь появятся доступные вам сделки. Сейчас создание сделки недоступно.'
							}
							action={
								hasFilters ? (
									<Button variant="secondary" onClick={resetFilters}>
										Сбросить фильтры
									</Button>
								) : canCreate ? (
									<Button
										tooltip="Выбрать клиента, сумму сделки и первое действие по ней"
										disabledTooltip="Для новой сделки нужны права изменения сделок, просмотра контактов и доступная воронка."
										disabled={!context.canWrite || !pipelines.data?.length}
										onClick={() => setCreateOpen(true)}
									>
										Новая сделка
									</Button>
								) : undefined
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
			{pipelinesOpen && (
				<PipelineManager
					context={context}
					onClose={() => setPipelinesOpen(false)}
					onSaved={saved}
				/>
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
