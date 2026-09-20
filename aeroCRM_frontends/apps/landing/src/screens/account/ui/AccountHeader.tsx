import type { CrmBillingWorkspace } from '@/entities/crm-pricing/client'
import Image from 'next/image'
import Link from 'next/link'
import styles from './AccountPage.module.scss'

type LocalSection = 'profile' | 'sessions'

interface AccountHeaderProps {
	user: {
		name?: string
		email?: string | null
		avatarPath?: string | null
	}
	ownerWorkspaces: CrmBillingWorkspace[]
	billingLoading: boolean
	billingError: boolean
	active: LocalSection | 'payment'
	onSelectSection?: (section: LocalSection) => void
}

const CRM_URL = 'https://workspace.aerocrm.space'
const DEFAULT_AVATAR = '/avatar-default.png'

export const formatWorkspaceSubscription = (
	workspace: CrmBillingWorkspace
): string => {
	const { status, expiresAt, seats } = workspace.subscription
	const date = expiresAt
		? new Date(expiresAt).toLocaleDateString('ru-RU')
		: null
	const label =
		status === 'TRIAL'
			? 'Бесплатный период'
			: status === 'PAID'
				? 'Подписка активна'
				: status === 'GRACE'
					? 'Льготный период'
					: status === 'SCHEDULED'
						? 'Оплаченный период запланирован'
						: 'Подписка не активна'
	const dateLabel = date
		? status === 'INACTIVE'
			? `завершилась ${date}`
			: `до ${date}`
		: null
	return [label, dateLabel, seats ? `Мест: ${seats}` : null]
		.filter(Boolean)
		.join(' · ')
}

export default function AccountHeader({
	user,
	ownerWorkspaces,
	billingLoading,
	billingError,
	active,
	onSelectSection
}: AccountHeaderProps) {
	const subscriptionSummary = billingError
		? 'Данные подписки временно недоступны'
		: billingLoading
			? 'Проверяем рабочие пространства'
			: ownerWorkspaces.length > 1
				? `Рабочих пространств с правом владельца: ${ownerWorkspaces.length}`
				: ownerWorkspaces.length === 1
					? formatWorkspaceSubscription(ownerWorkspaces[0])
					: 'Нет пространства с правом владельца'
	const navClass = (selected: boolean) =>
		`${styles.accountNavItem} ${selected ? styles.accountNavActive : ''}`

	return (
		<header className={styles.accountHeader}>
			<div className={styles.accountIdentity}>
				<Image
					className={styles.accountAvatar}
					src={encodeURI(user.avatarPath || DEFAULT_AVATAR)}
					alt=""
					width={64}
					height={64}
					unoptimized
					onError={event => {
						;(event.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR
					}}
				/>
				<div className={styles.accountIdentityText}>
					<span className={styles.accountEyebrow}>Личный кабинет</span>
					<h1>{user.name?.trim() || 'Пользователь'}</h1>
					<p>{user.email || 'Email не указан'}</p>
				</div>
				<div className={styles.accountSubscription}>
					<span>Подписка aeroCRM</span>
					<strong>{subscriptionSummary}</strong>
				</div>
			</div>
			<nav
				className={styles.accountNav}
				aria-label="Разделы личного кабинета"
			>
				{active === 'payment' ? (
					<>
						<Link className={navClass(false)} href="/cabinet">
							Профиль
						</Link>
						<Link className={navClass(false)} href="/cabinet#sessions">
							Активные сессии
						</Link>
					</>
				) : (
					<>
						<button
							className={navClass(active === 'profile')}
							type="button"
							aria-pressed={active === 'profile'}
							aria-controls="account-profile-panel"
							onClick={() => onSelectSection?.('profile')}
						>
							Профиль
						</button>
						<button
							className={navClass(active === 'sessions')}
							type="button"
							aria-pressed={active === 'sessions'}
							aria-controls="account-sessions-panel"
							onClick={() => onSelectSection?.('sessions')}
						>
							Активные сессии
						</button>
					</>
				)}
				<a className={navClass(false)} href={CRM_URL}>
					CRM
				</a>
				<Link
					className={navClass(active === 'payment')}
					href="/payment"
					aria-current={active === 'payment' ? 'page' : undefined}
				>
					Подписка и оплата
				</Link>
			</nav>
		</header>
	)
}
