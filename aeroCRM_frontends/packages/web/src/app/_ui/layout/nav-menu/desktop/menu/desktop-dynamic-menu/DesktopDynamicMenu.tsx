import AuthItems from '@/app/_ui/layout/nav-menu/desktop/menu/auth-items/AuthItems'
import styles from '@/app/_ui/layout/nav-menu/desktop/menu/desktop-dynamic-menu/DesktopDynamicMenu.module.scss'
import { NextPage } from 'next'

const DesktopDynamicMenu: NextPage = () => {
	return (
		<ul className={styles.wrapper}>
			<AuthItems />
		</ul>
	)
}

export default DesktopDynamicMenu
