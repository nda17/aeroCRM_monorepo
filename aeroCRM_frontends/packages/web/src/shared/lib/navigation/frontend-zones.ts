export type FrontendZone = 'landing' | 'crm' | 'admin-panel'

const crmPath =
	/^\/(?:analytics|billing|contacts|deals|inbox|invitations|planner|settings|tasks)(?:\/|$)/

export function zoneForPath(pathname: string): FrontendZone {
	if (/^\/admin(?:\/|$)/.test(pathname)) return 'admin-panel'
	return crmPath.test(pathname) ? 'crm' : 'landing'
}

export function currentFrontendZone(): FrontendZone {
	const zone = process.env.NEXT_PUBLIC_FRONTEND_APP
	if (zone === 'crm' || zone === 'admin-panel') return zone
	return 'landing'
}

const originForZone = (zone: FrontendZone): string => {
	const local = process.env.NODE_ENV === 'development'
	if (zone === 'admin-panel')
		return local ? 'http://localhost:3003' : 'https://admin.aerocrm.space'
	if (zone === 'crm')
		return local ? 'http://localhost:3001' : 'https://workspace.aerocrm.space'
	return local ? 'http://localhost:3000' : 'https://aerocrm.space'
}

export function resolveFrontendHref(
	href: string,
	current = currentFrontendZone()
): string {
	if (!href.startsWith('/') || href.startsWith('//')) return href
	const target = zoneForPath(new URL(href, originForZone(current)).pathname)
	return target === current ? href : new URL(href, originForZone(target)).toString()
}

export function needsDocumentNavigation(
	href: string,
	current = currentFrontendZone()
): boolean {
	if (href.startsWith('#') || href.startsWith('?')) return false
	if (!href.startsWith('/') || href.startsWith('//')) return true
	return resolveFrontendHref(href, current) !== href
}
