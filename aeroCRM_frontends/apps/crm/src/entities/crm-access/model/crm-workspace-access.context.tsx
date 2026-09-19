'use client'

import { createContext, useContext, type PropsWithChildren } from 'react'

import type { CrmResolvedAccessResponse } from './crm-access.types'

export type CrmWorkspaceAccessState = 'ACTIVE' | 'GRACE' | 'READ_ONLY'

export interface CrmWorkspaceAccess {
	workspaceId: string
	state: CrmWorkspaceAccessState
	membership: CrmResolvedAccessResponse['membership']
	entitlement: NonNullable<CrmResolvedAccessResponse['entitlement']>
	/** Subscription UI capability. Each endpoint independently enforces CRM RBAC. */
	canWrite: boolean
	isReadOnly: boolean
	canExport: boolean
}

export const canOpenCrmWorkspace = (access: CrmResolvedAccessResponse) =>
	(access.state === 'ACTIVE' ||
		access.state === 'GRACE' ||
		access.state === 'READ_ONLY') &&
	access.entitlement !== null &&
	(access.access?.lifecycle === 'ACTIVE' ||
		(access.state === 'READ_ONLY' &&
			access.access?.lifecycle === 'READ_ONLY'))

const CrmWorkspaceAccessContext = createContext<CrmWorkspaceAccess | null>(
	null
)

/** Mount only after AccessGate has successfully validated the current session. */
export const CrmWorkspaceAccessProvider = ({
	access,
	children
}: PropsWithChildren<{ access: CrmResolvedAccessResponse }>) => {
	if (!canOpenCrmWorkspace(access) || !access.entitlement) {
		throw new Error('Confirmed workspace access is required')
	}

	const isReadOnly = access.state === 'READ_ONLY'

	return (
		<CrmWorkspaceAccessContext.Provider
			value={{
				workspaceId: access.selectedWorkspaceId,
				state: access.state as CrmWorkspaceAccessState,
				membership: access.membership,
				entitlement: access.entitlement,
				canWrite: !isReadOnly,
				isReadOnly,
				canExport: access.membership.role === 'OWNER'
			}}
		>
			{children}
		</CrmWorkspaceAccessContext.Provider>
	)
}

export const useCrmWorkspaceAccess = (): CrmWorkspaceAccess => {
	const access = useContext(CrmWorkspaceAccessContext)
	if (!access) throw new Error('CRM workspace access provider is required')
	return access
}
