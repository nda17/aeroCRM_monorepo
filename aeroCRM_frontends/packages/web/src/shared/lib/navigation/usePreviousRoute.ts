import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

export const usePreviousRoute = () => {
	const pathname = usePathname()
	const searchParams = useSearchParams()

	const [previousRoute, setPreviousRoute] = useState<string | null>(null)
	const currentRouteRef = useRef<string | null>(null)

	useEffect(() => {
		const url = `${pathname}?${searchParams}`
		setPreviousRoute(currentRouteRef.current)
		currentRouteRef.current = url
	}, [pathname, searchParams])

	return { previousRoute }
}
