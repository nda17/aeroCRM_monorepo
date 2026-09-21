// Service-owned copy of the versioned Billing HTTP contract. Never import
// another app's runtime. Parity is exercised by the contract tests.
export type CrmBillingCycle = 'MONTHLY' | 'YEARLY';

export type CrmOrderState =
	| 'PENDING'
	| 'SUCCEEDED'
	| 'CANCELLED'
	| 'UNKNOWN';

export interface CrmPriceSnapshot {
	policyVersion: number;
	monthlyPriceMinor: number;
	yearlyPriceMinor: number;
	additionalSeatMonthlyPriceMinor: number;
	additionalSeatYearlyPriceMinor: number;
	includedSeats: number;
	graceDays: number;
}

export interface CrmCapacityFence {
	operationId: string;
	requestHash: string;
	fenceRevision: number;
	targetSeats: number;
}

export interface CrmAdminSeatProof {
	schemaVersion: 1;
	workspaceId: string;
	commandId: string;
	actorSubject: string;
	requestHash: string;
	capacityFence: CrmCapacityFence;
	status: 'COMMITTED' | 'CANCELLED';
	releaseFence: true;
	billingVersion: string;
	entitlementVersion: string;
	totalSeats: number | null;
}

export interface CrmCommerceContext {
	schemaVersion: 1;
	workspaceId: string;
	actorSubject: string;
}

export interface CrmCommerceCommand extends CrmCommerceContext {
	commandId: string;
	expectedBillingVersion: string;
}

export interface CrmCheckoutCommand extends CrmCommerceCommand {
	expectedPolicyVersion: number;
	cycle: CrmBillingCycle;
	totalSeats: number;
	autoRenew: boolean;
	consentVersion: string | null;
	capacityFence: CrmCapacityFence;
}

export interface CrmSeatChangeCommand extends CrmCommerceCommand {
	expectedPeriodId: string;
	expectedPeriodVersion: number;
	newTotalSeats: number;
	capacityFence: CrmCapacityFence;
}

export interface CrmDisableRenewalCommand extends CrmCommerceCommand {
	expectedRenewalVersion: number;
}

export interface CrmConfirmRenewalCommand extends CrmDisableRenewalCommand {
	expectedPolicyVersion: number;
	consentVersion: string;
}

export interface CrmVerifyOrderCommand extends CrmCommerceCommand {
	orderId: string;
	expectedOrderVersion: number;
}

export interface CrmQuoteRequest extends CrmCommerceContext {
	intent: 'CHECKOUT' | 'SEAT_CHANGE' | 'RENEWAL';
	cycle: CrmBillingCycle;
	totalSeats: number;
}

export interface CrmCommerceQuote {
	schemaVersion: 1;
	workspaceId: string;
	billingVersion: string;
	serverTime: string;
	validUntil: string;
	intent: 'CHECKOUT' | 'SEAT_CHANGE' | 'RENEWAL';
	cycle: CrmBillingCycle;
	totalSeats: number;
	amountMinor: string;
	currency: 'RUB';
	priceSnapshot: CrmPriceSnapshot;
	startsAt: string;
	expiresAt: string;
	period: {
		id: string;
		version: number;
		oldTotalSeats: number;
		oldExpiresAt: string;
		oldPeriodPriceMinor: string;
		newPeriodPriceMinor: string;
	} | null;
	consent: { version: string; text: string };
}

export interface CrmCommandStatusRequest extends CrmCommerceContext {
	commandId: string;
	requestHash: string;
}

export interface CrmCloseCommand extends CrmCommandStatusRequest {
	commandType: 'AEROCRM_CHECKOUT' | 'AEROCRM_SEAT_CHANGE';
	capacityFence: CrmCapacityFence;
}

export interface CrmOrderRequest extends CrmCommerceContext {
	orderId: string;
}

export interface CrmHistoryRequest extends CrmCommerceContext {
	page: number;
	pageSize: number;
}

export interface CrmOrderResponse {
	schemaVersion: 1;
	workspaceId: string;
	serverTime: string;
	order: CrmOrderView;
}

