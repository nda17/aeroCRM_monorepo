'use client'
import { CookieConsentProvider } from '@/features/cookie-consent'
import PlatformProviders from '@/app/providers/PlatformProviders'
import type { PropsWithChildren } from 'react'
import { useEffect } from 'react'

const AFFILIATE_REFERRER_STORAGE_KEY = 'affiliateReferrerId'

type AppProvidersProps = PropsWithChildren<{
	hasSessionHint: boolean
}>

const AppProviders = ({ children, hasSessionHint }: AppProvidersProps) => {
	return (
		<PlatformProviders hasSessionHint={hasSessionHint}>
			<AffiliateReferralTracker />
			<CookieConsentProvider />
			{children}
		</PlatformProviders>
	)
}

export default AppProviders

const AffiliateReferralTracker = () => {
	useEffect(() => {
		const params = new URLSearchParams(window.location.search)
		const referrerId = params.get('ref')?.trim()

		if (referrerId) {
			window.localStorage.setItem(
				AFFILIATE_REFERRER_STORAGE_KEY,
				referrerId
			)
		}
	}, [])

	return null
}
