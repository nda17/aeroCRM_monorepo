import { ServiceUnavailableException } from '@nestjs/common';

const STATUSES = ['PENDING', 'SUCCEEDED', 'CANCELLED', 'EXPIRED', 'UNKNOWN'] as const;

function invalid(): never {
	throw new ServiceUnavailableException('Owner returned invalid admin overview');
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
	return value as Record<string, unknown>;
}

function string(value: unknown): string {
	if (typeof value !== 'string' || !value.length) return invalid();
	return value;
}

function nullableString(value: unknown): string | null {
	return value === null ? null : string(value);
}

function nullableText(value: unknown): string | null {
	if (value === null || typeof value === 'string') return value;
	return invalid();
}

function count(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) return invalid();
	return Number(value);
}

function integerString(value: unknown): string {
	const result = string(value);
	if (!/^\d+$/.test(result)) return invalid();
	return result;
}

function date(value: unknown): string {
	const result = string(value);
	if (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result))) return invalid();
	return result;
}

function nullableDate(value: unknown): string | null {
	return value === null ? null : date(value);
}

export function parseBillingAdminOverview(value: unknown, userId: string) {
	const billing = record(value);
	if (billing.schemaVersion !== 1 || billing.ownerSubject !== userId || !Array.isArray(billing.workspaces)) return invalid();
	const seen = new Set<string>();
	const items = billing.workspaces.map(item => {
		const workspace = record(item);
		const workspaceId = string(workspace.workspaceId);
		if (seen.has(workspaceId)) return invalid();
		seen.add(workspaceId);
		if (workspace.entitlement === null) return { workspaceId, entitlement: null };
		const entitlement = record(workspace.entitlement);
		if (entitlement.workspaceId !== workspaceId) return invalid();
		return { workspaceId, entitlement: {
			workspaceId,
			productCode: string(entitlement.productCode),
			planCode: string(entitlement.planCode),
			status: string(entitlement.status),
			seatLimit: entitlement.seatLimit === null ? null : count(entitlement.seatLimit),
			graceUntil: nullableDate(entitlement.graceUntil),
			trialStartedAt: nullableDate(entitlement.trialStartedAt),
			effectiveFrom: date(entitlement.effectiveFrom),
			effectiveUntil: date(entitlement.effectiveUntil),
			aggregateVersion: integerString(entitlement.aggregateVersion),
			sourceSequence: integerString(entitlement.sourceSequence)
		} };
	});
	const sourceCounts = record(billing.paymentCounts);
	const counts = {
		PENDING: count(sourceCounts.PENDING), SUCCEEDED: count(sourceCounts.SUCCEEDED),
		CANCELLED: count(sourceCounts.CANCELLED), EXPIRED: count(sourceCounts.EXPIRED), UNKNOWN: count(sourceCounts.UNKNOWN)
	};
	const total = count(Object.values(counts).reduce((sum, value) => sum + value, 0));
	if (!Array.isArray(billing.latestPayments) || billing.latestPayments.length > 5) return invalid();
	const latest = billing.latestPayments.map(item => {
		const payment = record(item);
		const status = STATUSES.find(status => status === payment.status);
		if (!status) return invalid();
		return {
			id: string(payment.id), workspaceId: string(payment.workspaceId),
			providerPaymentId: nullableString(payment.providerPaymentId), status,
			amountMinor: integerString(payment.amountMinor), kind: string(payment.kind),
			cycle: nullableString(payment.cycle), createdAt: date(payment.createdAt), updatedAt: date(payment.updatedAt)
		};
	});
	return {
		subscriptions: { status: 'AVAILABLE' as const, items },
		payments: { status: 'AVAILABLE' as const, total, counts, latest }
	};
}

export function parseAuditAdminOverview(value: unknown) {
	const audit = record(value);
	if (!Array.isArray(audit.latest)) return invalid();
	const latest = audit.latest.map(item => {
		const event = record(item);
		if (event.role !== 'TARGET' && event.role !== 'ADMIN') return invalid();
		return {
			id: string(event.id), section: string(event.section), action: string(event.action),
			description: string(event.description), entityType: nullableString(event.entityType),
			entityLabel: nullableString(event.entityLabel), adminName: nullableText(event.adminName),
			adminEmail: nullableText(event.adminEmail), targetUserId: nullableString(event.targetUserId),
			createdAt: date(event.createdAt), role: event.role
		};
	});
	return { status: 'AVAILABLE' as const, latest };
}
