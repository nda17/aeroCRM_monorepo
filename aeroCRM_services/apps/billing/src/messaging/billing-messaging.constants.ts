export const BILLING_EVENTS_EXCHANGE = 'aerocrm.events';
export const BILLING_ADMIN_AUDIT_ROUTING_KEY = 'admin.audit.billing.v1';
export const BILLING_RETRY_EXCHANGE = 'aerocrm.billing.retry';
export const BILLING_DEAD_LETTER_EXCHANGE =
	'aerocrm.billing.dead-letter';

export const BILLING_EVENT_TYPES = {
	identityChanged: 'billing.identity.changed.v1',
	offerChanged: 'billing.offer.changed.v2',
	notificationRoutingChanged: 'billing.notification-routing.changed.v1',
	lifecycleRepairRequested: 'billing.lifecycle-repair.requested.v1',
	settingsChanged: 'billing.settings.changed.v1',
	crmEntitlementChanged: 'billing.crm-entitlement.changed.v1',
	crmOrderSucceeded: 'billing.crm-order.succeeded.v1',
	adminAudit: 'admin.audit.event.v1'
} as const;

export type BillingConsumerKind =
	| 'identity'
	| 'offer'
	| 'notification-routing'
	| 'lifecycle-repair';

export const BILLING_CONSUMER_KINDS: readonly BillingConsumerKind[] = [
	'identity',
	'offer',
	'notification-routing',
	'lifecycle-repair'
];

export const BILLING_QUEUE_NAMES: Record<BillingConsumerKind, string> = {
	identity: 'aerocrm.billing.identity.v1',
	offer: 'aerocrm.billing.offer.v2',
	'notification-routing': 'aerocrm.billing.notification-routing.v1',
	'lifecycle-repair': 'aerocrm.billing.lifecycle-repair.v1'
};

export const BILLING_ROUTING_KEYS: Record<BillingConsumerKind, string> = {
	identity: BILLING_EVENT_TYPES.identityChanged,
	offer: BILLING_EVENT_TYPES.offerChanged,
	'notification-routing': BILLING_EVENT_TYPES.notificationRoutingChanged,
	'lifecycle-repair': BILLING_EVENT_TYPES.lifecycleRepairRequested
};

export const BILLING_RETRY_DELAYS_MS = [
	60_000, 300_000, 1_800_000
] as const;

export function billingRetryRoutingKey(
	kind: BillingConsumerKind,
	attempt: number
): string {
	return `${kind}.retry.${attempt}`;
}

export function billingDeadLetterRoutingKey(
	kind: BillingConsumerKind
): string {
	return `${kind}.dead-letter`;
}
