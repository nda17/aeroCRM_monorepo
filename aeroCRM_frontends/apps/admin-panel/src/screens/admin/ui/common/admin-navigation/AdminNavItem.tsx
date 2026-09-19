import styles from '@/screens/admin/ui/common/admin-navigation/AdminNavigation.module.scss'
import { INavItem } from '@/screens/admin/ui/common/admin-navigation/admin-navigation.interface'
import clsx from 'clsx'
import { NextPage } from 'next'
import Link from '@/shared/lib/navigation/ZoneLink'
import { usePathname } from 'next/navigation'
import { isAdminNavItemActive } from './data/admin-navigation.data'
import toast from 'react-hot-toast'

const AdminNavItem: NextPage<{ item: INavItem }> = ({
	item: { link, title, option }
}) => {
	const pathname = usePathname()
	const isActive = isAdminNavItemActive(pathname, { link, title, option })

	return (
		<li>
			<Link
				href={link}
				className={clsx(styles.itemLink, isActive && styles.active)}
				aria-current={isActive ? 'page' : undefined}
				onClick={() => {
					if (!isActive)
						toast(title, { id: 'admin-navigation', duration: 1800 })
				}}
			>
				{title}
			</Link>
		</li>
	)
}

export default AdminNavItem
