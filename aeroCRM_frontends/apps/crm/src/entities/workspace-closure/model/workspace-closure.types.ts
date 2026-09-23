import type {
	BillingHistory,
	BillingOrderResponse,
	BillingSummary
} from '@/entities/crm-billing'

export const WORKSPACE_CLOSURE_SERVICES = [
	'crm-access',
	'identity',
	'billing',
	'crm-customers',
	'crm-sales',
	'crm-intake',
	'notification-delivery'
] as const

export type WorkspaceClosureService =
	(typeof WORKSPACE_CLOSURE_SERVICES)[number]
export type WorkspaceClosureState = 'CLOSING' | 'CLOSED'
export type WorkspaceClosureParticipantState =
	| 'PENDING'
	| 'FENCED'
	| 'SETTLED'

export interface WorkspaceClosureView {
	id: string
	workspaceId: string
	displayName: string | null
	state: WorkspaceClosureState
	version: string
	requestedAt: string
	closedAt: string | null
	steps: Array<{
		service: WorkspaceClosureService
		state: WorkspaceClosureParticipantState
		lastErrorCode: string | null
	}>
	financialPendingCount: number
	priorDispatchCount: number
	lastErrorCode: string | null
}

export interface WorkspaceClosureCommand {
	schemaVersion: 1
	commandId: string
	workspaceId: string
	expectedVersion: '0'
	confirmationLabel: string
}

export interface WorkspaceClosurePreview {
	schemaVersion: 1
	scope: { subject: string; workspaceId: string }
	enabled: boolean
	version: '0'
	confirmationLabel: string
	closure: WorkspaceClosureView | null
}

export interface WorkspaceClosureList {
	schemaVersion: 1
	scope: { subject: string }
	items: WorkspaceClosureView[]
}

export type ClosedWorkspaceBilling = BillingSummary
export type ClosedWorkspaceBillingHistory = BillingHistory
export type ClosedWorkspaceBillingOrder = BillingOrderResponse
