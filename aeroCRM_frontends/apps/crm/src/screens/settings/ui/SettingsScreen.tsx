'use client'

import {
	crmRoleLabels,
	listTeamRecords,
	type TeamCollection,
	type TeamRow
} from '@/entities/crm-team'
import { useSessionStore } from '@/entities/session'
import { CrmCommercialPolicyCard } from '@/features/view-crm-commercial-policy'
import { WorkspaceBrandingSettings } from '@/features/manage-workspace-branding'
import { ReminderSettings } from '@/features/manage-reminders'
import { SlaSettings } from '@/features/manage-intake-sla'
import { BillingEntryCard } from '@/features/manage-crm-billing'
import { getRuntimeConfig } from '@/shared/config/runtime'
import {
	TeamEditor,
	EmployeeProfileControl,
	useTeamSession,
	type TeamEditorSelection
} from '@/features/manage-team'
import {
	Button,
	DataTable,
	PageHeader,
	ReadOnlyBanner,
	ScreenState,
	StatusBadge,
	type DataTableColumn
} from '@/shared/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import toast from 'react-hot-toast'
import styles from './SettingsScreen.module.scss'

const tabs: Record<TeamCollection, string> = {
	members: 'Сотрудники',
	invitations: 'Приглашения',
	teams: 'Отделы',
	deliveries: 'Ошибки обработки'
}
const teamActionTooltips: Record<TeamEditorSelection['kind'], string> = {
	invite:
		'Создать приглашение на 7 дней. Доступ зависит от подтверждения email и свободного места',
	'create-team':
		'Создать отдел для распределения сотрудников и области доступа руководителей',
	'rename-team': 'Изменить название отдела',
	'archive-team':
		'Убрать отдел из действующих. Сначала снимите все назначения сотрудников',
	revoke:
		'Отменить доступ по приглашению. Уже активного сотрудника нужно отключать отдельно',
	role: 'Изменить роль сотрудника и доступные ему действия в CRM',
	teams: 'Настроить отделы сотрудника и связанную с ними область доступа',
	disable:
		'Отключить доступ к CRM и освободить место. Аккаунт и права на виджеты сохранятся',
	enable:
		'Поставить сотрудника в очередь допуска: включение зависит от прав и свободного места',
	retry:
		'Повторить только эту фоновую обработку с проверкой актуальных прав'
}
const invitationStatuses = {
	REGISTERING: 'Подготавливается',
	INVITED: 'Ожидает подтверждения email',
	ACCEPTED: 'Email подтверждён',
	REVOKED: 'Отозвано',
	EXPIRED: 'Истекло'
}
const date = (value: string) => new Date(value).toLocaleDateString('ru-RU')

