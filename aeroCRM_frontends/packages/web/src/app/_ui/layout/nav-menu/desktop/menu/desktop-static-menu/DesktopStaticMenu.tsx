import {
	staticMenu,
	usesApplicationMenu
} from '@/app/_ui/layout/nav-menu/data/menu.data'
import styles from '@/app/_ui/layout/nav-menu/desktop/menu/desktop-static-menu/DesktopStaticMenu.module.scss'
import MenuItem from '@/app/_ui/layout/nav-menu/desktop/menu/menu-item/MenuItem'
import { IMenuItem } from '@/app/_ui/layout/nav-menu/menu-item.interface'
import { NextPage } from 'next'
import { usePathname } from 'next/navigation'
import { currentFrontendZone } from '@/shared/lib/navigation/frontend-zones'
import Link from '@/shared/lib/navigation/ZoneLink'
import { getCrmAppUrl } from '@/shared/config/crm-release.config'
import { PUBLIC_PAGES } from '@/shared/config/pages/public.config'

const DesktopStaticMenu: NextPage = () => {
	const application = usesApplicationMenu(
		usePathname(),
		currentFrontendZone()
	)
	return (
		<ul className={styles.wrapper}>
			{application ? (
				<li>
					<Link href={getCrmAppUrl()}>Рабочая область</Link>
				</li>
			) : (
				<>
					{staticMenu.items?.map((item: IMenuItem) => (
						<MenuItem item={item} key={item.link} />
					))}
					<MenuItem
						item={{
							icon: 'apps',
							link: PUBLIC_PAGES.MOBILE_APP,
							title: 'Мобильные приложения'
						}}
					/>
				</>
			)}
		</ul>
	)
}

export default DesktopStaticMenu
