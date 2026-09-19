import {
	CRM_ACCESS_STATES,
	CRM_ENTITLEMENT_STATUSES,
	type CrmAccessBootstrapResponse,
	type CrmAccessLifecycle,
	type CrmAccessState,
	type CrmEntitlementDetails,
	type CrmEntitlementStatus,
	type CrmResolvedAccessResponse,
	type CrmTrialActivationResponse,
	type CrmWorkspaceOption,
	type CrmWorkspaceRole
} from '@/entities/crm-access/model/crm-access.types'
import {
	hasExactKeys,
	isIsoDate,
	isNonEmptyString,
	isPositiveDecimal,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'

const WORKSPACE_ROLES = ['OWNER', 'MEMBER'] as const
const ACCESS_LIFECYCLES = [
	'ONBOARDING',
	'ACTIVE',
	'READ_ONLY',
	'SUSPENDED'
] as const
const MAX_WORKSPACES = 1000

const isWorkspaceRole = (value: unknown): value is CrmWorkspaceRole =>
	WORKSPACE_ROLES.includes(value as CrmWorkspaceRole)

const isAccessLifecycle = (value: unknown): value is CrmAccessLifecycle =>
	ACCESS_LIFECYCLES.includes(value as CrmAccessLifecycle)

const isAccessState = (value: unknown): value is CrmAccessState =>
	CRM_ACCESS_STATES.includes(value as CrmAccessState)

const isEntitlementStatus = (
	value: unknown
): value is CrmEntitlementStatus =>
	CRM_ENTITLEMENT_STATUSES.includes(value as CrmEntitlementStatus)

const parseWorkspace = (value: unknown): CrmWorkspaceOption | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['workspaceId', 'membershipId', 'role']) ||
		!isUuidV4(value.workspaceId) ||
		!isUuidV4(value.membershipId) ||
		!isWorkspaceRole(value.role)
	) {
		return null
	}

	return {
		workspaceId: value.workspaceId,
		membershipId: value.membershipId,
		role: value.role
	}
}

const parseWorkspaces = (value: unknown): CrmWorkspaceOption[] | null => {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > MAX_WORKSPACES
	) {
		return null
	}

	const workspaces: CrmWorkspaceOption[] = []
	const workspaceIds = new Set<string>()
	const membershipIds = new Set<string>()

	for (const item of value) {
		const workspace = parseWorkspace(item)
		if (
			!workspace ||
			workspaceIds.has(workspace.workspaceId) ||
			membershipIds.has(workspace.membershipId)
		) {
			return null
		}

		workspaceIds.add(workspace.workspaceId)
		membershipIds.add(workspace.membershipId)
		workspaces.push(workspace)
	}

	return workspaces
}

const parseEntitlement = (
	value: unknown,
	workspaceId: string
): CrmEntitlementDetails | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'id',
			'workspaceId',
			'planCode',
			'seatLimit',
			'policyVersion',
			'graceUntil',
			'trialStartedAt',
			'effectiveFrom',
			'effectiveUntil',
			'aggregateVersion',
			'sourceSequence'
		]) ||
		!isUuidV4(value.id) ||
		value.workspaceId !== workspaceId ||
		!isNonEmptyString(value.planCode, 64) ||
		!isIsoDate(value.effectiveFrom) ||
		!isIsoDate(value.effectiveUntil) ||
		Date.parse(value.effectiveFrom) > Date.parse(value.effectiveUntil) ||
		!isPositiveDecimal(value.aggregateVersion) ||
		!isPositiveDecimal(value.sourceSequence) ||
		(value.seatLimit !== null &&
			(typeof value.seatLimit !== 'number' ||
				!Number.isSafeInteger(value.seatLimit) ||
				value.seatLimit <= 0)) ||
		(value.policyVersion !== null &&
			(typeof value.policyVersion !== 'number' ||
				!Number.isSafeInteger(value.policyVersion) ||
				value.policyVersion <= 0)) ||
		(value.graceUntil !== null && !isIsoDate(value.graceUntil)) ||
		(value.policyVersion === null
			? value.graceUntil !== null
			: !isIsoDate(value.graceUntil) ||
				Date.parse(value.graceUntil) <= Date.parse(value.effectiveUntil) ||
				typeof value.seatLimit !== 'number' ||
				value.seatLimit < 2) ||
		(value.trialStartedAt !== null && !isIsoDate(value.trialStartedAt)) ||
		(value.planCode === 'TRIAL' && !isIsoDate(value.trialStartedAt)) ||
		(isIsoDate(value.trialStartedAt) &&
			Date.parse(value.trialStartedAt) > Date.parse(value.effectiveUntil))
	) {
		return null
	}

	return {
		id: value.id,
		workspaceId,
		planCode: value.planCode,
		seatLimit: value.seatLimit,
		policyVersion: value.policyVersion,
		graceUntil: value.graceUntil,
		trialStartedAt: value.trialStartedAt,
		effectiveFrom: value.effectiveFrom,
		effectiveUntil: value.effectiveUntil,
		aggregateVersion: value.aggregateVersion,
		sourceSequence: value.sourceSequence
	}
}

