-- A coordinated empty-state cutover: run the infrastructure preflight with
-- all affected writers stopped before applying this migration. Baseline remains immutable.
-- Existing unrelated receipts, failures, outboxes and integrity clauses are preserved.
BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE "notification_delivery"."control_actions",
  "notification_delivery"."delivery_failures",
  "notification_delivery"."delivery_receipts",
  "notification_delivery"."outbox_events" IN ACCESS EXCLUSIVE MODE;

DO $cutover$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "notification_delivery"."control_actions"
    WHERE "kind" LIKE '%wincrm%'
  ) OR EXISTS (
    SELECT 1 FROM "notification_delivery"."delivery_receipts"
    WHERE "consumer" LIKE '%wincrm%'
  ) OR EXISTS (
    SELECT 1 FROM "notification_delivery"."delivery_failures"
    WHERE concat_ws(' ', "consumer", "routing_key", "payload"->>'eventType',
      "payload"#>>'{reference,type}') LIKE '%wincrm%'
  ) OR EXISTS (
    SELECT 1 FROM "notification_delivery"."outbox_events"
    WHERE concat_ws(' ', "event_type", "routing_key", "deduplication_key",
      "payload"->>'eventType', "payload"->>'sourceKind',
      "payload"#>>'{reference,type}') LIKE '%wincrm%'
  ) THEN
    RAISE EXCEPTION 'CRM contract cutover requires an empty legacy delivery ledger; preserve rows and abort';
  END IF;
END
$cutover$;

ALTER TABLE "notification_delivery"."control_actions" DROP CONSTRAINT "control_actions_identity_check";
ALTER TABLE "notification_delivery"."control_actions" ADD CONSTRAINT "control_actions_identity_check" CHECK (
		char_length(btrim("kind")) BETWEEN 1 AND 100
		AND "kind" IN (

			'campaign-email',
			'campaign-telegram',
			'daily-summary-delivery-telegram',
            'operations-backup-report-telegram',
			'subscription-expiry-email',
			'subscription-expiry-telegram',
			'crm-invitation-email',
			'crm-task-reminder-email',
			'crm-task-reminder-telegram',
			'support-team-email',
			'support-team-telegram',
			'support-client-email',
			'crm-intake-sla-email',
			'crm-intake-sla-telegram'
		)
		AND char_length(btrim("actor_id")) BETWEEN 1 AND 255
	);

ALTER TABLE "notification_delivery"."delivery_failures" DROP CONSTRAINT "delivery_failures_classification_check";
ALTER TABLE "notification_delivery"."delivery_failures" ADD CONSTRAINT "delivery_failures_classification_check" CHECK (
		char_length(btrim("consumer")) BETWEEN 1 AND 100
		AND "consumer" IN (

			'campaign-email',
			'campaign-telegram',
			'daily-summary-delivery-telegram',
            'operations-backup-report-telegram',
			'subscription-expiry-email',
			'subscription-expiry-telegram',
			'crm-invitation-email',
			'crm-task-reminder-email',
			'crm-task-reminder-telegram',
			'support-team-email',
			'support-team-telegram',
			'support-client-email',
			'crm-intake-sla-email',
			'crm-intake-sla-telegram'
		)
		AND char_length(btrim("routing_key")) BETWEEN 1 AND 255
		AND char_length(btrim("normalized_code")) BETWEEN 1 AND 255
		AND char_length(btrim("safe_reason")) BETWEEN 1 AND 2000
		AND "classification_version" > 0
		AND ("http_status" IS NULL OR "http_status" BETWEEN 100 AND 599)
		AND jsonb_typeof("headers") = 'object'
	);

ALTER TABLE "notification_delivery"."delivery_receipts" DROP CONSTRAINT "delivery_receipts_identity_check";
ALTER TABLE "notification_delivery"."delivery_receipts" ADD CONSTRAINT "delivery_receipts_identity_check" CHECK (
		char_length(btrim("consumer")) BETWEEN 1 AND 100
		AND "consumer" IN (

			'campaign-email',
			'campaign-telegram',
			'daily-summary-delivery-telegram',
            'operations-backup-report-telegram',
			'subscription-expiry-email',
			'subscription-expiry-telegram',
			'crm-invitation-email',
			'crm-task-reminder-email',
			'crm-task-reminder-telegram',
			'support-team-email',
			'support-team-telegram',
			'support-client-email',
			'crm-intake-sla-email',
			'crm-intake-sla-telegram'
		)
	);

ALTER TABLE "notification_delivery"."outbox_events" DROP CONSTRAINT "notification_outbox_events_identity_check";
ALTER TABLE "notification_delivery"."outbox_events" ADD CONSTRAINT "notification_outbox_events_identity_check" CHECK (
		char_length(btrim("event_type")) BETWEEN 1 AND 255
		AND char_length(btrim("routing_key")) BETWEEN 1 AND 255
		AND (
			"deduplication_key" IS NULL
			OR char_length(btrim("deduplication_key")) BETWEEN 1 AND 500
		)
		AND jsonb_typeof("headers") = 'object'
		AND (
			"routing_key" NOT IN ('manual.crm-invitation-email', 'crm-invitation-email.dead-letter')
			OR "event_type" = 'notification.crm.invitation.email.requested.v1'
		)
		AND (
			"routing_key" NOT IN ('manual.crm-task-reminder-email', 'crm-task-reminder-email.dead-letter')
			OR "event_type" = 'notification.crm.task-reminder.email.requested.v1'
		)
		AND (
			"routing_key" NOT IN ('manual.crm-task-reminder-telegram', 'crm-task-reminder-telegram.dead-letter')
			OR "event_type" = 'notification.crm.task-reminder.telegram.requested.v1'
		)
		AND (
			"routing_key" NOT IN ('manual.support-team-email', 'support-team-email.dead-letter')
			OR "event_type" = 'notification.support.team.email.requested.v1'
		)
		AND (
			"routing_key" NOT IN ('manual.support-team-telegram', 'support-team-telegram.dead-letter')
			OR "event_type" = 'notification.support.team.telegram.requested.v1'
		)
		AND (
			"routing_key" NOT IN ('manual.support-client-email', 'support-client-email.dead-letter')
			OR "event_type" = 'notification.support.client.email.requested.v1'
		)
		AND (
			"routing_key" NOT IN ('manual.crm-intake-sla-email', 'crm-intake-sla-email.dead-letter')
			OR "event_type" = 'notification.crm.intake-sla.email.requested.v1'
		)
		AND (
			"routing_key" NOT IN ('manual.operations-backup-report-telegram', 'operations-backup-report-telegram.dead-letter')
			OR "event_type" = 'notification.operations.backup-report.telegram.requested.v1'
		)
		AND (
			"routing_key" NOT IN ('manual.crm-intake-sla-telegram', 'crm-intake-sla-telegram.dead-letter')
			OR "event_type" = 'notification.crm.intake-sla.telegram.requested.v1'
		)
		AND (
			(
				"exchange" = 'EVENTS'::"notification_delivery"."NotificationDeliveryExchange"
				AND (
					"routing_key" IN (

						'manual.campaign-email',
						'manual.campaign-telegram',
						'manual.daily-summary-delivery-telegram',
                        'manual.operations-backup-report-telegram',
						'manual.subscription-expiry-email',
						'manual.subscription-expiry-telegram',
						'manual.crm-invitation-email',
						'manual.crm-task-reminder-email',
						'manual.crm-task-reminder-telegram',
						'manual.support-team-email',
						'manual.support-team-telegram',
						'manual.support-client-email',
						'manual.crm-intake-sla-email',
						'manual.crm-intake-sla-telegram'
					)
					OR (
						"routing_key" = 'notification.telegram.destination-unavailable.v1'
						AND "event_type" = 'notification.telegram.destination-unavailable.v1'
					)
					OR (
						"routing_key" = 'notification.delivery.outcome.v1'
						AND "event_type" = "routing_key"
						AND (
							"payload"->>'sourceKind' IN (
								'subscription-expiry-email',
								'subscription-expiry-telegram'
							)
							OR "status"::TEXT = 'PUBLISHED'
						)
					)
					OR (
						"routing_key" = 'reporting.notification.delivery.outcome.v1'
						AND "event_type" = "routing_key"
						AND "payload"->>'sourceKind' =
							'daily-summary-delivery-telegram'
					)
					OR (
						"routing_key" = 'support.notification.delivery.outcome.v1'
						AND "event_type" = "routing_key"
						AND "payload"->>'sourceKind' IN ('support-team-email', 'support-team-telegram', 'support-client-email')
					)
					OR (
						"routing_key" = 'notification.delivery.outcome.v2'
						AND "event_type" = "routing_key"
					)
				)
			)
			OR (
				"exchange" = 'DEAD_LETTER'::"notification_delivery"."NotificationDeliveryExchange"
				AND "routing_key" IN (

					'campaign-email.dead-letter',
					'campaign-telegram.dead-letter',
					'daily-summary-delivery-telegram.dead-letter',
                    'operations-backup-report-telegram.dead-letter',
					'subscription-expiry-email.dead-letter',
					'subscription-expiry-telegram.dead-letter',
					'crm-invitation-email.dead-letter',
					'crm-task-reminder-email.dead-letter',
					'crm-task-reminder-telegram.dead-letter',
					'support-team-email.dead-letter',
					'support-team-telegram.dead-letter',
					'support-client-email.dead-letter',
					'crm-intake-sla-email.dead-letter',
					'crm-intake-sla-telegram.dead-letter'
				)
			)
		)
	);

COMMIT;
