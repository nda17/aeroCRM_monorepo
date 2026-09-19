import styles from '@/app/_ui/layout/nav-menu/mobile/menu/logout-button/LogoutButton.module.scss'
import AppIcon from '@/shared/ui/icons/AppIcon'
import { useLogout } from '@/features/auth'
import { useHamburgerStore } from '@/features/mobile-navigation'
import { useVeilBackgroundStore } from '@/shared/lib/veil-background'
import clsx from 'clsx'
import { NextPage } from 'next'
import { MouseEvent } from 'react'

const LogoutButton: NextPage = () => {
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

	const { logout, isPending } = useLogout(closeMenu)

	const logoutHandler = (e: MouseEvent) => {
		e.preventDefault()
		logout()
	}

	return (
		<button
			onClick={logoutHandler}
			disabled={isPending}
			className={clsx(styles['link-auth-button'])}
		>
			<AppIcon name="logout" fill="red" />
			Выйти
		</button>
	)
}

export default LogoutButton
