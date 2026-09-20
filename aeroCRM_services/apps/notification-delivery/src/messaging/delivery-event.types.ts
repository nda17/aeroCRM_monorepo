import type { SupportNotificationEvent } from './support-notification.contract';
import {
	CAMPAIGN_EMAIL_NOTIFICATION_EVENT_TYPE,
	CAMPAIGN_NOTIFICATION_DELIVERY_OUTCOME_EVENT_TYPE,
	CAMPAIGN_TELEGRAM_NOTIFICATION_EVENT_TYPE,
	DAILY_SUMMARY_TELEGRAM_NOTIFICATION_EVENT_TYPE,
	OPERATIONS_BACKUP_REPORT_TELEGRAM_EVENT_TYPE,
	NOTIFICATION_DELIVERY_OUTCOME_EVENT_TYPE,
	REPORTING_NOTIFICATION_DELIVERY_OUTCOME_EVENT_TYPE,
	SUBSCRIPTION_EXPIRY_EMAIL_NOTIFICATION_EVENT_TYPE,
	SUBSCRIPTION_EXPIRY_TELEGRAM_NOTIFICATION_EVENT_TYPE,
	TELEGRAM_DESTINATION_UNAVAILABLE_EVENT_TYPE,
	CRM_INVITATION_EMAIL_EVENT_TYPE,
	CRM_TASK_REMINDER_EMAIL_EVENT_TYPE,
	CRM_TASK_REMINDER_TELEGRAM_EVENT_TYPE
} from './messaging.constants';
import {
	CRM_INTAKE_SLA_EMAIL_EVENT_TYPE,
	CRM_INTAKE_SLA_TELEGRAM_EVENT_TYPE
} from './messaging.constants';

export interface TelegramDestinationUnavailableEventPayload {
	schemaVersion: 1;
	eventType: typeof TELEGRAM_DESTINATION_UNAVAILABLE_EVENT_TYPE;
	sourceEventId: string;
	sourceKind:
		| 'campaign-telegram'
		| 'subscription-expiry-telegram';
	destination: {
		telegramChatId: string;
	};
	normalizedCode: string;
	occurredAt: string;
}

export type NotificationDeliveryReference =
	| {
			type: 'daily-summary-job';
			id: string;
	  }
	| {
			type: 'subscription-expiry-reminder';
			id: string;
	  };

interface CampaignNotificationContent {
	subject: string;
	message: string;
}

export interface CampaignDeliveryReference {
	type: 'campaign-delivery';
	id: string;
	aggregateId: string;
	dispatchGeneration: number;
}

interface SubscriptionExpiryNotificationContent {
	daysBeforeExpiry: number;
	planLabel: string;
	expiresAtLabel: string;
}

export interface CampaignEmailNotificationRequestedEventPayload {
	schemaVersion: 2;
	eventType: typeof CAMPAIGN_EMAIL_NOTIFICATION_EVENT_TYPE;
	eventId: string;
	occurredAt: string;
	correlationId: string;
	campaignId: string;
	deliveryId: string;
	dispatchGeneration: number;
	reference: CampaignDeliveryReference;
	destination: {
		email: string;
	};
	content: CampaignNotificationContent;
}

export interface CampaignTelegramNotificationRequestedEventPayload {
	schemaVersion: 2;
	eventType: typeof CAMPAIGN_TELEGRAM_NOTIFICATION_EVENT_TYPE;
	eventId: string;
	occurredAt: string;
	correlationId: string;
	campaignId: string;
	deliveryId: string;
	dispatchGeneration: number;
	reference: CampaignDeliveryReference;
	destination: {
		telegramChatId: string;
	};
	content: CampaignNotificationContent;
}

export interface DailySummaryTelegramNotificationRequestedEventPayload {
	schemaVersion: 1;
	eventType: typeof DAILY_SUMMARY_TELEGRAM_NOTIFICATION_EVENT_TYPE;
	reference: Extract<
		NotificationDeliveryReference,
		{ type: 'daily-summary-job' }
	>;
	destination: {
		telegramChatId: string;
		messageThreadId: number;
	};
	content: {
		text: string;
	};
}

export interface OperationsBackupReportTelegramEventPayload {
	schemaVersion: 1;
	eventType: typeof OPERATIONS_BACKUP_REPORT_TELEGRAM_EVENT_TYPE;
	eventId: string;
	occurredAt: string;
	reference: { type: 'operations-backup-report'; id: string };
	destination: { telegramChatId: string; messageThreadId: number };
	content: { text: string; consoleUrl: string };
}

