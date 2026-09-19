import styles from '@/app/_ui/layout/nav-menu/mobile/menu/menu-item/MenuItem.module.scss'
import { IMenuItem } from '@/app/_ui/layout/nav-menu/menu-item.interface'
import AppIcon from '@/shared/ui/icons/AppIcon'
import { useHamburgerStore } from '@/features/mobile-navigation'
import { useVeilBackgroundStore } from '@/shared/lib/veil-background'
import clsx from 'clsx'
import { NextPage } from 'next'
import Link from '@/shared/lib/navigation/ZoneLink'
import { usePathname } from 'next/navigation'
import toast from 'react-hot-toast'

const MenuItem: NextPage<{ item: IMenuItem }> = ({ item }) => {
	const pathname = usePathname()
	const changeVisibleHamburger = useHamburgerStore(
		state => state.setVisible
	)
	const changeVisibleVeilBackground = useVeilBackgroundStore(
		state => state.setVisible
	)

	const closeMenu = () => {
		changeVisibleHamburger(false)
		changeVisibleVeilBackground(false)
	}

	return (
		<li
			className={clsx([styles.wrapper], {
				[styles.active]: !item.disabled && pathname === item.link
			})}
		>
			<Link
				href={item.link}
				className={clsx(styles['link-button'], {
					[styles.disabled]: item.disabled
				})}
				aria-disabled={item.disabled || undefined}
				aria-label={
					item.disabled && item.tooltip
						? `${item.title} — ${item.tooltip}`
						: undefined
				}
				title={item.disabled ? item.tooltip : undefined}
				onClick={event => {
					if (item.disabled) {
						event.preventDefault()
						toast(item.tooltip || 'Раздел пока недоступен')
						return
					}
					closeMenu()
				}}
			>
				<AppIcon name={item.icon} />
				{item.title}
				{item.disabled && item.tooltip && (
					<span className={styles.tooltip}>{item.tooltip}</span>
				)}
			</Link>
		</li>
	)
}

export default MenuItem
