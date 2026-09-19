'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
	useWorkdaySession,
	type WorkdayTask
} from '@/entities/crm-workday'
import {
	AssigneeSelect,
	TeamSelect,
	useAssigneeOptions,
	useTeamOptions,
	type AssigneeBinding
} from '@/entities/crm-team'
import {
	getSalesDeal,
	listSalesDeals,
	type SalesDeal
} from '@/entities/sales'
import {
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import {
	Button,
	Drawer,
	ScreenState,
	SelectField,
	TextField
} from '@/shared/ui'
import { useWorkdayCommand } from '../model/use-workday-command'
import {
	deviceTimeZone,
	taskDueIso,
	workdayDirectoryContext
} from '../model/workday-form'
import { WorkdayCommandState } from './WorkdayCommandState'
import styles from './WorkdayTaskDrawer.module.scss'

export interface WorkdayCreateTaskDrawerProps {
	onClose: () => void
	onSaved?: (task: WorkdayTask) => void
	// Supplied only after an explicit next-step action and a fresh scoped read.
	initialDeal?: SalesDeal | null
}
export const WorkdayCreateTaskDrawer = (
	props: WorkdayCreateTaskDrawerProps
) => {
	const context = useWorkdaySession()
	return <CreateForm key={JSON.stringify(context.key)} {...props} />
}
const CreateForm = ({
	onClose,
	onSaved,
	initialDeal
}: WorkdayCreateTaskDrawerProps) => {
	const [title, setTitle] = useState('')
	const [due, setDue] = useState('')
	const [linked, setLinked] = useState(!!initialDeal)
	const [deal, setDeal] = useState<SalesDeal | null>(initialDeal ?? null)
	const [teamId, setTeamId] = useState('')
	const [assignee, setAssignee] = useState<AssigneeBinding | null>(null)
	const [checking, setChecking] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const mounted = useRef(true)
	useLayoutEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
		}
	}, [])
	const command = useWorkdayCommand('create-task', task => {
		onSaved?.(task)
		onClose()
	})
	const context = command.context
	const effectiveTeam = linked ? (deal?.teamId ?? '') : teamId
	const options = useAssigneeOptions(workdayDirectoryContext(context), {
		selectedSubject: assignee?.subject ?? context.session?.userId,
		...(effectiveTeam ? { teamId: effectiveTeam } : {})
	})
	const creator = context.session
		? options.resolveBinding({ subject: context.session.userId })
		: null
	const selected =
		assignee ??
		(creator
			? { subject: creator.subject, membershipId: creator.membershipId }
			: null)
	const resolved = selected ? options.resolveBinding(selected) : null
	const teams = useTeamOptions(
		{
			workspaceId: context.workspace.workspaceId,
			subject: context.session?.userId,
			accessToken: context.session?.accessToken,
			sessionRevision: context.sessionRevision,
			permissionScope: context.scopeKey,
			teamIds: context.permissions.data?.teamIds ?? [],
			enabled: context.canRead && !linked
		},
		teamId
	)
	const dueAt = taskDueIso(due)
	const locked = command.locked || checking
	const close = () => {
		if (command.canClose()) {
			mounted.current = false
			onClose()
		}
	}
	const save = async () => {
		if (
			locked ||
			!title.trim() ||
			!dueAt ||
			!resolved ||
			(linked && !deal) ||
			(!linked && !teams.validSelection)
		)
			return
		const captured = {
			title,
			dueAt,
			dealId: linked ? deal!.id : null,
			teamId: linked ? null : teamId || null,
			assignee: {
				subject: resolved.subject,
				membershipId: resolved.membershipId
			}
		}
		const selectedTeam = deal?.teamId
		setChecking(true)
		setError(null)
		try {
			if (!context.current() || !context.session)
				throw invalidContractError()
			if (captured.dealId) {
				const fresh = await getSalesDeal(
					context.session.accessToken,
					context.workspace.workspaceId,
					captured.dealId
				)
				if (!mounted.current || !context.current()) return
				if (
					fresh.status !== 'OPEN' ||
					fresh.archivedAt !== null ||
					fresh.teamId !== selectedTeam
				)
					throw new AuthenticatedApiError(
						'conflict',
						'Связанная сделка изменилась. Выберите её заново перед сохранением.'
					)
			}
			if (!mounted.current || !context.current()) return
			await command.execute({ kind: 'create', ...captured })
		} catch (cause) {
			if (!mounted.current || !context.current()) return
			const message =
				cause instanceof AuthenticatedApiError
					? cause.message
					: 'Не удалось проверить связанную сделку. Задача не отправлена.'
			setError(message)
			toast.error(message)
		} finally {
			if (mounted.current) setChecking(false)
		}
	}
	return (
		<Drawer
			isOpen
			onClose={close}
			title="Новая задача"
			description="Создайте самостоятельную задачу или свяжите её с доступной сделкой."
			size="lg"
		>
			{context.permissions.isFetching ? (
				<ScreenState
					variant="loading"
					description="Проверяем права доступа. Ваш черновик сохранён в открытой форме."
				/>
			) : null}
			<div
				hidden={context.permissions.isFetching}
				inert={context.permissions.isFetching}
				aria-hidden={context.permissions.isFetching}
			>
				<div className={styles.content}>
					{!context.canWrite ? (
						<p className={styles.note}>
							Создание недоступно в режиме чтения или без подтверждённых
							прав.
						</p>
					) : null}
					<section className={styles.section} aria-label="Новая задача">
						<TextField
							label="Название задачи"
							value={title}
							maxLength={200}
							disabled={locked}
							onChange={event => setTitle(event.target.value)}
						/>
						<TextField
							label="Срок выполнения"
							type="datetime-local"
							value={due}
							disabled={locked}
							onChange={event => setDue(event.target.value)}
							hint={`Часовой пояс устройства: ${deviceTimeZone()}.`}
							error={
								due && !dueAt
									? 'Укажите существующую дату и время.'
									: undefined
							}
						/>
						<SelectField
							label="Связь со сделкой"
							value={linked ? 'deal' : 'standalone'}
							disabled={locked}
							onChange={event => {
								setLinked(event.target.value === 'deal')
								toast(
									event.target.value === 'deal'
										? 'Выберите связанную сделку'
										: 'Самостоятельная задача'
								)
							}}
						>
							<option value="standalone">Без сделки</option>
							<option value="deal">Связать со сделкой</option>
						</SelectField>
						{linked ? (
							<WorkdayDealChoice
								context={context}
								value={deal}
								onChange={setDeal}
								disabled={locked}
							/>
						) : (
							<TeamSelect
								options={teams}
								value={teamId}
								onChange={setTeamId}
								disabled={locked}
								label="Отдел задачи"
							/>
						)}
						<AssigneeSelect
							options={options}
							value={selected}
							onChange={option =>
								setAssignee({
									subject: option.subject,
									membershipId: option.membershipId
								})
							}
							disabled={locked}
						/>
						{!assignee && !creator && !options.loading ? (
							<p className={styles.note}>
								Не удалось подтвердить текущее назначение на создателя.
								Выберите доступного сотрудника явно.
							</p>
						) : null}
					</section>
					{error ? (
						<p className={styles.error} role="alert">
							{error}
						</p>
					) : null}
					<WorkdayCommandState command={command} />
					{command.blocked ? (
						<p className={styles.warning}>
							Команда отклонена. Закройте форму и откройте её заново после
							проверки доступа и данных.
						</p>
					) : null}
					<div className={styles.footer}>
						<Button variant="secondary" onClick={close}>
							Закрыть
						</Button>
						<Button
							tooltip="Сохранить задачу с выбранным сроком, ответственным и связью со сделкой, если она указана."
							disabled={
								locked ||
								!title.trim() ||
								!dueAt ||
								!resolved ||
								(linked && !deal) ||
								(!linked && !teams.validSelection)
							}
							onClick={() => void save()}
						>
							{command.pending
								? 'Сохраняем…'
								: checking
									? 'Проверяем данные…'
									: 'Создать задачу'}
						</Button>
					</div>
				</div>
			</div>
		</Drawer>
	)
}

