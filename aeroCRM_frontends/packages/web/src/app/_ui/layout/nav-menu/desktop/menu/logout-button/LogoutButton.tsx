import styles from '@/app/_ui/layout/nav-menu/desktop/menu/logout-button/LogoutButton.module.scss'
import AppIcon from '@/shared/ui/icons/AppIcon'
import { useLogout } from '@/features/auth'
import clsx from 'clsx'
import { NextPage } from 'next'
import { MouseEvent } from 'react'

const LogoutButton: NextPage = () => {
	const { logout, isPending } = useLogout()

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
			{isPending ? 'Подождите...' : 'Выйти'}
		</button>
	)
}

export default LogoutButton
