'use client'

import {
	listInbox,
	type InboxEntry,
	type InboxStatus
} from '@/entities/intake'
import {
	InboxEditor,
	CsvImportDrawer,
	SourcesPanel,
	useIntakeAccess
} from '@/features/manage-intake'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import {
	AppIcon,
	ActionMenu,
	Button,
	DataTable,
	PageHeader,
	ScreenState,
	SelectField,
	StatusBadge,
	TextField,
	type DataTableColumn
} from '@/shared/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import styles from './InboxScreen.module.scss'
import { ExportRecordsControl } from '@/features/export-records'
import { listInboxSla } from '@/entities/intake-sla'
import { SlaInboxBadge } from '@/features/manage-intake-sla'
import { isUuidV4 } from '@/shared/lib/contract'

const statusName = {
	NEW: 'Новое',
	ACCEPTED: 'Принято',
	REJECTED: 'Отклонено'
}
const InboxContent = ({
	access,
	initialEntryId
}: {
	access: ReturnType<typeof useIntakeAccess>
	initialEntryId: string | null
}) => {
	const client = useQueryClient()
	const [tab, setTab] = useState<'inbox' | 'sources'>('inbox')
	const [searchDraft, setSearchDraft] = useState('')
	const [search, setSearch] = useState('')
	const [status, setStatus] = useState<InboxStatus | ''>('NEW')
	const [page, setPage] = useState(1)
	const [selected, setSelected] = useState<{ id?: string } | null>(
		initialEntryId ? { id: initialEntryId } : null
	)
	const [importing, setImporting] = useState(false)
	const query = useQuery({
		queryKey: [
			'crm-inbox',
			access.workspaceId,
			access.session?.userId,
			access.revision,
			access.scopeKey,
			page,
			search,
			status
		],
		enabled: tab === 'inbox' && access.canRead && !!access.session,
		queryFn: () =>
			listInbox(
				access.session!.accessToken,
				access.workspaceId,
				page,
				25,
				search,
				status
			),
		retry: false,
		gcTime: 0,
		refetchOnWindowFocus: false
	})
	const denied =
		query.error instanceof AuthenticatedApiError &&
		['unauthorized', 'forbidden'].includes(query.error.kind)
	const entryIds = query.data?.items.map(entry => entry.id) ?? []
	const sla = useQuery({
		queryKey: [
			'crm-inbox-sla',
			access.workspaceId,
			access.session?.userId,
			access.revision,
			access.scopeKey,
			entryIds
		],
		enabled:
			tab === 'inbox' &&
			access.canRead &&
			!!access.session &&
			!denied &&
			!query.isError &&
			!query.isFetching &&
			entryIds.length > 0,
		queryFn: () =>
			listInboxSla(
				access.session!.accessToken,
				access.workspaceId,
				entryIds
			),
		retry: false,
		gcTime: 0,
		refetchOnWindowFocus: false,
		refetchInterval: 60000
	})
	const columns: DataTableColumn<InboxEntry>[] = [
		{
			id: 'title',
			header: 'Обращение',
			headerClassName: styles.titleColumn,
			render: entry => (
				<button
					type="button"
					className={styles.entryButton}
					onClick={() => setSelected({ id: entry.id })}
				>
					<strong>{entry.title}</strong>
					<span>{entry.name ?? 'Имя не передано'}</span>
				</button>
			)
		},
		{
			id: 'contact',
			header: 'Контакт',
			headerClassName: styles.contactColumn,
			render: entry => (
				<div className={styles.contact}>
					<span>{entry.phone ?? '—'}</span>
					<span>{entry.email ?? '—'}</span>
				</div>
			)
		},
		{
			id: 'origin',
			header: 'Источник',
			headerClassName: styles.originColumn,
			render: entry =>
				({ MANUAL: 'Вручную', API: 'API', CSV: 'CSV' })[
					entry.origin
				]
		},
		{
			id: 'status',
			header: 'Статус',
			headerClassName: styles.statusColumn,
			render: entry => (
				<StatusBadge
					tone={
						entry.status === 'NEW'
							? 'accent'
							: entry.status === 'ACCEPTED'
								? 'success'
								: 'neutral'
					}
				>
					{statusName[entry.status]}
				</StatusBadge>
			)
		},
		{
			id: 'sla',
			header: 'SLA',
			headerClassName: styles.slaColumn,
			render: entry => (
				<SlaInboxBadge
					item={sla.data?.items.find(item => item.entryId === entry.id)}
					loading={sla.isPending && !sla.isError}
					deliveryEnabled={sla.data?.deliveryEnabled}
					unavailable={sla.isError}
					notActivated={
						sla.error instanceof AuthenticatedApiError &&
						sla.error.kind === 'notFound'
					}
				/>
			)
		},
		{
			id: 'received',
			header: 'Получено',
			headerClassName: styles.receivedColumn,
			render: entry => new Date(entry.receivedAt).toLocaleString('ru-RU')
		}
	]
	const searchSubmit = (event: FormEvent) => {
		event.preventDefault()
		setPage(1)
		setSearch(searchDraft.trim())
		toast('Поиск применён')
	}
	const onSaved = () => {
		void client.invalidateQueries({
			queryKey: ['crm-inbox-sla', access.workspaceId]
		})
		void client.invalidateQueries({
			queryKey: ['crm-inbox', access.workspaceId]
		})
		void client.invalidateQueries({
			queryKey: ['crm-intake-history', access.workspaceId]
		})
	}
	return (
		<div className={styles.screen}>
			<PageHeader
				title="Входящие"
				description="Новые заявки и история работы с обращениями."
				actions={
					<div className={styles.tabs}>
						<ActionMenu>
							<ExportRecordsControl
								entity="inbox"
								disabled={denied || tab !== 'inbox'}
							/>
							<Button
								variant="secondary"
								tooltip="Проверить CSV-файл и импортировать строки как новые обращения. Контакты и сделки создаются при принятии в работу."
								disabled={
									!access.canWrite ||
									access.permissions.data?.role === 'ANALYST' ||
									denied ||
									tab !== 'inbox'
								}
								onClick={() => {
									setImporting(true)
								}}
							>
								Импорт CSV
							</Button>
						</ActionMenu>
						<Button
							disabled={!access.canWrite || denied || tab !== 'inbox'}
							tooltip="Внести обращение вручную, чтобы затем принять его в работу или отклонить."
							disabledTooltip="Создание доступно на вкладке обращений при подтверждённых правах на изменение."
							leadingIcon={<AppIcon name="plus" size={18} />}
							onClick={() => setSelected({})}
						>
							Новое обращение
						</Button>
					</div>
				}
			/>
			<div
				className={styles.tabs}
				role="group"
				aria-label="Обращения и интеграции"
			>
				<Button
					variant={tab === 'inbox' ? 'primary' : 'secondary'}
					tooltip="Просматривать поступившие заявки, принимать их в работу и отслеживать результат обработки."
					aria-pressed={tab === 'inbox'}
					onClick={() => setTab('inbox')}
				>
					Обращения
				</Button>
				<Button
					variant={tab === 'sources' ? 'primary' : 'secondary'}
					tooltip="Настроить поступление заявок из форм сайта, Tilda и внешних API."
					aria-pressed={tab === 'sources'}
					onClick={() => setTab('sources')}
				>
					Источники
				</Button>
			</div>
			{tab === 'sources' ? (
				<SourcesPanel
					key={`${access.workspaceId}:${access.session?.userId}`}
					access={access}
				/>
			) : !access.permissions.isSuccess ? (
				<ScreenState
					variant={access.permissions.isError ? 'error' : 'loading'}
					description={access.permissions.error?.message}
					action={
						access.permissions.isError ? (
							<Button onClick={() => void access.permissions.refetch()}>
								Повторить проверку доступа
							</Button>
						) : undefined
					}
				/>
			) : !access.canRead ? (
				<ScreenState
					variant="permission"
					description="Ваша CRM-роль не предоставляет доступ к обращениям."
				/>
			) : denied ? (
				<ScreenState
					variant="permission"
					description="Доступ к обращениям больше не подтверждён."
				/>
			) : (
				<section
					className={styles.panel}
					aria-label="Список входящих обращений"
				>
					<div className={styles.panelHeader}>
						<h2 className={styles.panelTitle}>Обращения</h2>
						<form className={styles.search} onSubmit={searchSubmit}>
							<TextField
								label="Поиск обращений"
								labelHidden
								placeholder="Тема, имя, телефон, email"
								maxLength={200}
								value={searchDraft}
								onChange={event => setSearchDraft(event.target.value)}
							/>
							<SelectField
								label="Статус обращения"
								labelHidden
								value={status}
								onChange={event => {
									setStatus(event.target.value as InboxStatus | '')
									setPage(1)
									toast('Фильтр статуса применён')
								}}
							>
								<option value="">Все статусы</option>
								<option value="NEW">Новые</option>
								<option value="ACCEPTED">Принятые</option>
								<option value="REJECTED">Отклонённые</option>
							</SelectField>
							<Button variant="secondary" type="submit">
								Найти
							</Button>
						</form>
					</div>
					{query.isError ? (
						<ScreenState
							variant="error"
							description={query.error.message}
							action={
								<Button onClick={() => void query.refetch()}>
									Повторить
								</Button>
							}
						/>
					) : query.isPending ? (
						<ScreenState variant="loading" />
					) : (
						<>
							<DataTable
								className={styles.entriesTable}
								mobileLayout="cards"
								caption="Входящие обращения выбранного рабочего пространства"
								columns={columns}
								rows={query.data.items}
								getRowKey={entry => entry.id}
								embedded
								emptyMessage={
									search
										? 'По вашему запросу ничего не найдено'
										: 'Обращений с выбранным статусом пока нет'
								}
							/>
							<div className={styles.pagination}>
								<span>Всего: {query.data.total}</span>
								<Button
									variant="secondary"
									disabled={page === 1}
									onClick={() => setPage(value => value - 1)}
								>
									Назад
								</Button>
								<span>
									{page} / {Math.max(1, Math.ceil(query.data.total / 25))}
								</span>
								<Button
									variant="secondary"
									disabled={page * 25 >= query.data.total}
									onClick={() => setPage(value => value + 1)}
								>
									Далее
								</Button>
							</div>
						</>
					)}
				</section>
			)}
			{selected && access.session ? (
				<InboxEditor
					key={`${access.workspaceId}:${access.session?.userId}:${selected.id ?? 'new'}`}
					access={access}
					id={selected.id}
					onClose={() => setSelected(null)}
					onSaved={onSaved}
				/>
			) : null}
			{importing && access.session ? (
				<CsvImportDrawer
					access={access}
					onClose={() => setImporting(false)}
					onSaved={onSaved}
				/>
			) : null}
		</div>
	)
}
const InboxScreen = ({
	initialEntryId
}: {
	initialEntryId?: string | null
}) => {
	const access = useIntakeAccess()
	const entryBinding = JSON.stringify([
		access.workspaceId,
		access.session?.userId,
		access.revision
	])
	const scope = JSON.stringify([entryBinding, access.scopeKey])
	// A URL only selects an entry. Existing scoped reads still authorize its data.
	// Bind once to this session/workspace and the first confirmed permission scope.
	const [link, setLink] = useState(() =>
		isUuidV4(initialEntryId)
			? {
					entryId: initialEntryId,
					binding: entryBinding,
					scope: null as string | null
				}
			: null
	)
	if (
		link &&
		(link.binding !== entryBinding ||
			(link.scope !== null && link.scope !== scope))
	)
		setLink(null)
	else if (link?.scope === null && access.canRead)
		setLink({ ...link, scope })
	const linkedEntryId = link?.scope === scope ? link.entryId : null
	return (
		<InboxContent
			key={JSON.stringify([scope, linkedEntryId])}
			access={access}
			initialEntryId={linkedEntryId}
		/>
	)
}
export default InboxScreen
