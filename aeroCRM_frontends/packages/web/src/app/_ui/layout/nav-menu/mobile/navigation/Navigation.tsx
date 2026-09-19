import styles from '@/app/_ui/layout/nav-menu/mobile/navigation/Navigation.module.scss'
import { Hamburger } from '@/features/mobile-navigation'
import clsx from 'clsx'
import { NextPage } from 'next'

interface NavigationProps {
	isDark?: boolean
}

const Navigation: NextPage<NavigationProps> = ({ isDark }) => {
	return (
		<nav className={styles.wrapper} aria-label="Мобильная навигация">
			<div className={clsx(styles['layout-container'])}>
				<div className={styles.right}>
					<div
						className={clsx(
							styles['menu-toggle'],
							!isDark && styles['menu-toggle--light']
						)}
					>
						<Hamburger />
					</div>
				</div>
			</div>
		</nav>
	)
}

export default Navigation
