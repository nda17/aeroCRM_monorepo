import styles from '@/app/_ui/layout/nav-menu/desktop/DesktopNavBar.module.scss'
import Menu from '@/app/_ui/layout/nav-menu/desktop/menu/Menu'
import { NextPage } from 'next'

const DesktopNavBar: NextPage = () => {
	return (
		<nav className={styles.wrapper} aria-label="Основная навигация">
			<div className={styles['layout-container']}>
				<Menu />
			</div>
		</nav>
	)
}

export default DesktopNavBar
