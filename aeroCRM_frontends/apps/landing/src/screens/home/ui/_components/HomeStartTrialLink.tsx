'use client'

import { PUBLIC_PAGES } from '@/shared/config/pages/public.config'
import { useAuthStore } from '@/entities/user'
import Link from '@/shared/lib/navigation/ZoneLink'
import type { ReactNode } from 'react'

interface HomeStartTrialLinkProps {
	className: string
	children: ReactNode
}

const HomeStartTrialLink = ({
	className,
	children
}: HomeStartTrialLinkProps) => {
	const auth = useAuthStore(state => state.auth)
	const href = auth ? PUBLIC_PAGES.CABINET : PUBLIC_PAGES.REGISTER

	return (
		<Link href={href} className={className}>
			{children}
		</Link>
	)
}

export default HomeStartTrialLink