export interface CrmHistoryResponse {
	schemaVersion: 1;
	workspaceId: string;
	page: number;
	pageSize: number;
	total: number;
	items: CrmOrderView[];
}

export interface CrmOrderView {
	canVerify: boolean;
	id: string;
	workspaceId: string;
	version: number;
	kind: 'ONE_TIME' | 'RECURRING';
	state: CrmOrderState;
	cycle: CrmBillingCycle;
	totalSeats: number;
	amountMinor: string;
	currency: 'RUB';
	policyVersion: number;
	confirmationUrl: string | null;
	checkoutExpiresAt: string;
	createdAt: string;
	succeededAt: string | null;
	fulfillment: 'NONE' | 'SCHEDULED' | 'ACTIVE' | 'EXPIRED';
	periodId: string | null;
	startsAt: string | null;
	expiresAt: string | null;
}

export interface CrmPaidPeriodView {
	id: string;
	orderId: string;
	version: number;
	cycle: CrmBillingCycle;
	totalSeats: number;
	priceSnapshot: CrmPriceSnapshot;
	startsAt: string;
	expiresAt: string;
	graceUntil: string;
	state: 'SCHEDULED' | 'ACTIVE' | 'GRACE' | 'EXPIRED';
}

export interface CrmRenewalView {
	version: number;
	state:
		| 'NONE'
		| 'ACTIVE'
		| 'USER_DISABLED'
		| 'TECHNICAL_PAUSE'
		| 'PRICE_CONFIRMATION_REQUIRED'
		| 'REVOKED';
	canDisable: boolean;
	dispatchPending: boolean;
	nextChargeAt: string | null;
	nextRetryAt: string | null;
	retryAttempt: number;
	methodLast4: string | null;
	methodTitle: string | null;
}

export interface CrmCommerceSummary {
	schemaVersion: 1;
	workspaceId: string;
	billingVersion: string;
	serverTime: string;
	policy: CrmPriceSnapshot;
	trial: { startsAt: string; expiresAt: string; seatLimit: number } | null;
	period: CrmPaidPeriodView | null;
	pendingOrder: CrmOrderView | null;
	renewal: CrmRenewalView;
}

export interface CrmCommerceSummaryWithSeatControl {
	schemaVersion: 1;
	summary: CrmCommerceSummary;
	seatChangeBlockedReason: 'ADMIN_SEATS_ADJUSTED' | null;
}

export interface CrmCommerceCommandProof {
	schemaVersion: 1;
	workspaceId: string;
	commandId: string;
	requestHash: string;
	status: 'PENDING' | 'COMMITTED' | 'CANCELLED';
	billingVersion: string;
	releaseFence: boolean;
	holdUntil: string | null;
	order: CrmOrderView | null;
	period: CrmPaidPeriodView | null;
}
export type CommerceCommandType =
	| 'AEROCRM_CHECKOUT'
	| 'AEROCRM_SEAT_CHANGE'
	| 'AEROCRM_DISABLE_RENEWAL'
	| 'AEROCRM_CONFIRM_RENEWAL'
	| 'AEROCRM_VERIFY_ORDER';
export type CommerceUserCommand =
	| Omit<CrmCheckoutCommand, 'capacityFence'>
	| Omit<CrmSeatChangeCommand, 'capacityFence'>
	| CrmDisableRenewalCommand
	| CrmConfirmRenewalCommand
	| CrmVerifyOrderCommand;
export interface CrmBillingOperationView {
	schemaVersion: 1;
	workspaceId: string;
	commandId: string;
	state: 'PENDING' | 'COMMITTED' | 'CANCELLED' | 'NOT_STARTED';
	requestHash: string | null;
	billing: CrmCommerceCommandProof | null;
}
export interface CrmBillingContext {
	schemaVersion: 1;
	workspaceId: string;
	actorSubject: string;
	billing: CrmCommerceSummary;
	capacity: {
		usedSeats: number;
		admissionCeiling: number | null;
		pendingOperationId: string | null;
	};
	capabilities: {
		quote: boolean;
		checkout: boolean;
		changeSeats: boolean;
		disableAutoRenew: boolean;
		confirmRenewalPrice: boolean;
	};
}
