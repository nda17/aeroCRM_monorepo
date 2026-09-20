export const SUPPORT_NOTIFICATION_KINDS = [
	'support-team-email',
	'support-team-telegram',
	'support-client-email'
] as const;
export type SupportNotificationKind =
	(typeof SUPPORT_NOTIFICATION_KINDS)[number];
export const SUPPORT_NOTIFICATION_EVENT_TYPES = {
	'support-team-email': 'notification.support.team.email.requested.v1',
	'support-team-telegram':
		'notification.support.team.telegram.requested.v1',
	'support-client-email': 'notification.support.client.email.requested.v1'
} as const;
export const SUPPORT_NOTIFICATION_OUTCOME_EVENT_TYPE =
	'support.notification.delivery.outcome.v1';

export const TELEGRAM_DESTINATION_UNAVAILABLE_EVENT_TYPE =
	'notification.telegram.destination-unavailable.v1';
export const CAMPAIGN_EMAIL_NOTIFICATION_EVENT_TYPE =
	'notification.campaign.email.requested.v2';
export const CAMPAIGN_TELEGRAM_NOTIFICATION_EVENT_TYPE =
	'notification.campaign.telegram.requested.v2';
export const DAILY_SUMMARY_TELEGRAM_NOTIFICATION_EVENT_TYPE =
	'notification.daily-summary.telegram.requested.v1';
export const OPERATIONS_BACKUP_REPORT_TELEGRAM_EVENT_TYPE =
	'notification.operations.backup-report.telegram.requested.v1';
export const SUBSCRIPTION_EXPIRY_EMAIL_NOTIFICATION_EVENT_TYPE =
	'notification.subscription-expiry.email.requested.v1';
export const SUBSCRIPTION_EXPIRY_TELEGRAM_NOTIFICATION_EVENT_TYPE =
	'notification.subscription-expiry.telegram.requested.v1';
export const CRM_INVITATION_EMAIL_EVENT_TYPE =
	'notification.crm.invitation.email.requested.v1';
export const CRM_TASK_REMINDER_EMAIL_EVENT_TYPE =
	'notification.crm.task-reminder.email.requested.v1';
export const CRM_TASK_REMINDER_TELEGRAM_EVENT_TYPE =
	'notification.crm.task-reminder.telegram.requested.v1';
export const CRM_TASK_REMINDER_KINDS = [
	'crm-task-reminder-email',
	'crm-task-reminder-telegram'
] as const;
export const CRM_INTAKE_SLA_EMAIL_EVENT_TYPE =
	'notification.crm.intake-sla.email.requested.v1';
export const CRM_INTAKE_SLA_TELEGRAM_EVENT_TYPE =
	'notification.crm.intake-sla.telegram.requested.v1';
export const CRM_INTAKE_SLA_KINDS = [
	'crm-intake-sla-email',
	'crm-intake-sla-telegram'
] as const;
export const NOTIFICATION_DELIVERY_OUTCOME_EVENT_TYPE =
	'notification.delivery.outcome.v1';
export const REPORTING_NOTIFICATION_DELIVERY_OUTCOME_EVENT_TYPE =
	'reporting.notification.delivery.outcome.v1';
export const CAMPAIGN_NOTIFICATION_DELIVERY_OUTCOME_EVENT_TYPE =
	'notification.delivery.outcome.v2';

export const EVENTS_EXCHANGE = 'aerocrm.events';
export const RETRY_EXCHANGE = 'aerocrm.retry';
export const DEAD_LETTER_EXCHANGE = 'aerocrm.dead-letter';
export const MANUAL_RETRY_EXCHANGE = 'aerocrm.manual-retry';

export const DEFAULT_NOTIFICATION_DELIVERY_KINDS = [
	'campaign-email',
	'campaign-telegram',
	'daily-summary-delivery-telegram',
	'operations-backup-report-telegram',
	'subscription-expiry-email',
	'subscription-expiry-telegram'
] as const;

