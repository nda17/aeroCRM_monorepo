import styles from '@/app/_ui/layout/footer/Footer.module.scss'
import AppIcon from '@/shared/ui/icons/AppIcon'
import { PUBLIC_PAGES } from '@/shared/config/pages/public.config'
import { DEFAULT_HOME_PAGE_FOOTER_CONTENT } from '@/entities/home-page-content'
import type { HomePageFooterContent } from '@/entities/home-page-content'
import clsx from 'clsx'
import { NextPage } from 'next'
import Link from '@/shared/lib/navigation/ZoneLink'

interface FooterProps {
	content?: HomePageFooterContent
}

const isYbsInfoLine = (line: string) => /(?:ЮБС|YBS)/i.test(line)

const Footer: NextPage<FooterProps> = ({ content }) => {
	const year = 2025
	const currentYear = new Date().getFullYear()
	const footerContent = content ?? DEFAULT_HOME_PAGE_FOOTER_CONTENT
	const email = footerContent.email.trim()
	const ybsUrl =
		footerContent.ybsUrl.trim() || DEFAULT_HOME_PAGE_FOOTER_CONTENT.ybsUrl
	const vkUrl = footerContent.vkUrl.trim()
	const telegramUrl = footerContent.telegramUrl.trim()
	const legalDisclaimer = (footerContent.legalDisclaimer ?? '').trim()

	return (
		<footer className={styles.footer}>
			<div className={clsx(styles['layout-container'])}>
				<div className={clsx(styles['information-wrapper'])}>
					<div className={clsx(styles['contacts-wrapper'])}>
						<p className={clsx(styles['title-block'])}>
							{footerContent.aboutTitle}
						</p>
						{footerContent.infoLines.map((line, index) => (
							<p
								key={`${line}-${index}`}
								className={clsx(styles['info-llc'])}
							>
								{isYbsInfoLine(line) ? (
									<Link href={ybsUrl} className={styles['info-link']}>
										{line}
									</Link>
								) : (
									line
								)}
							</p>
						))}

						{email && (
							<a
								href={`mailto:${email}`}
								className={clsx(styles['link-contact'])}
							>
								{email}
							</a>
						)}

						{(vkUrl || telegramUrl) && (
							<nav
								className={clsx(styles['socials-wrapper'])}
								aria-label="Социальные сети"
							>
								<div className={clsx(styles['link-icon-wrapper'])}>
									{vkUrl && (
										<Link
											href={vkUrl}
											className={clsx(styles['link-icon'])}
											aria-label={footerContent.vkAriaLabel}
											title={footerContent.vkAriaLabel}
										>
											<AppIcon name="vk" fill="#000000" />
										</Link>
									)}
									{telegramUrl && (
										<Link
											href={telegramUrl}
											className={clsx(styles['link-icon'])}
											aria-label={footerContent.telegramAriaLabel}
											title={footerContent.telegramAriaLabel}
										>
											<AppIcon name="telegram" fill="#000000" />
										</Link>
									)}
								</div>
							</nav>
						)}
					</div>

					<nav
						className={clsx(styles['legal-wrapper'])}
						aria-label="Правовая информация"
					>
						<p className={clsx(styles['title-block'])}>
							Правовая информация:
						</p>
						<Link
							href={PUBLIC_PAGES.CONSENT_PROCESSING}
							className={clsx(styles['link-legal'])}
						>
							Согласие на обработку персональных данных
						</Link>
						<Link
							href={PUBLIC_PAGES.PERSONAL_POLICY}
							className={clsx(styles['link-legal'])}
						>
							Политика обработки персональных данных
						</Link>
						<Link
							href={PUBLIC_PAGES.COOKIE_NOTICE}
							className={clsx(styles['link-legal'])}
						>
							Политика обработки Cookie
						</Link>
						<Link
							href={PUBLIC_PAGES.OFERTA}
							className={clsx(styles['link-legal'])}
						>
							Договор-оферта
						</Link>
						{legalDisclaimer && (
							<p className={clsx(styles['legal-disclaimer'])}>
								{legalDisclaimer}
							</p>
						)}
					</nav>
				</div>

				<div className={clsx(styles['inform-wrapper'])}>
					<div className={clsx(styles['ybs-inform-wrapper'])}>
						<p className={clsx(styles['date-inform'])}>Project by</p>
						<Link
							href={ybsUrl}
							className={styles['ybs-logo-link']}
							aria-label="Сайт YBS"
							title="Сайт YBS"
						>
							<svg
								id="ybs"
								className={styles['ybs-logo']}
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 204.4 204.3"
								width="40"
								height="40"
								xmlSpace="preserve"
							>
								<path
									className={styles['ybs-logo-mark']}
									fill="#000000"
									d="M172.4,117.2c0,3.8-0.8,7.3-2.4,10.3c-1.6,3.1-4,5.5-7,7.2c-3.1,1.7-6.8,2.6-11,2.6c-5.1,0-9.3-1.2-12.6-3.5
    c-2.3-1.7-4.2-4-5.7-6.8c-1.5-2.8-2.2-5.6-2.2-8.3c0-1.6,0.4-2.9,1.3-4c0.9-1.1,2-1.7,3.4-1.7c1.1,0,2,0.4,2.8,1.3s1.4,2.1,2,3.9
    c0.7,2,1.4,3.7,2.1,5.1c0.8,1.4,1.8,2.5,3.2,3.4c1.4,0.9,3.2,1.3,5.4,1.3c3.1,0,5.6-0.9,7.5-2.7c1.9-1.8,2.9-4,2.9-6.6
    c0-2.1-0.5-3.8-1.6-5.1c-1-1.3-2.4-2.3-4-3s-3.9-1.4-6.6-2.2c-3.7-1.1-6.8-2.3-9.3-3.7c-2.5-1.4-4.5-3.4-5.9-5.8s-2.2-5.5-2.2-9.2
    c0-3.5,0.8-6.6,2.3-9.3c1.5-2.7,3.8-4.8,6.7-6.3c2.9-1.5,6.4-2.2,10.3-2.2c3.2,0,5.9,0.5,8.2,1.4c2.3,1,4.2,2.2,5.7,3.9
    s2.6,3.3,3.3,5c0.7,1.8,1.1,3.5,1.1,5.1c0,1.5-0.4,2.9-1.3,4.1c-0.9,1.2-2,1.8-3.3,1.8c-1.2,0-2.1-0.4-2.7-1.1
    c-0.6-0.7-1.3-1.9-2-3.6c-0.9-2.4-2.1-4.3-3.4-5.6c-1.3-1.3-3.4-2-6.3-2c-2.7,0-4.9,0.7-6.5,2.2c-1.7,1.5-2.5,3.2-2.5,5.3
    c0,1.3,0.3,2.4,0.8,3.3c0.6,0.9,1.3,1.7,2.3,2.4c1,0.7,2,1.2,3,1.6c1,0.4,2.7,0.9,5,1.6c2.9,0.8,5.5,1.8,7.9,2.8
    c2.4,1,4.4,2.2,6,3.7c1.7,1.4,2.9,3.3,3.9,5.5C172,111.3,172.4,114,172.4,117.2z"
								/>
								<path
									className={styles['ybs-logo-mark']}
									fill="#000000"
									d="M103.5,136.2H87.8c-2.3,0-3.9-0.6-4.9-1.9c-1-1.3-1.5-3.3-1.5-6V80.6c0-2.8,0.5-4.8,1.5-6
    c1-1.2,2.6-1.8,4.8-1.8h16.7c2.5,0,4.6,0.2,6.4,0.6c1.8,0.4,3.4,1.1,4.9,2.2c1.2,0.9,2.3,2,3.2,3.4c0.9,1.4,1.7,2.9,2.1,4.5
    c0.5,1.7,0.7,3.4,0.7,5.3c0,6.3-2.6,11-7.7,13.9c6.8,2.7,10.2,7.8,10.2,15.5c0,3.5-0.7,6.7-2.2,9.6c-1.5,2.8-3.5,4.9-6,6.3
    c-1.6,0.8-3.4,1.4-5.4,1.7C108.6,136,106.2,136.2,103.5,136.2z M91.9,82.4v16.4h9.6c2.6,0,4.6-0.3,6-0.9c1.4-0.6,2.5-1.8,3.3-3.5
    c0.6-1.2,0.9-2.6,0.9-4.1c0-3.2-0.9-5.3-2.8-6.4c-1.9-1.1-4.7-1.6-8.5-1.6H91.9z M102.7,108H91.9v18.5h11.2c7.1,0,10.6-3.1,10.6-9.4
    c0-3.2-0.9-5.5-2.7-7C109.1,108.8,106.4,108,102.7,108z"
								/>
								<path
									className={styles['ybs-logo-mark']}
									fill="#000000"
									d="M48,129.5v-20.1l-12.6-24c-1.1-2.2-1.9-3.9-2.3-5.1c-0.5-1.2-0.7-2.3-0.7-3.2c0-1.5,0.5-2.7,1.4-3.8
    c0.9-1.1,2.1-1.6,3.4-1.6c1.4,0,2.5,0.5,3.3,1.5s1.8,3,3.3,5.9l9.6,19.3l9.7-19.3c0.6-1.2,1.1-2.2,1.5-3c0.4-0.8,0.8-1.6,1.3-2.3
    c0.5-0.7,1-1.2,1.6-1.6c0.6-0.4,1.3-0.6,2.1-0.6c1.3,0,2.4,0.5,3.3,1.6c0.9,1.1,1.3,2.3,1.3,3.7c0,1.1-0.2,2.2-0.7,3.4
    S72.4,83,71.3,85l-12.9,24.4v20.1c0,2.6-0.5,4.6-1.5,5.9s-2.2,1.9-3.8,1.9c-1.5,0-2.8-0.6-3.8-1.9C48.5,134.1,48,132.1,48,129.5z"
								/>

								<circle
									className={styles['ybs-logo-ring']}
									cx="102.2"
									cy="102.15"
									r="88"
									fill="none"
									stroke="#000000"
									strokeWidth="10"
								/>
							</svg>
						</Link>
					</div>
					<p className={clsx(styles['text-inform'])}>
						Все права защищены ©
					</p>
					<p className={clsx(styles['date-inform'])}>
						{year === currentYear
							? currentYear
							: `${year} - ${currentYear}`}
					</p>
				</div>
			</div>
		</footer>
	)
}

export default Footer