export const WorkdayDealChoice = ({
	context,
	value,
	onChange,
	disabled
}: {
	context: ReturnType<typeof useWorkdaySession>
	value: SalesDeal | null
	onChange: (deal: SalesDeal | null) => void
	disabled: boolean
}) => {
	const [search, setSearch] = useState('')
	const [appliedSearch, setAppliedSearch] = useState('')
	const [page, setPage] = useState(1)
	const records = useQuery({
		queryKey: [
			'workday-deal-options',
			...context.key,
			appliedSearch,
			page
		],
		enabled: context.canRead,
		retry: false,
		staleTime: 0,
		gcTime: 0,
		refetchOnWindowFocus: false,
		queryFn: async () => {
			if (!context.current() || !context.session)
				throw invalidContractError()
			const result = await listSalesDeals(
				context.session.accessToken,
				context.workspace.workspaceId,
				page,
				20,
				appliedSearch,
				'',
				'OPEN'
			)
			if (
				!context.current() ||
				result.items.some(deal => deal.status !== 'OPEN')
			)
				throw invalidContractError()
			return result
		}
	})
	const data =
		context.canRead && !records.isError ? records.data : undefined
	return (
		<div className={styles.content}>
			<div className={styles.search}>
				<TextField
					label="Поиск сделки"
					value={search}
					maxLength={200}
					disabled={disabled}
					onChange={event => setSearch(event.target.value)}
				/>
				<Button
					variant="secondary"
					disabled={disabled || records.isFetching}
					tooltip="Найти доступную сделку для привязки этой задачи."
					onClick={() => {
						setAppliedSearch(search.trim())
						setPage(1)
						toast('Поиск сделок обновлён')
					}}
				>
					Найти сделку
				</Button>
			</div>
			<SelectField
				label="Связанная сделка"
				value={value?.id ?? ''}
				disabled={disabled || records.isFetching || !data}
				onChange={event => {
					const selected = data?.items.find(
						deal => deal.id === event.target.value
					)
					if (selected) {
						onChange(selected)
						toast('Сделка выбрана')
					}
				}}
			>
				<option value="" disabled>
					Выберите сделку
				</option>
				{value &&
				data &&
				!data.items.some(deal => deal.id === value.id) ? (
					<option value={value.id}>{value.title}</option>
				) : null}
				{data?.items.map(deal => (
					<option value={deal.id} key={deal.id}>
						{deal.title}
					</option>
				))}
			</SelectField>
			{records.isError ? (
				<ScreenState
					compact
					variant="error"
					description="Не удалось загрузить доступные сделки."
					action={
						<Button
							variant="secondary"
							onClick={() => void records.refetch()}
						>
							Повторить загрузку сделок
						</Button>
					}
				/>
			) : records.isPending ? (
				<p className={styles.note}>Загружаем сделки…</p>
			) : data?.total === 0 ? (
				<p className={styles.note}>
					Доступные открытые сделки не найдены.
				</p>
			) : null}
			<nav className={styles.pagination} aria-label="Страницы сделок">
				<Button
					variant="secondary"
					disabled={disabled || records.isFetching || page === 1}
					onClick={() => {
						setPage(page - 1)
						toast('Предыдущая страница сделок')
					}}
				>
					Назад
				</Button>
				<span>Страница {page}</span>
				<Button
					variant="secondary"
					disabled={
						disabled ||
						records.isFetching ||
						!data ||
						page * 20 >= data.total
					}
					onClick={() => {
						setPage(page + 1)
						toast('Следующая страница сделок')
					}}
				>
					Далее
				</Button>
			</nav>
		</div>
	)
}