export interface SubscriptionExpiryEmailNotificationRequestedEventPayload {
	schemaVersion: 1;
	eventType: typeof SUBSCRIPTION_EXPIRY_EMAIL_NOTIFICATION_EVENT_TYPE;
	reference: Extract<
		NotificationDeliveryReference,
		{ type: 'subscription-expiry-reminder' }
	>;
	destination: {
		email: string;
	};
	content: SubscriptionExpiryNotificationContent;
}

export interface SubscriptionExpiryTelegramNotificationRequestedEventPayload {
	schemaVersion: 1;
	eventType: typeof SUBSCRIPTION_EXPIRY_TELEGRAM_NOTIFICATION_EVENT_TYPE;
	reference: Extract<
		NotificationDeliveryReference,
		{ type: 'subscription-expiry-reminder' }
	>;
	destination: {
		telegramChatId: string;
	};
	content: SubscriptionExpiryNotificationContent;
}

export type OutcomeNotificationDeliveryKind =
	| 'subscription-expiry-email'
	| 'subscription-expiry-telegram';

export interface NotificationDeliveryOutcomeEventPayload {
	schemaVersion: 1;
	eventType: typeof NOTIFICATION_DELIVERY_OUTCOME_EVENT_TYPE;
	sourceEventId: string;
	sourceKind: OutcomeNotificationDeliveryKind;
	reference: Extract<
		NotificationDeliveryReference,
		{ type: 'subscription-expiry-reminder' }
	>;
	status: 'DELIVERED' | 'FAILED';
	failure: {
		normalizedCode: string;
		safeReason: string;
	} | null;
	occurredAt: string;
}

export interface ReportingNotificationDeliveryOutcomeEventPayload {
	schemaVersion: 1;
	eventType: typeof REPORTING_NOTIFICATION_DELIVERY_OUTCOME_EVENT_TYPE;
	sourceEventId: string;
	sourceKind: 'daily-summary-delivery-telegram';
	reference: Extract<
		NotificationDeliveryReference,
		{ type: 'daily-summary-job' }
	>;
	status: 'DELIVERED' | 'FAILED';
	failure: {
		normalizedCode: string;
		safeReason: string;
	} | null;
	occurredAt: string;
}

export interface CampaignNotificationDeliveryOutcomeEventPayload {
	schemaVersion: 2;
	eventType: typeof CAMPAIGN_NOTIFICATION_DELIVERY_OUTCOME_EVENT_TYPE;
	eventId: string;
	occurredAt: string;
	correlationId: string;
	sourceEventId: string;
	sourceKind: 'campaign-email' | 'campaign-telegram';
	campaignId: string;
	deliveryId: string;
	dispatchGeneration: number;
	status: 'DELIVERED' | 'FAILED';
	failure: {
		normalizedCode: string;
		safeReason: string;
	} | null;
}

export interface CrmInvitationEmailRequestedEventPayload {
	schemaVersion: 1;
	eventId: string;
	eventType: typeof CRM_INVITATION_EMAIL_EVENT_TYPE;
	occurredAt: string;
	reference: {
		type: 'crm-invitation';
		id: string;
		workspaceId: string;
	};
	destination: { email: string };
	content: { invitationId: string; expiresAt: string };
}

export type NotificationDeliveryEventPayload =
	| SupportNotificationEvent
	| CrmIntakeSlaEventPayload
	| CrmTaskReminderEventPayload
	| CrmInvitationEmailRequestedEventPayload
	| CampaignEmailNotificationRequestedEventPayload
	| CampaignTelegramNotificationRequestedEventPayload
	| DailySummaryTelegramNotificationRequestedEventPayload
	| OperationsBackupReportTelegramEventPayload
	| SubscriptionExpiryEmailNotificationRequestedEventPayload
	| SubscriptionExpiryTelegramNotificationRequestedEventPayload
	| TelegramDestinationUnavailableEventPayload;

export interface CrmTaskReminderEventPayload {
	schemaVersion: 1;
	eventId: string;
	eventType:
		| typeof CRM_TASK_REMINDER_EMAIL_EVENT_TYPE
		| typeof CRM_TASK_REMINDER_TELEGRAM_EVENT_TYPE;
	occurredAt: string;
	reference: {
		type: 'crm-task-reminder';
		id: string;
		workspaceId: string;
	};
}
export interface CrmIntakeSlaEventPayload {
	schemaVersion: 1;
	eventId: string;
	eventType:
		| typeof CRM_INTAKE_SLA_EMAIL_EVENT_TYPE
		| typeof CRM_INTAKE_SLA_TELEGRAM_EVENT_TYPE;
	occurredAt: string;
	reference: {
		type: 'crm-intake-sla';
		id: string;
		workspaceId: string;
	};
}
