'use client'
import CookieConsentPopup from '@/features/cookie-consent/ui/CookieConsentPopup'
import Cookies from 'js-cookie'
import { NextPage } from 'next'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

const CookieConsentProvider: NextPage = () => {
	const [confirm, setConfirm] = useState(true)
	const pathname = usePathname()

	useEffect(() => {
		setConfirm(Boolean(Cookies.get('cookieConsent')))
	}, [pathname])

	return <CookieConsentPopup status={!confirm ? 'show' : 'hide'} />
}

export default CookieConsentProvider
