'use client'
import styles from './AccountPage.module.scss'
import { useCrmBillingWorkspaces } from '@/entities/crm-pricing/client'
import { useAuthStore, useUser } from '@/entities/user'
import SkeletonLoader from '@/shared/ui/skeleton-loader/SkeletonLoader'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

const CRM_URL = 'https://workspace.aerocrm.space'

export default function PaymentPageClient() {
	const router = useRouter()
	const auth = useAuthStore(state => state.auth)
	const isAuthResolved = useAuthStore(state => state.isAuthResolved)
	const { user, isLoading: isProfileLoading } = useUser()
	const userId = auth && typeof user.id === 'string' ? user.id : null
	const { ownerWorkspaces, isLoading, isError } =
		useCrmBillingWorkspaces(userId)

	useEffect(() => {
		if (isAuthResolved && !auth)
			router.replace('/login?returnUrl=%2Fpayment')
	}, [auth, isAuthResolved, router])

	if (!isAuthResolved || !auth || isProfileLoading || isLoading)
		return (
			<main className={styles.page} aria-busy="true">
				<span className={styles.srOnly} role="status">
					Загружаем данные аккаунта
				</span>
				<div className={styles.loading} aria-hidden="true">
					<SkeletonLoader width={280} height={36} />
					<SkeletonLoader width="80%" height={20} />
					<div className={styles.card}>
						<SkeletonLoader count={2} height={44} />
					</div>
				</div>
			</main>
		)

	return (
		<main className={styles.page}>
			<h1>Подписка и оплата</h1>
			<p>
				Выберите своё рабочее пространство, чтобы открыть управление
				подпиской в CRM.
			</p>
			{isError ? (
				<p role="alert">
					Не удалось загрузить подписки. Обновите страницу или откройте
					CRM.
				</p>
			) : ownerWorkspaces.length ? (
				<ul className={styles.list}>
					{ownerWorkspaces.map((workspace, index) => (
						<li key={workspace.workspaceId}>
							<a
								className={styles.button}
								href={`${CRM_URL}/billing?workspaceId=${encodeURIComponent(workspace.workspaceId)}`}
							>
								Рабочее пространство {index + 1} — открыть оплату
							</a>
						</li>
					))}
				</ul>
			) : (
				<p>
					У вас нет рабочего пространства с правом владельца. Управлять
					оплатой может владелец пространства.
				</p>
			)}
			<div className={styles.links}>
				<a href={CRM_URL}>Открыть CRM</a>
				<Link href="/cabinet">Личный кабинет</Link>
			</div>
		</main>
	)
}
