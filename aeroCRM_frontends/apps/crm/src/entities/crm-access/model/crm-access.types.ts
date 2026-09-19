export const CRM_ACCESS_STATES = [
	'WORKSPACE_SELECTION_REQUIRED',
	'NOT_ACTIVATED',
	'ONBOARDING',
	'ACTIVE',
	'GRACE',
	'READ_ONLY',
	'SUSPENDED',
	'EXPIRED',
	'CANCELLED'
] as const

export type CrmAccessState = (typeof CRM_ACCESS_STATES)[number]

export const CRM_ENTITLEMENT_STATUSES = [
	'NOT_ACTIVATED',
	'ACTIVE',
	'GRACE',
	'READ_ONLY',
	'SUSPENDED',
	'EXPIRED',
	'CANCELLED'
] as const

export type CrmEntitlementStatus =
	(typeof CRM_ENTITLEMENT_STATUSES)[number]

export type CrmWorkspaceRole = 'OWNER' | 'MEMBER'
export type CrmAccessLifecycle =
	| 'ONBOARDING'
	| 'ACTIVE'
	| 'READ_ONLY'
	| 'SUSPENDED'

export interface CrmWorkspaceOption {
	workspaceId: string
	membershipId: string
	role: CrmWorkspaceRole
}

export interface CrmEntitlementDetails {
	id: string
	workspaceId: string
	planCode: string
	seatLimit: number | null
	policyVersion: number | null
	graceUntil: string | null
	trialStartedAt: string | null
	effectiveFrom: string
	effectiveUntil: string
	aggregateVersion: string
	sourceSequence: string
}

export interface CrmWorkspaceSelectionResponse {
	schemaVersion: 1
	state: 'WORKSPACE_SELECTION_REQUIRED'
	selectedWorkspaceId: null
	workspaces: readonly CrmWorkspaceOption[]
}

export interface CrmResolvedAccessResponse {
	schemaVersion: 1
	state: Exclude<CrmAccessState, 'WORKSPACE_SELECTION_REQUIRED'>
	selectedWorkspaceId: string
	membership: {
		membershipId: string
		role: CrmWorkspaceRole
	}
	workspaces: readonly CrmWorkspaceOption[]
	entitlementStatus: CrmEntitlementStatus
	entitlement: CrmEntitlementDetails | null
	access: { lifecycle: CrmAccessLifecycle } | null
}

export type CrmAccessBootstrapResponse =
	| CrmWorkspaceSelectionResponse
	| CrmResolvedAccessResponse

export type CrmTrialActivationResponse = CrmResolvedAccessResponse & {
	activated: boolean
}
