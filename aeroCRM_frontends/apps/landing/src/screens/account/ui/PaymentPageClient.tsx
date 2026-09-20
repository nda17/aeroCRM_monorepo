'use client'
import styles from './AccountPage.module.scss'
import { useCrmBillingWorkspaces } from '@/entities/crm-pricing/client'
import { useAuthStore, useUser } from '@/entities/user'
import SkeletonLoader from '@/shared/ui/skeleton-loader/SkeletonLoader'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import AccountHeader, {
	formatWorkspaceSubscription
} from './AccountHeader'

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

	if (!isAuthResolved || !auth || isProfileLoading)
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
			<AccountHeader
				user={user}
				ownerWorkspaces={ownerWorkspaces}
				billingLoading={isLoading}
				billingError={isError}
				active="payment"
			/>
			<section className={styles.card}>
				<h2>Подписка и оплата</h2>
				<p>
					Выберите рабочее пространство, чтобы управлять его подпиской в
					CRM.
				</p>
				{isLoading ? (
					<div aria-busy="true">
						<span className={styles.srOnly} role="status">
							Загружаем рабочие пространства
						</span>
						<SkeletonLoader count={2} height={64} />
					</div>
				) : isError ? (
					<p role="alert">
						Не удалось загрузить подписки. Обновите страницу или откройте
						CRM.
					</p>
				) : ownerWorkspaces.length ? (
					<ul className={styles.workspaceList}>
						{ownerWorkspaces.map((workspace, index) => (
							<li
								className={styles.workspaceItem}
								key={workspace.workspaceId}
							>
								<div className={styles.workspaceCopy}>
									<strong>Рабочее пространство {index + 1}</strong>
									<span className={styles.muted}>
										{formatWorkspaceSubscription(workspace)}
									</span>
								</div>
								<a
									className={styles.button}
									href={`${CRM_URL}/billing?workspaceId=${encodeURIComponent(workspace.workspaceId)}`}
								>
									Управлять оплатой
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
			</section>
		</main>
	)
}
