import { isUuidV4 } from '@/shared/lib/contract'

export interface BillingRoute {
	workspaceId: string
	orderId: string | null
	commandId: string | null
}

/** Only opaque references belong in a payment return URL, never a payment body. */
export const parseBillingRoute = (
	search: Pick<URLSearchParams, 'getAll' | 'keys'>,
	returning = false
): BillingRoute | null => {
	const allowed = returning
		? ['workspaceId', 'orderId']
		: ['workspaceId', 'orderId', 'commandId']
	if ([...search.keys()].some(key => !allowed.includes(key))) return null
	const ids = new Map<string, string | null>()
	for (const key of allowed) {
		const values = search.getAll(key)
		if (values.length > 1 || (values.length === 1 && !isUuidV4(values[0])))
			return null
		ids.set(key, values[0] ?? null)
	}
	const workspaceId = ids.get('workspaceId')
	const orderId = ids.get('orderId') ?? null
	const commandId = ids.get('commandId') ?? null
	if (!workspaceId || (returning && !orderId) || (orderId && commandId))
		return null
	return { workspaceId, orderId, commandId }
}

export const billingHref = (
	workspaceId: string,
	reference?: { orderId: string } | { commandId: string }
) => {
	if (!isUuidV4(workspaceId)) return null
	const search = new URLSearchParams({ workspaceId })
	if (reference) {
		const [key, value] = Object.entries(reference)[0] ?? []
		if (
			Object.keys(reference).length !== 1 ||
			(key !== 'orderId' && key !== 'commandId') ||
			!isUuidV4(value)
		)
			return null
		search.set(key, value)
	}
	return `/billing?${search.toString()}`
}
