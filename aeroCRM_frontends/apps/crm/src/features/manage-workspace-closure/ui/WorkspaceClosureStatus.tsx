'use client'

import {
	getClosedWorkspaceBilling,
	getClosedWorkspaceBillingHistory,
	getClosedWorkspaceBillingOrder,
	getWorkspaceClosure,
	type WorkspaceClosureView
} from '@/entities/workspace-closure'
import { useSessionStore } from '@/entities/session'
import { invalidContractError } from '@/shared/api/authenticated-http-client'
import { Button, ScreenState, StatusBadge } from '@/shared/ui'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
	billingDate,
	billingFulfillmentLabel,
	billingMoney,
	billingOrderLabel
} from '@/features/manage-crm-billing/model/billing-display'
import styles from './WorkspaceClosure.module.scss'

const serviceNames: Record<
	WorkspaceClosureView['steps'][number]['service'],
	string
> = {
	'crm-access': 'Доступ CRM',
	identity: 'Аккаунты и приглашения',
	billing: 'Подписка и платежи',
	'crm-customers': 'Клиенты',
	'crm-sales': 'Сделки и задачи',
	'crm-intake': 'Приём обращений',
	'notification-delivery': 'Отправка уведомлений'
}

const stepNames = {
	PENDING: 'Ожидает остановки',
	FENCED: 'Новые действия остановлены',
	SETTLED: 'Завершено'
} as const

const ClosedFinancialHistory = ({
	closure,
	current,
	accessToken,
	subject,
	sessionRevision
}: {
	closure: WorkspaceClosureView
	current: () => boolean
	accessToken: string
	subject: string
	sessionRevision: number
}) => {
	const scope = [subject, sessionRevision, closure.workspaceId, closure.id]
	const [page, setPage] = useState(1)
	const [orderId, setOrderId] = useState<string | null>(null)
	const summary = useQuery({
		queryKey: ['crm-closed-billing', ...scope],
		queryFn: async () => {
			const value = await getClosedWorkspaceBilling(
				accessToken,
				closure.id,
				closure.workspaceId,
				subject
			)
			if (!current()) throw invalidContractError()
			return value
		},
		retry: false,
		staleTime: 0,
		gcTime: 0,
		refetchOnWindowFocus: false
	})
	const history = useQuery({
		queryKey: ['crm-closed-billing-history', ...scope, page],
		queryFn: async () => {
			const value = await getClosedWorkspaceBillingHistory(
				accessToken,
				closure.id,
				closure.workspaceId,
				subject,
				page,
				20
			)
			if (!current()) throw invalidContractError()
			return value
		},
		retry: false,
		staleTime: 0,
		gcTime: 0,
		refetchOnWindowFocus: false
	})
	const order = useQuery({
		queryKey: ['crm-closed-billing-order', ...scope, orderId],
		queryFn: async () => {
			const value = await getClosedWorkspaceBillingOrder(
				accessToken,
				closure.id,
				closure.workspaceId,
				subject,
				orderId!
			)
			if (!current()) throw invalidContractError()
			return value
		},
		enabled: !!orderId,
		retry: false,
		staleTime: 0,
		gcTime: 0,
		refetchOnWindowFocus: false
	})
	const pages = Math.max(1, Math.ceil((history.data?.total ?? 0) / 20))
	if (summary.isError || history.isError || order.isError)
		return (
			<section
				className={styles.card}
				aria-label="Финансовая история закрытого пространства"
			>
				<h2>Подписка и история платежей</h2>
				<p className={styles.notice} role="alert">
					Не удалось подтвердить доступ к финансовой истории. Обновите
					данные.
				</p>
				<Button
					variant="secondary"
					onClick={() => {
						void summary.refetch()
						void history.refetch()
						if (orderId) void order.refetch()
					}}
				>
					Повторить проверку
				</Button>
			</section>
		)
	return (
		<section
			className={styles.card}
			aria-label="Финансовая история закрытого пространства"
		>
			<h2>Подписка и история платежей</h2>
			<p className={styles.muted}>
				История сохраняется после закрытия. Результат ранее начатого
				платежа может поступить позже; обновите данные, чтобы увидеть его.
			</p>
			{summary.data ? (
				<dl className={styles.facts}>
					<div>
						<dt>Оплаченный период</dt>
						<dd>
							{summary.data.period
								? `${billingDate(summary.data.period.startsAt)} — ${billingDate(summary.data.period.expiresAt)}`
								: 'Нет действующего периода'}
						</dd>
					</div>
					<div>
						<dt>Автопродление</dt>
						<dd>
							{summary.data.renewal.state === 'REVOKED'
								? 'Остановлено при закрытии'
								: 'Не выполняется после закрытия'}
						</dd>
					</div>
				</dl>
			) : summary.isPending ? (
				<ScreenState compact variant="loading" />
			) : null}
			{history.data?.items.length ? (
				<ul className={styles.history}>
					{history.data.items.map(item => (
						<li key={item.id}>
							<span>
								<strong>{billingMoney(item.amountMinor)}</strong> ·{' '}
								{billingOrderLabel(item.state)}
								<br />
								{billingDate(item.createdAt)}
							</span>
							<Button
								size="sm"
								variant="secondary"
								onClick={() => setOrderId(item.id)}
							>
								Подробнее
							</Button>
						</li>
					))}
				</ul>
			) : history.isPending ? (
				<ScreenState compact variant="loading" />
			) : !history.isError ? (
				<p className={styles.muted}>Платежей пока нет.</p>
			) : null}
			{orderId ? (
				<div className={styles.notice} aria-label="Детали платежа">
					<div className={styles.actions}>
						<h3>Детали платежа</h3>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => setOrderId(null)}
						>
							Скрыть
						</Button>
					</div>
					{order.isError ? (
						<p role="alert">
							Не удалось загрузить заказ. Повторите проверку.
						</p>
					) : order.data ? (
						<dl className={styles.facts}>
							<div>
								<dt>Состояние</dt>
								<dd>{billingOrderLabel(order.data.order.state)}</dd>
							</div>
							<div>
								<dt>Сумма</dt>
								<dd>{billingMoney(order.data.order.amountMinor)}</dd>
							</div>
							<div>
								<dt>Оплаченный период</dt>
								<dd>
									{billingFulfillmentLabel(order.data.order.fulfillment)}
								</dd>
							</div>
							<div>
								<dt>Создан</dt>
								<dd>{billingDate(order.data.order.createdAt)}</dd>
							</div>
						</dl>
					) : (
						<ScreenState compact variant="loading" />
					)}
					<Button
						size="sm"
						variant="secondary"
						isLoading={order.isFetching}
						onClick={() => void order.refetch()}
					>
						Обновить статус заказа
					</Button>
				</div>
			) : null}
			<div className={styles.actions}>
				<Button
					size="sm"
					variant="secondary"
					disabled={page <= 1 || history.isFetching}
					onClick={() => setPage(value => value - 1)}
				>
					Назад
				</Button>
				<span className={styles.muted}>
					Страница {page} из {pages}
				</span>
				<Button
					size="sm"
					variant="secondary"
					disabled={page >= pages || history.isFetching}
					onClick={() => setPage(value => value + 1)}
				>
					Далее
				</Button>
				<Button
					size="sm"
					variant="secondary"
					isLoading={summary.isFetching || history.isFetching}
					onClick={() => {
						void summary.refetch()
						void history.refetch()
						if (orderId) void order.refetch()
					}}
				>
					Обновить историю
				</Button>
			</div>
		</section>
	)
}

