'use client'

import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { useDirtyForm, useDirtyFormGuard } from '@/shared/lib/dirty-form'

import { AssigneeSelect, useAssigneeOptions } from '@/entities/crm-team'
import { useSessionStore } from '@/entities/session'
import { getCustomer } from '@/entities/customer'
import Link from 'next/link'
import {
	getSalesDealContext,
	listSalesTimelineV3,
	listArchivedDealTasks,
	type SalesDeal,
	type SalesPipeline
} from '@/entities/sales'
import {
	Button,
	Drawer,
	ScreenState,
	SelectField,
	StatusBadge,
	TextareaField
} from '@/shared/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { useSalesCommand } from '../model/use-sales-command'
import { useSalesSession } from '../model/use-sales-session'
import { SalesCommandState } from './SalesCommandState'
import { NextActionFields } from './NextActionFields'
import { useSalesAssignees } from '../model/use-sales-assignees'
import { DealCommercePanel } from './DealCommercePanel'
import { InteractionResultForm } from './InteractionResultForm'
import styles from './SalesWorkflow.module.scss'

export const salesMoney = (minor: number) =>
	new Intl.NumberFormat('ru-RU', {
		style: 'currency',
		currency: 'RUB',
		maximumFractionDigits: 2
	}).format(minor / 100)
export const salesDate = (date: string) =>
	new Intl.DateTimeFormat('ru-RU', {
		dateStyle: 'medium',
		timeStyle: 'short'
	}).format(new Date(date))
const statuses = {
	OPEN: 'В работе',
	WON: 'Успешно',
	LOST: 'Отказ'
} as const
const historyLabels = {
	CREATED: 'Сделка создана',
	TRANSITIONED: 'Этап изменён',
	TASK_COMPLETED: 'Действие выполнено',
	ARCHIVED: 'Сделка архивирована',
	CALL_REACHED: 'Дозвонился',
	CALL_NO_ANSWER: 'Не ответил',
	MEETING_HELD: 'Встреча состоялась',
	ASSIGNEE_CHANGED: 'Ответственный изменён'
} as const