export const NOTIFICATION_DELIVERY_KINDS = [
	...DEFAULT_NOTIFICATION_DELIVERY_KINDS,
	...SUPPORT_NOTIFICATION_KINDS,
	'crm-invitation-email',
	...CRM_TASK_REMINDER_KINDS,
	...CRM_INTAKE_SLA_KINDS
] as const;

export type NotificationDeliveryKind =
	(typeof NOTIFICATION_DELIVERY_KINDS)[number];
export type IntegrationKind = NotificationDeliveryKind;
export type MessagingKind = NotificationDeliveryKind;

export const MESSAGING_KINDS = NOTIFICATION_DELIVERY_KINDS;

export const isCrmInvitationDeliveryEnabled = (
	configuredKinds?: string
): boolean =>
	configuredKinds
		?.split(',')
		.some(kind => kind.trim() === 'crm-invitation-email') === true;

export const MESSAGING_ROUTING_KEYS: Record<MessagingKind, string> = {
	...SUPPORT_NOTIFICATION_EVENT_TYPES,
	'crm-intake-sla-email': CRM_INTAKE_SLA_EMAIL_EVENT_TYPE,
	'crm-intake-sla-telegram': CRM_INTAKE_SLA_TELEGRAM_EVENT_TYPE,
	'campaign-email': CAMPAIGN_EMAIL_NOTIFICATION_EVENT_TYPE,
	'campaign-telegram': CAMPAIGN_TELEGRAM_NOTIFICATION_EVENT_TYPE,
	'daily-summary-delivery-telegram':
		DAILY_SUMMARY_TELEGRAM_NOTIFICATION_EVENT_TYPE,
	'operations-backup-report-telegram':
		OPERATIONS_BACKUP_REPORT_TELEGRAM_EVENT_TYPE,
	'subscription-expiry-email':
		SUBSCRIPTION_EXPIRY_EMAIL_NOTIFICATION_EVENT_TYPE,
	'subscription-expiry-telegram':
		SUBSCRIPTION_EXPIRY_TELEGRAM_NOTIFICATION_EVENT_TYPE,
	'crm-invitation-email': CRM_INVITATION_EMAIL_EVENT_TYPE,
	'crm-task-reminder-email': CRM_TASK_REMINDER_EMAIL_EVENT_TYPE,
	'crm-task-reminder-telegram': CRM_TASK_REMINDER_TELEGRAM_EVENT_TYPE
};

export const MESSAGING_QUEUE_NAMES: Record<MessagingKind, string> = {
	'support-team-email': 'aerocrm.notification.support.team.email',
	'support-team-telegram': 'aerocrm.notification.support.team.telegram',
	'support-client-email': 'aerocrm.notification.support.client.email',
	'crm-intake-sla-email':
		'aerocrm.notification.crm.intake-sla.email',
	'crm-intake-sla-telegram':
		'aerocrm.notification.crm.intake-sla.telegram',
	'campaign-email': 'aerocrm.notification.campaign.email.v2',
	'campaign-telegram': 'aerocrm.notification.campaign.telegram.v2',
	'daily-summary-delivery-telegram':
		'aerocrm.notification.daily-summary.telegram',
	'operations-backup-report-telegram':
		'aerocrm.notification.operations.backup-report.telegram',
	'subscription-expiry-email':
		'aerocrm.notification.subscription-expiry.email',
	'subscription-expiry-telegram':
		'aerocrm.notification.subscription-expiry.telegram',
	'crm-invitation-email':
		'aerocrm.notification.crm.invitation.email',
	'crm-task-reminder-email':
		'aerocrm.notification.crm.task-reminder.email',
	'crm-task-reminder-telegram':
		'aerocrm.notification.crm.task-reminder.telegram'
};

export const getManualRetryRoutingKey = (kind: MessagingKind): string =>
	`manual.${kind}`;

export const getDeadLetterRoutingKey = (kind: MessagingKind): string =>
	`${kind}.dead-letter`;

export const RETRY_DELAYS_MS = [30_000, 300_000, 1_800_000] as const;
