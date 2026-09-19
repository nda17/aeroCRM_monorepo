'use client'
import styles from '@/features/cookie-consent/ui/CookieConsentPopup.module.scss'
import { ICookieConsent } from '@/features/cookie-consent/ui/cookie-consent.interface'
import AppIcon from '@/shared/ui/icons/AppIcon'
import { PUBLIC_PAGES } from '@/shared/config/pages/public.config'
import clsx from 'clsx'
import Cookies from 'js-cookie'
import { NextPage } from 'next'
import Link from '@/shared/lib/navigation/ZoneLink'
import { useEffect, useState } from 'react'

const CookieConsentPopup: NextPage<ICookieConsent> = status => {
	const [showPopup, setShowPopup] = useState(`${status}`)

	const accept = () => {
		Cookies.set('cookieConsent', 'status:accept', { expires: 365 })
		setShowPopup('hide')
	}

	useEffect(() => {
		setShowPopup(`${status.status}`)
	}, [status])

	return showPopup === 'show' ? (
		<div className={clsx(styles['wrapper-cookie'])}>
			<div className={clsx(styles['wrapper-content'])}>
				<div className={styles.heading}>
					<div className={clsx(styles['image-cookie'])}>
						<AppIcon name="cookie" fill="#dd850b" />
					</div>
					<div className={styles['heading-copy']}>
						<h2 className={clsx(styles['text-heading'])}>
							Согласие на использование cookie
						</h2>
					</div>
				</div>

				<div className={clsx(styles['text-wrapper'])}>
					<p className={clsx(styles['text-consent'])}>
						Мы используем cookie для аналитики, корректной работы сайта и
						персонализации сервисов. Продолжая пользоваться сайтом, вы
						соглашаетесь на их обработку в соответствии с политикой cookie.
					</p>
				</div>
			</div>

			<div className={styles.actions}>
				<Link
					href={PUBLIC_PAGES.COOKIE_NOTICE}
					className={clsx(styles['more-link'])}
				>
					Подробнее
				</Link>
				<button
					type="button"
					onClick={accept}
					className={clsx(styles['button-accept'])}
				>
					Принять
				</button>
			</div>
		</div>
	) : null
}

export default CookieConsentPopup