const DealEditor = ({
	deal,
	pipeline,
	enabled,
	command,
	onDirtyChange
}: {
	deal: SalesDeal
	pipeline: SalesPipeline | undefined
	enabled: boolean
	command: ReturnType<typeof useSalesCommand>
	onDirtyChange: (dirty: boolean) => void
}) => {
	const [expectedVersion, setExpectedVersion] = useState(deal.version)
	const [initialStageId, setInitialStageId] = useState(deal.stageId)
	const [targetStageId, setTargetStageId] = useState(deal.stageId)
	const [outcome, setOutcome] = useState('')
	const [taskTitle, setTaskTitle] = useState('')
	const [due, setDue] = useState('')
	const [confirmArchive, setConfirmArchive] = useState(false)
	const dirty =
		targetStageId !== initialStageId || !!outcome || !!taskTitle || !!due
	if (!dirty && !command.locked && expectedVersion !== deal.version) {
		setExpectedVersion(deal.version)
		setInitialStageId(deal.stageId)
		setTargetStageId(deal.stageId)
	}
	useEffect(() => {
		onDirtyChange(dirty)
	}, [dirty, onDirtyChange])
	useEffect(() => () => onDirtyChange(false), [onDirtyChange])
	useDirtyForm({
		dirty:
			targetStageId !== initialStageId ||
			!!outcome ||
			!!taskTitle ||
			!!due,
		label: 'Результат сделки'
	})
	const target = pipeline?.stages.find(stage => stage.id === targetStageId)
	const submit = (event: FormEvent) => {
		event.preventDefault()
		if (!enabled || command.locked) return
		if (!target) {
			toast.error('Выберите доступный этап')
			return
		}
		if (target.state === 'OPEN' && !Number.isFinite(Date.parse(due))) {
			toast.error('Укажите срок следующего действия')
			return
		}
		void command.execute({
			kind: 'transition',
			id: deal.id,
			expectedVersion,
			targetStageId,
			outcome: outcome.trim(),
			...(target.state === 'OPEN'
				? {
						nextTask: {
							title: taskTitle.trim(),
							dueAt: new Date(due).toISOString()
						}
					}
				: {})
		})
	}
	return (
		<section className={styles.section}>
			<h3>Этап и следующий шаг</h3>
			{!enabled ? (
				<p className={styles.muted}>
					Изменения доступны после проверки актуальных данных и прав.
				</p>
			) : null}
			<form
				id="deal-result-form"
				className={styles.form}
				onSubmit={submit}
			>
				<fieldset
					className={styles.fields}
					disabled={command.locked || !enabled}
				>
					<SelectField
						label="Следующий этап"
						value={targetStageId}
						onChange={event => setTargetStageId(event.target.value)}
					>
						{pipeline?.stages.map(stage => (
							<option key={stage.id} value={stage.id}>
								{stage.name}
							</option>
						))}
					</SelectField>
					<TextareaField
						label="Что сделано / результат"
						value={outcome}
						onChange={event => setOutcome(event.target.value)}
						required
						maxLength={4000}
						rows={3}
					/>
					{target?.state === 'OPEN' ? (
						<>
							{deal.nextTask ? (
								<p className={styles.muted}>
									При сохранении результата текущее следующее действие «
									{deal.nextTask.title}» завершится. Вместо него будет
									создано действие, указанное ниже; остальные задачи
									останутся без изменений.
								</p>
							) : null}
							<NextActionFields
								title={taskTitle}
								onTitleChange={setTaskTitle}
								due={due}
								onDueChange={setDue}
							/>
						</>
					) : (
						<p className={styles.muted}>
							Все открытые задачи по сделке завершатся при закрытии.
						</p>
					)}
				</fieldset>
				<Button
					type="submit"
					disabled={!enabled || command.locked}
					isLoading={command.pending}
				>
					Сохранить результат
				</Button>
			</form>
			{confirmArchive ? (
				<div className={styles.error}>
					<p>
						Архивировать сделку? Открытые задачи будут отменены. История
						сохранится.
					</p>
					<div className={styles.actions}>
						<Button
							variant="danger"
							disabled={command.locked || !enabled}
							onClick={() =>
								void command.execute({
									kind: 'archive',
									id: deal.id,
									expectedVersion
								})
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
					disabled={command.locked || !enabled}
					tooltip="Открыть подтверждение архивации: сделка уйдёт из активных, открытые задачи будут отменены, история сохранится."
					onClick={() => setConfirmArchive(true)}
				>
					Архивировать сделку
				</Button>
			)}
		</section>
	)
}

export const DealDetailsDrawer = ({
	id,
	pipelines,
	onClose,
	onSaved,
	archive = 'ACTIVE'
}: {
	archive?: 'ACTIVE' | 'ARCHIVED'
	id: string
	pipelines: SalesPipeline[]
	onClose: () => void
	onSaved: () => void
}) => {
	const context = useSalesSession()
	const queryClient = useQueryClient()
	const [page, setPage] = useState(1)
	const [taskPage, setTaskPage] = useState(1)
	const [recipient, setRecipient] = useState<{
		subject: string
		membershipId: string
	} | null>(null)
	const [openedAt] = useState(() => Date.now())
	const [editorRevision, setEditorRevision] = useState(0)
	const [commerceBusy, setCommerceBusy] = useState(false)
	const [stageDirty, setStageDirty] = useState(false)
	const [interactionDirty, setInteractionDirty] = useState(false)
	const [tab, setTab] = useState<'overview' | 'commerce' | 'history'>(
		'overview'
	)
	const tabsId = useId()
	const tabs = [
		{ id: 'overview', label: 'Обзор' },
		...(archive === 'ACTIVE'
			? [{ id: 'commerce' as const, label: 'КП и оплаты' }]
			: []),
		{ id: 'history', label: 'История' }
	] as const
	const detail = useQuery({
		queryKey: ['sales', 'deal-context', ...context.key, id, archive],
		enabled: context.canRead && !!context.session,
		queryFn: () =>
			getSalesDealContext(
				context.session!.accessToken,
				context.workspace.workspaceId,
				id,
				archive
			),
		retry: false,
		gcTime: 0
	})
	const history = useQuery({
		queryKey: ['sales', 'timeline-v3', ...context.key, id, archive, page],
		enabled:
			context.canRead &&
			!!context.session &&
			!!detail.data &&
			!detail.isError,
		queryFn: () =>
			listSalesTimelineV3(
				context.session!.accessToken,
				context.workspace.workspaceId,
				id,
				page,
				archive
			),
		retry: false,
		gcTime: 0
	})
	const archivedTasks = useQuery({
		queryKey: ['sales', 'archived-tasks', ...context.key, id, taskPage],
		enabled:
			archive === 'ARCHIVED' &&
			context.canRead &&
			!!context.session &&
			!!detail.data &&
			!detail.isError,
		queryFn: () =>
			listArchivedDealTasks(
				context.session!.accessToken,
				context.workspace.workspaceId,
				id,
				taskPage
			),
		retry: false,
		gcTime: 0
	})
	const draftGuard = useDirtyFormGuard()
	const transientDetailError =
		detail.error instanceof AuthenticatedApiError &&
		detail.error.kind === 'temporary'
	const showDetail =
		!detail.isError || (transientDetailError && !!detail.data)
	const deal = showDetail ? detail.data?.deal : undefined
	const directory = useAssigneeOptions(
		{
			workspaceId: context.workspace.workspaceId,
			subject: context.session?.userId,
			accessToken: context.session?.accessToken,
			sessionRevision: context.sessionRevision,
			canRead: context.canRead && context.canWrite && archive === 'ACTIVE',
			authority: context.permissions.data,
			isCurrent: () => {
				const current = useSessionStore.getState()
				return (
					context.canRead &&
					context.canWrite &&
					!context.permissions.isFetching &&
					!context.permissions.isError &&
					current.session?.accessToken === context.session?.accessToken &&
					current.sessionRevision === context.sessionRevision
				)
			}
		},
		{
			...(deal?.teamId ? { teamId: deal.teamId } : {}),
			selectedSubject: recipient?.subject
		}
	)
	useDirtyForm({ dirty: !!recipient, label: 'Передача сделки' })
	const pipeline = pipelines.find(item => item.id === deal?.pipelineId)
	const assigneeLabel = useSalesAssignees(
		context,
		deal && !detail.isError
			? [
					deal.assignedToSubject,
					...(history.isError
						? []
						: (history.data?.items.flatMap(item =>
								item.details
									? [item.details.beforeSubject, item.details.afterSubject]
									: []
							) ?? []))
				]
			: []
	)
	const canReadContact =
		context.canRead &&
		context.permissions.data?.permissions.includes('customers:read') ===
			true
	const contact = useQuery({
		queryKey: [
			'crm-customer-detail',
			...context.key,
			'deal-contact',
			deal?.contactId
		],
		enabled: canReadContact && !!deal && !detail.isError,
		queryFn: () =>
			getCustomer(
				context.session!.accessToken,
				'contacts',
				context.workspace.workspaceId,
				deal!.contactId
			),
		retry: false,
		gcTime: 0
	})
	const readableContact =
		canReadContact &&
		!contact.isError &&
		!contact.isFetching &&
		contact.data?.kind === 'contacts'
			? contact.data
			: undefined
	const companyId = readableContact?.companyId
	const company = useQuery({
		queryKey: [
			'crm-customer-detail',
			...context.key,
			'deal-company',
			companyId
		],
		enabled: canReadContact && !!companyId && !detail.isError,
		queryFn: () =>
			getCustomer(
				context.session!.accessToken,
				'companies',
				context.workspace.workspaceId,
				companyId!
			),
		retry: false,
		gcTime: 0
	})
	const readableCompany =
		canReadContact &&
		!company.isError &&
		!company.isFetching &&
		company.data?.kind === 'companies' &&
		company.data.id === companyId
			? company.data
			: undefined
	const quoteCustomerDetails = readableContact
		? [
				readableCompany?.legalName || readableCompany?.name,
				readableCompany?.inn ? `ИНН: ${readableCompany.inn}` : null,
				readableCompany?.kpp ? `КПП: ${readableCompany.kpp}` : null,
				readableCompany?.ogrn ? `ОГРН: ${readableCompany.ogrn}` : null,
				readableCompany?.legalAddress,
				readableContact.name,
				readableContact.phone,
				readableContact.email
			]
				.filter(Boolean)
				.join('\n')
		: undefined
	const reload = async () => {
		const [auth, record] = await Promise.all([
			context.permissions.refetch(),
			detail.refetch()
		])
		if (auth.isError || record.isError)
			throw new Error('Не удалось обновить данные')
	}
	const command = useSalesCommand(
		context.workspace.workspaceId,
		context.session?.accessToken || '',
		context.canWrite && archive === 'ACTIVE',
		result => {
			queryClient.setQueryData(
				['sales', 'deal-context', ...context.key, id, archive],
				{ deal: result, company: detail.data?.company ?? null }
			)
			setEditorRevision(value => value + 1)
			setRecipient(null)
			onSaved()
			if (result.archivedAt) onClose()
			else {
				void detail.refetch()
				void history.refetch()
			}
		},
		`deal:${id}`,
		context.scopeKey
	)
	return (
		<Drawer
			isOpen
			onClose={() => {
				if (commerceBusy) {
					toast(
						'Сохраните или отмените изменения состава и подтвердите результат текущей команды.'
					)
					return
				}
				if (command.canClose()) onClose()
			}}
			title={
				context.canRead && showDetail ? deal?.title || 'Сделка' : 'Сделка'
			}
			description={
				context.canRead && showDetail ? pipeline?.name : undefined
			}
			footer={
				tab === 'overview' &&
				archive === 'ACTIVE' &&
				context.canRead &&
				showDetail &&
				deal ? (
					<Button
						type="submit"
						form="deal-interaction-form"
						disabled={
							!context.canWrite ||
							detail.isFetching ||
							detail.isError ||
							stageDirty ||
							commerceBusy ||
							command.locked
						}
						isLoading={command.pending}
						tooltip="Записать итог разговора и выбранное следующее действие"
					>
						Сохранить результат общения
					</Button>
				) : null
			}
		>
			<SalesCommandState
				command={command}
				onReview={async () => {
					await reload()
					draftGuard.confirmDiscard(() => {
						command.resetAfterReview()
						setEditorRevision(value => value + 1)
					})
				}}
			/>
			{!context.canRead ? (
				<ScreenState
					variant={
						context.permissions.isPending ? 'loading' : 'permission'
					}
				/>
			) : detail.isError && !showDetail ? (
				<ScreenState
					variant="error"
					description="Карточка недоступна. Данные не показаны до успешной проверки."
					action={
						<Button onClick={() => void detail.refetch()}>
							Повторить
						</Button>
					}
				/>
			) : detail.isPending || !deal ? (
				<ScreenState variant="loading" />
			) : (
				<div className={styles.content}>
					{detail.isError ? (
						<ScreenState
							compact
							variant="error"
							description="Не удалось обновить карточку. Черновик сохранён. Повторите загрузку перед сохранением."
							action={
								<Button onClick={() => void detail.refetch()}>
									Повторить
								</Button>
							}
						/>
					) : null}
					{archive === 'ARCHIVED' ? (
						<p className={styles.muted}>
							Архивная сделка. Доступны просмотр и история.
						</p>
					) : null}
					<section className={styles.summary} aria-label="Клиент и сделка">
						<div className={styles.summaryHeading}>
							{canReadContact ? (
								<Link
									className={styles.contactLink}
									href={`/contacts?contactId=${encodeURIComponent(deal.contactId)}`}
									onClick={event => {
										if (commerceBusy || !command.canClose())
											event.preventDefault()
									}}
								>
									{deal.contactName}
								</Link>
							) : (
								<span className={styles.contactName}>
									{deal.contactName}
								</span>
							)}
							<StatusBadge
								tone={
									deal.status === 'WON'
										? 'success'
										: deal.status === 'LOST'
											? 'danger'
											: 'info'
								}
							>
								{pipeline?.stages.find(stage => stage.id === deal.stageId)
									?.name || statuses[deal.status]}
							</StatusBadge>
						</div>
						{canReadContact &&
						!contact.isError &&
						contact.data?.kind === 'contacts' ? (
							<div className={styles.contactChannels}>
								{contact.data.phone ? (
									<a
										href={`tel:${contact.data.phone}`}
										onClick={() => toast('Открытие звонка')}
									>
										{contact.data.phone}
									</a>
								) : null}
								{contact.data.email ? (
									<a
										href={`mailto:${contact.data.email}`}
										onClick={() => toast('Открытие письма')}
									>
										{contact.data.email}
									</a>
								) : null}
							</div>
						) : canReadContact && contact.isError ? (
							<p className={styles.muted}>
								Контактные данные временно недоступны.
							</p>
						) : null}
						{detail.data?.company && !detail.isError ? (
							<p>
								<Link
									className={styles.contactLink}
									href={`/contacts?companyId=${encodeURIComponent(detail.data.company.id)}`}
								>
									{detail.data.company.name}
								</Link>
								{detail.data.company.inn
									? ` · ИНН ${detail.data.company.inn}`
									: ''}
							</p>
						) : null}
						<dl className={styles.details}>
							<div>
								<dt>Сумма сделки</dt>
								<dd className={styles.amount}>
									{salesMoney(deal.amountMinor)}
								</dd>
							</div>
							<div>
								<dt>Ответственный</dt>
								<dd>{assigneeLabel(deal.assignedToSubject)}</dd>
							</div>
						</dl>
					</section>
					{archive === 'ARCHIVED' ? (
						<section className={styles.section}>
							<h3>Задачи архивной сделки</h3>
							{archivedTasks.isError ? (
								<ScreenState
									variant="error"
									compact
									action={
										<Button onClick={() => void archivedTasks.refetch()}>
											Повторить
										</Button>
									}
								/>
							) : archivedTasks.isPending ? (
								<ScreenState variant="loading" compact />
							) : (
								<>
									<ul>
										{archivedTasks.data?.items.map(task => (
											<li key={task.id}>
												{task.title} · {salesDate(task.dueAt)} ·{' '}
												{task.status === 'COMPLETED'
													? 'Завершена'
													: task.status === 'CANCELLED'
														? 'Отменена'
														: 'В работе'}
											</li>
										))}
									</ul>
									<div className={styles.actions}>
										<Button
											variant="ghost"
											disabled={taskPage === 1 || archivedTasks.isFetching}
											onClick={() => setTaskPage(value => value - 1)}
										>
											Назад
										</Button>
										<span>Страница {taskPage}</span>
										<Button
											variant="ghost"
											disabled={
												taskPage * 10 >=
													(archivedTasks.data?.total ?? 0) ||
												archivedTasks.isFetching
											}
											onClick={() => setTaskPage(value => value + 1)}
										>
											Далее
										</Button>
									</div>
								</>
							)}
						</section>
					) : null}
					{archive === 'ACTIVE' && context.canWrite ? (
						<section className={styles.section}>
							<h3>Передать сделку</h3>
							<p className={styles.muted}>
								Активные задачи прежнего ответственного перейдут выбранному
								сотруднику. Остальные назначения сохранятся, если
								сотрудникам останется доступ к сделке.
							</p>
							<AssigneeSelect
								options={directory}
								value={recipient}
								label="Новый ответственный"
								disabled={
									command.locked ||
									stageDirty ||
									interactionDirty ||
									commerceBusy
								}
								onChange={employee =>
									setRecipient({
										subject: employee.subject,
										membershipId: employee.membershipId
									})
								}
							/>
							<Button
								disabled={
									!recipient ||
									!directory.resolveBinding(recipient) ||
									command.locked ||
									detail.isError ||
									detail.isFetching ||
									stageDirty ||
									interactionDirty ||
									commerceBusy
								}
								onClick={() => {
									if (!recipient || !directory.resolveBinding(recipient))
										return
									void command.execute({
										kind: 'assign',
										id: deal.id,
										expectedVersion: deal.version,
										assignee: recipient
									})
								}}
							>
								Передать выбранному сотруднику
							</Button>
						</section>
					) : null}
					<section
						className={styles.nextAction}
						aria-label="Следующее действие по сделке"
					>
						<h3>Следующее действие</h3>
						<strong>
							{deal.nextTask?.title ||
								(deal.status === 'OPEN'
									? 'Нет следующего действия'
									: 'Сделка закрыта')}
						</strong>
						{deal.nextTask ? (
							<div className={styles.actions}>
								<Link
									className={styles.contactLink}
									href={`/tasks?task=${encodeURIComponent(deal.nextTask.id)}&workspaceId=${encodeURIComponent(deal.workspaceId)}`}
									onClick={event => {
										if (
											!context.canRead ||
											context.permissions.isFetching ||
											detail.isError ||
											detail.isFetching ||
											commerceBusy ||
											!command.canClose()
										)
											event.preventDefault()
									}}
								>
									Открыть задачу
								</Link>
								<time dateTime={deal.nextTask.dueAt}>
									{salesDate(deal.nextTask.dueAt)}
								</time>
								{Date.parse(deal.nextTask.dueAt) < openedAt ? (
									<StatusBadge tone="danger">
										Действие просрочено
									</StatusBadge>
								) : null}
							</div>
						) : deal.status === 'OPEN' ? (
							<p className={styles.muted}>
								Запланируйте звонок, встречу или другое действие ниже.
							</p>
						) : null}
					</section>
					<div
						className={styles.tabs}
						role="tablist"
						aria-label="Разделы сделки"
					>
						{tabs.map((item, index) => (
							<button
								key={item.id}
								type="button"
								role="tab"
								id={`${tabsId}-${item.id}-tab`}
								aria-controls={`${tabsId}-${item.id}`}
								aria-selected={tab === item.id}
								tabIndex={tab === item.id ? 0 : -1}
								disabled={command.pending || command.ambiguous}
								onClick={() => setTab(item.id)}
								onKeyDown={event => {
									const next =
										event.key === 'ArrowRight'
											? (index + 1) % tabs.length
											: event.key === 'ArrowLeft'
												? (index + tabs.length - 1) % tabs.length
												: event.key === 'Home'
													? 0
													: event.key === 'End'
														? tabs.length - 1
														: -1
									if (next < 0) return
									event.preventDefault()
									setTab(tabs[next].id)
									document
										.getElementById(`${tabsId}-${tabs[next].id}-tab`)
										?.focus()
								}}
							>
								{item.label}
							</button>
						))}
					</div>
					<div
						role="tabpanel"
						id={`${tabsId}-commerce`}
						aria-labelledby={`${tabsId}-commerce-tab`}
						hidden={tab !== 'commerce'}
						inert={tab !== 'commerce'}
					>
						{stageDirty || interactionDirty ? (
							<p className={styles.muted}>
								Сохраните или очистите результат общения и изменения этапа
								во вкладке «Обзор», чтобы изменять КП и оплаты.
							</p>
						) : null}
						{archive === 'ACTIVE' ? (
							<DealCommercePanel
								context={{
									...context,
									canWrite:
										context.canWrite &&
										archive === 'ACTIVE' &&
										!stageDirty &&
										!interactionDirty &&
										!command.locked
								}}
								dealId={deal.id}
								customerDetailsSuggestion={quoteCustomerDetails}
								onBusyChange={setCommerceBusy}
								onSaved={() => {
									onSaved()
									void detail.refetch()
								}}
							/>
						) : null}
					</div>
					<div
						role="tabpanel"
						id={`${tabsId}-overview`}
						aria-labelledby={`${tabsId}-overview-tab`}
						hidden={tab !== 'overview'}
						inert={tab !== 'overview'}
						className={styles.overviewPanel}
					>
						{stageDirty || commerceBusy ? (
							<p className={styles.muted}>
								Завершите редактирование этапа или КП перед сохранением
								результата общения.
							</p>
						) : null}
						<InteractionResultForm
							key={`interaction-${editorRevision}`}
							deal={deal}
							command={command}
							onDirtyChange={setInteractionDirty}
							enabled={
								context.canWrite &&
								archive === 'ACTIVE' &&
								!detail.isFetching &&
								!detail.isError &&
								!commerceBusy &&
								!stageDirty
							}
						/>
						<details className={styles.stageDetails}>
							<summary>Изменить этап или закрыть сделку</summary>
							<DealEditor
								key={editorRevision}
								deal={deal}
								pipeline={pipeline}
								enabled={
									context.canWrite &&
									archive === 'ACTIVE' &&
									!detail.isFetching &&
									!detail.isError &&
									!commerceBusy &&
									!interactionDirty &&
									!!pipeline
								}
								command={command}
								onDirtyChange={setStageDirty}
							/>
						</details>
					</div>
					<div
						role="tabpanel"
						id={`${tabsId}-history`}
						aria-labelledby={`${tabsId}-history-tab`}
						hidden={tab !== 'history'}
						inert={tab !== 'history'}
					>
						<section className={styles.section}>
							<h3>История сделки</h3>
							{history.isError ? (
								<ScreenState
									variant="error"
									compact
									action={
										<Button
											variant="secondary"
											onClick={() => void history.refetch()}
										>
											Повторить
										</Button>
									}
								/>
							) : history.isPending ? (
								<ScreenState variant="loading" compact />
							) : (
								<>
									<ol className={styles.history}>
										{history.data?.items.map(item => (
											<li key={item.id}>
												<strong>{historyLabels[item.kind]}</strong>
												{item.outcome ? <p>{item.outcome}</p> : null}
												{item.details ? (
													<p>
														{assigneeLabel(item.details.beforeSubject)} →{' '}
														{assigneeLabel(item.details.afterSubject)}.
														Перенесено активных задач:{' '}
														{item.details.transferredTaskCount}
													</p>
												) : null}
												<time dateTime={item.createdAt}>
													{salesDate(item.createdAt)}
												</time>
											</li>
										))}
									</ol>
									<div className={styles.pagination}>
										<Button
											size="sm"
											variant="ghost"
											disabled={page === 1 || history.isFetching}
											onClick={() => setPage(value => value - 1)}
										>
											Назад
										</Button>
										<span>Страница {page}</span>
										<Button
											size="sm"
											variant="ghost"
											disabled={
												page * 10 >= (history.data?.total || 0) ||
												history.isFetching
											}
											onClick={() => setPage(value => value + 1)}
										>
											Далее
										</Button>
									</div>
								</>
							)}
						</section>
					</div>
				</div>
			)}
		</Drawer>
	)
}
