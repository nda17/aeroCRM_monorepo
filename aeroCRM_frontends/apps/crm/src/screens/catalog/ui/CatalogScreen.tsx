'use client'

import {
	listCatalogItems,
	saveCatalogItem,
	updateCatalogItem,
	archiveCatalogItem
} from '@/entities/sales/api/commerce.api'
import { useSalesSession } from '@/features/manage-sales/model/use-sales-session'
import {
	useCommerceCommand,
	type CommerceContext
} from '@/features/manage-sales/model/use-commerce-command'
import {
	commerceFormError,
	moneyInput,
	parseMoneyInput
} from '@/features/manage-sales/model/commerce-form'
import { CommerceCommandState } from '@/features/manage-sales/ui/CommerceCommandState'
import { CatalogImportDrawer } from '@/features/manage-sales/ui/CatalogImportDrawer'
import { CommerceHistoryDrawer } from '@/features/manage-sales/ui/CommerceHistoryDrawer'
import { CommerceExportControl } from '@/features/manage-sales/ui/CommerceExportControl'
import { salesMoney } from '@/features/manage-sales/ui/DealDetailsDrawer'
import {
	ActionMenu,
	AppIcon,
	Button,
	DataTable,
	Drawer,
	HelpHint,
	PageHeader,
	ReadOnlyBanner,
	ScreenState,
	SelectField,
	StatusBadge,
	TextField,
	type DataTableColumn
} from '@/shared/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import styles from '@/features/manage-sales/ui/Commerce.module.scss'

type CatalogRecord = {
	id: string
	workspaceId: string
	code: string
	kind: 'PRODUCT' | 'SERVICE'
	name: string
	unit: string
	basePriceMinor: number | null
	version: number
	archivedAt: string | null
	createdAt: string
	updatedAt: string
}

type CatalogMutation =
	| {
			action: 'save'
			code?: string
			kind: 'PRODUCT' | 'SERVICE'
			name: string
			unit: string
			basePriceMinor: number | null
	  }
	| { action: 'archive' }

const CatalogEditor = ({
	context,
	item,
	onClose,
	onSaved
}: {
	context: CommerceContext
	item: CatalogRecord | null
	onClose: () => void
	onSaved: () => void
}) => {
	const [name, setName] = useState(item?.name || '')
	const [code, setCode] = useState(item?.code || '')
	const [kind, setKind] = useState<'PRODUCT' | 'SERVICE'>(
		item?.kind || 'PRODUCT'
	)
	const [unit, setUnit] = useState(item?.unit || 'шт.')
	const [price, setPrice] = useState(
		moneyInput(item?.basePriceMinor ?? null)
	)
	const [error, setError] = useState<string | null>(null)
	const [confirmArchive, setConfirmArchive] = useState(false)
	const command = useCommerceCommand<CatalogMutation, unknown>(
		context,
		`catalog:${item?.id || 'new'}`,
		(token, input) => {
			const { action, ...base } = input
			if (action === 'archive' && item)
				return archiveCatalogItem(token, item.id, {
					schemaVersion: 1,
					workspaceId: input.workspaceId,
					commandId: input.commandId,
					expectedVersion: item.version
				})
			if (action !== 'save')
				throw new Error('Не удалось подготовить изменение')
			if (item)
				return updateCatalogItem(token, item.id, {
					schemaVersion: 1,
					workspaceId: input.workspaceId,
					commandId: input.commandId,
					expectedVersion: item.version,
					kind: input.kind,
					name: input.name,
					unit: input.unit,
					basePriceMinor: input.basePriceMinor
				})
			return saveCatalogItem(
				token,
				base as Omit<typeof input, 'action'> & {
					kind: 'PRODUCT' | 'SERVICE'
					name: string
					unit: string
					basePriceMinor: number | null
				}
			)
		},
		() => {
			onSaved()
			onClose()
		}
	)
	const submit = (event: FormEvent) => {
		event.preventDefault()
		if (command.locked) return
		try {
			const basePriceMinor = parseMoneyInput(price, true)
			setError(null)
			void command.execute({
				action: 'save',
				name: name.trim(),
				kind,
				unit: unit.trim(),
				basePriceMinor,
				...(code.trim() ? { code: code.trim() } : {})
			})
		} catch (cause) {
			setError(commerceFormError(cause))
		}
	}
	if (!context.canRead)
		return (
			<Drawer
				isOpen
				title="Позиция каталога"
				onClose={() => {
					if (command.canClose()) onClose()
				}}
			>
				<ScreenState
					variant={
						context.permissions.isFetching ? 'loading' : 'permission'
					}
				/>
			</Drawer>
		)
	return (
		<Drawer
			isOpen
			title={item ? 'Позиция каталога' : 'Новая позиция'}
			onClose={() => {
				if (command.canClose()) onClose()
			}}
			footer={
				!item?.archivedAt ? (
					<Button
						type="submit"
						form="catalog-item-form"
						disabled={command.locked}
						isLoading={command.running}
					>
						Сохранить позицию
					</Button>
				) : undefined
			}
		>
			<div className={styles.stack}>
				<CommerceCommandState
					command={command}
					onReview={async () => {
						const access = await context.permissions.refetch()
						if (access.isError) throw new Error()
						onSaved()
						onClose()
					}}
				/>
				{error && (
					<p className={styles.error} role="alert">
						{error}
					</p>
				)}
				{item?.archivedAt && (
					<p className={styles.notice}>
						Позиция в архиве. В существующих сделках её название и цена
						сохранены.
					</p>
				)}
				<form id="catalog-item-form" onSubmit={submit}>
					<fieldset
						className={styles.fields}
						disabled={command.locked || !!item?.archivedAt}
					>
						<TextField
							label="Название"
							value={name}
							onChange={event => setName(event.target.value)}
							required
							maxLength={200}
						/>
						<SelectField
							label="Тип"
							value={kind}
							onChange={event =>
								setKind(event.target.value as 'PRODUCT' | 'SERVICE')
							}
						>
							<option value="PRODUCT">Товар</option>
							<option value="SERVICE">Услуга</option>
						</SelectField>
						<TextField
							label="Код / артикул"
							value={code}
							onChange={event => setCode(event.target.value)}
							maxLength={100}
							disabled={!!item}
							hint={
								item
									? 'Постоянный код для сопоставления при импорте.'
									: 'Оставьте пустым, чтобы создать код автоматически. Ведущие нули сохраняются.'
							}
						/>
						<TextField
							label="Единица измерения"
							value={unit}
							onChange={event => setUnit(event.target.value)}
							required
							maxLength={32}
							placeholder="шт., час, м²"
						/>
						<TextField
							label="Базовая цена, ₽"
							value={price}
							inputMode="decimal"
							onChange={event => setPrice(event.target.value)}
							hint="Можно не указывать. Тогда цену потребуется ввести в сделке. Ноль означает бесплатную позицию."
						/>
						<p className={styles.muted}>
							Изменение каталога не меняет согласованные цены в сделках и
							ранее сформированные КП.
						</p>
					</fieldset>
				</form>
				{item &&
					!item.archivedAt &&
					context.canWrite &&
					(confirmArchive ? (
						<div className={styles.notice}>
							<p>
								Архивировать позицию? Она исчезнет из выбора новых позиций.
								Старые сделки сохранят свой состав.
							</p>
							<div className={styles.actions}>
								<Button
									variant="danger"
									disabled={command.locked}
									onClick={() =>
										void command.execute({ action: 'archive' })
									}
								>
									Да, архивировать
								</Button>
								<Button
									variant="ghost"
									disabled={command.locked}
									onClick={() => setConfirmArchive(false)}
								>
									Отмена
								</Button>
							</div>
						</div>
					) : (
						<Button
							variant="ghost"
							disabled={command.locked}
							onClick={() => setConfirmArchive(true)}
						>
							Архивировать позицию
						</Button>
					))}
			</div>
		</Drawer>
	)
}

