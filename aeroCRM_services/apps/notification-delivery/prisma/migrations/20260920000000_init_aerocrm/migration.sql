-- CreateSchema
-- The notification_delivery schema is pre-created and owned by its migration role.
DO $aerocrm_schema_owner$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'notification_delivery' AND nspowner = to_regrole(CURRENT_USER)) THEN RAISE EXCEPTION 'notification_delivery schema must exist and be owned by the migration role'; END IF; END $aerocrm_schema_owner$;

-- CreateEnum
CREATE TYPE "notification_delivery"."NotificationDeliveryReceiptStatus" AS ENUM ('PROCESSING', 'RETRY_SCHEDULED', 'DELIVERED', 'DEAD_LETTERED', 'CLOSED_NO_RETRY');

-- CreateEnum
CREATE TYPE "notification_delivery"."NotificationDeliveryErrorCategory" AS ENUM ('TRANSIENT', 'RATE_LIMIT', 'PERMANENT', 'AUTH_CONFIGURATION');

-- CreateEnum
CREATE TYPE "notification_delivery"."NotificationDeliveryFailureResolution" AS ENUM ('DELIVERED', 'CLOSED_NO_RETRY');

-- CreateEnum
CREATE TYPE "notification_delivery"."NotificationDeliveryControlActionKind" AS ENUM ('RETRY', 'CLOSE');

-- CreateEnum
CREATE TYPE "notification_delivery"."NotificationDeliveryOutboxStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "notification_delivery"."NotificationDeliveryExchange" AS ENUM ('EVENTS', 'DEAD_LETTER');

