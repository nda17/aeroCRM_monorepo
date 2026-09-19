export interface SessionTransportLease {
	accessToken: string
	isCurrent: () => boolean
	refresh?: () => Promise<SessionTransportLease>
}

export type SessionTransportResolver = (
	bindingToken: string
) => Promise<SessionTransportLease>

interface Registration {
	resolver: SessionTransportResolver
}

let registration: Registration | null = null

export const registerSessionTransport = (
	resolver: SessionTransportResolver
) => {
	const owner = { resolver }
	registration = owner
	return () => {
		if (registration === owner) registration = null
	}
}

const bindLease = (
	lease: SessionTransportLease,
	owner: Registration
): SessionTransportLease => ({
	accessToken: lease.accessToken,
	isCurrent: () => registration === owner && lease.isCurrent(),
	...(lease.refresh
		? { refresh: async () => bindLease(await lease.refresh!(), owner) }
		: {})
})

export const resolveSessionTransport = async (
	bindingToken: string
): Promise<SessionTransportLease> => {
	const owner = registration
	// Standalone API consumers retain the existing direct-token contract.
	if (!owner) return { accessToken: bindingToken, isCurrent: () => true }
	return bindLease(await owner.resolver(bindingToken), owner)
}