const isStateConsistent = (
	state: Exclude<CrmAccessState, 'WORKSPACE_SELECTION_REQUIRED'>,
	entitlementStatus: CrmEntitlementStatus,
	entitlement: CrmEntitlementDetails | null,
	access: { lifecycle: CrmAccessLifecycle } | null
) => {
	if (entitlementStatus === 'NOT_ACTIVATED') {
		return (
			state === 'NOT_ACTIVATED' && entitlement === null && access === null
		)
	}

	if (!entitlement) {
		return false
	}

	if (access?.lifecycle === 'SUSPENDED') {
		return state === 'SUSPENDED'
	}

	if (entitlementStatus !== 'ACTIVE' && entitlementStatus !== 'GRACE') {
		return state === entitlementStatus
	}

	if (state === 'ONBOARDING') {
		return access === null || access.lifecycle === 'ONBOARDING'
	}

	if (access?.lifecycle === 'READ_ONLY') {
		return state === 'READ_ONLY'
	}

	return state === entitlementStatus && access?.lifecycle === 'ACTIVE'
}

const parseResolvedAccess = (
	value: Record<string, unknown>,
	expectActivation: boolean,
	expectedWorkspaceId?: string
): CrmResolvedAccessResponse | CrmTrialActivationResponse | null => {
	const keys = [
		'schemaVersion',
		'state',
		'selectedWorkspaceId',
		'membership',
		'workspaces',
		'entitlementStatus',
		'entitlement',
		'access',
		...(expectActivation ? ['activated'] : [])
	]

	if (
		!hasExactKeys(value, keys) ||
		value.schemaVersion !== 1 ||
		!isAccessState(value.state) ||
		value.state === 'WORKSPACE_SELECTION_REQUIRED' ||
		!isUuidV4(value.selectedWorkspaceId) ||
		(expectedWorkspaceId !== undefined &&
			value.selectedWorkspaceId !== expectedWorkspaceId) ||
		!isEntitlementStatus(value.entitlementStatus) ||
		!isRecord(value.membership) ||
		!hasExactKeys(value.membership, ['membershipId', 'role']) ||
		!isUuidV4(value.membership.membershipId) ||
		!isWorkspaceRole(value.membership.role) ||
		(expectActivation && typeof value.activated !== 'boolean')
	) {
		return null
	}

	const workspaces = parseWorkspaces(value.workspaces)
	const selectedWorkspace = workspaces?.find(
		workspace => workspace.workspaceId === value.selectedWorkspaceId
	)
	if (
		!workspaces ||
		!selectedWorkspace ||
		selectedWorkspace.membershipId !== value.membership.membershipId ||
		selectedWorkspace.role !== value.membership.role
	) {
		return null
	}

	let access: { lifecycle: CrmAccessLifecycle } | null = null
	if (value.access !== null) {
		if (
			!isRecord(value.access) ||
			!hasExactKeys(value.access, ['lifecycle']) ||
			!isAccessLifecycle(value.access.lifecycle)
		) {
			return null
		}
		access = { lifecycle: value.access.lifecycle }
	}

	const entitlement =
		value.entitlement === null
			? null
			: parseEntitlement(value.entitlement, value.selectedWorkspaceId)
	if (
		(value.entitlement !== null && !entitlement) ||
		!isStateConsistent(
			value.state,
			value.entitlementStatus,
			entitlement,
			access
		)
	) {
		return null
	}

	const response: CrmResolvedAccessResponse = {
		schemaVersion: 1,
		state: value.state,
		selectedWorkspaceId: value.selectedWorkspaceId,
		membership: {
			membershipId: value.membership.membershipId,
			role: value.membership.role
		},
		workspaces,
		entitlementStatus: value.entitlementStatus,
		entitlement,
		access
	}

	return expectActivation
		? { ...response, activated: value.activated as boolean }
		: response
}

export const parseCrmAccessBootstrap = (
	value: unknown,
	expectedWorkspaceId?: string
): CrmAccessBootstrapResponse | null => {
	if (!isRecord(value)) {
		return null
	}

	if (value.state === 'WORKSPACE_SELECTION_REQUIRED') {
		if (
			expectedWorkspaceId !== undefined ||
			!hasExactKeys(value, [
				'schemaVersion',
				'state',
				'selectedWorkspaceId',
				'workspaces'
			]) ||
			value.schemaVersion !== 1 ||
			value.selectedWorkspaceId !== null
		) {
			return null
		}

		const workspaces = parseWorkspaces(value.workspaces)
		return workspaces
			? {
					schemaVersion: 1,
					state: 'WORKSPACE_SELECTION_REQUIRED',
					selectedWorkspaceId: null,
					workspaces
				}
			: null
	}

	return parseResolvedAccess(value, false, expectedWorkspaceId)
}

export const parseCrmTrialActivation = (
	value: unknown,
	expectedWorkspaceId: string
): CrmTrialActivationResponse | null => {
	if (!isRecord(value)) {
		return null
	}

	return parseResolvedAccess(
		value,
		true,
		expectedWorkspaceId
	) as CrmTrialActivationResponse | null
}
