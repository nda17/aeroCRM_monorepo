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

export function needsDocumentNavigation(
	href: string,
	current = currentFrontendZone()
): boolean {
	if (href.startsWith('#') || href.startsWith('?')) return false
	if (!href.startsWith('/') || href.startsWith('//')) return true
	try {
		const url = new URL(href, 'https://aerocrm.space')
		if (url.origin !== 'https://aerocrm.space') return true
		return zoneForPath(url.pathname) !== current
	} catch {
		return true
	}
}
