import { parseStrictBoolean } from '../runtime/billing-runtime.service';

export const AEROCRM_PROVIDER_EVENT =
	'billing.crm.provider-operation.requested.v1';
export const AEROCRM_PROVIDER_QUEUE =
	'aerocrm.billing.crm-provider.v1';
export const AEROCRM_PROVIDER_DEAD_EXCHANGE =
	'aerocrm.billing.crm-provider.dead-letter';
export const AEROCRM_PROVIDER_DEAD_QUEUE = `${AEROCRM_PROVIDER_QUEUE}.dead-letter`;
export const AEROCRM_PROVIDER_REQUEUE_MS = 5_000;

export function crmPaymentsEnabled(): boolean {
	return parseStrictBoolean(
		process.env.BILLING_CRM_PAYMENTS_ENABLED,
		false,
		'BILLING_CRM_PAYMENTS_ENABLED'
	);
}

// Keep reconciliation alive after new payments have been switched off. Once
// provisioned, the broker credential is retained until durable jobs are drained.
// The scheduler receives the non-secret switch, never the worker's credential.
export function crmProviderMessagingEnabled(): boolean {
	const reconciliation = parseStrictBoolean(
		process.env.BILLING_CRM_RECONCILIATION_ENABLED,
		false,
		'BILLING_CRM_RECONCILIATION_ENABLED'
	);
	return (
		crmPaymentsEnabled() ||
		reconciliation ||
		Boolean(process.env.BILLING_CRM_PROVIDER_RABBITMQ_URL?.trim())
	);
}

export function crmProviderBrokerConfiguration() {
	const raw =
		process.env.BILLING_CRM_PROVIDER_RABBITMQ_URL?.trim() || '';
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		throw new Error('aeroCRM provider RabbitMQ URL is required');
	}
	if (
		!parsed.username ||
		!parsed.password ||
		parsed.hash ||
		parsed.search ||
		!(
			parsed.protocol === 'amqps:' ||
			(parsed.protocol === 'amqp:' &&
				['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname))
		)
	) {
		throw new Error(
			'aeroCRM provider RabbitMQ requires scoped credentials and TLS except on loopback'
		);
	}
	return {
		url: raw,
		assertTopology: parseStrictBoolean(
			process.env.BILLING_CRM_PROVIDER_ASSERT_TOPOLOGY,
			false,
			'BILLING_CRM_PROVIDER_ASSERT_TOPOLOGY'
		)
	};
}
