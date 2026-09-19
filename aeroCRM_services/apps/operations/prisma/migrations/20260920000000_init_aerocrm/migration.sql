-- CreateSchema
DO $aerocrm_schema_owner$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'operations' AND nspowner = to_regrole(CURRENT_USER)) THEN RAISE EXCEPTION 'operations schema must exist and be owned by the migration role'; END IF; END $aerocrm_schema_owner$;

-- CreateEnum
CREATE TYPE "operations"."AuditReceiptStatus" AS ENUM ('PROCESSING', 'RETRY_SCHEDULED', 'DELIVERED', 'DEAD_LETTERED');

-- CreateEnum
CREATE TYPE "operations"."OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "operations"."ScheduledJobRunStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "operations"."ScheduledJobRunTrigger" AS ENUM ('SCHEDULED', 'MANUAL');

-- CreateEnum
CREATE TYPE "operations"."IntegrationDeliveryReceiptStatus" AS ENUM ('PROCESSING', 'RETRY_SCHEDULED', 'DELIVERED', 'DEAD_LETTERED', 'CLOSED_NO_RETRY');

-- CreateEnum
CREATE TYPE "operations"."IntegrationErrorCategory" AS ENUM ('TRANSIENT', 'RATE_LIMIT', 'PERMANENT', 'AUTH_CONFIGURATION');

-- CreateEnum
CREATE TYPE "operations"."IntegrationFailureResolution" AS ENUM ('DELIVERED', 'CLOSED_NO_RETRY');

-- CreateEnum
CREATE TYPE "operations"."OperationalAlertSeverity" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "operations"."DatabaseRestoreJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'RECOVERY_REQUIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "operations"."DatabaseRestoreJobPhase" AS ENUM ('PREPARING', 'FENCING', 'FENCED', 'SAFETY_READY', 'MUTATING', 'VERIFIED', 'UNFENCING', 'UNFENCED');

-- CreateEnum
CREATE TYPE "operations"."DatabaseRestorePermitStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'CONSUMED', 'CLOSED');

-- CreateEnum
CREATE TYPE "operations"."DatabaseRestoreRecoveryActionType" AS ENUM ('VERIFY_AS_IS', 'ROLL_BACK_SAFETY', 'ROLL_FORWARD_SOURCE');

-- CreateEnum
CREATE TYPE "operations"."DatabaseRestoreRecoveryActionStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'PROCESSING', 'RESOLVED', 'BLOCKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "operations"."DatabaseRestoreRecoveryActionPhase" AS ENUM ('PREPARING', 'FENCING', 'FENCED', 'MUTATING', 'VERIFYING', 'VERIFIED', 'UNFENCING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "operations"."DatabaseRestoreExecutionOperationType" AS ENUM ('RESTORE', 'RECOVERY', 'RECONCILIATION');

