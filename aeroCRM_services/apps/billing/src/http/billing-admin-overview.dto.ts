export type BillingAdminPaymentStatus =
	| 'PENDING'
	| 'SUCCEEDED'
	| 'CANCELLED'
	| 'EXPIRED'
	| 'UNKNOWN';

export interface BillingAdminEntitlementDto {
	workspaceId: string;
	productCode: string;
	planCode: string;
	status: string;
	seatLimit: number | null;
	graceUntil: string | null;
	trialStartedAt: string | null;
	effectiveFrom: string;
	effectiveUntil: string;
	aggregateVersion: string;
	sourceSequence: string;
}

export interface BillingAdminPaymentDto {
	id: string;
	workspaceId: string;
	providerPaymentId: string | null;
	status: BillingAdminPaymentStatus;
	amountMinor: string;
	kind: string;
	cycle: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface BillingAdminOverviewDto {
	schemaVersion: 1;
	ownerSubject: string;
	workspaces: Array<{
		workspaceId: string;
		entitlement: BillingAdminEntitlementDto | null;
	}>;
	paymentCounts: Record<BillingAdminPaymentStatus, number>;
	latestPayments: BillingAdminPaymentDto[];
}
