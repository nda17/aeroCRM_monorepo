'use client'
import VeilBackground from '@/shared/ui/veil-background/VeilBackground'
import Snowflakes from '@/shared/ui/snowflakes/Snowflakes'
import styles from '@/app/_ui/layout/Layout.module.scss'
import Footer from '@/app/_ui/layout/footer/Footer'
import Header from '@/app/_ui/layout/header/Header'
import { ILayout } from '@/app/_ui/layout/layout.interface'
import { isMarketingPage } from '@/shared/config/pages/public.config'
import { useVeilBackgroundStore } from '@/shared/lib/veil-background'
import { NextPage } from 'next'
import { usePathname } from 'next/navigation'

const Layout: NextPage<ILayout> = ({
	children,
	siteSettings,
	footerContent
}) => {
	const visibleVeilBackground = useVeilBackgroundStore(
		state => state.visible
	)
	const pathname = usePathname()
	const isLandingPage = isMarketingPage(pathname)
	return (
		<div className={styles.layout}>
			{siteSettings?.snowflakeEnabled && <Snowflakes />}
			{siteSettings?.bannerEnabled && siteSettings.bannerText && (
				<div className={styles.banner}>
					<span>{siteSettings.bannerText}</span>
				</div>
			)}
			<Header isAbsolute={isLandingPage} />
			{visibleVeilBackground && <VeilBackground />}
			<main className={isLandingPage ? styles.mainLanding : styles.main}>
				{children}
			</main>
			<Footer content={footerContent} />
		</div>
	)
}

export default Layout