-- CreateTable
CREATE TABLE "operations"."service_identity" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "service_name" TEXT NOT NULL DEFAULT 'operations-service',
    "database_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations"."admin_event_logs" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT,
    "admin_name" TEXT,
    "admin_email" TEXT,
    "section" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "entity_label" TEXT,
    "target_user_id" TEXT,
    "target_user_name" TEXT,
    "target_user_email" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations"."audit_event_receipts" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "consumer" TEXT NOT NULL,
    "status" "operations"."AuditReceiptStatus" NOT NULL DEFAULT 'PROCESSING',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMP(3),
    "retry_available_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "dead_lettered_at" TIMESTAMP(3),
    "dead_letter_source" TEXT,
    "dead_letter_payload" JSONB,
    "manual_retry_cycle" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_event_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations"."outbox_events" (
    "id" TEXT NOT NULL,
    "event_id" UUID NOT NULL,
    "message_id" UUID,
    "deduplication_key" TEXT,
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "correlation_id" UUID,
    "exchange" TEXT NOT NULL DEFAULT 'aerocrm.events',
    "routing_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL DEFAULT '{}',
    "status" "operations"."OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations"."telegram_bot_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "daily_summary_chat_id" TEXT NOT NULL DEFAULT '',
    "database_backup_thread_id" INTEGER,
    "payments_thread_id" INTEGER,
    "operational_alerts_thread_id" INTEGER,
    "database_backup_enabled" BOOLEAN NOT NULL DEFAULT true,
    "database_backup_time" TEXT NOT NULL DEFAULT '01:45',
    "database_backup_last_sent_period_start" TIMESTAMP(3),
    "database_backup_last_sent_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_bot_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations"."scheduled_job_runs" (
    "id" UUID NOT NULL,
    "job_type" TEXT NOT NULL,
    "schedule_key" TEXT NOT NULL,
    "trigger" "operations"."ScheduledJobRunTrigger" NOT NULL DEFAULT 'SCHEDULED',
    "status" "operations"."ScheduledJobRunStatus" NOT NULL DEFAULT 'QUEUED',
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "period_start" TIMESTAMP(3),
    "period_end" TIMESTAMP(3),
    "input" JSONB NOT NULL DEFAULT '{}',
    "checkpoint" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 4,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_owner" TEXT,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations"."scheduled_job_idempotency_keys" (
    "admin_id" TEXT NOT NULL,
    "job_type" TEXT NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_job_idempotency_keys_pkey" PRIMARY KEY ("admin_id","job_type","idempotency_key")
);

-- CreateTable
CREATE TABLE "operations"."messaging_heartbeats" (
    "id" UUID NOT NULL,
    "service" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messaging_heartbeats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations"."integration_delivery_failures" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "integration" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "routing_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL,
    "last_error" TEXT NOT NULL,
    "category" "operations"."IntegrationErrorCategory",
    "normalized_code" TEXT,
    "safe_reason" TEXT,
    "http_status" INTEGER,
    "provider_code" TEXT,
    "retryable" BOOLEAN,
    "failed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retrying_at" TIMESTAMP(3),
    "active_retry_token" UUID,
    "resolved_at" TIMESTAMP(3),
    "resolution" "operations"."IntegrationFailureResolution",
    "resolution_comment" TEXT,
    "resolved_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_delivery_failures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations"."integration_delivery_receipts" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "integration" TEXT NOT NULL,
    "status" "operations"."IntegrationDeliveryReceiptStatus" NOT NULL DEFAULT 'PROCESSING',
    "locked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),
    "retry_attempt" INTEGER,
    "retry_available_at" TIMESTAMP(3),
    "retry_token" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_delivery_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations"."operational_alerts" (
    "id" UUID NOT NULL,
    "deduplication_key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "operations"."OperationalAlertSeverity" NOT NULL,
    "source" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "target_user_id" TEXT,
    "target_user_name" TEXT,
    "target_user_email" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "alert_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operational_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations"."reporting_schedule_policy" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "reservation_time" TEXT NOT NULL DEFAULT '01:50',
    "reservation_generation" BIGINT NOT NULL DEFAULT 0,
    "confirmed_change_id" UUID,
    "pending_change_id" UUID,
    "pending_time" TEXT,
    "pending_generation" BIGINT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reporting_schedule_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations"."database_restore_jobs" (
    "id" UUID NOT NULL,
    "target" TEXT NOT NULL,
    "status" "operations"."DatabaseRestoreJobStatus" NOT NULL DEFAULT 'QUEUED',
    "phase" "operations"."DatabaseRestoreJobPhase",
    "source_file_name" TEXT NOT NULL,
    "source_sha256" TEXT NOT NULL,
    "source_size" BIGINT NOT NULL,
    "source_backup_job_id" UUID NOT NULL,
    "backup_provenance" TEXT NOT NULL,
    "backup_provenance_envelope_sha256" TEXT NOT NULL,
    "backup_provenance_key_id" TEXT NOT NULL,
    "requested_by_id" TEXT NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "permit_id" UUID NOT NULL,
    "expected_services_sha" TEXT NOT NULL,
    "migration_manifest_sha" TEXT NOT NULL,
    "lease_owner" TEXT,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "safety_backup_file_name" TEXT,
    "safety_backup_sha256" TEXT,
    "source_deleted_at" TIMESTAMP(3),
    "safety_deleted_at" TIMESTAMP(3),
    "cleanup_error" TEXT,
    "recovery_resolved_at" TIMESTAMP(3),
    "artifact_retain_until" TIMESTAMP(3),
    "writer_fence_roles" JSONB,
    "writer_fence_requested_at" TIMESTAMP(3),
    "writer_fence_applied_at" TIMESTAMP(3),
    "writer_fence_released_at" TIMESTAMP(3),
    "writer_fence_evidence_sha256" TEXT,
    "writer_fence_release_evidence_sha256" TEXT,
    "result" JSONB,
    "last_error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "database_restore_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations"."database_restore_permits" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "target" TEXT NOT NULL,
    "source_sha256" TEXT NOT NULL,
    "source_size" BIGINT NOT NULL,
    "source_backup_job_id" UUID NOT NULL,
    "backup_provenance" TEXT NOT NULL,
    "backup_provenance_envelope_sha256" TEXT NOT NULL,
    "backup_provenance_key_id" TEXT NOT NULL,
    "expected_services_sha" TEXT NOT NULL,
    "migration_manifest_sha" TEXT NOT NULL,
    "status" "operations"."DatabaseRestorePermitStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "requested_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "close_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "database_restore_permits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations"."database_restore_terminal_receipts" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "permit_id" UUID NOT NULL,
    "permit_requested_by_id" TEXT NOT NULL,
    "permit_approved_by_id" TEXT NOT NULL,
    "permit_created_at" TIMESTAMP(3) NOT NULL,
    "permit_approved_at" TIMESTAMP(3) NOT NULL,
    "permit_expires_at" TIMESTAMP(3) NOT NULL,
    "permit_consumed_at" TIMESTAMP(3) NOT NULL,
    "target" TEXT NOT NULL,
    "terminal_status" "operations"."DatabaseRestoreJobStatus" NOT NULL,
    "phase" "operations"."DatabaseRestoreJobPhase",
    "source_sha256" TEXT NOT NULL,
    "source_size" BIGINT NOT NULL,
    "source_backup_job_id" UUID NOT NULL,
    "backup_provenance_envelope_sha256" TEXT NOT NULL,
    "backup_provenance_key_id" TEXT NOT NULL,
    "safety_backup_sha256" TEXT,
    "expected_services_sha" TEXT NOT NULL,
    "migration_manifest_sha" TEXT NOT NULL,
    "result_sha256" TEXT,
    "error_sha256" TEXT,
    "payload_sha256" TEXT NOT NULL,
    "signature_hmac_sha256" TEXT NOT NULL,
    "signature_key_id" TEXT NOT NULL,
    "writer_fence_roles" JSONB,
    "writer_fence_requested_at" TIMESTAMP(3),
    "writer_fence_applied_at" TIMESTAMP(3),
    "writer_fence_released_at" TIMESTAMP(3),
    "writer_fence_evidence_sha256" TEXT,
    "writer_fence_release_evidence_sha256" TEXT,
    "release_authorization_payload_sha256" TEXT,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "database_restore_terminal_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations"."database_restore_recovery_actions" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "action" "operations"."DatabaseRestoreRecoveryActionType" NOT NULL,
    "status" "operations"."DatabaseRestoreRecoveryActionStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "phase" "operations"."DatabaseRestoreRecoveryActionPhase",
    "event_id" UUID,
    "receipt_payload_sha" TEXT NOT NULL,
    "requested_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "lease_owner" TEXT,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "artifact_sha256" TEXT,
    "writer_fence_roles" JSONB,
    "writer_fence_requested_at" TIMESTAMP(3),
    "writer_fence_applied_at" TIMESTAMP(3),
    "writer_fence_released_at" TIMESTAMP(3),
    "writer_fence_evidence_sha256" TEXT,
    "writer_fence_release_evidence_sha256" TEXT,
    "result" JSONB,
    "last_error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "database_restore_recovery_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations"."database_restore_execution_lease" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "operation_type" "operations"."DatabaseRestoreExecutionOperationType",
    "operation_id" UUID,
    "lease_owner" TEXT,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "database_restore_execution_lease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations"."database_restore_release_authorizations" (
    "id" UUID NOT NULL,
    "operation_type" "operations"."DatabaseRestoreExecutionOperationType" NOT NULL,
    "operation_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "action_id" UUID,
    "permit_id" UUID,
    "event_id" UUID NOT NULL,
    "target" TEXT NOT NULL,
    "recovery_action" "operations"."DatabaseRestoreRecoveryActionType",
    "initial_receipt_payload_sha256" TEXT,
    "source_sha256" TEXT NOT NULL,
    "source_size" BIGINT NOT NULL,
    "source_backup_job_id" UUID NOT NULL,
    "backup_provenance_envelope_sha256" TEXT NOT NULL,
    "backup_provenance_key_id" TEXT NOT NULL,
    "artifact_sha256" TEXT,
    "expected_services_sha" TEXT NOT NULL,
    "migration_manifest_sha" TEXT NOT NULL,
    "requested_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT NOT NULL,
    "approved_at" TIMESTAMP(3) NOT NULL,
    "approval_evidence_sha256" TEXT NOT NULL,
    "writer_fence_roles" JSONB NOT NULL,
    "writer_fence_applied_at" TIMESTAMP(3) NOT NULL,
    "writer_fence_evidence_sha256" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL,
    "migration_ledger_sha256" TEXT NOT NULL,
    "acl_evidence_sha256" TEXT NOT NULL,
    "verified_writer_fence_sha256" TEXT NOT NULL,
    "payload_sha256" TEXT NOT NULL,
    "signature_hmac_sha256" TEXT NOT NULL,
    "signature_key_id" TEXT NOT NULL,
    "authorized_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "database_restore_release_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations"."database_restore_recovery_receipts" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "action_id" UUID NOT NULL,
    "target" TEXT NOT NULL,
    "action" "operations"."DatabaseRestoreRecoveryActionType" NOT NULL,
    "initial_receipt_payload_sha" TEXT NOT NULL,
    "artifact_sha256" TEXT,
    "expected_services_sha" TEXT NOT NULL,
    "migration_manifest_sha" TEXT NOT NULL,
    "writer_fence_roles" JSONB NOT NULL,
    "writer_fence_applied_at" TIMESTAMP(3) NOT NULL,
    "writer_fence_released_at" TIMESTAMP(3) NOT NULL,
    "writer_fence_evidence_sha256" TEXT NOT NULL,
    "writer_fence_release_evidence_sha256" TEXT NOT NULL,
    "release_authorization_payload_sha256" TEXT NOT NULL,
    "result_sha256" TEXT NOT NULL,
    "payload_sha256" TEXT NOT NULL,
    "signature_hmac_sha256" TEXT NOT NULL,
    "signature_key_id" TEXT NOT NULL,
    "resolved_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "database_restore_recovery_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_identity_database_id_key" ON "operations"."service_identity"("database_id");

-- CreateIndex
CREATE INDEX "admin_event_logs_admin_id_idx" ON "operations"."admin_event_logs"("admin_id");

-- CreateIndex
CREATE INDEX "admin_event_logs_target_user_id_idx" ON "operations"."admin_event_logs"("target_user_id");

-- CreateIndex
CREATE INDEX "admin_event_logs_section_idx" ON "operations"."admin_event_logs"("section");

-- CreateIndex
CREATE INDEX "admin_event_logs_action_idx" ON "operations"."admin_event_logs"("action");

-- CreateIndex
CREATE INDEX "admin_event_logs_entity_type_entity_id_idx" ON "operations"."admin_event_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "admin_event_logs_created_at_idx" ON "operations"."admin_event_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_event_receipts_claim_idx" ON "operations"."audit_event_receipts"("status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "audit_event_receipts_retry_idx" ON "operations"."audit_event_receipts"("status", "retry_available_at");

-- CreateIndex
CREATE INDEX "audit_event_receipts_delivered_idx" ON "operations"."audit_event_receipts"("delivered_at");

-- CreateIndex
CREATE UNIQUE INDEX "audit_event_receipts_event_consumer_key" ON "operations"."audit_event_receipts"("event_id", "consumer");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_event_id_key" ON "operations"."outbox_events"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_deduplication_key_key" ON "operations"."outbox_events"("deduplication_key");

-- CreateIndex
CREATE INDEX "outbox_events_dispatch_idx" ON "operations"."outbox_events"("status", "available_at", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_retention_idx" ON "operations"."outbox_events"("status", "published_at", "id");

-- CreateIndex
CREATE INDEX "scheduled_job_runs_dispatch_idx" ON "operations"."scheduled_job_runs"("status", "available_at", "created_at");

-- CreateIndex
CREATE INDEX "scheduled_job_runs_lease_idx" ON "operations"."scheduled_job_runs"("status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "scheduled_job_runs_type_created_idx" ON "operations"."scheduled_job_runs"("job_type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_job_runs_type_schedule_key_unique" ON "operations"."scheduled_job_runs"("job_type", "schedule_key");

-- CreateIndex
CREATE INDEX "scheduled_job_idempotency_keys_job_idx" ON "operations"."scheduled_job_idempotency_keys"("job_id");

-- CreateIndex
CREATE INDEX "messaging_heartbeats_service_seen_idx" ON "operations"."messaging_heartbeats"("service", "last_seen_at");

-- CreateIndex
CREATE INDEX "messaging_heartbeats_seen_idx" ON "operations"."messaging_heartbeats"("last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_heartbeats_service_instance_unique" ON "operations"."messaging_heartbeats"("service", "instance_id");

-- CreateIndex
CREATE INDEX "integration_delivery_failures_status_idx" ON "operations"."integration_delivery_failures"("resolved_at", "failed_at");

-- CreateIndex
CREATE INDEX "integration_delivery_failures_integration_idx" ON "operations"."integration_delivery_failures"("integration", "resolved_at");

-- CreateIndex
CREATE INDEX "integration_delivery_failures_category_idx" ON "operations"."integration_delivery_failures"("category", "resolved_at", "failed_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_delivery_failures_event_integration_unique" ON "operations"."integration_delivery_failures"("event_id", "integration");

-- CreateIndex
CREATE INDEX "integration_delivery_receipts_processing_idx" ON "operations"."integration_delivery_receipts"("status", "locked_at");

-- CreateIndex
CREATE INDEX "integration_delivery_receipts_integration_delivered_idx" ON "operations"."integration_delivery_receipts"("integration", "delivered_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_delivery_receipts_event_integration_unique" ON "operations"."integration_delivery_receipts"("event_id", "integration");

-- CreateIndex
CREATE UNIQUE INDEX "operational_alerts_deduplication_key_key" ON "operations"."operational_alerts"("deduplication_key");

-- CreateIndex
CREATE INDEX "operational_alerts_active_idx" ON "operations"."operational_alerts"("resolved_at", "severity", "alert_at");

-- CreateIndex
CREATE INDEX "operational_alerts_source_idx" ON "operations"."operational_alerts"("source", "resolved_at");

-- CreateIndex
CREATE UNIQUE INDEX "database_restore_jobs_event_id_unique" ON "operations"."database_restore_jobs"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "database_restore_jobs_permit_id_unique" ON "operations"."database_restore_jobs"("permit_id");

-- CreateIndex
CREATE INDEX "database_restore_jobs_dispatch_idx" ON "operations"."database_restore_jobs"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "database_restore_jobs_actor_idempotency_key" ON "operations"."database_restore_jobs"("requested_by_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "database_restore_jobs_exact_permit_binding_unique" ON "operations"."database_restore_jobs"("permit_id", "id", "target", "source_sha256", "source_size", "source_backup_job_id", "backup_provenance_envelope_sha256", "backup_provenance_key_id", "expected_services_sha", "migration_manifest_sha");

-- CreateIndex
CREATE UNIQUE INDEX "database_restore_jobs_exact_release_binding_unique" ON "operations"."database_restore_jobs"("id", "target", "source_sha256", "source_size", "source_backup_job_id", "backup_provenance_envelope_sha256", "backup_provenance_key_id", "expected_services_sha", "migration_manifest_sha");

-- CreateIndex
CREATE UNIQUE INDEX "database_restore_permits_job_id_unique" ON "operations"."database_restore_permits"("job_id");

-- CreateIndex
CREATE INDEX "database_restore_permits_status_expiry_idx" ON "operations"."database_restore_permits"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "database_restore_permits_exact_binding_unique" ON "operations"."database_restore_permits"("id", "job_id", "target", "source_sha256", "source_size", "source_backup_job_id", "backup_provenance_envelope_sha256", "backup_provenance_key_id", "expected_services_sha", "migration_manifest_sha");

-- CreateIndex
CREATE UNIQUE INDEX "database_restore_terminal_receipts_job_id_unique" ON "operations"."database_restore_terminal_receipts"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "database_restore_terminal_receipts_exact_job_binding_unique" ON "operations"."database_restore_terminal_receipts"("permit_id", "job_id", "target", "source_sha256", "source_size", "source_backup_job_id", "backup_provenance_envelope_sha256", "backup_provenance_key_id", "expected_services_sha", "migration_manifest_sha");

-- CreateIndex
CREATE UNIQUE INDEX "database_restore_recovery_actions_event_id_unique" ON "operations"."database_restore_recovery_actions"("event_id");

-- CreateIndex
CREATE INDEX "database_restore_recovery_actions_job_status_idx" ON "operations"."database_restore_recovery_actions"("job_id", "status");

-- CreateIndex
CREATE INDEX "database_restore_recovery_actions_status_expiry_idx" ON "operations"."database_restore_recovery_actions"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "database_restore_recovery_actions_exact_release_binding_unique" ON "operations"."database_restore_recovery_actions"("id", "job_id", "action", "receipt_payload_sha");

-- CreateIndex
CREATE UNIQUE INDEX "database_restore_release_authorizations_action_id_unique" ON "operations"."database_restore_release_authorizations"("action_id");

-- CreateIndex
CREATE UNIQUE INDEX "database_restore_release_authorizations_permit_id_unique" ON "operations"."database_restore_release_authorizations"("permit_id");

-- CreateIndex
CREATE UNIQUE INDEX "database_restore_release_authorizations_operation_unique" ON "operations"."database_restore_release_authorizations"("operation_type", "operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "database_restore_release_auth_exact_action_binding_unique" ON "operations"."database_restore_release_authorizations"("action_id", "job_id", "recovery_action", "initial_receipt_payload_sha256");

-- CreateIndex
CREATE UNIQUE INDEX "database_restore_release_auth_exact_permit_binding_unique" ON "operations"."database_restore_release_authorizations"("permit_id", "job_id", "target", "source_sha256", "source_size", "source_backup_job_id", "backup_provenance_envelope_sha256", "backup_provenance_key_id", "expected_services_sha", "migration_manifest_sha");

-- CreateIndex
CREATE UNIQUE INDEX "database_restore_recovery_receipts_job_id_unique" ON "operations"."database_restore_recovery_receipts"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "database_restore_recovery_receipts_action_id_unique" ON "operations"."database_restore_recovery_receipts"("action_id");

-- AddForeignKey
ALTER TABLE "operations"."scheduled_job_idempotency_keys" ADD CONSTRAINT "scheduled_job_idempotency_keys_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "operations"."scheduled_job_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations"."database_restore_jobs" ADD CONSTRAINT "database_restore_jobs_permit_fkey" FOREIGN KEY ("permit_id", "id", "target", "source_sha256", "source_size", "source_backup_job_id", "backup_provenance_envelope_sha256", "backup_provenance_key_id", "expected_services_sha", "migration_manifest_sha") REFERENCES "operations"."database_restore_permits"("id", "job_id", "target", "source_sha256", "source_size", "source_backup_job_id", "backup_provenance_envelope_sha256", "backup_provenance_key_id", "expected_services_sha", "migration_manifest_sha") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "operations"."database_restore_permits" ADD CONSTRAINT "database_restore_permits_source_backup_job_fkey" FOREIGN KEY ("source_backup_job_id") REFERENCES "operations"."scheduled_job_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "operations"."database_restore_terminal_receipts" ADD CONSTRAINT "database_restore_terminal_receipts_job_fkey" FOREIGN KEY ("permit_id", "job_id", "target", "source_sha256", "source_size", "source_backup_job_id", "backup_provenance_envelope_sha256", "backup_provenance_key_id", "expected_services_sha", "migration_manifest_sha") REFERENCES "operations"."database_restore_jobs"("permit_id", "id", "target", "source_sha256", "source_size", "source_backup_job_id", "backup_provenance_envelope_sha256", "backup_provenance_key_id", "expected_services_sha", "migration_manifest_sha") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "operations"."database_restore_recovery_actions" ADD CONSTRAINT "database_restore_recovery_actions_job_fkey" FOREIGN KEY ("job_id") REFERENCES "operations"."database_restore_jobs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "operations"."database_restore_release_authorizations" ADD CONSTRAINT "database_restore_release_authorizations_job_fkey" FOREIGN KEY ("job_id", "target", "source_sha256", "source_size", "source_backup_job_id", "backup_provenance_envelope_sha256", "backup_provenance_key_id", "expected_services_sha", "migration_manifest_sha") REFERENCES "operations"."database_restore_jobs"("id", "target", "source_sha256", "source_size", "source_backup_job_id", "backup_provenance_envelope_sha256", "backup_provenance_key_id", "expected_services_sha", "migration_manifest_sha") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "operations"."database_restore_release_authorizations" ADD CONSTRAINT "database_restore_release_authorizations_action_fkey" FOREIGN KEY ("action_id", "job_id", "recovery_action", "initial_receipt_payload_sha256") REFERENCES "operations"."database_restore_recovery_actions"("id", "job_id", "action", "receipt_payload_sha") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "operations"."database_restore_release_authorizations" ADD CONSTRAINT "database_restore_release_authorizations_permit_fkey" FOREIGN KEY ("permit_id", "job_id", "target", "source_sha256", "source_size", "source_backup_job_id", "backup_provenance_envelope_sha256", "backup_provenance_key_id", "expected_services_sha", "migration_manifest_sha") REFERENCES "operations"."database_restore_permits"("id", "job_id", "target", "source_sha256", "source_size", "source_backup_job_id", "backup_provenance_envelope_sha256", "backup_provenance_key_id", "expected_services_sha", "migration_manifest_sha") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "operations"."database_restore_recovery_receipts" ADD CONSTRAINT "database_restore_recovery_receipts_job_fkey" FOREIGN KEY ("job_id") REFERENCES "operations"."database_restore_jobs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "operations"."database_restore_recovery_receipts" ADD CONSTRAINT "database_restore_recovery_receipts_action_fkey" FOREIGN KEY ("action_id") REFERENCES "operations"."database_restore_recovery_actions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- Active partial indexes that Prisma cannot express.
CREATE UNIQUE INDEX "database_restore_jobs_single_processing" ON "operations"."database_restore_jobs"("status") WHERE "status" = 'PROCESSING';
CREATE INDEX "database_restore_jobs_processing_lease_idx" ON "operations"."database_restore_jobs"("status", "lease_expires_at");
CREATE UNIQUE INDEX "database_restore_jobs_target_fence" ON "operations"."database_restore_jobs"("target") WHERE "status" IN ('QUEUED', 'PROCESSING') OR ("status" = 'RECOVERY_REQUIRED' AND "recovery_resolved_at" IS NULL);
CREATE UNIQUE INDEX "database_restore_permits_global_active_unique" ON "operations"."database_restore_permits"((1)) WHERE "status" IN ('PENDING_APPROVAL', 'APPROVED', 'CONSUMED');
CREATE UNIQUE INDEX "database_restore_recovery_actions_active_job_unique" ON "operations"."database_restore_recovery_actions"("job_id") WHERE "status" IN ('PENDING_APPROVAL', 'APPROVED', 'PROCESSING');
CREATE INDEX "database_restore_recovery_actions_processing_lease_idx" ON "operations"."database_restore_recovery_actions"("status", "lease_expires_at");

-- Current service-owned integrity guards (fresh database, no historical data patches).

ALTER TABLE "operations"."audit_event_receipts" ADD CONSTRAINT "audit_event_receipts_attempt_check" CHECK ("attempt" >= 1);

ALTER TABLE "operations"."audit_event_receipts" ADD CONSTRAINT "audit_event_receipts_consumer_check" CHECK (
        char_length("consumer") BETWEEN 1 AND 120
    );

ALTER TABLE "operations"."audit_event_receipts" ADD CONSTRAINT "audit_event_receipts_error_check" CHECK (
        "last_error" IS NULL OR char_length("last_error") <= 2000
    );

ALTER TABLE "operations"."audit_event_receipts" ADD CONSTRAINT "audit_event_receipts_manual_retry_cycle_check" CHECK ("manual_retry_cycle" >= 0);

ALTER TABLE "operations"."audit_event_receipts" ADD CONSTRAINT "audit_event_receipts_state_check" CHECK (
        (
            "status" = 'PROCESSING'
            AND "lease_token" IS NOT NULL
            AND "lease_expires_at" IS NOT NULL
            AND "retry_available_at" IS NULL
            AND "delivered_at" IS NULL
            AND "dead_lettered_at" IS NULL
            AND "dead_letter_source" IS NULL
            AND "dead_letter_payload" IS NULL
        ) OR (
            "status" = 'RETRY_SCHEDULED'
            AND "lease_token" IS NULL
            AND "lease_expires_at" IS NULL
            AND "retry_available_at" IS NOT NULL
            AND "delivered_at" IS NULL
            AND "dead_lettered_at" IS NULL
            AND "dead_letter_source" IS NULL
            AND "dead_letter_payload" IS NULL
        ) OR (
            "status" = 'DELIVERED'
            AND "lease_token" IS NULL
            AND "lease_expires_at" IS NULL
            AND "retry_available_at" IS NULL
            AND "delivered_at" IS NOT NULL
            AND "dead_lettered_at" IS NULL
            AND "dead_letter_source" IS NULL
            AND "dead_letter_payload" IS NULL
        ) OR (
            "status" = 'DEAD_LETTERED'
            AND "lease_token" IS NULL
            AND "lease_expires_at" IS NULL
            AND "retry_available_at" IS NULL
            AND "delivered_at" IS NULL
            AND "dead_lettered_at" IS NOT NULL
            AND "dead_letter_source" IN (
                'campaigns', 'reporting', 'billing',
                'identity', 'platform', 'support', 'core'
            )
            AND jsonb_typeof("dead_letter_payload") = 'object'
        )
    );

ALTER TABLE "operations"."database_restore_execution_lease" ADD CONSTRAINT "database_restore_execution_lease_shape" CHECK (
        ("operation_type" IS NULL AND "operation_id" IS NULL AND "lease_owner" IS NULL
            AND "lease_token" IS NULL AND "lease_expires_at" IS NULL)
        OR ("operation_type" IS NOT NULL AND "operation_id" IS NOT NULL AND "lease_owner" IS NOT NULL
            AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
    );

ALTER TABLE "operations"."database_restore_execution_lease" ADD CONSTRAINT "database_restore_execution_lease_singleton" CHECK ("id" = 'singleton');

ALTER TABLE "operations"."database_restore_jobs" ADD CONSTRAINT "database_restore_jobs_artifact_retention_shape" CHECK (
    "artifact_retain_until" IS NULL
    OR ("status" = 'SUCCEEDED' AND "finished_at" IS NOT NULL
        AND "artifact_retain_until" >= "finished_at")
    OR ("status" = 'RECOVERY_REQUIRED' AND "recovery_resolved_at" IS NOT NULL
        AND "artifact_retain_until" >= "recovery_resolved_at")
);

ALTER TABLE "operations"."database_restore_jobs" ADD CONSTRAINT "database_restore_jobs_attempts_nonnegative" CHECK ("attempts" >= 0);

ALTER TABLE "operations"."database_restore_jobs" ADD CONSTRAINT "database_restore_jobs_lease_shape" CHECK (
    ("status" = 'PROCESSING' AND "phase" IS NOT NULL AND "event_id" IS NOT NULL AND "lease_owner" IS NOT NULL AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
    OR
    ("status" <> 'PROCESSING' AND "lease_owner" IS NULL AND "lease_token" IS NULL AND "lease_expires_at" IS NULL)
);

ALTER TABLE "operations"."database_restore_jobs" ADD CONSTRAINT "database_restore_jobs_manifest_sha" CHECK ("migration_manifest_sha" ~ '^[0-9a-f]{64}$');

ALTER TABLE "operations"."database_restore_jobs" ADD CONSTRAINT "database_restore_jobs_provenance_check" CHECK (
    "source_size" > 0
    AND "source_size" <= 51380224
    AND "backup_provenance_envelope_sha256" ~ '^[0-9a-f]{64}$'
    AND "backup_provenance_key_id" ~ '^[A-Za-z0-9._:-]{1,80}$'
    AND octet_length("backup_provenance") BETWEEN 1 AND 16384
);

ALTER TABLE "operations"."database_restore_jobs" ADD CONSTRAINT "database_restore_jobs_recovery_resolution_shape" CHECK (
    "recovery_resolved_at" IS NULL
    OR ("status" = 'RECOVERY_REQUIRED' AND "recovery_resolved_at" IS NOT NULL)
);

ALTER TABLE "operations"."database_restore_jobs" ADD CONSTRAINT "database_restore_jobs_safety_pair" CHECK (("safety_backup_file_name" IS NULL) = ("safety_backup_sha256" IS NULL));

ALTER TABLE "operations"."database_restore_jobs" ADD CONSTRAINT "database_restore_jobs_safety_sha256" CHECK ("safety_backup_sha256" IS NULL OR "safety_backup_sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "operations"."database_restore_jobs" ADD CONSTRAINT "database_restore_jobs_services_sha" CHECK ("expected_services_sha" ~ '^[0-9a-f]{40}$');

ALTER TABLE "operations"."database_restore_jobs" ADD CONSTRAINT "database_restore_jobs_sha256" CHECK ("source_sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "operations"."database_restore_jobs" ADD CONSTRAINT "database_restore_jobs_size" CHECK ("source_size" > 0);

ALTER TABLE "operations"."database_restore_jobs" ADD CONSTRAINT "database_restore_jobs_target" CHECK (
    "target" IN ('notification-delivery', 'campaigns', 'reporting', 'identity', 'platform', 'support')
);

ALTER TABLE "operations"."database_restore_jobs" ADD CONSTRAINT "database_restore_jobs_writer_fence_exact_roles" CHECK (
    "target" IN ('notification-delivery', 'campaigns', 'reporting', 'identity', 'platform', 'support')
    AND ("writer_fence_roles" IS NULL OR "writer_fence_roles" = CASE "target"
        WHEN 'notification-delivery' THEN '["aerocrm_notification_delivery_runtime","aerocrm_notification_delivery_migration","aerocrm_notification_delivery_backup"]'::jsonb
        WHEN 'campaigns' THEN '["aerocrm_campaigns_runtime","aerocrm_campaigns_migration","aerocrm_campaigns_backup"]'::jsonb
        WHEN 'reporting' THEN '["aerocrm_reporting_runtime","aerocrm_reporting_migration","aerocrm_reporting_backup"]'::jsonb
        WHEN 'identity' THEN '["aerocrm_identity_runtime","aerocrm_identity_migration","aerocrm_identity_backup"]'::jsonb
        WHEN 'platform' THEN '["aerocrm_platform_runtime","aerocrm_platform_migration","aerocrm_platform_backup"]'::jsonb
        WHEN 'support' THEN '["aerocrm_support_runtime","aerocrm_support_migration","aerocrm_support_backup"]'::jsonb
        ELSE '[]'::jsonb
    END)
);

ALTER TABLE "operations"."database_restore_jobs" ADD CONSTRAINT "database_restore_jobs_writer_fence_hashes" CHECK (
    ("writer_fence_evidence_sha256" IS NULL OR "writer_fence_evidence_sha256" ~ '^[0-9a-f]{64}$')
    AND ("writer_fence_release_evidence_sha256" IS NULL OR "writer_fence_release_evidence_sha256" ~ '^[0-9a-f]{64}$')
);

ALTER TABLE "operations"."database_restore_jobs" ADD CONSTRAINT "database_restore_jobs_writer_fence_shape" CHECK (
    ("writer_fence_roles" IS NULL AND "writer_fence_requested_at" IS NULL AND "writer_fence_applied_at" IS NULL
        AND "writer_fence_released_at" IS NULL AND "writer_fence_evidence_sha256" IS NULL
        AND "writer_fence_release_evidence_sha256" IS NULL)
    OR
    (jsonb_typeof("writer_fence_roles") = 'array' AND jsonb_array_length("writer_fence_roles") = 3
        AND "writer_fence_requested_at" IS NOT NULL
        AND ("writer_fence_applied_at" IS NULL OR "writer_fence_applied_at" >= "writer_fence_requested_at")
        AND ("writer_fence_applied_at" IS NULL) = ("writer_fence_evidence_sha256" IS NULL)
        AND ("writer_fence_released_at" IS NULL OR ("writer_fence_applied_at" IS NOT NULL AND "writer_fence_released_at" >= "writer_fence_applied_at"))
        AND ("writer_fence_released_at" IS NULL) = ("writer_fence_release_evidence_sha256" IS NULL))
);

ALTER TABLE "operations"."database_restore_permits" ADD CONSTRAINT "database_restore_permits_distinct_actors" CHECK ("approved_by_id" IS NULL OR "approved_by_id" <> "requested_by_id");

ALTER TABLE "operations"."database_restore_permits" ADD CONSTRAINT "database_restore_permits_expiry" CHECK ("expires_at" > "created_at");

ALTER TABLE "operations"."database_restore_permits" ADD CONSTRAINT "database_restore_permits_manifest_sha" CHECK ("migration_manifest_sha" ~ '^[0-9a-f]{64}$');

ALTER TABLE "operations"."database_restore_permits" ADD CONSTRAINT "database_restore_permits_provenance_check" CHECK (
    "source_size" > 0
    AND "source_size" <= 51380224
    AND "backup_provenance_envelope_sha256" ~ '^[0-9a-f]{64}$'
    AND "backup_provenance_key_id" ~ '^[A-Za-z0-9._:-]{1,80}$'
    AND octet_length("backup_provenance") BETWEEN 1 AND 16384
);

ALTER TABLE "operations"."database_restore_permits" ADD CONSTRAINT "database_restore_permits_services_sha" CHECK ("expected_services_sha" ~ '^[0-9a-f]{40}$');

ALTER TABLE "operations"."database_restore_permits" ADD CONSTRAINT "database_restore_permits_source_sha256" CHECK ("source_sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "operations"."database_restore_permits" ADD CONSTRAINT "database_restore_permits_state_shape" CHECK (
        ("status" = 'PENDING_APPROVAL' AND "approved_by_id" IS NULL AND "approved_at" IS NULL AND "consumed_at" IS NULL AND "closed_at" IS NULL AND "close_reason" IS NULL)
        OR ("status" = 'APPROVED' AND "approved_by_id" IS NOT NULL AND "approved_at" IS NOT NULL AND "consumed_at" IS NULL AND "closed_at" IS NULL AND "close_reason" IS NULL)
        OR ("status" = 'CONSUMED' AND "approved_by_id" IS NOT NULL AND "approved_at" IS NOT NULL AND "consumed_at" IS NOT NULL AND "closed_at" IS NULL AND "close_reason" IS NULL)
        OR ("status" = 'CLOSED' AND "closed_at" IS NOT NULL AND "close_reason" IS NOT NULL)
    );

ALTER TABLE "operations"."database_restore_permits" ADD CONSTRAINT "database_restore_permits_target" CHECK (
        "target" IN ('notification-delivery', 'campaigns', 'reporting', 'identity', 'platform', 'support')
    );

ALTER TABLE "operations"."database_restore_recovery_actions" ADD CONSTRAINT "database_restore_recovery_actions_artifact_sha" CHECK ("artifact_sha256" IS NULL OR "artifact_sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "operations"."database_restore_recovery_actions" ADD CONSTRAINT "database_restore_recovery_actions_attempts_nonnegative" CHECK ("attempts" >= 0);

ALTER TABLE "operations"."database_restore_recovery_actions" ADD CONSTRAINT "database_restore_recovery_actions_distinct_actors" CHECK ("approved_by_id" IS NULL OR "approved_by_id" <> "requested_by_id");

ALTER TABLE "operations"."database_restore_recovery_actions" ADD CONSTRAINT "database_restore_recovery_actions_expiry" CHECK ("expires_at" > "created_at");

ALTER TABLE "operations"."database_restore_recovery_actions" ADD CONSTRAINT "database_restore_recovery_actions_fence_hashes" CHECK (
    ("writer_fence_evidence_sha256" IS NULL OR "writer_fence_evidence_sha256" ~ '^[0-9a-f]{64}$')
    AND ("writer_fence_release_evidence_sha256" IS NULL OR "writer_fence_release_evidence_sha256" ~ '^[0-9a-f]{64}$')
);

ALTER TABLE "operations"."database_restore_recovery_actions" ADD CONSTRAINT "database_restore_recovery_actions_fence_shape" CHECK (
    ("writer_fence_roles" IS NULL AND "writer_fence_requested_at" IS NULL AND "writer_fence_applied_at" IS NULL
        AND "writer_fence_released_at" IS NULL AND "writer_fence_evidence_sha256" IS NULL
        AND "writer_fence_release_evidence_sha256" IS NULL)
    OR
    (jsonb_typeof("writer_fence_roles") = 'array' AND jsonb_array_length("writer_fence_roles") = 3
        AND "writer_fence_requested_at" IS NOT NULL
        AND ("writer_fence_applied_at" IS NULL OR "writer_fence_applied_at" >= "writer_fence_requested_at")
        AND ("writer_fence_applied_at" IS NULL) = ("writer_fence_evidence_sha256" IS NULL)
        AND ("writer_fence_released_at" IS NULL OR ("writer_fence_applied_at" IS NOT NULL AND "writer_fence_released_at" >= "writer_fence_applied_at"))
        AND ("writer_fence_released_at" IS NULL) = ("writer_fence_release_evidence_sha256" IS NULL))
);

ALTER TABLE "operations"."database_restore_recovery_actions" ADD CONSTRAINT "database_restore_recovery_actions_receipt_sha" CHECK ("receipt_payload_sha" ~ '^[0-9a-f]{64}$');

ALTER TABLE "operations"."database_restore_recovery_actions" ADD CONSTRAINT "database_restore_recovery_actions_state_shape" CHECK (
    ("status" = 'PENDING_APPROVAL' AND "approved_by_id" IS NULL AND "approved_at" IS NULL
        AND "event_id" IS NULL AND "phase" IS NULL AND "lease_token" IS NULL AND "finished_at" IS NULL)
    OR ("status" = 'APPROVED' AND "approved_by_id" IS NOT NULL AND "approved_at" IS NOT NULL
        AND "event_id" IS NOT NULL AND "phase" IS NULL AND "lease_token" IS NULL AND "finished_at" IS NULL)
    OR ("status" = 'PROCESSING' AND "approved_by_id" IS NOT NULL AND "approved_at" IS NOT NULL
        AND "event_id" IS NOT NULL AND "phase" IS NOT NULL AND "lease_owner" IS NOT NULL
        AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL AND "started_at" IS NOT NULL
        AND "finished_at" IS NULL)
    OR ("status" = 'RESOLVED' AND "approved_by_id" IS NOT NULL AND "approved_at" IS NOT NULL
        AND "event_id" IS NOT NULL AND "phase" = 'RESOLVED' AND "lease_owner" IS NULL
        AND "lease_token" IS NULL AND "lease_expires_at" IS NULL AND "finished_at" IS NOT NULL
        AND "last_error" IS NULL)
    OR ("status" = 'BLOCKED' AND "approved_by_id" IS NOT NULL AND "approved_at" IS NOT NULL
        AND "event_id" IS NOT NULL AND "phase" IS NOT NULL AND "lease_owner" IS NULL
        AND "lease_token" IS NULL AND "lease_expires_at" IS NULL AND "finished_at" IS NOT NULL
        AND "last_error" IS NOT NULL)
    OR ("status" = 'EXPIRED' AND "lease_owner" IS NULL AND "lease_token" IS NULL AND "lease_expires_at" IS NULL)
);

ALTER TABLE "operations"."database_restore_recovery_receipts" ADD CONSTRAINT "database_restore_recovery_receipts_fence_order" CHECK (
        "writer_fence_released_at" >= "writer_fence_applied_at"
    );

ALTER TABLE "operations"."database_restore_recovery_receipts" ADD CONSTRAINT "database_restore_recovery_receipts_key_id" CHECK ("signature_key_id" ~ '^[A-Za-z0-9._:-]{1,80}$');

ALTER TABLE "operations"."database_restore_recovery_receipts" ADD CONSTRAINT "database_restore_recovery_receipts_release_authorization" CHECK (
    "release_authorization_payload_sha256" ~ '^[0-9a-f]{64}$'
);

ALTER TABLE "operations"."database_restore_recovery_receipts" ADD CONSTRAINT "database_restore_recovery_receipts_roles" CHECK (
        jsonb_typeof("writer_fence_roles") = 'array' AND jsonb_array_length("writer_fence_roles") = 3
        AND "writer_fence_roles" = CASE "target"
            WHEN 'notification-delivery' THEN '["aerocrm_notification_delivery_runtime","aerocrm_notification_delivery_migration","aerocrm_notification_delivery_backup"]'::jsonb
            WHEN 'campaigns' THEN '["aerocrm_campaigns_runtime","aerocrm_campaigns_migration","aerocrm_campaigns_backup"]'::jsonb
            WHEN 'reporting' THEN '["aerocrm_reporting_runtime","aerocrm_reporting_migration","aerocrm_reporting_backup"]'::jsonb
            WHEN 'identity' THEN '["aerocrm_identity_runtime","aerocrm_identity_migration","aerocrm_identity_backup"]'::jsonb
            WHEN 'platform' THEN '["aerocrm_platform_runtime","aerocrm_platform_migration","aerocrm_platform_backup"]'::jsonb
            WHEN 'support' THEN '["aerocrm_support_runtime","aerocrm_support_migration","aerocrm_support_backup"]'::jsonb
            ELSE '[]'::jsonb
        END
    );

ALTER TABLE "operations"."database_restore_recovery_receipts" ADD CONSTRAINT "database_restore_recovery_receipts_sha_shape" CHECK (
        "initial_receipt_payload_sha" ~ '^[0-9a-f]{64}$'
        AND ("artifact_sha256" IS NULL OR "artifact_sha256" ~ '^[0-9a-f]{64}$')
        AND "expected_services_sha" ~ '^[0-9a-f]{40}$'
        AND "migration_manifest_sha" ~ '^[0-9a-f]{64}$'
        AND "writer_fence_evidence_sha256" ~ '^[0-9a-f]{64}$'
        AND "writer_fence_release_evidence_sha256" ~ '^[0-9a-f]{64}$'
        AND "result_sha256" ~ '^[0-9a-f]{64}$'
        AND "payload_sha256" ~ '^[0-9a-f]{64}$'
        AND "signature_hmac_sha256" ~ '^[0-9a-f]{64}$'
    );

ALTER TABLE "operations"."database_restore_recovery_receipts" ADD CONSTRAINT "database_restore_recovery_receipts_target" CHECK (
        "target" IN ('notification-delivery', 'campaigns', 'reporting', 'identity', 'platform', 'support')
    );

ALTER TABLE "operations"."database_restore_release_authorizations" ADD CONSTRAINT "database_restore_release_authorizations_actors" CHECK (
        "requested_by_id" <> "approved_by_id"
    );

ALTER TABLE "operations"."database_restore_release_authorizations" ADD CONSTRAINT "database_restore_release_authorizations_hashes" CHECK (
        ("initial_receipt_payload_sha256" IS NULL OR "initial_receipt_payload_sha256" ~ '^[0-9a-f]{64}$')
        AND "source_sha256" ~ '^[0-9a-f]{64}$'
        AND ("artifact_sha256" IS NULL OR "artifact_sha256" ~ '^[0-9a-f]{64}$')
        AND "expected_services_sha" ~ '^[0-9a-f]{40}$'
        AND "migration_manifest_sha" ~ '^[0-9a-f]{64}$'
        AND "approval_evidence_sha256" ~ '^[0-9a-f]{64}$'
        AND "writer_fence_evidence_sha256" ~ '^[0-9a-f]{64}$'
        AND "migration_ledger_sha256" ~ '^[0-9a-f]{64}$'
        AND "acl_evidence_sha256" ~ '^[0-9a-f]{64}$'
        AND "verified_writer_fence_sha256" ~ '^[0-9a-f]{64}$'
        AND "payload_sha256" ~ '^[0-9a-f]{64}$'
        AND "signature_hmac_sha256" ~ '^[0-9a-f]{64}$'
    );

ALTER TABLE "operations"."database_restore_release_authorizations" ADD CONSTRAINT "database_restore_release_authorizations_key_id" CHECK (
        "signature_key_id" ~ '^[A-Za-z0-9._:-]{1,80}$'
    );

ALTER TABLE "operations"."database_restore_release_authorizations" ADD CONSTRAINT "database_restore_release_authorizations_operation" CHECK (
        ("operation_type" = 'RESTORE' AND "operation_id" = "job_id"
            AND "action_id" IS NULL AND "permit_id" IS NOT NULL
            AND "recovery_action" IS NULL AND "initial_receipt_payload_sha256" IS NULL
            AND "artifact_sha256" IS NOT NULL)
        OR
        ("operation_type" = 'RECOVERY' AND "operation_id" = "action_id"
            AND "action_id" IS NOT NULL AND "permit_id" IS NULL
            AND "recovery_action" IS NOT NULL AND "initial_receipt_payload_sha256" IS NOT NULL
            AND (("recovery_action" = 'VERIFY_AS_IS' AND "artifact_sha256" IS NULL)
                OR ("recovery_action" <> 'VERIFY_AS_IS' AND "artifact_sha256" IS NOT NULL)))
    );

ALTER TABLE "operations"."database_restore_release_authorizations" ADD CONSTRAINT "database_restore_release_authorizations_provenance_check" CHECK (
    "source_size" > 0
    AND "source_size" <= 51380224
    AND "backup_provenance_envelope_sha256" ~ '^[0-9a-f]{64}$'
    AND "backup_provenance_key_id" ~ '^[A-Za-z0-9._:-]{1,80}$'
);

ALTER TABLE "operations"."database_restore_release_authorizations" ADD CONSTRAINT "database_restore_release_authorizations_roles" CHECK (
        jsonb_typeof("writer_fence_roles") = 'array'
        AND jsonb_array_length("writer_fence_roles") = 3
        AND "writer_fence_roles" = CASE "target"
            WHEN 'notification-delivery' THEN '["aerocrm_notification_delivery_runtime","aerocrm_notification_delivery_migration","aerocrm_notification_delivery_backup"]'::jsonb
            WHEN 'campaigns' THEN '["aerocrm_campaigns_runtime","aerocrm_campaigns_migration","aerocrm_campaigns_backup"]'::jsonb
            WHEN 'reporting' THEN '["aerocrm_reporting_runtime","aerocrm_reporting_migration","aerocrm_reporting_backup"]'::jsonb
            WHEN 'identity' THEN '["aerocrm_identity_runtime","aerocrm_identity_migration","aerocrm_identity_backup"]'::jsonb
            WHEN 'platform' THEN '["aerocrm_platform_runtime","aerocrm_platform_migration","aerocrm_platform_backup"]'::jsonb
            WHEN 'support' THEN '["aerocrm_support_runtime","aerocrm_support_migration","aerocrm_support_backup"]'::jsonb
            ELSE '[]'::jsonb
        END
    );

ALTER TABLE "operations"."database_restore_release_authorizations" ADD CONSTRAINT "database_restore_release_authorizations_target" CHECK (
        "target" IN ('notification-delivery', 'campaigns', 'reporting', 'identity', 'platform', 'support')
    );

ALTER TABLE "operations"."database_restore_release_authorizations" ADD CONSTRAINT "database_restore_release_authorizations_time_order" CHECK (
        "verified_at" >= "writer_fence_applied_at"
        AND "verified_at" >= "approved_at"
        AND "authorized_at" >= "verified_at"
    );

ALTER TABLE "operations"."database_restore_terminal_receipts" ADD CONSTRAINT "database_restore_terminal_receipts_error_sha256" CHECK ("error_sha256" IS NULL OR "error_sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "operations"."database_restore_terminal_receipts" ADD CONSTRAINT "database_restore_terminal_receipts_hmac_sha256" CHECK ("signature_hmac_sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "operations"."database_restore_terminal_receipts" ADD CONSTRAINT "database_restore_terminal_receipts_key_id" CHECK ("signature_key_id" ~ '^[A-Za-z0-9._:-]{1,80}$');

ALTER TABLE "operations"."database_restore_terminal_receipts" ADD CONSTRAINT "database_restore_terminal_receipts_manifest_sha" CHECK ("migration_manifest_sha" ~ '^[0-9a-f]{64}$');

ALTER TABLE "operations"."database_restore_terminal_receipts" ADD CONSTRAINT "database_restore_terminal_receipts_payload_sha256" CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "operations"."database_restore_terminal_receipts" ADD CONSTRAINT "database_restore_terminal_receipts_permit_actors" CHECK (
    "permit_requested_by_id" <> "permit_approved_by_id"
);

ALTER TABLE "operations"."database_restore_terminal_receipts" ADD CONSTRAINT "database_restore_terminal_receipts_permit_timestamps" CHECK (
    "permit_approved_at" >= "permit_created_at"
    AND "permit_consumed_at" >= "permit_approved_at"
    AND "permit_consumed_at" <= "permit_expires_at"
);

ALTER TABLE "operations"."database_restore_terminal_receipts" ADD CONSTRAINT "database_restore_terminal_receipts_provenance_check" CHECK (
    "source_size" > 0
    AND "source_size" <= 51380224
    AND "backup_provenance_envelope_sha256" ~ '^[0-9a-f]{64}$'
    AND "backup_provenance_key_id" ~ '^[A-Za-z0-9._:-]{1,80}$'
);

ALTER TABLE "operations"."database_restore_terminal_receipts" ADD CONSTRAINT "database_restore_terminal_receipts_release_authorization" CHECK (
    ("terminal_status" = 'SUCCEEDED'
        AND "release_authorization_payload_sha256" IS NOT NULL
        AND "release_authorization_payload_sha256" ~ '^[0-9a-f]{64}$')
    OR ("terminal_status" <> 'SUCCEEDED'
        AND "release_authorization_payload_sha256" IS NULL)
);

ALTER TABLE "operations"."database_restore_terminal_receipts" ADD CONSTRAINT "database_restore_terminal_receipts_result_sha256" CHECK ("result_sha256" IS NULL OR "result_sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "operations"."database_restore_terminal_receipts" ADD CONSTRAINT "database_restore_terminal_receipts_safety_sha256" CHECK ("safety_backup_sha256" IS NULL OR "safety_backup_sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "operations"."database_restore_terminal_receipts" ADD CONSTRAINT "database_restore_terminal_receipts_services_sha" CHECK ("expected_services_sha" ~ '^[0-9a-f]{40}$');

ALTER TABLE "operations"."database_restore_terminal_receipts" ADD CONSTRAINT "database_restore_terminal_receipts_source_sha256" CHECK ("source_sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "operations"."database_restore_terminal_receipts" ADD CONSTRAINT "database_restore_terminal_receipts_target" CHECK (
        "target" IN ('notification-delivery', 'campaigns', 'reporting', 'identity', 'platform', 'support')
    );

ALTER TABLE "operations"."database_restore_terminal_receipts" ADD CONSTRAINT "database_restore_terminal_receipts_terminal_status" CHECK (
        "terminal_status" IN ('SUCCEEDED', 'FAILED', 'RECOVERY_REQUIRED', 'CANCELLED')
    );

ALTER TABLE "operations"."database_restore_terminal_receipts" ADD CONSTRAINT "database_restore_terminal_receipts_writer_fence_exact_roles" CHECK (
    "target" IN ('notification-delivery', 'campaigns', 'reporting', 'identity', 'platform', 'support')
    AND ("writer_fence_roles" IS NULL OR (
        jsonb_typeof("writer_fence_roles") = 'array'
        AND jsonb_array_length("writer_fence_roles") = 3
        AND "writer_fence_roles" = CASE "target"
            WHEN 'notification-delivery' THEN '["aerocrm_notification_delivery_runtime","aerocrm_notification_delivery_migration","aerocrm_notification_delivery_backup"]'::jsonb
            WHEN 'campaigns' THEN '["aerocrm_campaigns_runtime","aerocrm_campaigns_migration","aerocrm_campaigns_backup"]'::jsonb
            WHEN 'reporting' THEN '["aerocrm_reporting_runtime","aerocrm_reporting_migration","aerocrm_reporting_backup"]'::jsonb
            WHEN 'identity' THEN '["aerocrm_identity_runtime","aerocrm_identity_migration","aerocrm_identity_backup"]'::jsonb
            WHEN 'platform' THEN '["aerocrm_platform_runtime","aerocrm_platform_migration","aerocrm_platform_backup"]'::jsonb
            WHEN 'support' THEN '["aerocrm_support_runtime","aerocrm_support_migration","aerocrm_support_backup"]'::jsonb
            ELSE '[]'::jsonb
        END
    ))
);

ALTER TABLE "operations"."database_restore_terminal_receipts" ADD CONSTRAINT "database_restore_terminal_receipts_writer_fence_hashes" CHECK (
    ("writer_fence_evidence_sha256" IS NULL OR "writer_fence_evidence_sha256" ~ '^[0-9a-f]{64}$')
    AND ("writer_fence_release_evidence_sha256" IS NULL OR "writer_fence_release_evidence_sha256" ~ '^[0-9a-f]{64}$')
);

ALTER TABLE "operations"."integration_delivery_failures" ADD CONSTRAINT "integration_delivery_failures_attempts" CHECK ("attempts" >= 1);

ALTER TABLE "operations"."outbox_events" ADD CONSTRAINT "outbox_events_attempt_check" CHECK ("attempt" >= 0);

ALTER TABLE "operations"."outbox_events" ADD CONSTRAINT "outbox_events_payload_object_check" CHECK (
        jsonb_typeof("payload") = 'object'
        AND jsonb_typeof("headers") = 'object'
    );

ALTER TABLE "operations"."outbox_events" ADD CONSTRAINT "outbox_events_state_check" CHECK (
        (
            "status" = 'PENDING'
            AND "lease_token" IS NULL
            AND "lease_expires_at" IS NULL
            AND "published_at" IS NULL
        ) OR (
            "status" = 'PROCESSING'
            AND "lease_token" IS NOT NULL
            AND "lease_expires_at" IS NOT NULL
            AND "published_at" IS NULL
        ) OR (
            "status" = 'PUBLISHED'
            AND "lease_token" IS NULL
            AND "lease_expires_at" IS NULL
            AND "published_at" IS NOT NULL
        )
    );

ALTER TABLE "operations"."reporting_schedule_policy" ADD CONSTRAINT "reporting_schedule_policy_pending_pair" CHECK (("pending_change_id" IS NULL) = ("pending_time" IS NULL) AND ("pending_time" IS NULL) = ("pending_generation" IS NULL));

ALTER TABLE "operations"."reporting_schedule_policy" ADD CONSTRAINT "reporting_schedule_policy_singleton" CHECK ("id" = 'singleton');

ALTER TABLE "operations"."reporting_schedule_policy" ADD CONSTRAINT "reporting_schedule_policy_time" CHECK ("reservation_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND ("pending_time" IS NULL OR "pending_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'));

ALTER TABLE "operations"."scheduled_job_runs" ADD CONSTRAINT "scheduled_job_runs_attempts" CHECK ("attempts" >= 0 AND "max_attempts" BETWEEN 1 AND 1000);

ALTER TABLE "operations"."service_identity" ADD CONSTRAINT "service_identity_singleton_check" CHECK (
        "id" = 'singleton' AND "service_name" = 'operations-service'
    );

ALTER TABLE "operations"."telegram_bot_settings" ADD CONSTRAINT "telegram_bot_settings_singleton" CHECK ("id" = 'singleton');

ALTER TABLE "operations"."telegram_bot_settings" ADD CONSTRAINT "telegram_bot_settings_time" CHECK ("database_backup_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');



CREATE FUNCTION "operations"."prevent_database_restore_release_authorization_mutation"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $immutable_release_authorization$
BEGIN
    RAISE EXCEPTION 'Database restore release authorizations are immutable';
END
$immutable_release_authorization$;

REVOKE ALL ON FUNCTION "operations"."prevent_database_restore_release_authorization_mutation"() FROM PUBLIC;

CREATE FUNCTION "operations"."prevent_database_restore_terminal_receipt_mutation"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $immutable_receipt$
BEGIN
    RAISE EXCEPTION 'Database restore terminal receipts are immutable';
END
$immutable_receipt$;

REVOKE ALL ON FUNCTION "operations"."prevent_database_restore_terminal_receipt_mutation"() FROM PUBLIC;

CREATE FUNCTION "operations"."protect_database_restore_job_provenance"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $protect_restore_job_provenance$
BEGIN
    IF NEW.source_size IS DISTINCT FROM OLD.source_size
        OR NEW.source_backup_job_id IS DISTINCT FROM OLD.source_backup_job_id
        OR NEW.backup_provenance IS DISTINCT FROM OLD.backup_provenance
        OR NEW.backup_provenance_envelope_sha256 IS DISTINCT FROM OLD.backup_provenance_envelope_sha256
        OR NEW.backup_provenance_key_id IS DISTINCT FROM OLD.backup_provenance_key_id THEN
        RAISE EXCEPTION 'Database restore job provenance is immutable';
    END IF;
    RETURN NEW;
END
$protect_restore_job_provenance$;

REVOKE ALL ON FUNCTION "operations"."protect_database_restore_job_provenance"() FROM PUBLIC;

CREATE FUNCTION "operations"."protect_database_restore_permit_binding"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $protect_restore_permit_binding$
BEGIN
    IF NEW.job_id IS DISTINCT FROM OLD.job_id
        OR NEW.target IS DISTINCT FROM OLD.target
        OR NEW.source_sha256 IS DISTINCT FROM OLD.source_sha256
        OR NEW.source_size IS DISTINCT FROM OLD.source_size
        OR NEW.source_backup_job_id IS DISTINCT FROM OLD.source_backup_job_id
        OR NEW.backup_provenance IS DISTINCT FROM OLD.backup_provenance
        OR NEW.backup_provenance_envelope_sha256 IS DISTINCT FROM OLD.backup_provenance_envelope_sha256
        OR NEW.backup_provenance_key_id IS DISTINCT FROM OLD.backup_provenance_key_id
        OR NEW.expected_services_sha IS DISTINCT FROM OLD.expected_services_sha
        OR NEW.migration_manifest_sha IS DISTINCT FROM OLD.migration_manifest_sha
        OR NEW.requested_by_id IS DISTINCT FROM OLD.requested_by_id
        OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Database restore permit binding is immutable';
    END IF;
    IF OLD.status <> 'PENDING_APPROVAL' AND (
        NEW.approved_by_id IS DISTINCT FROM OLD.approved_by_id
        OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    ) THEN
        RAISE EXCEPTION 'Database restore permit approval evidence is immutable';
    END IF;
    IF OLD.status IN ('CONSUMED', 'CLOSED') AND
        NEW.consumed_at IS DISTINCT FROM OLD.consumed_at THEN
        RAISE EXCEPTION 'Database restore permit consumption evidence is immutable';
    END IF;
    IF OLD.status = 'CLOSED' AND (
        NEW.closed_at IS DISTINCT FROM OLD.closed_at
        OR NEW.close_reason IS DISTINCT FROM OLD.close_reason
        OR NEW.status IS DISTINCT FROM OLD.status
    ) THEN
        RAISE EXCEPTION 'Database restore closed permit is immutable';
    END IF;
    RETURN NEW;
END
$protect_restore_permit_binding$;

REVOKE ALL ON FUNCTION "operations"."protect_database_restore_permit_binding"() FROM PUBLIC;

CREATE FUNCTION "operations"."protect_database_restore_recovery_action_binding"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $protect_recovery_action_binding$
BEGIN
    IF OLD.status IN ('RESOLVED', 'BLOCKED', 'EXPIRED') AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'Database restore terminal recovery action is immutable';
    END IF;
    IF NEW.job_id IS DISTINCT FROM OLD.job_id
        OR NEW.action IS DISTINCT FROM OLD.action
        OR NEW.receipt_payload_sha IS DISTINCT FROM OLD.receipt_payload_sha
        OR NEW.requested_by_id IS DISTINCT FROM OLD.requested_by_id
        OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Database restore recovery action binding is immutable';
    END IF;
    IF OLD.status <> 'PENDING_APPROVAL' AND (
        NEW.approved_by_id IS DISTINCT FROM OLD.approved_by_id
        OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
        OR NEW.event_id IS DISTINCT FROM OLD.event_id
    ) THEN
        RAISE EXCEPTION 'Database restore recovery approval evidence is immutable';
    END IF;
    RETURN NEW;
END
$protect_recovery_action_binding$;

REVOKE ALL ON FUNCTION "operations"."protect_database_restore_recovery_action_binding"() FROM PUBLIC;

CREATE FUNCTION "operations"."protect_database_restore_recovery_resolution"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $protect_recovery_resolution$
BEGIN
    IF OLD.recovery_resolved_at IS NOT NULL
        AND NEW.recovery_resolved_at IS DISTINCT FROM OLD.recovery_resolved_at THEN
        RAISE EXCEPTION 'Database restore recovery resolution is immutable';
    END IF;
    RETURN NEW;
END
$protect_recovery_resolution$;

REVOKE ALL ON FUNCTION "operations"."protect_database_restore_recovery_resolution"() FROM PUBLIC;

CREATE FUNCTION "operations"."validate_database_restore_recovery_action_roles"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $validate_recovery_action_roles$
DECLARE
    restore_target TEXT;
    expected_roles JSONB;
BEGIN
    IF NEW.writer_fence_roles IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT restore_job.target INTO restore_target
    FROM operations.database_restore_jobs AS restore_job
    WHERE restore_job.id = NEW.job_id;
    expected_roles := CASE restore_target
        WHEN 'notification-delivery' THEN '["aerocrm_notification_delivery_runtime","aerocrm_notification_delivery_migration","aerocrm_notification_delivery_backup"]'::jsonb
        WHEN 'campaigns' THEN '["aerocrm_campaigns_runtime","aerocrm_campaigns_migration","aerocrm_campaigns_backup"]'::jsonb
        WHEN 'reporting' THEN '["aerocrm_reporting_runtime","aerocrm_reporting_migration","aerocrm_reporting_backup"]'::jsonb
        WHEN 'identity' THEN '["aerocrm_identity_runtime","aerocrm_identity_migration","aerocrm_identity_backup"]'::jsonb
        WHEN 'platform' THEN '["aerocrm_platform_runtime","aerocrm_platform_migration","aerocrm_platform_backup"]'::jsonb
        WHEN 'support' THEN '["aerocrm_support_runtime","aerocrm_support_migration","aerocrm_support_backup"]'::jsonb
        ELSE NULL
    END;
    IF expected_roles IS NULL OR NEW.writer_fence_roles <> expected_roles THEN
        RAISE EXCEPTION 'Database restore recovery action writer roles do not match target';
    END IF;
    RETURN NEW;
END
$validate_recovery_action_roles$;

REVOKE ALL ON FUNCTION "operations"."validate_database_restore_recovery_action_roles"() FROM PUBLIC;

CREATE TRIGGER "database_restore_jobs_immutable_provenance"
BEFORE UPDATE ON "operations"."database_restore_jobs"
FOR EACH ROW
EXECUTE FUNCTION "operations"."protect_database_restore_job_provenance"();

CREATE TRIGGER "database_restore_jobs_immutable_recovery_resolution"
BEFORE UPDATE OF "recovery_resolved_at" ON "operations"."database_restore_jobs"
FOR EACH ROW
EXECUTE FUNCTION "operations"."protect_database_restore_recovery_resolution"();

CREATE TRIGGER "database_restore_permits_immutable_binding"
BEFORE UPDATE ON "operations"."database_restore_permits"
FOR EACH ROW
EXECUTE FUNCTION "operations"."protect_database_restore_permit_binding"();

CREATE TRIGGER "database_restore_recovery_actions_exact_roles"
BEFORE INSERT OR UPDATE OF "writer_fence_roles", "job_id"
ON "operations"."database_restore_recovery_actions"
FOR EACH ROW
EXECUTE FUNCTION "operations"."validate_database_restore_recovery_action_roles"();

CREATE TRIGGER "database_restore_recovery_actions_immutable_binding"
BEFORE UPDATE ON "operations"."database_restore_recovery_actions"
FOR EACH ROW
EXECUTE FUNCTION "operations"."protect_database_restore_recovery_action_binding"();

CREATE TRIGGER "database_restore_recovery_receipts_immutable"
BEFORE UPDATE OR DELETE ON "operations"."database_restore_recovery_receipts"
FOR EACH ROW
EXECUTE FUNCTION "operations"."prevent_database_restore_terminal_receipt_mutation"();

CREATE TRIGGER "database_restore_release_authorizations_immutable"
BEFORE UPDATE OR DELETE ON "operations"."database_restore_release_authorizations"
FOR EACH ROW
EXECUTE FUNCTION "operations"."prevent_database_restore_release_authorization_mutation"();

CREATE TRIGGER "database_restore_terminal_receipts_immutable"
BEFORE UPDATE OR DELETE ON "operations"."database_restore_terminal_receipts"
FOR EACH ROW
EXECUTE FUNCTION "operations"."prevent_database_restore_terminal_receipt_mutation"();

ALTER DEFAULT PRIVILEGES IN SCHEMA "operations" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "operations" FROM PUBLIC;

REVOKE ALL ON TABLE "operations"."service_identity" FROM PUBLIC;