const CatalogWorkspace = ({ context }: { context: CommerceContext }) => {
	const client = useQueryClient()
	const [search, setSearch] = useState('')
	const [searchInput, setSearchInput] = useState('')
	const [includeArchived, setIncludeArchived] = useState(false)
	const [page, setPage] = useState(1)
	const [editor, setEditor] = useState<CatalogRecord | 'new' | null>(null)
	const [importOpen, setImportOpen] = useState(false)
	const [historyOpen, setHistoryOpen] = useState(false)
	const catalog = useQuery({
		queryKey: [
			'sales',
			'catalog',
			...context.key,
			search,
			includeArchived,
			page
		],
		enabled: context.canRead,
		queryFn: () =>
			listCatalogItems(
				context.session!.accessToken,
				context.workspace.workspaceId,
				{ page, pageSize: 20, search, includeArchived }
			),
		retry: false,
		gcTime: 0
	})
	const saved = () => {
		void client.invalidateQueries({ queryKey: ['sales', 'catalog'] })
	}
	const columns: DataTableColumn<CatalogRecord>[] = [
		{
			id: 'name',
			header: 'Название',
			render: item => (
				<button
					type="button"
					className={styles.record}
					onClick={() => setEditor(item)}
				>
					{item.name}
				</button>
			)
		},
		{ id: 'code', header: 'Код / артикул', render: item => item.code },
		{
			id: 'kind',
			header: 'Тип',
			render: item => (item.kind === 'PRODUCT' ? 'Товар' : 'Услуга')
		},
		{ id: 'unit', header: 'Единица', render: item => item.unit },
		{
			id: 'price',
			header: 'Базовая цена',
			align: 'right',
			render: item =>
				item.basePriceMinor === null
					? 'Не указана'
					: salesMoney(item.basePriceMinor)
		},
		{
			id: 'state',
			header: 'Статус',
			render: item => (
				<StatusBadge tone={item.archivedAt ? 'neutral' : 'success'}>
					{item.archivedAt ? 'В архиве' : 'Активна'}
				</StatusBadge>
			)
		}
	]
	return (
		<div className={styles.screen}>
			<PageHeader
				title="Каталог"
				description={
					<>
						Общие товары и услуги для всех воронок рабочего пространства.{' '}
						<HelpHint
							label="Каталог"
							description="Позиция каталога — шаблон товара или услуги для будущих сделок. Изменение цены здесь не переписывает ранее сохранённые сделки и КП."
						/>
					</>
				}
				actions={
					<>
						<ActionMenu>
							<CommerceExportControl />
							<Button
								variant="secondary"
								tooltip="Посмотреть изменения каталога и воронок; история конкретной сделки находится в её карточке"
								disabled={!context.canRead}
								onClick={() => setHistoryOpen(true)}
							>
								История каталога и воронок
							</Button>
							<Button
								variant="secondary"
								disabled={!context.canRead || catalog.isFetching}
								onClick={() => void catalog.refetch()}
							>
								Обновить каталог
							</Button>
						</ActionMenu>
						<Button
							variant="secondary"
							tooltip="Проверить Excel или CSV перед добавлением позиций в каталог"
							disabled={!context.canWrite}
							onClick={() => setImportOpen(true)}
						>
							Импорт
						</Button>
						<Button
							disabled={!context.canWrite}
							onClick={() => setEditor('new')}
							leadingIcon={<AppIcon name="plus" size={18} />}
						>
							Новая позиция
						</Button>
					</>
				}
			/>
			{context.permissions.isError ? (
				<ScreenState
					variant="error"
					description="Не удалось проверить права."
					action={
						<Button onClick={() => void context.permissions.refetch()}>
							Повторить
						</Button>
					}
				/>
			) : context.permissions.isPending ? (
				<ScreenState variant="loading" />
			) : !context.canRead ? (
				<ScreenState variant="permission" />
			) : (
				<>
					{!context.canWrite && (
						<ReadOnlyBanner description="Доступен просмотр каталога. Изменение позиций и импорт требуют права изменения сделок и активной подписки." />
					)}
					<p className={styles.muted}>
						Каталог необязателен: в сделку можно добавить разовую строку
						или указать сумму вручную. Складские остатки здесь не
						учитываются.
					</p>
					<form
						className={styles.filters}
						onSubmit={event => {
							event.preventDefault()
							setSearch(searchInput.trim())
							setPage(1)
						}}
					>
						<TextField
							label="Поиск"
							placeholder="Название или код"
							value={searchInput}
							onChange={event => setSearchInput(event.target.value)}
							maxLength={100}
						/>
						<label className={styles.check}>
							<input
								type="checkbox"
								checked={includeArchived}
								onChange={event => {
									setIncludeArchived(event.target.checked)
									setPage(1)
								}}
							/>
							Показать архивные
						</label>
						<Button type="submit" variant="secondary">
							Найти
						</Button>
					</form>
					{catalog.isError ? (
						<ScreenState
							variant="error"
							description="Не удалось загрузить каталог."
							action={
								<Button onClick={() => void catalog.refetch()}>
									Повторить
								</Button>
							}
						/>
					) : catalog.isPending ? (
						<ScreenState variant="loading" />
					) : catalog.data.items.length ? (
						<>
							<DataTable
								caption="Товары и услуги"
								mobileLayout="cards"
								rows={catalog.data.items}
								columns={columns}
								getRowKey={item => item.id}
								onRowClick={item => setEditor(item)}
							/>
							<div className={styles.heading}>
								<span className={styles.muted}>
									Всего {catalog.data.total} · страница {page}
								</span>
								<div className={styles.actions}>
									<Button
										variant="secondary"
										disabled={page === 1 || catalog.isFetching}
										onClick={() => setPage(value => value - 1)}
									>
										Назад
									</Button>
									<Button
										variant="secondary"
										disabled={
											page * 20 >= catalog.data.total || catalog.isFetching
										}
										onClick={() => setPage(value => value + 1)}
									>
										Далее
									</Button>
								</div>
							</div>
						</>
					) : (
						<ScreenState
							variant="empty"
							title={search ? 'Позиции не найдены' : 'Каталог пока пуст'}
							description="Создайте товар или услугу вручную либо загрузите Excel или CSV."
						/>
					)}
				</>
			)}
			{editor && (
				<CatalogEditor
					key={
						typeof editor === 'string'
							? 'new'
							: `${editor.id}:${editor.version}`
					}
					context={context}
					item={editor === 'new' ? null : editor}
					onClose={() => setEditor(null)}
					onSaved={saved}
				/>
			)}
			{importOpen && (
				<CatalogImportDrawer
					context={context}
					onClose={() => setImportOpen(false)}
					onSaved={saved}
				/>
			)}
			{historyOpen && (
				<CommerceHistoryDrawer
					context={context}
					onClose={() => setHistoryOpen(false)}
				/>
			)}
		</div>
	)
}

export default function CatalogScreen() {
	const context = useSalesSession()
	return <CatalogWorkspace key={context.key.join(':')} context={context} />
}
