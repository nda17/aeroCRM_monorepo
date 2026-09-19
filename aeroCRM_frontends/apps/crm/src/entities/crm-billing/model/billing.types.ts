import type {
	BillingCycle,
	BillingPeriod,
	BillingPriceSnapshot
} from './billing-values.contract'

export interface BillingOrder {
	id: string
	workspaceId: string
	version: number
	kind: 'ONE_TIME' | 'RECURRING'
	state: 'PENDING' | 'SUCCEEDED' | 'CANCELLED' | 'UNKNOWN'
	cycle: BillingCycle
	totalSeats: number
	amountMinor: string
	currency: 'RUB'
	policyVersion: number
	confirmationUrl: string | null
	canVerify: boolean
	checkoutExpiresAt: string
	createdAt: string
	succeededAt: string | null
	fulfillment: 'NONE' | 'SCHEDULED' | 'ACTIVE' | 'EXPIRED'
	periodId: string | null
	startsAt: string | null
	expiresAt: string | null
}
export interface BillingRenewal {
	version: number
	state:
		| 'NONE'
		| 'ACTIVE'
		| 'USER_DISABLED'
		| 'TECHNICAL_PAUSE'
		| 'PRICE_CONFIRMATION_REQUIRED'
		| 'REVOKED'
	canDisable: boolean
	dispatchPending: boolean
	nextChargeAt: string | null
	nextRetryAt: string | null
	retryAttempt: number
	methodLast4: string | null
	methodTitle: string | null
}
export interface BillingSummary {
	schemaVersion: 1
	workspaceId: string
	billingVersion: string
	serverTime: string
	policy: BillingPriceSnapshot
	trial: { startsAt: string; expiresAt: string; seatLimit: number } | null
	period: BillingPeriod | null
	pendingOrder: BillingOrder | null
	renewal: BillingRenewal
}
export interface BillingContext {
	schemaVersion: 1
	workspaceId: string
	actorSubject: string
	billing: BillingSummary
	capacity: {
		usedSeats: number
		admissionCeiling: number | null
		pendingOperationId: string | null
	}
	capabilities: {
		quote: boolean
		checkout: boolean
		changeSeats: boolean
		disableAutoRenew: boolean
		confirmRenewalPrice: boolean
	}
}
export interface BillingCommandProof {
	schemaVersion: 1
	workspaceId: string
	commandId: string
	requestHash: string
	status: 'PENDING' | 'COMMITTED' | 'CANCELLED'
	billingVersion: string
	releaseFence: boolean
	holdUntil: string | null
	order: BillingOrder | null
	period: BillingPeriod | null
}
export interface BillingOperation {
	schemaVersion: 1
	workspaceId: string
	commandId: string
	state: 'PENDING' | 'COMMITTED' | 'CANCELLED' | 'NOT_STARTED'
	requestHash: string | null
	billing: BillingCommandProof | null
}
interface BillingCommandBase {
	schemaVersion: 1
	workspaceId: string
	commandId: string
	expectedBillingVersion: string
}
export interface BillingCheckoutCommand extends BillingCommandBase {
	expectedPolicyVersion: number
	cycle: BillingCycle
	totalSeats: number
	autoRenew: boolean
	consentVersion: string | null
}
export interface BillingSeatCommand extends BillingCommandBase {
	expectedPeriodId: string
	expectedPeriodVersion: number
	newTotalSeats: number
}
export interface BillingDisableRenewalCommand extends BillingCommandBase {
	expectedRenewalVersion: number
}
export interface BillingConfirmRenewalCommand extends BillingDisableRenewalCommand {
	expectedPolicyVersion: number
	consentVersion: string
}
export interface BillingVerifyOrderCommand extends BillingCommandBase {
	orderId: string
	expectedOrderVersion: number
}
export type BillingMutation =
	| { action: 'checkout'; body: BillingCheckoutCommand }
	| { action: 'seats'; body: BillingSeatCommand }
	| { action: 'renewal/disable'; body: BillingDisableRenewalCommand }
	| { action: 'renewal/confirm-price'; body: BillingConfirmRenewalCommand }
	| { action: 'orders/verify'; body: BillingVerifyOrderCommand }
export interface BillingHistory {
	schemaVersion: 1
	workspaceId: string
	page: number
	pageSize: number
	total: number
	items: BillingOrder[]
}
export interface BillingOrderResponse {
	schemaVersion: 1
	workspaceId: string
	serverTime: string
	order: BillingOrder
}
