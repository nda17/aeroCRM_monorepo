'use client'

import {
	crmPermissionScope,
	useCrmPermissions,
	useCrmWorkspaceAccess,
	type CrmPermissions
} from '@/entities/crm-access'
import { getCrmCommercialPolicy } from '@/entities/crm-commercial-policy'
import {
	useSessionStore,
	type AuthenticatedSession
} from '@/entities/session'
import { Button, ScreenState } from '@/shared/ui'
import {
	CancelledError,
	onlineManager,
	useQuery,
	useQueryClient
} from '@tanstack/react-query'
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import toast from 'react-hot-toast'
import styles from './CrmCommercialPolicyCard.module.scss'

const subscribeOnline = (notify: () => void) =>
	onlineManager.subscribe(notify)
const readOnline = () => onlineManager.isOnline() && navigator.onLine
const rubles = new Intl.NumberFormat('ru-RU', {
	style: 'currency',
	currency: 'RUB',
	minimumFractionDigits: 2,
	maximumFractionDigits: 2
})

export const CrmCommercialPolicyCard = () => {
	const workspace = useCrmWorkspaceAccess()
	const { session, status, sessionRevision } = useSessionStore()
	const permissions = useCrmPermissions(
		workspace.workspaceId,
		session,
		sessionRevision
	)
	if (
		status !== 'authenticated' ||
		!session ||
		!permissions.isSuccess ||
		permissions.isFetching ||
		permissions.data.subject !== session.userId ||
		permissions.data.workspaceId !== workspace.workspaceId ||
		!['OWNER', 'CRM_ADMIN'].includes(permissions.data.role)
	)
		return null

	const scope = crmPermissionScope(permissions.data)
	return (
		<PolicyCard
			key={JSON.stringify([
				workspace.workspaceId,
				session.userId,
				sessionRevision,
				scope,
				permissions.data.state
			])}
			workspaceId={workspace.workspaceId}
			session={session}
			sessionRevision={sessionRevision}
			scope={scope}
			accessState={permissions.data.state}
		/>
	)
}

function PolicyCard({
	workspaceId,
	session,
	sessionRevision,
	scope,
	accessState
}: {
	workspaceId: string
	session: AuthenticatedSession
	sessionRevision: number
	scope: string
	accessState: CrmPermissions['state']
}) {
	const queryClient = useQueryClient()
	const mounted = useRef(false)
	useLayoutEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
		}
	}, [])
	const current = () => {
		const owner = useSessionStore.getState()
		const confirmed = queryClient.getQueryState<CrmPermissions>([
			'crm-permissions',
			workspaceId,
			session.userId,
			sessionRevision
		])
		return (
			mounted.current &&
			owner.status === 'authenticated' &&
			owner.session?.userId === session.userId &&
			owner.session.accessToken === session.accessToken &&
			owner.sessionRevision === sessionRevision &&
			confirmed?.status === 'success' &&
			confirmed.fetchStatus === 'idle' &&
			confirmed.data?.subject === session.userId &&
			confirmed.data.workspaceId === workspaceId &&
			confirmed.data.state === accessState &&
			crmPermissionScope(confirmed.data) === scope
		)
	}
	const online = useSyncExternalStore(
		subscribeOnline,
		readOnline,
		() => false
	)
	const query = useQuery({
		queryKey: [
			'crm-commercial-policy',
			workspaceId,
			session.userId,
			sessionRevision,
			scope,
			accessState
		],
		queryFn: async ({ signal }) => {
			const guard = () => {
				if (signal.aborted || !current()) throw new CancelledError()
			}
			guard()
			try {
				const policy = await getCrmCommercialPolicy(session.accessToken)
				guard()
				return policy
			} catch (error) {
				guard()
				throw error
			}
		},
		retry: false,
		staleTime: 0,
		gcTime: 0,
		refetchOnWindowFocus: false,
		refetchOnReconnect: 'always'
	})
	const refresh = async () => {
		if (!current() || !online || !readOnline() || query.isFetching) return
		const result = await query.refetch()
		if (!current()) return
		if (result.isError || !result.data)
			toast.error('Не удалось обновить условия aeroCRM')
		else toast.success('Условия aeroCRM обновлены')
	}
	const policy =
		!query.isError && !query.isFetching ? query.data : undefined
	return (
		<section
			className={styles.card}
			aria-label="Опубликованные условия aeroCRM"
		>
			<div className={styles.header}>
				<div>
					<h2 className={styles.title}>Опубликованные условия aeroCRM</h2>
					<p className={styles.description}>
						Текущие условия продукта, не условия вашей действующей подписки
						и не предложение к оплате.
					</p>
				</div>
				<Button
					size="sm"
					variant="secondary"
					disabled={!online || query.isFetching}
					onClick={() => void refresh()}
				>
					{query.isError
						? 'Повторить загрузку условий'
						: 'Обновить условия'}
				</Button>
			</div>
			{!online ? (
				<p className={styles.notice} role="status">
					Нет подключения к сети. Для актуальных условий восстановите
					соединение.
				</p>
			) : null}
			{query.isError ? (
				<ScreenState
					compact
					variant="error"
					title="Условия пока недоступны"
					description="Не удалось проверить опубликованные цены. Управление командой работает независимо от этой карточки."
				/>
			) : !policy ? (
				<ScreenState
					compact
					variant="loading"
					title="Загружаем условия aeroCRM"
				/>
			) : (
				<>
					<dl className={styles.prices}>
						<div className={styles.period}>
							<dt>Месячная стоимость</dt>
							<dd className={styles.price}>
								{rubles.format(policy.monthlyPriceMinor / 100)}{' '}
								<span>/ месяц</span>
							</dd>
							<dt>Дополнительное место на месяц</dt>
							<dd>
								{rubles.format(
									policy.additionalSeatMonthlyPriceMinor / 100
								)}{' '}
								/ месяц
							</dd>
						</div>
						<div className={styles.period}>
							<dt>Годовая стоимость</dt>
							<dd className={styles.price}>
								{rubles.format(policy.yearlyPriceMinor / 100)}{' '}
								<span>/ год</span>
							</dd>
							<dt>Дополнительное место на год</dt>
							<dd>
								{rubles.format(
									policy.additionalSeatYearlyPriceMinor / 100
								)}{' '}
								/ год
							</dd>
						</div>
					</dl>
					<div className={styles.details}>
						<p>
							В стоимость включено мест:{' '}
							<strong>{policy.includedSeats}</strong>, вместе с владельцем.
						</p>
						<p>
							Бесплатный период — <strong>{policy.trialDays} дней</strong>,
							мест на Trial: <strong>{policy.trialSeatLimit}</strong>,
							вместе с владельцем. Начинается только по кнопке «Попробовать
							бесплатно 5 дней», не при просмотре этой карточки.
						</p>
						<p>
							Льготный период после Trial — {policy.graceDays} дня.
							Карточка не меняет подписку, лимиты вашего пространства или
							автопродление.
						</p>
						<p className={styles.version}>
							Версия условий {policy.version} · опубликована{' '}
							{new Date(policy.createdAt).toLocaleDateString('ru-RU')}
						</p>
					</div>
				</>
			)}
		</section>
	)
}
