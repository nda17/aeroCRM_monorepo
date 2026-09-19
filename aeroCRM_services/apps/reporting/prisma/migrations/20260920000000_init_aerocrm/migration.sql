-- Clean aeroCRM Reporting baseline for CRM projections and operational delivery.
BEGIN;

DO $$ BEGIN
  IF to_regnamespace('reporting') IS NULL OR (
    SELECT nspowner FROM pg_namespace WHERE oid = to_regnamespace('reporting')
  ) IS DISTINCT FROM to_regrole(CURRENT_USER) THEN
    RAISE EXCEPTION 'reporting schema must exist and be owned by the migration role';
  END IF;
END $$;

-- CreateSchema


-- CreateEnum
CREATE TYPE "reporting"."ProjectionReceiptResult" AS ENUM ('APPLIED', 'DUPLICATE', 'STALE');

-- CreateEnum
CREATE TYPE "reporting"."ReportingConsumerReceiptStatus" AS ENUM ('PROCESSING', 'RETRY_SCHEDULED', 'DELIVERED', 'DEAD_LETTERED');

-- CreateEnum
CREATE TYPE "reporting"."ReportRunStatus" AS ENUM ('PENDING', 'PROCESSING', 'WAITING_DELIVERY', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "reporting"."ReportingOutboxStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "reporting"."ReportingOutboxExchange" AS ENUM ('EVENTS', 'RETRY', 'MANUAL_RETRY', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "reporting"."ReportingConsumerFailureStatus" AS ENUM ('OPEN', 'RETRY_REQUESTED', 'RESOLVED');

-- CreateTable
CREATE TABLE "reporting"."service_identity" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "service_name" TEXT NOT NULL DEFAULT 'reporting-service',
    "database_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting"."identity_user_projections" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3),
    "source_updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "status" TEXT,
    "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "has_email_identity" BOOLEAN,
    "has_phone_identity" BOOLEAN,
    "login_method_count" INTEGER,
    "tombstoned" BOOLEAN NOT NULL DEFAULT false,
    "state_hash" CHAR(64) NOT NULL,
    "aggregate_version" DECIMAL(65,0) NOT NULL,
    "source_sequence" DECIMAL(65,0) NOT NULL,
    "source_occurred_at" TIMESTAMP(3) NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identity_user_projections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting"."crm_order_facts" (
    "id" UUID NOT NULL,
    "workspace_id" UUID,
    "owner_subject" VARCHAR(256),
    "amount_minor" BIGINT,
    "currency" VARCHAR(3),
    "cycle" VARCHAR(16),
    "paid_at" TIMESTAMP(3),
    "tombstoned" BOOLEAN NOT NULL DEFAULT false,
    "state_hash" CHAR(64) NOT NULL,
    "aggregate_version" DECIMAL(65,0) NOT NULL,
    "source_sequence" DECIMAL(65,0) NOT NULL,
    "source_occurred_at" TIMESTAMP(3) NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_order_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting"."crm_entitlement_projections" (
    "id" UUID NOT NULL,
    "workspace_id" UUID,
    "plan_code" VARCHAR(32),
    "status" VARCHAR(24),
    "seat_limit" INTEGER,
    "effective_from" TIMESTAMP(3),
    "effective_until" TIMESTAMP(3),
    "tombstoned" BOOLEAN NOT NULL DEFAULT false,
    "state_hash" CHAR(64) NOT NULL,
    "aggregate_version" DECIMAL(65,0) NOT NULL,
    "source_sequence" DECIMAL(65,0) NOT NULL,
    "source_occurred_at" TIMESTAMP(3) NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_entitlement_projections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting"."projection_receipts" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "projection" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "aggregate_version" DECIMAL(65,0) NOT NULL,
    "source_sequence" DECIMAL(65,0) NOT NULL,
    "tombstone" BOOLEAN NOT NULL,
    "state_hash" CHAR(64) NOT NULL,
    "result" "reporting"."ProjectionReceiptResult" NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projection_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting"."projection_watermarks" (
    "stream" TEXT NOT NULL,
    "source_sequence" DECIMAL(65,0) NOT NULL,
    "event_id" UUID NOT NULL,
    "aggregate_version" DECIMAL(65,0) NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projection_watermarks_pkey" PRIMARY KEY ("stream")
);