-- CreateTable
CREATE TABLE "notification_delivery"."delivery_receipts" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "consumer" TEXT NOT NULL,
    "status" "notification_delivery"."NotificationDeliveryReceiptStatus" NOT NULL,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "lock_token" UUID,
    "lease_expires_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "retry_attempt" INTEGER,
    "retry_available_at" TIMESTAMP(3),
    "retry_token" UUID,
    "checkpoint" JSONB,
    "details_redacted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_delivery"."delivery_failures" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "consumer" TEXT NOT NULL,
    "routing_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL,
    "last_error" TEXT NOT NULL,
    "category" "notification_delivery"."NotificationDeliveryErrorCategory" NOT NULL,
    "normalized_code" TEXT NOT NULL,
    "safe_reason" TEXT NOT NULL,
    "http_status" INTEGER,
    "provider_code" TEXT,
    "retryable" BOOLEAN NOT NULL,
    "classification_version" INTEGER NOT NULL,
    "first_failed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retrying_at" TIMESTAMP(3),
    "active_retry_token" UUID,
    "resolved_at" TIMESTAMP(3),
    "resolution" "notification_delivery"."NotificationDeliveryFailureResolution",
    "resolution_comment" TEXT,
    "resolved_by_id" TEXT,
    "details_redacted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_failures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_delivery"."control_actions" (
    "id" UUID NOT NULL,
    "action" "notification_delivery"."NotificationDeliveryControlActionKind" NOT NULL,
    "failure_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "control_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_delivery"."outbox_events" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "deduplication_key" TEXT,
    "exchange" "notification_delivery"."NotificationDeliveryExchange" NOT NULL,
    "event_type" TEXT NOT NULL,
    "routing_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL DEFAULT '{}',
    "status" "notification_delivery"."NotificationDeliveryOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "lock_token" UUID,
    "lease_expires_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_delivery"."heartbeats" (
    "id" UUID NOT NULL,
    "service" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "heartbeats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_receipts_lease_idx" ON "notification_delivery"."delivery_receipts"("status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "delivery_receipts_retry_idx" ON "notification_delivery"."delivery_receipts"("status", "retry_available_at");

-- CreateIndex
CREATE INDEX "delivery_receipts_retention_idx" ON "notification_delivery"."delivery_receipts"("status", "delivered_at", "id");

-- CreateIndex
CREATE INDEX "delivery_receipts_consumer_delivered_idx" ON "notification_delivery"."delivery_receipts"("consumer", "delivered_at");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_receipts_event_consumer_unique" ON "notification_delivery"."delivery_receipts"("event_id", "consumer");

-- CreateIndex
CREATE INDEX "delivery_failures_status_idx" ON "notification_delivery"."delivery_failures"("resolved_at", "failed_at");

-- CreateIndex
CREATE INDEX "delivery_failures_consumer_idx" ON "notification_delivery"."delivery_failures"("consumer", "resolved_at");

-- CreateIndex
CREATE INDEX "delivery_failures_category_idx" ON "notification_delivery"."delivery_failures"("category", "resolved_at", "failed_at");

-- CreateIndex
CREATE INDEX "delivery_failures_resolver_idx" ON "notification_delivery"."delivery_failures"("resolved_by_id");

-- CreateIndex
CREATE INDEX "delivery_failures_retention_idx" ON "notification_delivery"."delivery_failures"("resolution", "resolved_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_failures_event_consumer_unique" ON "notification_delivery"."delivery_failures"("event_id", "consumer");

-- CreateIndex
CREATE INDEX "control_actions_failure_created_idx" ON "notification_delivery"."control_actions"("failure_id", "created_at");

-- CreateIndex
CREATE INDEX "control_actions_event_created_idx" ON "notification_delivery"."control_actions"("event_id", "created_at");

-- CreateIndex
CREATE INDEX "control_actions_actor_created_idx" ON "notification_delivery"."control_actions"("actor_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_outbox_events_deduplication_key_unique" ON "notification_delivery"."outbox_events"("deduplication_key");

-- CreateIndex
CREATE INDEX "notification_outbox_events_dispatch_idx" ON "notification_delivery"."outbox_events"("status", "available_at", "created_at");

-- CreateIndex
CREATE INDEX "notification_outbox_events_lease_idx" ON "notification_delivery"."outbox_events"("status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "notification_outbox_events_message_id_idx" ON "notification_delivery"."outbox_events"("message_id");

-- CreateIndex
CREATE INDEX "notification_outbox_events_published_idx" ON "notification_delivery"."outbox_events"("published_at");

-- CreateIndex
CREATE INDEX "notification_outbox_events_retention_idx" ON "notification_delivery"."outbox_events"("status", "published_at", "id");

-- CreateIndex
CREATE INDEX "heartbeats_service_seen_idx" ON "notification_delivery"."heartbeats"("service", "last_seen_at");

-- CreateIndex
CREATE INDEX "heartbeats_seen_idx" ON "notification_delivery"."heartbeats"("last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "heartbeats_service_instance_unique" ON "notification_delivery"."heartbeats"("service", "instance_id");

-- AddForeignKey
ALTER TABLE "notification_delivery"."control_actions" ADD CONSTRAINT "control_actions_failure_id_fkey" FOREIGN KEY ("failure_id") REFERENCES "notification_delivery"."delivery_failures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Service-owned receipt, retry, and outbox integrity guards.

ALTER TABLE "notification_delivery"."control_actions" ADD CONSTRAINT "control_actions_content_check" CHECK ((
		(
			"action" = 'RETRY'::"notification_delivery"."NotificationDeliveryControlActionKind"
			AND "comment" IS NULL
		)
		OR (
			"action" = 'CLOSE'::"notification_delivery"."NotificationDeliveryControlActionKind"
			AND char_length(btrim("comment")) BETWEEN 3 AND 1000
		)
	) IS TRUE);

ALTER TABLE "notification_delivery"."control_actions" ADD CONSTRAINT "control_actions_identity_check" CHECK (
		char_length(btrim("kind")) BETWEEN 1 AND 100
		AND "kind" IN (

			'campaign-email',
			'campaign-telegram',
			'daily-summary-delivery-telegram',
            'operations-backup-report-telegram',
			'subscription-expiry-email',
			'subscription-expiry-telegram',
			'wincrm-invitation-email',
			'wincrm-task-reminder-email',
			'wincrm-task-reminder-telegram',
			'support-team-email',
			'support-team-telegram',
			'support-client-email',
			'wincrm-intake-sla-email',
			'wincrm-intake-sla-telegram'
		)
		AND char_length(btrim("actor_id")) BETWEEN 1 AND 255
	);

ALTER TABLE "notification_delivery"."delivery_failures" ADD CONSTRAINT "delivery_failures_attempts_check" CHECK ("attempts" > 0);

ALTER TABLE "notification_delivery"."delivery_failures" ADD CONSTRAINT "delivery_failures_classification_check" CHECK (
		char_length(btrim("consumer")) BETWEEN 1 AND 100
		AND "consumer" IN (

			'campaign-email',
			'campaign-telegram',
			'daily-summary-delivery-telegram',
            'operations-backup-report-telegram',
			'subscription-expiry-email',
			'subscription-expiry-telegram',
			'wincrm-invitation-email',
			'wincrm-task-reminder-email',
			'wincrm-task-reminder-telegram',
			'support-team-email',
			'support-team-telegram',
			'support-client-email',
			'wincrm-intake-sla-email',
			'wincrm-intake-sla-telegram'
		)
		AND char_length(btrim("routing_key")) BETWEEN 1 AND 255
		AND char_length(btrim("normalized_code")) BETWEEN 1 AND 255
		AND char_length(btrim("safe_reason")) BETWEEN 1 AND 2000
		AND "classification_version" > 0
		AND ("http_status" IS NULL OR "http_status" BETWEEN 100 AND 599)
		AND jsonb_typeof("headers") = 'object'
	);

ALTER TABLE "notification_delivery"."delivery_failures" ADD CONSTRAINT "delivery_failures_resolution_check" CHECK ((
		(
			"resolved_at" IS NULL
			AND "resolution" IS NULL
			AND "resolution_comment" IS NULL
			AND "resolved_by_id" IS NULL
		)
		OR (
			"resolved_at" IS NOT NULL
			AND "resolution" = 'DELIVERED'::"notification_delivery"."NotificationDeliveryFailureResolution"
			AND "resolution_comment" IS NULL
			AND "resolved_by_id" IS NULL
			AND "retrying_at" IS NULL
			AND "active_retry_token" IS NULL
		)
		OR (
			"resolved_at" IS NOT NULL
			AND "resolution" = 'CLOSED_NO_RETRY'::"notification_delivery"."NotificationDeliveryFailureResolution"
			AND char_length(btrim("resolution_comment")) BETWEEN 3 AND 1000
			AND char_length(btrim("resolved_by_id")) BETWEEN 1 AND 255
			AND "retrying_at" IS NULL
			AND "active_retry_token" IS NULL
		)
	) IS TRUE);

ALTER TABLE "notification_delivery"."delivery_failures" ADD CONSTRAINT "delivery_failures_retry_state_check" CHECK ((
		(
			"retrying_at" IS NULL
			AND "active_retry_token" IS NULL
		)
		OR (
			"retrying_at" IS NOT NULL
			AND "active_retry_token" IS NOT NULL
			AND "resolved_at" IS NULL
		)
	) IS TRUE);

ALTER TABLE "notification_delivery"."delivery_receipts" ADD CONSTRAINT "delivery_receipts_identity_check" CHECK (
		char_length(btrim("consumer")) BETWEEN 1 AND 100
		AND "consumer" IN (

			'campaign-email',
			'campaign-telegram',
			'daily-summary-delivery-telegram',
            'operations-backup-report-telegram',
			'subscription-expiry-email',
			'subscription-expiry-telegram',
			'wincrm-invitation-email',
			'wincrm-task-reminder-email',
			'wincrm-task-reminder-telegram',
			'support-team-email',
			'support-team-telegram',
			'support-client-email',
			'wincrm-intake-sla-email',
			'wincrm-intake-sla-telegram'
		)
	);

ALTER TABLE "notification_delivery"."delivery_receipts" ADD CONSTRAINT "delivery_receipts_lease_check" CHECK (
		"lease_expires_at" IS NULL
		OR (
			"locked_at" IS NOT NULL
			AND "lease_expires_at" > "locked_at"
		)
	);

ALTER TABLE "notification_delivery"."delivery_receipts" ADD CONSTRAINT "delivery_receipts_state_check" CHECK ((
		(
			"status" = 'PROCESSING'::"notification_delivery"."NotificationDeliveryReceiptStatus"
			AND "locked_at" IS NOT NULL
			AND char_length(btrim("locked_by")) > 0
			AND "lock_token" IS NOT NULL
			AND "lease_expires_at" IS NOT NULL
			AND "delivered_at" IS NULL
			AND "retry_attempt" IS NULL
			AND "retry_available_at" IS NULL
			AND "retry_token" IS NULL
		)
		OR (
			"status" = 'RETRY_SCHEDULED'::"notification_delivery"."NotificationDeliveryReceiptStatus"
			AND "locked_at" IS NULL
			AND "locked_by" IS NULL
			AND "lock_token" IS NULL
			AND "lease_expires_at" IS NULL
			AND "delivered_at" IS NULL
			AND "retry_attempt" IS NOT NULL
			AND "retry_attempt" >= 0
			AND "retry_available_at" IS NOT NULL
			AND "retry_token" IS NOT NULL
		)
		OR (
			"status" = 'DELIVERED'::"notification_delivery"."NotificationDeliveryReceiptStatus"
			AND "locked_at" IS NULL
			AND "locked_by" IS NULL
			AND "lock_token" IS NULL
			AND "lease_expires_at" IS NULL
			AND "delivered_at" IS NOT NULL
			AND "retry_attempt" IS NULL
			AND "retry_available_at" IS NULL
			AND "retry_token" IS NULL
		)
		OR (
			"status" IN (
				'DEAD_LETTERED'::"notification_delivery"."NotificationDeliveryReceiptStatus",
				'CLOSED_NO_RETRY'::"notification_delivery"."NotificationDeliveryReceiptStatus"
			)
			AND "locked_at" IS NULL
			AND "locked_by" IS NULL
			AND "lock_token" IS NULL
			AND "lease_expires_at" IS NULL
			AND "delivered_at" IS NULL
			AND "retry_attempt" IS NULL
			AND "retry_available_at" IS NULL
			AND "retry_token" IS NULL
		)
	) IS TRUE);

ALTER TABLE "notification_delivery"."heartbeats" ADD CONSTRAINT "heartbeats_identity_check" CHECK (
		char_length(btrim("service")) BETWEEN 1 AND 100
		AND char_length(btrim("instance_id")) BETWEEN 1 AND 255
		AND jsonb_typeof("metadata") = 'object'
	);

ALTER TABLE "notification_delivery"."outbox_events" ADD CONSTRAINT "notification_outbox_events_attempts_check" CHECK ("attempts" >= 0);

ALTER TABLE "notification_delivery"."outbox_events" ADD CONSTRAINT "notification_outbox_events_identity_check" CHECK (
		char_length(btrim("event_type")) BETWEEN 1 AND 255
		AND char_length(btrim("routing_key")) BETWEEN 1 AND 255
		AND (
			"deduplication_key" IS NULL
			OR char_length(btrim("deduplication_key")) BETWEEN 1 AND 500
		)
		AND jsonb_typeof("headers") = 'object'
		AND (
			"routing_key" NOT IN ('manual.wincrm-invitation-email', 'wincrm-invitation-email.dead-letter')
			OR "event_type" = 'notification.wincrm.invitation.email.requested.v1'
		)
		AND (
			"routing_key" NOT IN ('manual.wincrm-task-reminder-email', 'wincrm-task-reminder-email.dead-letter')
			OR "event_type" = 'notification.wincrm.task-reminder.email.requested.v1'
		)
		AND (
			"routing_key" NOT IN ('manual.wincrm-task-reminder-telegram', 'wincrm-task-reminder-telegram.dead-letter')
			OR "event_type" = 'notification.wincrm.task-reminder.telegram.requested.v1'
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
			"routing_key" NOT IN ('manual.wincrm-intake-sla-email', 'wincrm-intake-sla-email.dead-letter')
			OR "event_type" = 'notification.wincrm.intake-sla.email.requested.v1'
		)
		AND (
			"routing_key" NOT IN ('manual.operations-backup-report-telegram', 'operations-backup-report-telegram.dead-letter')
			OR "event_type" = 'notification.operations.backup-report.telegram.requested.v1'
		)
		AND (
			"routing_key" NOT IN ('manual.wincrm-intake-sla-telegram', 'wincrm-intake-sla-telegram.dead-letter')
			OR "event_type" = 'notification.wincrm.intake-sla.telegram.requested.v1'
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
						'manual.wincrm-invitation-email',
						'manual.wincrm-task-reminder-email',
						'manual.wincrm-task-reminder-telegram',
						'manual.support-team-email',
						'manual.support-team-telegram',
						'manual.support-client-email',
						'manual.wincrm-intake-sla-email',
						'manual.wincrm-intake-sla-telegram'
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
					'wincrm-invitation-email.dead-letter',
					'wincrm-task-reminder-email.dead-letter',
					'wincrm-task-reminder-telegram.dead-letter',
					'support-team-email.dead-letter',
					'support-team-telegram.dead-letter',
					'support-client-email.dead-letter',
					'wincrm-intake-sla-email.dead-letter',
					'wincrm-intake-sla-telegram.dead-letter'
				)
			)
		)
	);

ALTER TABLE "notification_delivery"."outbox_events" ADD CONSTRAINT "notification_outbox_events_lease_check" CHECK (
		"lease_expires_at" IS NULL
		OR (
			"locked_at" IS NOT NULL
			AND "lease_expires_at" > "locked_at"
		)
	);

ALTER TABLE "notification_delivery"."outbox_events" ADD CONSTRAINT "notification_outbox_events_state_check" CHECK ((
		(
			"status" = 'PENDING'::"notification_delivery"."NotificationDeliveryOutboxStatus"
			AND "locked_at" IS NULL
			AND "locked_by" IS NULL
			AND "lock_token" IS NULL
			AND "lease_expires_at" IS NULL
			AND "published_at" IS NULL
		)
		OR (
			"status" = 'PUBLISHING'::"notification_delivery"."NotificationDeliveryOutboxStatus"
			AND "locked_at" IS NOT NULL
			AND char_length(btrim("locked_by")) > 0
			AND "lock_token" IS NOT NULL
			AND "lease_expires_at" IS NOT NULL
			AND "published_at" IS NULL
		)
		OR (
			"status" = 'PUBLISHED'::"notification_delivery"."NotificationDeliveryOutboxStatus"
			AND "locked_at" IS NULL
			AND "locked_by" IS NULL
			AND "lock_token" IS NULL
			AND "lease_expires_at" IS NULL
			AND "published_at" IS NOT NULL
		)
		OR (
			"status" = 'FAILED'::"notification_delivery"."NotificationDeliveryOutboxStatus"
			AND "locked_at" IS NULL
			AND "locked_by" IS NULL
			AND "lock_token" IS NULL
			AND "lease_expires_at" IS NULL
			AND "published_at" IS NULL
		)
	) IS TRUE);

ALTER DEFAULT PRIVILEGES IN SCHEMA "notification_delivery" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "notification_delivery" FROM PUBLIC;

