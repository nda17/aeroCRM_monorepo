import styles from '@/features/mobile-navigation/ui/Hamburger.module.scss'
import AppIcon from '@/shared/ui/icons/AppIcon'
import { useHamburgerStore } from '@/features/mobile-navigation/model/mobile-navigation-store'
import { useVeilBackgroundStore } from '@/shared/lib/veil-background'
import { NextPage } from 'next'

const Hamburger: NextPage = () => {
	const visibleVeilBackground = useVeilBackgroundStore(
		state => state.visible
	)
	const changeVisibleVeilBackground = useVeilBackgroundStore(
		state => state.setVisible
	)
	const visibleHamburger = useHamburgerStore(state => state.visible)
	const changeVisibleHamburger = useHamburgerStore(
		state => state.setVisible
	)

	const changeStateMenu = () => {
		changeVisibleVeilBackground()
		changeVisibleHamburger()
	}

	const isOpen = visibleVeilBackground && visibleHamburger

	return (
		<button
			type="button"
			className={styles.hamburger}
			onClick={changeStateMenu}
			aria-label={isOpen ? 'Закрыть меню' : 'Открыть меню'}
			aria-expanded={isOpen}
			aria-controls="mobile-navigation-menu"
		>
			{isOpen ? (
				<AppIcon name="close" fill="currentColor" />
			) : (
				<AppIcon name="menu" fill="currentColor" />
			)}
		</button>
	)
}

export default Hamburger
