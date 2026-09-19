import {
	staticMenu,
	usesApplicationMenu
} from '@/app/_ui/layout/nav-menu/data/menu.data'
import MenuItem from '@/app/_ui/layout/nav-menu/mobile/menu/menu-item/MenuItem'
import { IMenuItem } from '@/app/_ui/layout/nav-menu/menu-item.interface'
import styles from '@/app/_ui/layout/nav-menu/mobile/menu/mobile-static-menu/MobileStaticMenu.module.scss'
import { NextPage } from 'next'
import { usePathname } from 'next/navigation'
import { currentFrontendZone } from '@/shared/lib/navigation/frontend-zones'
import { useHamburgerStore } from '@/features/mobile-navigation'
import { useVeilBackgroundStore } from '@/shared/lib/veil-background'
import Link from '@/shared/lib/navigation/ZoneLink'
import { getCrmAppUrl } from '@/shared/config/crm-release.config'

const MobileStaticMenu: NextPage = () => {
	const application = usesApplicationMenu(
		usePathname(),
		currentFrontendZone()
	)
	const setMenu = useHamburgerStore(state => state.setVisible)
	const setVeil = useVeilBackgroundStore(state => state.setVisible)
	if (!staticMenu.items?.length) return null

	return (
		<ul className={styles.wrapper}>
			{application ? (
				<li>
					<Link href={getCrmAppUrl()} onClick={() => { setMenu(false); setVeil(false) }}>Рабочая область</Link>
				</li>
			) : (
				staticMenu.items?.map((item: IMenuItem) => (
					<MenuItem item={item} key={item.link} />
				))
			)}
		</ul>
	)
}

export default MobileStaticMenu
