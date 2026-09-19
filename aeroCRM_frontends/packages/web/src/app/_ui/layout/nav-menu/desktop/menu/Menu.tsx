import styles from '@/app/_ui/layout/nav-menu/desktop/menu/Menu.module.scss'
import DesktopDynamicMenu from '@/app/_ui/layout/nav-menu/desktop/menu/desktop-dynamic-menu/DesktopDynamicMenu'
import DesktopStaticMenu from '@/app/_ui/layout/nav-menu/desktop/menu/desktop-static-menu/DesktopStaticMenu'
import { NextPage } from 'next'

const Menu: NextPage = () => {
	return (
		<div className={styles.wrapper}>
			<DesktopStaticMenu />
			<DesktopDynamicMenu />
		</div>
	)
}

export default Menu