-- CreateTable
CREATE TABLE "reporting"."consumer_receipts" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "consumer" TEXT NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "status" "reporting"."ReportingConsumerReceiptStatus" NOT NULL,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "lock_token" UUID,
    "lease_expires_at" TIMESTAMP(3),
    "retry_attempt" INTEGER,
    "retry_cycle" INTEGER NOT NULL DEFAULT 0,
    "delivered_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consumer_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting"."consumer_failures" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "consumer" TEXT NOT NULL,
    "consumer_kind" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "status" "reporting"."ReportingConsumerFailureStatus" NOT NULL DEFAULT 'OPEN',
    "manual_retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT NOT NULL,
    "last_failed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retry_requested_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consumer_failures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting"."reporting_settings" (
    "id" TEXT NOT NULL DEFAULT 'daily-summary',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "destination_chat_id" TEXT,
    "message_thread_id" INTEGER,
    "operational_alerts_thread_id" INTEGER,
    "operational_alerts_changed_at" TIMESTAMP(3),
    "schedule_time" TEXT NOT NULL DEFAULT '01:50',
    "schedule_authority_generation" BIGINT NOT NULL DEFAULT 0,
    "schedule_policy_change_id" UUID,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "last_successful_period_start" TIMESTAMP(3),
    "last_successful_at" TIMESTAMP(3),
    "last_failed_period_start" TIMESTAMP(3),
    "last_failed_at" TIMESTAMP(3),
    "last_failure_code" TEXT,
    "last_failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reporting_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting"."report_runs" (
    "id" UUID NOT NULL,
    "period_key" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "reporting"."ReportRunStatus" NOT NULL DEFAULT 'PENDING',
    "checkpoint" TEXT NOT NULL DEFAULT 'CREATED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "destination_chat_id" TEXT NOT NULL,
    "message_thread_id" INTEGER NOT NULL,
    "message_text" TEXT,
    "message_sha256" CHAR(64),
    "request_event_id" UUID,
    "outcome_event_id" UUID,
    "failure_code" TEXT,
    "failure_reason" TEXT,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "lock_token" UUID,
    "lease_expires_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting"."outbox_events" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "deduplication_key" TEXT,
    "exchange" "reporting"."ReportingOutboxExchange" NOT NULL DEFAULT 'EVENTS',
    "event_type" TEXT NOT NULL,
    "routing_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL DEFAULT '{}',
    "status" "reporting"."ReportingOutboxStatus" NOT NULL DEFAULT 'PENDING',
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
CREATE TABLE "reporting"."heartbeats" (
    "id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "heartbeats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_identity_database_id_key" ON "reporting"."service_identity"("database_id");

-- CreateIndex
CREATE INDEX "identity_users_reporting_idx" ON "reporting"."identity_user_projections"("tombstoned", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "identity_users_active_idx" ON "reporting"."identity_user_projections"("tombstoned", "source_updated_at");

-- CreateIndex
CREATE INDEX "crm_order_facts_paid_idx" ON "reporting"."crm_order_facts"("tombstoned", "paid_at");

-- CreateIndex
CREATE INDEX "crm_order_facts_workspace_paid_idx" ON "reporting"."crm_order_facts"("tombstoned", "workspace_id", "paid_at");

-- CreateIndex
CREATE INDEX "crm_entitlement_status_expiry_idx" ON "reporting"."crm_entitlement_projections"("tombstoned", "status", "effective_until");

-- CreateIndex
CREATE INDEX "crm_entitlement_workspace_idx" ON "reporting"."crm_entitlement_projections"("tombstoned", "workspace_id");

-- CreateIndex
CREATE INDEX "projection_receipts_watermark_idx" ON "reporting"."projection_receipts"("projection", "source_sequence");

-- CreateIndex
CREATE INDEX "projection_receipts_aggregate_idx" ON "reporting"."projection_receipts"("projection", "aggregate_id", "aggregate_version");

-- CreateIndex
CREATE UNIQUE INDEX "projection_receipts_event_projection_unique" ON "reporting"."projection_receipts"("event_id", "projection");

-- CreateIndex
CREATE INDEX "consumer_receipts_lease_idx" ON "reporting"."consumer_receipts"("status", "lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "consumer_receipts_event_consumer_unique" ON "reporting"."consumer_receipts"("event_id", "consumer");

-- CreateIndex
CREATE INDEX "reporting_consumer_failures_status_failed_idx" ON "reporting"."consumer_failures"("status", "last_failed_at");

-- CreateIndex
CREATE UNIQUE INDEX "reporting_consumer_failures_event_consumer_unique" ON "reporting"."consumer_failures"("event_id", "consumer");

-- CreateIndex
CREATE UNIQUE INDEX "report_runs_period_key_unique" ON "reporting"."report_runs"("period_key");

-- CreateIndex
CREATE UNIQUE INDEX "report_runs_request_event_unique" ON "reporting"."report_runs"("request_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_runs_outcome_event_unique" ON "reporting"."report_runs"("outcome_event_id");

-- CreateIndex
CREATE INDEX "report_runs_dispatch_idx" ON "reporting"."report_runs"("status", "available_at", "created_at");

-- CreateIndex
CREATE INDEX "report_runs_lease_idx" ON "reporting"."report_runs"("status", "lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "reporting_outbox_dedup_unique" ON "reporting"."outbox_events"("deduplication_key");

-- CreateIndex
CREATE INDEX "reporting_outbox_dispatch_idx" ON "reporting"."outbox_events"("status", "available_at", "created_at");

-- CreateIndex
CREATE INDEX "reporting_outbox_lease_idx" ON "reporting"."outbox_events"("status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "reporting_outbox_message_idx" ON "reporting"."outbox_events"("message_id");

-- CreateIndex
CREATE INDEX "reporting_heartbeats_role_seen_idx" ON "reporting"."heartbeats"("role", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "reporting_heartbeats_role_instance_unique" ON "reporting"."heartbeats"("role", "instance_id");

ALTER TABLE reporting.service_identity ALTER COLUMN database_id SET DEFAULT gen_random_uuid();

ALTER TABLE reporting.service_identity ADD CONSTRAINT service_identity_singleton_check CHECK (id = 'singleton');

ALTER TABLE reporting.service_identity ADD CONSTRAINT service_identity_name_check CHECK (service_name = 'reporting-service');

ALTER TABLE "reporting"."identity_user_projections" ADD CONSTRAINT "identity_users_version_check" CHECK ("aggregate_version" >= 0 AND "source_sequence" >= 0 AND "state_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "reporting"."identity_user_projections" ADD CONSTRAINT "identity_users_state_check" CHECK (
		"tombstoned"
		OR (
			"created_at" IS NOT NULL
			AND "source_updated_at" IS NOT NULL
			AND "status" IN ('ACTIVE', 'DEACTIVATED')
			AND "roles" <@ ARRAY['USER', 'ADMIN', 'DEV']::TEXT[]
			AND "has_email_identity" IS NOT NULL
			AND "has_phone_identity" IS NOT NULL
			AND "login_method_count" >= 0
		)
	);

ALTER TABLE "reporting"."projection_receipts" ADD CONSTRAINT "projection_receipts_content_check" CHECK (
		char_length(btrim("projection")) BETWEEN 1 AND 100
		AND char_length(btrim("event_type")) BETWEEN 1 AND 255
		AND char_length(btrim("aggregate_id")) BETWEEN 1 AND 255
			AND "aggregate_version" >= 0
			AND "source_sequence" >= 0
			AND "state_hash" ~ '^[0-9a-f]{64}$'
	);

ALTER TABLE "reporting"."projection_watermarks" ADD CONSTRAINT "projection_watermarks_content_check" CHECK (
		char_length(btrim("stream")) BETWEEN 1 AND 100
		AND "source_sequence" >= 0
		AND "aggregate_version" >= 0
	);

ALTER TABLE "reporting"."consumer_receipts" ADD CONSTRAINT "consumer_receipts_identity_check" CHECK (
		char_length(btrim("consumer")) BETWEEN 1 AND 100
		AND "payload_hash" ~ '^[0-9a-f]{64}$'
		AND ("retry_attempt" IS NULL OR "retry_attempt" BETWEEN 0 AND 3)
		AND "retry_cycle" BETWEEN 0 AND 1000000
	);

ALTER TABLE "reporting"."consumer_receipts" ADD CONSTRAINT "consumer_receipts_lease_check" CHECK (
		(
			"status" = 'PROCESSING'::"reporting"."ReportingConsumerReceiptStatus"
			AND "locked_at" IS NOT NULL
			AND "locked_by" IS NOT NULL
			AND char_length(btrim("locked_by")) > 0
			AND "lock_token" IS NOT NULL
			AND "lease_expires_at" > "locked_at"
			AND "retry_attempt" IS NULL
		)
		OR (
			"status" <> 'PROCESSING'::"reporting"."ReportingConsumerReceiptStatus"
			AND "locked_at" IS NULL
			AND "locked_by" IS NULL
			AND "lock_token" IS NULL
			AND "lease_expires_at" IS NULL
			AND (
				("status" = 'RETRY_SCHEDULED'::"reporting"."ReportingConsumerReceiptStatus" AND "retry_attempt" IS NOT NULL)
				OR ("status" <> 'RETRY_SCHEDULED'::"reporting"."ReportingConsumerReceiptStatus" AND "retry_attempt" IS NULL)
			)
		)
	);

ALTER TABLE "reporting"."consumer_failures" ADD CONSTRAINT "consumer_failures_content_check" CHECK (
		char_length(btrim("consumer")) BETWEEN 1 AND 100
		AND "consumer_kind" IN ('identityUser', 'crmOrder', 'crmEntitlement', 'reportingSettings', 'deliveryOutcome')
		AND char_length(btrim("event_type")) BETWEEN 1 AND 255
		AND jsonb_typeof("payload") = 'object'
		AND "payload_hash" ~ '^[0-9a-f]{64}$'
		AND "correlation_id" ~ '^[A-Za-z0-9._:-]{1,128}$'
		AND "manual_retry_count" BETWEEN 0 AND 1000000
		AND char_length("last_error") BETWEEN 1 AND 2000
	);

ALTER TABLE "reporting"."consumer_failures" ADD CONSTRAINT "consumer_failures_state_check" CHECK (
		("status" = 'OPEN'::"reporting"."ReportingConsumerFailureStatus" AND "retry_requested_at" IS NULL AND "resolved_at" IS NULL)
		OR ("status" = 'RETRY_REQUESTED'::"reporting"."ReportingConsumerFailureStatus" AND "retry_requested_at" IS NOT NULL AND "resolved_at" IS NULL)
		OR ("status" = 'RESOLVED'::"reporting"."ReportingConsumerFailureStatus" AND "resolved_at" IS NOT NULL)
	);

ALTER TABLE "reporting"."report_runs" ADD CONSTRAINT "report_runs_content_check" CHECK (
		char_length(btrim("period_key")) BETWEEN 1 AND 200
		AND "period_start" < "period_end"
		AND char_length(btrim("timezone")) BETWEEN 1 AND 100
		AND char_length(btrim("checkpoint")) BETWEEN 1 AND 100
		AND "attempts" >= 0
		AND char_length(btrim("destination_chat_id")) BETWEEN 1 AND 255
		AND "message_thread_id" > 0
		AND (("message_text" IS NULL AND "message_sha256" IS NULL) OR (char_length("message_text") BETWEEN 1 AND 10000 AND "message_sha256" ~ '^[0-9a-f]{64}$'))
	);

ALTER TABLE "reporting"."report_runs" ADD CONSTRAINT "report_runs_lease_check" CHECK (
		(
			"status" = 'PROCESSING'::"reporting"."ReportRunStatus"
			AND "locked_at" IS NOT NULL
			AND "locked_by" IS NOT NULL
			AND char_length(btrim("locked_by")) > 0
			AND "lock_token" IS NOT NULL
			AND "lease_expires_at" > "locked_at"
		)
		OR (
			"status" <> 'PROCESSING'::"reporting"."ReportRunStatus"
			AND "locked_at" IS NULL
			AND "locked_by" IS NULL
			AND "lock_token" IS NULL
			AND "lease_expires_at" IS NULL
		)
	);

ALTER TABLE "reporting"."outbox_events" ADD CONSTRAINT "outbox_events_content_check" CHECK (
		char_length(btrim("event_type")) BETWEEN 1 AND 255
		AND char_length(btrim("routing_key")) BETWEEN 1 AND 255
		AND jsonb_typeof("headers") = 'object'
		AND "attempts" >= 0
	);

ALTER TABLE "reporting"."outbox_events" ADD CONSTRAINT "outbox_events_lease_check" CHECK (
		(
			"status" = 'PUBLISHING'::"reporting"."ReportingOutboxStatus"
			AND "locked_at" IS NOT NULL
			AND "locked_by" IS NOT NULL
			AND char_length(btrim("locked_by")) > 0
			AND "lock_token" IS NOT NULL
			AND "lease_expires_at" > "locked_at"
		)
		OR (
			"status" <> 'PUBLISHING'::"reporting"."ReportingOutboxStatus"
			AND "locked_at" IS NULL
			AND "locked_by" IS NULL
			AND "lock_token" IS NULL
			AND "lease_expires_at" IS NULL
		)
	);

ALTER TABLE reporting."reporting_settings" ADD CONSTRAINT "reporting_settings_schedule_authority_generation_check" CHECK ("schedule_authority_generation" >= 0);

ALTER TABLE reporting."heartbeats" ADD CONSTRAINT "heartbeats_identity_check" CHECK (
    "role" IN ('all', 'api', 'worker', 'publisher', 'scheduler')
    AND char_length(btrim("instance_id")) BETWEEN 1 AND 255
    AND jsonb_typeof("metadata") = 'object'
);

ALTER TABLE reporting."reporting_settings" ADD CONSTRAINT "reporting_settings_content_check" CHECK (
    "id" = 'daily-summary'
    AND "schedule_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND char_length(btrim("timezone")) BETWEEN 1 AND 100
    AND (
        "destination_chat_id" IS NULL
        OR char_length(btrim("destination_chat_id")) BETWEEN 1 AND 255
    )
    AND ("message_thread_id" IS NULL OR "message_thread_id" > 0)
    AND (
        "operational_alerts_thread_id" IS NULL
        OR "operational_alerts_thread_id" > 0
    )
    AND (
        NOT "enabled"
        OR (
            "destination_chat_id" IS NOT NULL
            AND "message_thread_id" IS NOT NULL
            AND "operational_alerts_thread_id" IS NOT NULL
            AND "message_thread_id" <> "operational_alerts_thread_id"
        )
    )
);

ALTER TABLE reporting.crm_order_facts ADD CONSTRAINT crm_order_facts_version_check
CHECK (aggregate_version >= 0 AND source_sequence >= 0 AND state_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE reporting.crm_order_facts ADD CONSTRAINT crm_order_facts_state_check CHECK (
  tombstoned OR (
    workspace_id IS NOT NULL AND owner_subject IS NOT NULL AND length(btrim(owner_subject)) BETWEEN 1 AND 256
    AND amount_minor > 0 AND currency = 'RUB' AND cycle IN ('MONTHLY','YEARLY') AND paid_at IS NOT NULL
  )
);
ALTER TABLE reporting.crm_entitlement_projections ADD CONSTRAINT crm_entitlement_projections_version_check
CHECK (aggregate_version >= 0 AND source_sequence >= 0 AND state_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE reporting.crm_entitlement_projections ADD CONSTRAINT crm_entitlement_projections_state_check CHECK (
  tombstoned OR (
    workspace_id IS NOT NULL AND plan_code IS NOT NULL AND length(btrim(plan_code)) BETWEEN 1 AND 32
    AND plan_code IN ('TRIAL','PAID')
    AND status IN ('ACTIVE','GRACE','READ_ONLY','SUSPENDED','EXPIRED','CANCELLED')
    AND (seat_limit IS NULL OR seat_limit BETWEEN 1 AND 10000)
    AND effective_from IS NOT NULL AND effective_until IS NOT NULL AND effective_until >= effective_from
  )
);

CREATE FUNCTION "reporting"."reject_report_run_snapshot_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD."destination_chat_id" IS DISTINCT FROM NEW."destination_chat_id"
		OR OLD."message_thread_id" IS DISTINCT FROM NEW."message_thread_id"
		OR (OLD."message_text" IS NOT NULL AND OLD."message_text" IS DISTINCT FROM NEW."message_text")
		OR (OLD."message_sha256" IS NOT NULL AND OLD."message_sha256" IS DISTINCT FROM NEW."message_sha256")
	THEN
		RAISE EXCEPTION 'report run content and destination snapshot are immutable';
	END IF;
	RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION reporting.reject_report_run_snapshot_mutation() FROM PUBLIC;

CREATE FUNCTION reporting.enforce_service_identity_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, reporting AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Reporting service identity cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.service_name IS DISTINCT FROM OLD.service_name
    OR NEW.database_id IS DISTINCT FROM OLD.database_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'Reporting database identity marker is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION reporting.enforce_service_identity_integrity() FROM PUBLIC;

INSERT INTO reporting.service_identity (id, service_name, database_id, updated_at)
VALUES ('singleton', 'reporting-service', gen_random_uuid(), CURRENT_TIMESTAMP);

CREATE TRIGGER "report_runs_snapshot_immutable"
BEFORE UPDATE ON "reporting"."report_runs"
FOR EACH ROW
EXECUTE FUNCTION "reporting"."reject_report_run_snapshot_mutation"();

CREATE TRIGGER reporting_service_identity_integrity_guard BEFORE UPDATE OR DELETE ON reporting.service_identity
FOR EACH ROW EXECUTE FUNCTION reporting.enforce_service_identity_integrity();

ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA "reporting" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "reporting" FROM PUBLIC;

COMMIT;
