import styles from './AdminNavigation.module.scss'
import type { INavItem } from './admin-navigation.interface'
import { isAdminNavItemActive } from './data/admin-navigation.data'
import { ADMIN_PAGES } from '@/shared/config/pages/admin.config'
import Link from '@/shared/lib/navigation/ZoneLink'
import AppIcon from '@/shared/ui/icons/AppIcon'
import type { AppIconName } from '@/shared/types/icon.types'
import { usePathname } from 'next/navigation'

const icons: Record<string, AppIconName> = {
	[ADMIN_PAGES.HOME]: 'dashboard',
	[ADMIN_PAGES.ALERTS]: 'clock',
	[ADMIN_PAGES.USER_LIST]: 'person-add',
	[ADMIN_PAGES.CRM]: 'apps',
	[ADMIN_PAGES.FINANCE_SUBSCRIPTIONS]: 'payment',
	[ADMIN_PAGES.FINANCE_PRICING]: 'diamond',
	[ADMIN_PAGES.CONTENT]: 'edit',
	[ADMIN_PAGES.SUPPORT]: 'help',
	[ADMIN_PAGES.MAILINGS]: 'login',
	[ADMIN_PAGES.TELEGRAM_BOT]: 'telegram',
	[ADMIN_PAGES.SYSTEM]: 'settings',
	[ADMIN_PAGES.MESSAGING]: 'apps',
	[ADMIN_PAGES.DATABASES]: 'lock',
	[ADMIN_PAGES.SETTINGS]: 'settings',
	[ADMIN_PAGES.EVENT_LOG]: 'clock'
}

export default function AdminNavItem({
	item,
	onNavigate
}: {
	item: INavItem
	onNavigate?: () => void
}) {
	const pathname = usePathname()
	const isActive = isAdminNavItemActive(pathname, item)

	return (
		<li>
			<Link
				href={item.link}
				className={`${styles.itemLink} ${isActive ? styles.active : ''}`}
				aria-current={isActive ? 'page' : undefined}
				onClick={onNavigate}
			>
				<AppIcon
					name={icons[item.link] ?? 'apps'}
					size={18}
					aria-hidden="true"
				/>
				<span>{item.title}</span>
			</Link>
		</li>
	)
}