const WorkspaceClosureStatusScoped = ({
	initial,
	onStateChange
}: {
	initial: WorkspaceClosureView
	onStateChange?: (state: WorkspaceClosureView['state']) => void
}) => {
	const { session, sessionRevision } = useSessionStore()
	const [polls, setPolls] = useState(0)
	const mounted = useRef(false)
	useLayoutEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
		}
	}, [])
	const current = () => {
		const live = useSessionStore.getState()
		return (
			mounted.current &&
			live.session?.userId === session?.userId &&
			live.session?.accessToken === session?.accessToken &&
			live.sessionRevision === sessionRevision
		)
	}
	const status = useQuery({
		queryKey: [
			'crm-workspace-closure',
			session?.userId,
			sessionRevision,
			initial.workspaceId,
			initial.id
		],
		queryFn: async () => {
			const value = await getWorkspaceClosure(
				session!.accessToken,
				initial.id,
				initial.workspaceId,
				session!.userId
			)
			if (!current()) throw invalidContractError()
			return value
		},
		initialData: initial,
		enabled: !!session,
		retry: false,
		staleTime: 0,
		gcTime: 0,
		refetchOnWindowFocus: false
	})
	const closure = status.data ?? initial
	const refetchStatus = status.refetch
	useEffect(() => {
		const live = useSessionStore.getState()
		if (
			status.isError ||
			closure.state !== 'CLOSING' ||
			polls >= 12 ||
			live.session?.userId !== session?.userId ||
			live.session?.accessToken !== session?.accessToken ||
			live.sessionRevision !== sessionRevision
		)
			return
		const timer = window.setTimeout(() => {
			const latest = useSessionStore.getState()
			if (
				latest.session?.userId !== session?.userId ||
				latest.session?.accessToken !== session?.accessToken ||
				latest.sessionRevision !== sessionRevision
			)
				return
			setPolls(value => value + 1)
			void refetchStatus()
		}, 5000)
		return () => window.clearTimeout(timer)
	}, [
		closure.state,
		status.isError,
		polls,
		refetchStatus,
		session?.userId,
		session?.accessToken,
		sessionRevision
	])
	useEffect(() => {
		if (!status.isError) onStateChange?.(closure.state)
	}, [closure.state, onStateChange, status.isError])
	if (!session) return null
	if (status.isError)
		return (
			<section
				className={styles.card}
				aria-label="Закрытие рабочего пространства"
			>
				<h2>Проверка закрытия</h2>
				<p className={styles.notice} role="alert">
					Не удалось подтвердить доступ к состоянию закрытия. Обновите
					данные.
				</p>
				<Button
					variant="secondary"
					isLoading={status.isFetching}
					onClick={() => void status.refetch()}
				>
					Повторить проверку
				</Button>
			</section>
		)
	return (
		<>
			<section
				className={styles.card}
				aria-label="Закрытие рабочего пространства"
			>
				<div className={styles.actions}>
					<h2>{closure.displayName?.trim() || 'Рабочее пространство'}</h2>
					<StatusBadge
						tone={closure.state === 'CLOSED' ? 'neutral' : 'warning'}
					>
						{closure.state === 'CLOSED' ? 'Закрыто' : 'Закрывается'}
					</StatusBadge>
				</div>
				<p className={styles.muted}>
					{closure.state === 'CLOSED'
						? 'Новые действия остановлены. История пространства и платежей сохранена.'
						: 'Доступ в CRM остановлен. Останавливаем остальные источники новых действий и завершаем ранее принятые операции. Уже начатые платежи и сообщения могут завершиться позже.'}
				</p>
				<dl className={styles.facts}>
					<div>
						<dt>Запрошено</dt>
						<dd>{billingDate(closure.requestedAt)}</dd>
					</div>
					{closure.closedAt ? (
						<div>
							<dt>Закрыто</dt>
							<dd>{billingDate(closure.closedAt)}</dd>
						</div>
					) : null}
					<div>
						<dt>Платежи с ожидаемым результатом на момент остановки</dt>
						<dd>{closure.financialPendingCount}</dd>
					</div>
					<div>
						<dt>Ранее начатые отправки</dt>
						<dd>{closure.priorDispatchCount}</dd>
					</div>
				</dl>
				{closure.lastErrorCode ? (
					<p className={styles.notice} role="status">
						Один из этапов пока не завершён. Система продолжит повторять
						проверку. Финансовая история откроется после закрытия.
					</p>
				) : null}
				<ul className={styles.steps}>
					{closure.steps.map(step => (
						<li key={step.service}>
							<strong>{serviceNames[step.service]}</strong>
							<span>
								{step.lastErrorCode && step.state !== 'SETTLED'
									? 'Ожидает повторной проверки'
									: stepNames[step.state]}
							</span>
						</li>
					))}
				</ul>
				<div className={styles.actions}>
					<Button
						variant="secondary"
						isLoading={status.isFetching}
						onClick={() => {
							setPolls(0)
							void status.refetch()
						}}
					>
						Обновить статус
					</Button>
					{closure.state === 'CLOSING' && polls >= 12 ? (
						<span className={styles.muted}>
							Автоматическая проверка приостановлена. Обновить статус можно
							вручную.
						</span>
					) : null}
				</div>
			</section>
			{closure.state === 'CLOSED' ? (
				<ClosedFinancialHistory
					key={`${session.userId}:${sessionRevision}:${closure.id}`}
					closure={closure}
					current={current}
					accessToken={session.accessToken}
					subject={session.userId}
					sessionRevision={sessionRevision}
				/>
			) : (
				<p className={styles.notice}>
					Финансовая история откроется после завершения закрытия. Ранее
					начатые платежи и сообщения могут получить результат позже.
				</p>
			)}
		</>
	)
}

export const WorkspaceClosureStatus = ({
	initial,
	onStateChange
}: {
	initial: WorkspaceClosureView
	onStateChange?: (state: WorkspaceClosureView['state']) => void
}) => {
	const { session, sessionRevision } = useSessionStore()
	if (!session) return null
	return (
		<WorkspaceClosureStatusScoped
			key={`${session.userId}:${sessionRevision}:${initial.workspaceId}:${initial.id}`}
			initial={initial}
			onStateChange={onStateChange}
		/>
	)
}