const SettingsScreen = () => {
	const reasonPrefix = useId()
	const context = useTeamSession()
	const { workspace, session, sessionRevision } = context
	const [tab, setTab] = useState<TeamCollection>('members')
	const [page, setPage] = useState(1)
	const [selected, setSelected] = useState<TeamEditorSelection | null>(
		null
	)
	const queryClient = useQueryClient()
	const queryKey = ['crm-team', ...context.key, tab, page] as const
	const records = useQuery({
		queryKey,
		enabled: context.canRead,
		queryFn: () =>
			listTeamRecords(
				session!.accessToken,
				workspace.workspaceId,
				tab,
				page
			),
		retry: false,
		staleTime: 0,
		gcTime: 0
	})
	const quota = useQuery({
		queryKey: ['crm-team-quota', ...context.key],
		enabled: context.canRead,
		queryFn: () =>
			listTeamRecords(
				session!.accessToken,
				workspace.workspaceId,
				'members',
				1,
				1
			),
		retry: false,
		staleTime: 0,
		gcTime: 0
	})
	const visible =
		context.canRead && !records.isError && !records.isFetching
	const owner = quota.data?.ownerSubject
	const protectedReason = (row: TeamRow) =>
		row.kind === 'member' &&
		(row.subject === session?.userId || row.subject === owner)
			? 'Собственный доступ и владелец не редактируются'
			: 'role' in row &&
				  row.role === 'CRM_ADMIN' &&
				  context.permissions.data?.role !== 'OWNER'
				? 'Только владелец управляет администраторами CRM'
				: undefined
	const reasonId = (row: TeamRow) =>
		`${reasonPrefix}-${row.kind}-${row.id}`
	const open = (kind: TeamEditorSelection['kind'], record?: TeamRow) =>
		setSelected({ kind, record })
	const refresh = async () => {
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: ['crm-team', workspace.workspaceId]
			}),
			queryClient.invalidateQueries({
				queryKey: ['crm-team-quota', workspace.workspaceId]
			}),
			queryClient.invalidateQueries({
				queryKey: ['crm-team-picker', workspace.workspaceId]
			})
		])
	}
	const review = async () => {
		const result = await records.refetch()
		if (result.error || !result.data)
			throw new Error('Не удалось обновить список')
		const current = useSessionStore.getState()
		if (
			current.session?.accessToken !== session?.accessToken ||
			current.sessionRevision !== sessionRevision
		)
			throw new Error('Сессия изменилась')
		return selected?.record
			? result.data.items.find(row => row.id === selected.record!.id)
			: undefined
	}
	const action = (
		row: TeamRow,
		kind: TeamEditorSelection['kind'],
		label: string,
		revoke = false,
		disabled = false
	) => {
		const reason = protectedReason(row)
		return (
			<Button
				size="sm"
				variant="secondary"
				tooltip={teamActionTooltips[kind]}
				disabledTooltip={reason}
				aria-describedby={reason ? reasonId(row) : undefined}
				disabled={
					!!reason ||
					disabled ||
					!visible ||
					!(revoke ? context.canRevoke : context.canManage)
				}
				onClick={() => open(kind, row)}
			>
				{label}
			</Button>
		)
	}
	const columns: DataTableColumn<TeamRow>[] = [
		{
			id: 'record',
			header:
				tab === 'members'
					? 'Сотрудник'
					: tab === 'teams'
						? 'Отдел'
						: tab === 'invitations'
							? 'Email приглашения'
							: 'Обработка',
			render: row => (
				<div className={styles.record}>
					{row.kind === 'member' ? (
						<>
							<strong>
								{row.displayName ??
									row.verifiedEmail ??
									'Профиль недоступен'}
							</strong>
							<span>
								{row.verifiedEmail ?? 'Подтверждённый email не указан'}
							</span>
						</>
					) : row.kind === 'team' ? (
						<strong>{row.name}</strong>
					) : row.kind === 'invitation' ? (
						<>
							<strong>{row.email}</strong>
							<span>Действует до {date(row.expiresAt)}</span>
						</>
					) : (
						<>
							<strong>
								{
									{
										provision: 'Подготовка приглашения',
										acceptance: 'Принятие приглашения',
										admission: 'Допуск сотрудника'
									}[row.consumer]
								}
							</strong>
							<span>Обновлено {date(row.updatedAt)}</span>
						</>
					)}
				</div>
			)
		},
		{
			id: 'status',
			header: 'Роль и состояние',
			render: row => (
				<div className={styles.record}>
					{row.kind === 'member' ? (
						<>
							<strong>{crmRoleLabels[row.role]}</strong>
							<StatusBadge tone={row.disabledAt ? 'neutral' : 'success'}>
								{row.disabledAt ? 'Отключён' : 'Доступ включён'}
							</StatusBadge>
							<span>Отделов: {row.teamIds.length}</span>
						</>
					) : row.kind === 'invitation' ? (
						<>
							<strong>{crmRoleLabels[row.role]}</strong>
							<StatusBadge
								tone={
									row.status === 'REVOKED' || row.status === 'EXPIRED'
										? 'neutral'
										: 'info'
								}
							>
								{invitationStatuses[row.status]}
							</StatusBadge>
							{row.status === 'ACCEPTED' ? (
								<span>Допуск зависит от прав и свободного места</span>
							) : null}
						</>
					) : row.kind === 'team' ? (
						<StatusBadge tone="success">Активен</StatusBadge>
					) : (
						<>
							<StatusBadge
								tone={
									row.status === 'DEAD_LETTERED' ? 'danger' : 'warning'
								}
							>
								{row.status === 'DEAD_LETTERED'
									? 'Нужна проверка'
									: 'Повтор запланирован'}
							</StatusBadge>
							<span>Попытка {row.retryAttempt} из 3</span>
						</>
					)}
				</div>
			)
		},
		{
			id: 'actions',
			header: 'Действия',
			render: row => (
				<div className={styles.rowActions}>
					{row.kind === 'member' ? (
						<>
							<EmployeeProfileControl
								context={context}
								targetSubject={row.subject}
								disabled={!visible || !!row.disabledAt}
								allowEdit={
									row.subject === session?.userId ||
									context.permissions.data?.role === 'OWNER' ||
									row.role !== 'CRM_ADMIN'
								}
							/>
							{action(row, 'role', 'Роль')}
							{action(row, 'teams', 'Отделы')}
							{row.disabledAt
								? action(row, 'enable', 'Запросить включение')
								: action(row, 'disable', 'Отключить', true)}
						</>
					) : row.kind === 'team' ? (
						<>
							{action(row, 'rename-team', 'Переименовать')}
							{action(row, 'archive-team', 'Архивировать')}
						</>
					) : row.kind === 'invitation' ? (
						action(
							row,
							'revoke',
							'Отозвать',
							true,
							['REVOKED', 'EXPIRED'].includes(row.status)
						)
					) : (
						action(
							row,
							'retry',
							'Повторить',
							false,
							row.status !== 'DEAD_LETTERED'
						)
					)}
					{protectedReason(row) ? (
						<p id={reasonId(row)} className={styles.muted}>
							{protectedReason(row)}
						</p>
					) : null}
				</div>
			)
		}
	]
	const totalPages = Math.max(
		1,
		Math.ceil((records.data?.total ?? 0) / 20)
	)
	return (
		<div className={styles.screen}>
			<PageHeader
				eyebrow="Настройки CRM"
				title="Команда и доступ"
				description="Приглашайте сотрудников, распределяйте роли и отделы. Доступ к CRM не меняет права на виджеты."
				actions={
					<div className={styles.actions}>
						{session ? (
							<EmployeeProfileControl
								key={context.key.join(':')}
								context={context}
								targetSubject={session.userId}
							/>
						) : null}
						<Button
							variant="secondary"
							tooltip={teamActionTooltips['create-team']}
							disabled={!context.canManage}
							onClick={() => open('create-team')}
						>
							Новый отдел
						</Button>
						<Button
							tooltip={teamActionTooltips.invite}
							disabled={!context.canManage}
							onClick={() => open('invite')}
						>
							Пригласить сотрудника
						</Button>
					</div>
				}
			/>
			<WorkspaceBrandingSettings />
			<ReminderSettings />
			<SlaSettings />
			<CrmCommercialPolicyCard />
			{workspace.membership.role === 'OWNER' &&
			getRuntimeConfig().wincrmBillingEnabled ? (
				<BillingEntryCard
					key={`${session?.userId}:${sessionRevision}:${workspace.workspaceId}`}
					workspaceId={workspace.workspaceId}
				/>
			) : null}
			{!context.confirmed ? (
				<ScreenState
					variant={context.permissions.isError ? 'error' : 'loading'}
					description={context.permissions.error?.message}
					action={
						context.permissions.isError ? (
							<Button onClick={() => void context.permissions.refetch()}>
								Проверить доступ
							</Button>
						) : undefined
					}
				/>
			) : !context.canRead ? (
				<ScreenState
					variant="permission"
					title="Настройки команды доступны владельцу и администратору CRM"
					description="Остальные разделы остаются доступны в соответствии с вашей ролью."
				/>
			) : (
				<>
					{!context.canManage ? (
						<ReadOnlyBanner description="Можно просматривать сотрудников, приглашения и отделы. Изменения, включая отключение доступа, недоступны до восстановления подписки или прав." />
					) : null}
					{quota.isError ? (
						<div className={styles.notice} role="alert">
							<span>
								Не удалось получить актуальную квоту сотрудников.
							</span>
							<Button
								size="sm"
								variant="secondary"
								onClick={() => void quota.refetch()}
							>
								Повторить
							</Button>
						</div>
					) : quota.isPending || quota.isFetching ? (
						<ScreenState
							compact
							variant="loading"
							description="Проверяем лимит сотрудников"
						/>
					) : (
						<section
							className={styles.quotaPanel}
							aria-label="Лимит сотрудников"
						>
							<div>
								<span className={styles.muted}>Использовано мест</span>
								<strong className={styles.quotaNumber}>
									{quota.data.quota!.usedSeats} /{' '}
									{quota.data.quota!.seatLimit}
								</strong>
								<span className={styles.muted}>
									Владелец включён в лимит и всегда сохраняет доступ.
								</span>
							</div>
							<div>
								<strong>
									{quota.data.quota!.waitingCount} в очереди допуска
								</strong>
								<p className={styles.muted}>
									Ожидающие и отключённые сотрудники не занимают места.
									Приглашение само по себе не выдаёт доступ.
								</p>
							</div>
						</section>
					)}
					<div
						className={styles.tabs}
						role="group"
						aria-label="Раздел настроек команды"
					>
						{(Object.keys(tabs) as TeamCollection[]).map(value => (
							<Button
								key={value}
								variant={tab === value ? 'primary' : 'secondary'}
								aria-pressed={tab === value}
								onClick={() => {
									setTab(value)
									setPage(1)
									setSelected(null)
								}}
							>
								{tabs[value]}
							</Button>
						))}
					</div>
					<section className={styles.panel} aria-label={tabs[tab]}>
						<div className={styles.panelHeader}>
							<div>
								<h2 className={styles.panelTitle}>{tabs[tab]}</h2>
								<p className={styles.muted}>
									{tab === 'members'
										? 'Владелец не входит в редактируемый список.'
										: tab === 'deliveries'
											? 'Только ошибки этого пространства; повтор не создаёт второго сотрудника.'
											: tab === 'invitations'
												? 'После подтверждения email квота и права проверяются отдельно.'
												: 'Отделы определяют область данных для руководителей.'}
								</p>
							</div>
							<Button
								size="sm"
								variant="secondary"
								tooltip="Загрузить актуальные записи команды и квоту сотрудников"
								disabled={records.isFetching}
								onClick={() => {
									void refresh()
										.then(() => toast('Список обновлён'))
										.catch(() => toast.error('Не удалось обновить список'))
								}}
							>
								Обновить
							</Button>
						</div>
						{records.isError ? (
							<ScreenState
								variant="error"
								description={records.error.message}
								action={
									<Button onClick={() => void records.refetch()}>
										Повторить
									</Button>
								}
							/>
						) : records.isPending || records.isFetching ? (
							<ScreenState compact variant="loading" />
						) : records.data.items.length ? (
							<DataTable
								caption={tabs[tab]}
								columns={columns}
								rows={records.data.items}
								getRowKey={row => row.id}
								embedded
							/>
						) : (
							<ScreenState
								variant="empty"
								title={
									page > 1
										? 'На этой странице нет записей'
										: tab === 'members'
											? 'В CRM пока работает только владелец'
											: tab === 'teams'
												? 'Отделов пока нет'
												: tab === 'invitations'
													? 'Приглашений пока нет'
													: 'Ошибок обработки нет'
								}
								description={
									page > 1
										? 'Перейдите на предыдущую страницу.'
										: tab === 'members'
											? 'Создайте приглашение, чтобы подключить сотрудника.'
											: undefined
								}
							/>
						)}
						<div className={styles.pagination}>
							<span>
								Страница {page} из {totalPages}
							</span>
							<div className={styles.actions}>
								<Button
									size="sm"
									variant="secondary"
									disabled={page === 1 || records.isFetching}
									onClick={() => setPage(value => value - 1)}
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
									onClick={() => setPage(value => value + 1)}
								>
									Далее
								</Button>
							</div>
						</div>
					</section>
					{selected ? (
						<TeamEditor
							key={`${workspace.workspaceId}:${session?.userId}:${sessionRevision}:${selected.kind}:${selected.record?.id ?? 'new'}`}
							context={context}
							selection={selected}
							onClose={() => setSelected(null)}
							onSaved={() => void refresh()}
							onReview={review}
						/>
					) : null}
				</>
			)}
		</div>
	)
}
export default SettingsScreen
