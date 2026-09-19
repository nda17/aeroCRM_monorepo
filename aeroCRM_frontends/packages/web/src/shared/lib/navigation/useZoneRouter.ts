'use client'

import { useRouter } from 'next/navigation'
import { useMemo } from 'react'
import { needsDocumentNavigation } from './frontend-zones'

export function useZoneRouter() {
	const router = useRouter()
	return useMemo(
		() => ({
			...router,
			push: (...[href, options]: Parameters<typeof router.push>) => {
				if (needsDocumentNavigation(href)) window.location.assign(href)
				else router.push(href, options)
			},
			replace: (...[href, options]: Parameters<typeof router.replace>) => {
				if (needsDocumentNavigation(href)) window.location.replace(href)
				else router.replace(href, options)
			},
			prefetch: (
				...[href, options]: Parameters<typeof router.prefetch>
			) => {
				if (!needsDocumentNavigation(href)) router.prefetch(href, options)
			}
		}),
		[router]
	)
}
