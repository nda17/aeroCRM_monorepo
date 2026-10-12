'use client'

import AdminNavItem from './AdminNavItem'
import styles from './AdminNavigation.module.scss'
import { adminNavGroups } from './data/admin-navigation.data'
import { UserRole, useUser } from '@/entities/user'

interface AdminNavigationProps {
	shell?: boolean
	onNavigate?: () => void
}

// Existing screens still mount this component. The frame owns the visible
// navigation so each page keeps its current structure without duplicate menus.
export default function AdminNavigation({
	shell = false,
	onNavigate
}: AdminNavigationProps) {
	const { user } = useUser()
	if (!shell) return null

	const groups = adminNavGroups
		.map(group => ({
			...group,
			items: group.items.filter(
				item => !item.devOnly || user.rights?.includes(UserRole.DEV)
			)
		}))
		.filter(group => group.items.length > 0)

	return (
		<nav
			className={styles.navigation}
			aria-label="Разделы администрирования"
		>
			{groups.map(group => (
				<div className={styles.group} key={group.id}>
					<p className={styles.groupTitle}>{group.title}</p>
					<ul className={styles.navList}>
						{group.items.map(item => (
							<AdminNavItem
								key={item.link}
								item={item}
								onNavigate={onNavigate}
							/>
						))}
					</ul>
				</div>
			))}
		</nav>
	)
}
