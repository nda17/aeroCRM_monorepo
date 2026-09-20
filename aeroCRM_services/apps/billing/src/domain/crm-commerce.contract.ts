export const AEROCRM_PROVIDER_EVENT_TYPE =
	'billing.crm.provider-operation.requested.v1' as const;
export const AEROCRM_PROVIDER_CONSUMER =
	'billing.crm-provider.v1' as const;

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

export interface CrmProviderEvent {
	schemaVersion: 1;
	eventType: typeof AEROCRM_PROVIDER_EVENT_TYPE;
	eventId: string;
	operationId: string;
}

export interface CrmProviderClaim {
	operationId: string;
	eventId: string;
	leaseToken: string;
	version: number;
}

export type CrmProviderClaimResult =
	| { state: 'DONE' | 'BUSY' }
	| { state: 'CLAIMED'; claim: CrmProviderClaim };

// Provider-only material: never serialize this object to Outbox, receipts,
// public HTTP, exception messages or diagnostic logs. The caller decrypts the
// saved method immediately before invoking the provider adapter.
export interface CrmProviderCreateRequest {
	productCode: 'AEROCRM';
	paymentId: string;
	plan: 'AEROCRM';
	billingPeriod: CrmBillingCycle;
	kind: 'ONE_TIME' | 'RECURRING';
	amount: string;
	currency: 'RUB';
	autoRenew: boolean;
	customerEmail: string | null;
	customerPhone: string | null;
	returnUrl: string | null;
	paymentMethodCiphertext: string | null;
}

export type CrmPreparedProviderOperation =
	| { action: 'SKIP' }
	| {
			action: 'CREATE' | 'VERIFY' | 'SYNC_RECEIPT';
			orderId: string;
			workspaceId: string;
			ownerSubject: string;
			commandId: string;
			capacityFence: CrmCapacityFence;
			providerPaymentId: string | null;
			idempotencyKey: string;
			request: CrmProviderCreateRequest | null;
			firstDispatchAt: string | null;
	  };

export type CrmProviderFailureCode =
	| 'TRANSPORT_UNKNOWN'
	| 'PROVIDER_RETRYABLE'
	| 'PROVIDER_REJECTED'
	| 'PROVIDER_INVALID_RESPONSE'
	| 'PROVIDER_BINDING_MISMATCH'
	| 'DEPENDENCY_UNAVAILABLE'
	| 'AUTHORIZATION_REVOKED'
	| 'LEASE_EXPIRED'
	| 'IDEMPOTENCY_WINDOW_EXPIRED';

export interface CrmProviderFailure {
	code: CrmProviderFailureCode;
	ambiguous: boolean;
	retryable: boolean;
	providerPaymentId?: string;
}

export class CrmProviderResponseError extends Error {
	readonly retryable = false;
	constructor(
		readonly code:
			| 'PROVIDER_BINDING_MISMATCH'
			| 'PROVIDER_INVALID_RESPONSE'
	) {
		super('aeroCRM provider response failed validation');
		this.name = 'CrmProviderResponseError';
	}
}

export interface CrmOrderView {
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
	canVerify: boolean;
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
