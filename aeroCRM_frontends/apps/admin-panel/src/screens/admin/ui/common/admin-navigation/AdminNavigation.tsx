'use client'

import AdminNavItem from '@/screens/admin/ui/common/admin-navigation/AdminNavItem'
import styles from '@/screens/admin/ui/common/admin-navigation/AdminNavigation.module.scss'
import {
	adminNavGroups,
	isAdminNavItemActive
} from '@/screens/admin/ui/common/admin-navigation/data/admin-navigation.data'
import { useUser } from '@/entities/user'
import { UserRole } from '@/entities/user'
import clsx from 'clsx'
import { NextPage } from 'next'
import Link from '@/shared/lib/navigation/ZoneLink'
import { usePathname } from 'next/navigation'
import toast from 'react-hot-toast'

const AdminNavigation: NextPage = () => {
	const { user } = useUser()
	const pathname = usePathname()
	const groups = adminNavGroups
		.map(group => ({
			...group,
			items: group.items.filter(
				item => !item.devOnly || user?.rights?.includes(UserRole.DEV)
			)
		}))
		.filter(group => group.items.length > 0)
	const activeGroup =
		groups.find(group =>
			group.items.some(item => isAdminNavItemActive(pathname, item))
		) ?? groups[0]

	return (
		<nav
			className={styles.navigation}
			aria-label="Навигация администратора"
		>
			<p className={styles.caption}>aeroCRM · Администрирование</p>
			<ul className={styles.groups} aria-label="Разделы панели">
				{groups.map(group => (
					<li key={group.id}>
						<Link
							href={group.items[0].link}
							className={clsx(
								styles.groupLink,
								group.id === activeGroup?.id && styles.groupActive
							)}
							aria-current={
								group.id === activeGroup?.id ? 'location' : undefined
							}
							onClick={() =>
								toast(group.title, {
									id: 'admin-navigation',
									duration: 1800
								})
							}
						>
							{group.title}
						</Link>
					</li>
				))}
			</ul>
			{activeGroup && (
				<div className={styles.currentGroup}>
					<p className={styles.description}>{activeGroup.description}</p>
					<ul
						className={styles['nav-list']}
						aria-label={activeGroup.title}
					>
						{activeGroup.items.map(item => (
							<AdminNavItem key={item.link} item={item} />
						))}
					</ul>
				</div>
			)}
		</nav>
	)
}

export default AdminNavigation
