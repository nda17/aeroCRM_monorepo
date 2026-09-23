'use client'

import {
	useCrmPermissions,
	useCrmWorkspaceAccess,
	crmPermissionScope
} from '@/entities/crm-access'
import {
	listCustomers,
	type Customer,
	type CustomerKind
} from '@/entities/customer'
import { useSessionStore } from '@/entities/session'
import { CustomerEditor } from '@/features/edit-customer'
import { ExportRecordsControl } from '@/features/export-records'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { isUuidV4 } from '@/shared/lib/contract'
import {
	AppIcon,
	Button,
	DataTable,
	HelpHint,
	PageHeader,
	ScreenState,
	TextField,
	type DataTableColumn
} from '@/shared/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import styles from './ContactsScreen.module.scss'

const ContactsScreen = ({
	initialContactId
}: {
	initialContactId?: string | null
}) => {
	const { workspaceId, canWrite: subscriptionCanWrite } =
		useCrmWorkspaceAccess()
	const session = useSessionStore(state => state.session)
	const revision = useSessionStore(state => state.sessionRevision)
	const permissions = useCrmPermissions(workspaceId, session, revision)
	const scopeKey = crmPermissionScope(permissions.data)
	const confirmed = permissions.isSuccess && !permissions.isFetching
	const canRead =
		confirmed &&
		permissions.data.subject === session?.userId &&
		permissions.data.permissions.includes('customers:read')
	const canWrite =
		canRead &&
		subscriptionCanWrite &&
		permissions.data!.permissions.includes('customers:write')
	const linkBinding = JSON.stringify([
		workspaceId,
		session?.userId,
		revision
	])
	const linkScope = JSON.stringify([linkBinding, scopeKey])
	const [link, setLink] = useState(() =>
		isUuidV4(initialContactId)
			? {
					id: initialContactId,
					binding: linkBinding,
					scope: null as string | null
				}
			: null
	)
	if (
		link &&
		(link.binding !== linkBinding ||
			(link.scope !== null && link.scope !== linkScope))
	)
		setLink(null)
	else if (link?.scope === null && canRead)
		setLink({ ...link, scope: linkScope })
	const [kind, setKind] = useState<CustomerKind>('contacts')
	const [searchDraft, setSearchDraft] = useState('')
	const [search, setSearch] = useState('')
	const [page, setPage] = useState(1)
	const [selected, setSelected] = useState<{
		id?: string
		kind: CustomerKind
	} | null>(null)
	const activeSelection =
		selected ??
		(link?.scope === linkScope
			? { id: link.id, kind: 'contacts' as const }
			: null)
	const closeEditor = () => {
		setSelected(null)
		setLink(null)
	}
	const queryClient = useQueryClient()
	const records = useQuery({
		queryKey: [
			'crm-customers',
			workspaceId,
			session?.userId,
			revision,
			scopeKey,
			kind,
			2,
			search,
			page
		],
		enabled: canRead && !!session,
		queryFn: () =>
			listCustomers(
				session!.accessToken,
				kind,
				workspaceId,
				page,
				25,
				search
			),
		retry: false,
		gcTime: 0,
		staleTime: 0
	})
	const permissionError =
		records.error instanceof AuthenticatedApiError &&
		['unauthorized', 'forbidden'].includes(records.error.kind)
	const canDisplay = canRead && !records.isError
	const rows = canDisplay ? (records.data?.items ?? []) : []
	const columns: readonly DataTableColumn<Customer>[] = [
		{
			id: 'name',
			header: kind === 'contacts' ? 'Контакт' : 'Компания',
			render: item => (
				<button
					type="button"
					className={styles.contactButton}
					onClick={() => setSelected({ id: item.id, kind })}
				>
					<span className={styles.avatar} aria-hidden="true">
						{item.name
							.split(/\s+/)
							.slice(0, 2)
							.map(word => word[0])
							.join('')
							.toUpperCase()}
					</span>
					<span className={styles.contactCopy}>
						<strong>{item.name}</strong>
						<span>
							{item.kind === 'contacts'
								? item.companyId
									? 'Связан с компанией'
									: 'Частное лицо'
								: item.inn
									? `ИНН ${item.inn}`
									: 'ИНН не указан'}
						</span>
					</span>
				</button>
			)
		},
		{
			id: 'primary',
			header: kind === 'contacts' ? 'Телефон' : 'Сайт',
			render: item =>
				item.kind === 'contacts'
					? (item.phone ?? '—')
					: (item.website ?? '—')
		},
		{
			id: 'secondary',
			header: kind === 'contacts' ? 'Email' : 'Заметки',
			render: item =>
				item.kind === 'contacts' ? (
					(item.email ?? '—')
				) : (
					<span className={styles.notes}>{item.notes ?? '—'}</span>
				)
		},
		{
			id: 'updated',
			header: 'Обновлено',
			render: item => new Date(item.updatedAt).toLocaleDateString('ru-RU')
		}
	]
	const applySearch = (event: FormEvent) => {
		event.preventDefault()
		setSearch(searchDraft.trim())
		setPage(1)
	}
	const switchKind = (next: CustomerKind) => {
		setKind(next)
		setPage(1)
		setSearch('')
		setSearchDraft('')
		closeEditor()
	}
	const totalPages = Math.max(
		1,
		Math.ceil((records.data?.total ?? 0) / 25)
	)
	return (
		<div className={styles.screen}>
			<PageHeader
				eyebrow="Клиентская база"
				title="Контакты и компании"
				description={
					<>
						Вся информация о клиентах — в одном месте. Добавляйте контакты,
						связывайте их с компаниями и сохраняйте важные детали.{' '}
						<HelpHint
							label="Клиентская база"
							description="Контакт — человек, компания — организация. Контакт можно связать с компанией; сделки и обращения сохраняют собственную историю работы с ними."
						/>
					</>
				}
				actions={
					<>
						<ExportRecordsControl
							entity={kind}
							disabled={permissionError}
						/>
						<Button
							tooltip={
								kind === 'contacts'
									? 'Открыть форму для добавления клиента и его контактных данных'
									: 'Открыть форму для добавления компании и её реквизитов'
							}
							disabled={!canWrite || permissionError}
							leadingIcon={<AppIcon name="plus" size={18} />}
							onClick={() => setSelected({ kind })}
						>
							{kind === 'contacts' ? 'Новый контакт' : 'Новая компания'}
						</Button>
					</>
				}
			/>
			<div
				className={styles.tabs}
				role="group"
				aria-label="Раздел клиентской базы"
			>
				<Button
					variant={kind === 'contacts' ? 'primary' : 'secondary'}
					aria-pressed={kind === 'contacts'}
					onClick={() => switchKind('contacts')}
				>
					Контакты
				</Button>
				<Button
					variant={kind === 'companies' ? 'primary' : 'secondary'}
					aria-pressed={kind === 'companies'}
					onClick={() => switchKind('companies')}
				>
					Компании
				</Button>
			</div>
			{!confirmed ? (
				<ScreenState
					variant={permissions.isError ? 'error' : 'loading'}
					description={permissions.error?.message}
					action={
						permissions.isError ? (
							<Button onClick={() => void permissions.refetch()}>
								Повторить
							</Button>
						) : undefined
					}
				/>
			) : !canRead || permissionError ? (
				<ScreenState
					variant="permission"
					description="Ваша CRM-роль не предоставляет доступ к клиентской базе."
				/>
			) : (
				<section
					className={styles.panel}
					aria-label={
						kind === 'contacts' ? 'Список контактов' : 'Список компаний'
					}
				>
					<div className={styles.panelHeader}>
						<div>
							<h2 className={styles.panelTitle}>
								{kind === 'contacts' ? 'Все контакты' : 'Все компании'}
							</h2>
							<p className={styles.panelDescription}>
								{records.isError
									? 'Не удалось обновить список'
									: records.isPending
										? 'Загружаем клиентскую базу'
										: `Найдено записей: ${records.data?.total ?? 0}`}
							</p>
						</div>
						<form className={styles.search} onSubmit={applySearch}>
							<TextField
								label="Поиск клиентов"
								labelHidden
								placeholder={
									kind === 'contacts'
										? 'Имя, телефон или email'
										: 'Название или ИНН'
								}
								type="search"
								maxLength={200}
								value={searchDraft}
								onChange={event => setSearchDraft(event.target.value)}
							/>
							<Button
								type="submit"
								variant="secondary"
								size="sm"
								tooltip={
									kind === 'contacts'
										? 'Найти контакты по имени, телефону или email'
										: 'Найти компании по названию или ИНН'
								}
							>
								Найти
							</Button>
						</form>
					</div>
					{records.isError ? (
						<ScreenState
							variant="error"
							description={records.error.message}
							action={
								<Button
									variant="secondary"
									onClick={() => void records.refetch()}
								>
									Повторить
								</Button>
							}
						/>
					) : records.isPending || records.isFetching ? (
						<ScreenState variant="loading" compact />
					) : rows.length ? (
						<DataTable
							mobileLayout="cards"
							caption={
								kind === 'contacts'
									? 'Контакты вашей команды'
									: 'Компании вашей команды'
							}
							columns={columns}
							rows={rows}
							getRowKey={item => item.id}
							embedded
						/>
					) : (
						<ScreenState
							variant="empty"
							title={
								search
									? 'Ничего не найдено'
									: page > 1
										? 'На этой странице нет записей'
										: kind === 'contacts'
											? 'Добавьте первого клиента'
											: 'Добавьте первую компанию'
							}
							description={
								search
									? 'Попробуйте изменить поисковый запрос.'
									: page > 1
										? 'Перейдите на предыдущую страницу.'
										: 'Записи появятся здесь после добавления.'
							}
							action={
								canWrite && !search && page === 1 ? (
									<Button
										tooltip={
											kind === 'contacts'
												? 'Открыть форму для добавления клиента и его контактных данных'
												: 'Открыть форму для добавления компании и её реквизитов'
										}
										onClick={() => setSelected({ kind })}
									>
										{kind === 'contacts'
											? 'Добавить контакт'
											: 'Добавить компанию'}
									</Button>
								) : undefined
							}
						/>
					)}
					<div className={styles.pagination}>
						<span>
							Страница {page} из {totalPages}
						</span>
						<div className={styles.tabs}>
							<Button
								size="sm"
								variant="secondary"
								disabled={page === 1 || records.isFetching}
								onClick={() => setPage(current => current - 1)}
							>
								Назад
							</Button>
							<Button
								size="sm"
								variant="secondary"
								disabled={
									page >= totalPages ||
									records.isFetching ||
									records.isError
								}
								onClick={() => setPage(current => current + 1)}
							>
								Далее
							</Button>
						</div>
					</div>
				</section>
			)}
			{activeSelection && canRead && !permissionError ? (
				<CustomerEditor
					key={`${workspaceId}:${session?.userId}:${revision}:${activeSelection.kind}:${activeSelection.id ?? 'new'}`}
					workspaceId={workspaceId}
					kind={activeSelection.kind}
					id={activeSelection.id}
					canWrite={canWrite}
					scopeKey={scopeKey}
					onClose={closeEditor}
					onSaved={() => {
						void queryClient.invalidateQueries({
							queryKey: ['crm-customers', workspaceId]
						})
						void queryClient.invalidateQueries({
							queryKey: ['crm-company-picker', workspaceId]
						})
					}}
				/>
			) : null}
		</div>
	)
}

export default ContactsScreen
