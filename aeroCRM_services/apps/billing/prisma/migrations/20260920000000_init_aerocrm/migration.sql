-- Clean aeroCRM Billing baseline: CRM commerce and owned projections only.
-- Prices and the 10-day trial policy are bootstrapped from CRM_* configuration after migration.
BEGIN;

DO $$ BEGIN
  IF to_regnamespace('billing') IS NULL OR (
    SELECT nspowner FROM pg_namespace WHERE oid = to_regnamespace('billing')
  ) IS DISTINCT FROM to_regrole(CURRENT_USER) THEN
    RAISE EXCEPTION 'billing schema must exist and be owned by the migration role';
  END IF;
END $$;

-- CreateSchema


-- CreateEnum
CREATE TYPE "billing"."OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "billing"."CrmEntitlementStatus" AS ENUM ('ACTIVE', 'GRACE', 'READ_ONLY', 'SUSPENDED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "billing"."DeliveryReceiptStatus" AS ENUM ('PROCESSING', 'RETRY_SCHEDULED', 'DELIVERED', 'DEAD_LETTERED', 'CLOSED_NO_RETRY', 'FAILED');

-- CreateEnum
CREATE TYPE "billing"."IntegrationErrorCategory" AS ENUM ('TRANSIENT', 'RATE_LIMIT', 'PERMANENT', 'AUTH_CONFIGURATION');

-- CreateEnum
CREATE TYPE "billing"."IntegrationFailureResolution" AS ENUM ('DELIVERED', 'CLOSED_NO_RETRY');

-- CreateEnum
CREATE TYPE "billing"."DeliveryFailureStatus" AS ENUM ('OPEN', 'RETRY_PENDING', 'RESOLVED');

-- CreateTable
CREATE TABLE "billing"."service_identity" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "service_name" TEXT NOT NULL DEFAULT 'billing-service',
    "database_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."source_sequences" (
    "id" TEXT NOT NULL,
    "next_value" BIGINT NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."identity_contact_projections" (
    "user_id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "status" TEXT NOT NULL,
    "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "telegram_chat_id" TEXT,
    "telegram_channel_active" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "tombstone" BOOLEAN NOT NULL DEFAULT false,
    "projection_version" BIGINT NOT NULL DEFAULT 0,
    "source_sequence" BIGINT NOT NULL DEFAULT 0,
    "last_event_id" TEXT,
    "source_created_at" TIMESTAMP(3),
    "source_updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identity_contact_projections_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "billing"."notification_routing_projections" (
    "id" TEXT NOT NULL,
    "telegram_chat_id" TEXT,
    "payments_thread_id" INTEGER,
    "projection_version" BIGINT NOT NULL DEFAULT 0,
    "source_sequence" BIGINT NOT NULL DEFAULT 0,
    "tombstone" BOOLEAN NOT NULL DEFAULT false,
    "last_event_id" TEXT,
    "source_updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_routing_projections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."offer_projections" (
    "id" TEXT NOT NULL DEFAULT 'offer',
    "content" TEXT,
    "sha256" TEXT,
    "consent_version" TEXT,
    "consent_text" TEXT,
    "source_updated_at" TIMESTAMP(3),
    "projection_version" BIGINT NOT NULL DEFAULT 0,
    "source_sequence" BIGINT NOT NULL DEFAULT 0,
    "tombstone" BOOLEAN NOT NULL DEFAULT false,
    "last_event_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offer_projections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."command_receipts" (
    "command_id" TEXT NOT NULL,
    "command_type" TEXT NOT NULL,
    "request_hash" CHAR(64) NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
    "request_hash_version" SMALLINT NOT NULL DEFAULT 0,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "command_receipts_pkey" PRIMARY KEY ("command_id")
);

-- CreateTable
CREATE TABLE "billing"."crm_commercial_policies" (
    "version" INTEGER NOT NULL,
    "monthly_price_minor" INTEGER NOT NULL,
    "yearly_price_minor" INTEGER NOT NULL,
    "additional_seat_monthly_price_minor" INTEGER NOT NULL,
    "additional_seat_yearly_price_minor" INTEGER NOT NULL,
    "included_seats" INTEGER NOT NULL,
    "trial_seat_limit" INTEGER NOT NULL,
    "trial_days" INTEGER NOT NULL,
    "grace_days" INTEGER NOT NULL,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_commercial_policies_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "billing"."crm_admin_day_grants" (
    "command_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "actor_role" VARCHAR(16) NOT NULL,
    "days" INTEGER NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "target" VARCHAR(32) NOT NULL,
    "period_id" UUID,
    "old_expires_at" TIMESTAMP(3) NOT NULL,
    "new_expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_admin_day_grants_pkey" PRIMARY KEY ("command_id")
);

-- CreateTable
CREATE TABLE "billing"."crm_entitlements" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "product_code" VARCHAR(32) NOT NULL DEFAULT 'AEROCRM',
    "plan_code" VARCHAR(32) NOT NULL DEFAULT 'TRIAL',
    "status" "billing"."CrmEntitlementStatus" NOT NULL DEFAULT 'ACTIVE',
    "seat_limit" INTEGER,
    "policy_version" INTEGER,
    "grace_until" TIMESTAMP(3),
    "trial_started_at" TIMESTAMP(3),
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_until" TIMESTAMP(3) NOT NULL,
    "provisioning_command_id" UUID NOT NULL,
    "provisioning_command_type" VARCHAR(64) NOT NULL,
    "activated_by_user_id" TEXT NOT NULL,
    "aggregate_version" BIGINT NOT NULL DEFAULT 1,
    "source_sequence" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."crm_commerce_accounts" (
    "workspace_id" UUID NOT NULL,
    "owner_subject" VARCHAR(256) NOT NULL,
    "version" BIGINT NOT NULL DEFAULT 1,
    "capacity_command_id" UUID,
    "capacity_fence" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_commerce_accounts_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "billing"."crm_commerce_commands" (
    "command_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "command_type" VARCHAR(64) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "expected_version" BIGINT NOT NULL,
    "capacity_fence" JSONB,
    "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    "order_id" UUID,
    "period_id" UUID,
    "result_version" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_commerce_commands_pkey" PRIMARY KEY ("command_id")
);

-- CreateTable
CREATE TABLE "billing"."crm_orders" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "owner_subject" VARCHAR(256) NOT NULL,
    "command_id" UUID NOT NULL,
    "capacity_command_id" UUID NOT NULL,
    "capacity_fence" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "kind" VARCHAR(32) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    "cycle" VARCHAR(16) NOT NULL,
    "total_seats" INTEGER NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'RUB',
    "policy_version" INTEGER NOT NULL,
    "price_snapshot" JSONB NOT NULL,
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "consent_version" VARCHAR(128),
    "consent_text" TEXT,
    "consented_at" TIMESTAMP(3),
    "customer_email" VARCHAR(320),
    "customer_phone" VARCHAR(32),
    "provider_payment_id" VARCHAR(128),
    "provider_idempotency_key" CHAR(64) NOT NULL,
    "provider_status" VARCHAR(32),
    "confirmation_url" TEXT,
    "checkout_expires_at" TIMESTAMP(3) NOT NULL,
    "succeeded_at" TIMESTAMP(3),
    "cancellation_reason" VARCHAR(128),
    "recurring_cycle_key" VARCHAR(256),
    "recurring_attempt" INTEGER NOT NULL DEFAULT 0,
    "expected_renewal_version" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."crm_paid_periods" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "cycle" VARCHAR(16) NOT NULL,
    "total_seats" INTEGER NOT NULL,
    "original_seats" INTEGER NOT NULL,
    "price_snapshot" JSONB NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "original_expires_at" TIMESTAMP(3) NOT NULL,
    "grace_until" TIMESTAMP(3) NOT NULL,
    "activation_notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_paid_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."crm_auto_renewals" (
    "workspace_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "owner_subject" VARCHAR(256) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    "cycle" VARCHAR(16) NOT NULL,
    "total_seats" INTEGER NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "price_snapshot" JSONB NOT NULL,
    "payment_method_ciphertext" TEXT NOT NULL,
    "payment_method_title" VARCHAR(256),
    "payment_method_last4" VARCHAR(4),
    "consent_version" VARCHAR(128) NOT NULL,
    "consent_text" TEXT NOT NULL,
    "consented_at" TIMESTAMP(3) NOT NULL,
    "next_charge_at" TIMESTAMP(3) NOT NULL,
    "retry_started_at" TIMESTAMP(3),
    "retry_attempt" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMP(3),
    "dispatch_pending" BOOLEAN NOT NULL DEFAULT false,
    "disabled_at" TIMESTAMP(3),
    "last_error_code" VARCHAR(128),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_auto_renewals_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "billing"."crm_auto_renewal_consents" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "event_type" VARCHAR(32) NOT NULL,
    "command_id" UUID NOT NULL,
    "renewal_version" INTEGER NOT NULL,
    "evidence" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_auto_renewal_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."crm_provider_operations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotency_key" CHAR(64) NOT NULL,
    "provider_payment_id" VARCHAR(128),
    "first_dispatch_at" TIMESTAMP(3),
    "dispatch_attempt" INTEGER NOT NULL DEFAULT 0,
    "retry_attempt" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_token" UUID,
    "lease_until" TIMESTAMP(3),
    "pending_event_id" UUID NOT NULL,
    "outbox_id" TEXT NOT NULL,
    "request_snapshot" JSONB NOT NULL,
    "last_error_code" VARCHAR(128),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_provider_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."crm_provider_deliveries" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "consumer" VARCHAR(64) NOT NULL,
    "operation_id" UUID,
    "payload_hash" CHAR(64) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'PROCESSING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "lease_token" UUID,
    "lease_until" TIMESTAMP(3),
    "last_error_code" VARCHAR(128),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_provider_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."crm_payment_receipts" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider_receipt_id" VARCHAR(128) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "type" VARCHAR(32),
    "fiscal_document_number" VARCHAR(128),
    "fiscal_storage_number" VARCHAR(128),
    "fiscal_attribute" VARCHAR(128),
    "registered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_payment_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."outbox_events" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "message_id" TEXT,
    "deduplication_key" TEXT,
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "aggregate_version" BIGINT,
    "source_sequence" BIGINT,
    "correlation_id" UUID,
    "exchange" TEXT NOT NULL DEFAULT 'aerocrm.events',
    "routing_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "delivery_attempt" INTEGER NOT NULL DEFAULT 0,
    "status" "billing"."OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_token" TEXT,
    "lease_until" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."integration_delivery_receipts" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "integration" TEXT NOT NULL,
    "status" "billing"."DeliveryReceiptStatus" NOT NULL DEFAULT 'PROCESSING',
    "locked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),
    "retry_attempt" INTEGER DEFAULT 0,
    "retry_available_at" TIMESTAMP(3),
    "retry_token" UUID,
    "claim_token" UUID,
    "lease_until" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_delivery_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."integration_delivery_failures" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "integration" TEXT NOT NULL,
    "routing_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT NOT NULL DEFAULT '',
    "category" "billing"."IntegrationErrorCategory",
    "normalized_code" TEXT,
    "safe_reason" TEXT,
    "http_status" INTEGER,
    "provider_code" TEXT,
    "retryable" BOOLEAN,
    "classification_version" INTEGER,
    "first_failed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retrying_at" TIMESTAMP(3),
    "active_retry_token" UUID,
    "resolved_at" TIMESTAMP(3),
    "resolution" "billing"."IntegrationFailureResolution",
    "resolution_comment" TEXT,
    "resolved_by_id" TEXT,
    "error_code" TEXT,
    "error_safe" TEXT,
    "status" "billing"."DeliveryFailureStatus" NOT NULL DEFAULT 'OPEN',
    "retry_outbox_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_delivery_failures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_identity_database_id_key" ON "billing"."service_identity"("database_id");

-- CreateIndex
CREATE INDEX "identity_contact_projections_status_idx" ON "billing"."identity_contact_projections"("status");

-- CreateIndex
CREATE INDEX "command_receipts_command_type_created_at_idx" ON "billing"."command_receipts"("command_type", "created_at");

-- CreateIndex
CREATE INDEX "crm_admin_day_grants_workspace_id_created_at_command_id_idx" ON "billing"."crm_admin_day_grants"("workspace_id", "created_at", "command_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_entitlements_workspace_id_key" ON "billing"."crm_entitlements"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_entitlements_provisioning_command_id_key" ON "billing"."crm_entitlements"("provisioning_command_id");

-- CreateIndex
CREATE INDEX "crm_entitlements_status_effective_until_idx" ON "billing"."crm_entitlements"("status", "effective_until");

-- CreateIndex
CREATE INDEX "crm_commerce_commands_workspace_id_created_at_idx" ON "billing"."crm_commerce_commands"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "crm_commerce_commands_command_id_workspace_id_actor_subject_key" ON "billing"."crm_commerce_commands"("command_id", "workspace_id", "actor_subject");

-- CreateIndex
CREATE UNIQUE INDEX "crm_orders_command_id_key" ON "billing"."crm_orders"("command_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_orders_provider_payment_id_key" ON "billing"."crm_orders"("provider_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_orders_provider_idempotency_key_key" ON "billing"."crm_orders"("provider_idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "crm_orders_recurring_cycle_key_key" ON "billing"."crm_orders"("recurring_cycle_key");

-- CreateIndex
CREATE INDEX "crm_orders_workspace_id_created_at_idx" ON "billing"."crm_orders"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_orders_status_checkout_expires_at_idx" ON "billing"."crm_orders"("status", "checkout_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "crm_orders_id_workspace_id_key" ON "billing"."crm_orders"("id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_paid_periods_order_id_key" ON "billing"."crm_paid_periods"("order_id");

-- CreateIndex
CREATE INDEX "crm_paid_periods_workspace_id_starts_at_idx" ON "billing"."crm_paid_periods"("workspace_id", "starts_at");

-- CreateIndex
CREATE INDEX "crm_paid_periods_activation_notified_at_starts_at_idx" ON "billing"."crm_paid_periods"("activation_notified_at", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "crm_paid_periods_id_workspace_id_key" ON "billing"."crm_paid_periods"("id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_paid_periods_order_id_workspace_id_key" ON "billing"."crm_paid_periods"("order_id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_auto_renewals_id_key" ON "billing"."crm_auto_renewals"("id");

-- CreateIndex
CREATE INDEX "crm_auto_renewals_status_next_charge_at_idx" ON "billing"."crm_auto_renewals"("status", "next_charge_at");

-- CreateIndex
CREATE INDEX "crm_auto_renewals_status_next_retry_at_idx" ON "billing"."crm_auto_renewals"("status", "next_retry_at");

-- CreateIndex
CREATE INDEX "crm_auto_renewal_consents_workspace_id_created_at_idx" ON "billing"."crm_auto_renewal_consents"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "crm_provider_operations_idempotency_key_key" ON "billing"."crm_provider_operations"("idempotency_key");

-- CreateIndex
CREATE INDEX "crm_provider_operations_status_available_at_idx" ON "billing"."crm_provider_operations"("status", "available_at");

-- CreateIndex
CREATE INDEX "crm_provider_deliveries_status_lease_until_idx" ON "billing"."crm_provider_deliveries"("status", "lease_until");

-- CreateIndex
CREATE UNIQUE INDEX "crm_provider_deliveries_event_id_consumer_key" ON "billing"."crm_provider_deliveries"("event_id", "consumer");

-- CreateIndex
CREATE UNIQUE INDEX "crm_payment_receipts_provider_receipt_id_key" ON "billing"."crm_payment_receipts"("provider_receipt_id");

-- CreateIndex
CREATE INDEX "crm_payment_receipts_workspace_id_created_at_idx" ON "billing"."crm_payment_receipts"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_event_id_key" ON "billing"."outbox_events"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_deduplication_key_key" ON "billing"."outbox_events"("deduplication_key");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_idx" ON "billing"."outbox_events"("status", "available_at");

-- CreateIndex
CREATE INDEX "integration_delivery_receipts_status_lease_until_idx" ON "billing"."integration_delivery_receipts"("status", "lease_until");

-- CreateIndex
CREATE INDEX "integration_delivery_receipts_integration_delivered_at_idx" ON "billing"."integration_delivery_receipts"("integration", "delivered_at");

-- CreateIndex
CREATE INDEX "integration_delivery_receipts_delivered_at_idx" ON "billing"."integration_delivery_receipts"("delivered_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_delivery_receipts_event_id_integration_key" ON "billing"."integration_delivery_receipts"("event_id", "integration");

-- CreateIndex
CREATE INDEX "integration_delivery_failures_status_created_at_idx" ON "billing"."integration_delivery_failures"("status", "created_at");

-- CreateIndex
CREATE INDEX "integration_delivery_failures_resolved_at_failed_at_idx" ON "billing"."integration_delivery_failures"("resolved_at", "failed_at");

-- CreateIndex
CREATE INDEX "integration_delivery_failures_integration_resolved_at_idx" ON "billing"."integration_delivery_failures"("integration", "resolved_at");

-- CreateIndex
CREATE INDEX "integration_delivery_failures_category_resolved_at_failed_a_idx" ON "billing"."integration_delivery_failures"("category", "resolved_at", "failed_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_delivery_failures_event_id_integration_key" ON "billing"."integration_delivery_failures"("event_id", "integration");

-- AddForeignKey
ALTER TABLE "billing"."crm_entitlements" ADD CONSTRAINT "crm_entitlements_policy_version_fkey" FOREIGN KEY ("policy_version") REFERENCES "billing"."crm_commercial_policies"("version") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "billing"."crm_commerce_accounts" ADD CONSTRAINT "crm_commerce_accounts_capacity_owner_fkey" FOREIGN KEY ("capacity_command_id", "workspace_id", "owner_subject") REFERENCES "billing"."crm_commerce_commands"("command_id", "workspace_id", "actor_subject") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."crm_commerce_commands" ADD CONSTRAINT "crm_commerce_commands_order_id_workspace_id_fkey" FOREIGN KEY ("order_id", "workspace_id") REFERENCES "billing"."crm_orders"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."crm_commerce_commands" ADD CONSTRAINT "crm_commerce_commands_period_id_workspace_id_fkey" FOREIGN KEY ("period_id", "workspace_id") REFERENCES "billing"."crm_paid_periods"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."crm_orders" ADD CONSTRAINT "crm_orders_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "billing"."crm_commerce_accounts"("workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."crm_orders" ADD CONSTRAINT "crm_orders_capacity_command_id_workspace_id_owner_subject_fkey" FOREIGN KEY ("capacity_command_id", "workspace_id", "owner_subject") REFERENCES "billing"."crm_commerce_commands"("command_id", "workspace_id", "actor_subject") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."crm_paid_periods" ADD CONSTRAINT "crm_paid_periods_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "billing"."crm_commerce_accounts"("workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."crm_paid_periods" ADD CONSTRAINT "crm_paid_periods_order_id_workspace_id_fkey" FOREIGN KEY ("order_id", "workspace_id") REFERENCES "billing"."crm_orders"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."crm_auto_renewals" ADD CONSTRAINT "crm_auto_renewals_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "billing"."crm_commerce_accounts"("workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."crm_auto_renewal_consents" ADD CONSTRAINT "crm_auto_renewal_consents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "billing"."crm_commerce_accounts"("workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."crm_provider_operations" ADD CONSTRAINT "crm_provider_operations_order_id_workspace_id_fkey" FOREIGN KEY ("order_id", "workspace_id") REFERENCES "billing"."crm_orders"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."crm_provider_deliveries" ADD CONSTRAINT "crm_provider_deliveries_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "billing"."crm_provider_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."crm_payment_receipts" ADD CONSTRAINT "crm_payment_receipts_order_id_workspace_id_fkey" FOREIGN KEY ("order_id", "workspace_id") REFERENCES "billing"."crm_orders"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing"."service_identity" ALTER COLUMN "database_id" SET DEFAULT gen_random_uuid();

ALTER TABLE billing.crm_admin_day_grants ADD CONSTRAINT crm_admin_day_grants_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES billing.crm_entitlements(workspace_id) ON DELETE RESTRICT;
ALTER TABLE billing.crm_admin_day_grants ADD CONSTRAINT crm_admin_day_grants_period_id_fkey FOREIGN KEY (period_id) REFERENCES billing.crm_paid_periods(id) ON DELETE RESTRICT;
ALTER TABLE billing.crm_admin_day_grants ADD CONSTRAINT crm_admin_day_grants_period_workspace_fkey FOREIGN KEY (period_id, workspace_id) REFERENCES billing.crm_paid_periods(id, workspace_id) ON DELETE RESTRICT;

ALTER TABLE "billing"."service_identity" ADD CONSTRAINT "service_identity_singleton_check" CHECK ("id" = 'singleton');

ALTER TABLE "billing"."service_identity" ADD CONSTRAINT "service_identity_name_check" CHECK ("service_name" = 'billing-service');

ALTER TABLE "billing"."source_sequences" ADD CONSTRAINT "source_sequences_positive_check" CHECK ("next_value" > 0);

ALTER TABLE "billing"."offer_projections" ADD CONSTRAINT "offer_projections_singleton_check" CHECK ("id" = 'offer');

ALTER TABLE "billing"."offer_projections" ADD CONSTRAINT "offer_projections_versions_check" CHECK ("projection_version" >= 0 AND "source_sequence" >= 0);

ALTER TABLE "billing"."offer_projections" ADD CONSTRAINT "offer_projections_sha_check" CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "billing"."outbox_events" ADD CONSTRAINT "outbox_events_attempt_check" CHECK ("attempt" >= 0 AND "delivery_attempt" >= 0);

ALTER TABLE "billing"."integration_delivery_receipts" ADD CONSTRAINT "integration_delivery_receipts_attempt_check" CHECK ("retry_attempt" IS NULL OR "retry_attempt" >= 0);

ALTER TABLE "billing"."integration_delivery_failures" ADD CONSTRAINT "integration_delivery_failures_attempt_check" CHECK ("attempts" >= 0);

ALTER TABLE "billing"."command_receipts" ADD CONSTRAINT "command_receipts_request_hash_check" CHECK (
    (
      "request_hash_version" = 0
      AND "request_hash" = '0000000000000000000000000000000000000000000000000000000000000000'
    )
    OR (
      "request_hash_version" = 1
      AND "request_hash" ~ '^[0-9a-f]{64}$'
    )
  );

ALTER TABLE "billing"."crm_entitlements" ADD CONSTRAINT "crm_entitlements_product_code_check" CHECK ("product_code" = 'AEROCRM');

ALTER TABLE "billing"."crm_entitlements" ADD CONSTRAINT "crm_entitlements_plan_code_check" CHECK (length(btrim("plan_code")) BETWEEN 1 AND 32);

ALTER TABLE "billing"."crm_entitlements" ADD CONSTRAINT "crm_entitlements_seat_limit_check" CHECK ("seat_limit" IS NULL OR "seat_limit" > 0);

ALTER TABLE "billing"."crm_entitlements" ADD CONSTRAINT "crm_entitlements_effective_window_check" CHECK ("effective_until" > "effective_from");

ALTER TABLE "billing"."crm_entitlements" ADD CONSTRAINT "crm_entitlements_trial_start_check" CHECK (
      (
        "plan_code" = 'TRIAL'
        AND "trial_started_at" IS NOT NULL
        AND "trial_started_at" = "effective_from"
      )
      OR (
        "plan_code" <> 'TRIAL'
        AND (
          "trial_started_at" IS NULL
          OR "trial_started_at" <= "effective_from"
        )
      )
    );

ALTER TABLE "billing"."crm_entitlements" ADD CONSTRAINT "crm_entitlements_activated_by_check" CHECK (
      length("activated_by_user_id") BETWEEN 1 AND 256
      AND "activated_by_user_id" = btrim("activated_by_user_id")
    );

ALTER TABLE "billing"."crm_entitlements" ADD CONSTRAINT "crm_entitlements_provisioning_command_type_check" CHECK (
      "provisioning_command_type" ~ '^[A-Z][A-Z0-9_]{0,63}$'
    );

ALTER TABLE "billing"."crm_commercial_policies" ADD CONSTRAINT "crm_commercial_policies_version_check" CHECK ("version" > 0);

ALTER TABLE "billing"."crm_commercial_policies" ADD CONSTRAINT "crm_commercial_policies_prices_check" CHECK (
    "monthly_price_minor" BETWEEN 1 AND 100000000
    AND "yearly_price_minor" BETWEEN 1 AND 100000000
    AND "additional_seat_monthly_price_minor" BETWEEN 1 AND 100000000
    AND "additional_seat_yearly_price_minor" BETWEEN 1 AND 100000000
  );

ALTER TABLE "billing"."crm_commercial_policies" ADD CONSTRAINT "crm_commercial_policies_seats_check" CHECK (
    "included_seats" BETWEEN 2 AND 10000 AND "trial_seat_limit" BETWEEN 2 AND 10000
  );

ALTER TABLE "billing"."crm_commercial_policies" ADD CONSTRAINT "crm_commercial_policies_lifecycle_check" CHECK ("trial_days" = 10 AND "grace_days" = 3);

ALTER TABLE "billing"."crm_commercial_policies" ADD CONSTRAINT "crm_commercial_policies_actor_check" CHECK (
    "created_by_user_id" IS NULL OR
    (length("created_by_user_id") BETWEEN 1 AND 256 AND "created_by_user_id" = btrim("created_by_user_id"))
  );

ALTER TABLE "billing"."crm_entitlements" ADD CONSTRAINT "crm_entitlements_policy_snapshot_check" CHECK (
    ("policy_version" IS NULL AND "grace_until" IS NULL)
    OR ("policy_version" IS NOT NULL AND "seat_limit" BETWEEN 2 AND 10000
      AND "seat_limit" IS NOT NULL AND "grace_until" IS NOT NULL
      AND "grace_until" = "effective_until" + INTERVAL '3 days')
  );

ALTER TABLE billing.crm_commerce_accounts ADD CONSTRAINT "crm_commerce_accounts_version_check" CHECK (version > 0);

ALTER TABLE billing.crm_commerce_accounts ADD CONSTRAINT "crm_commerce_accounts_owner_check" CHECK (length(owner_subject) BETWEEN 1 AND 256 AND owner_subject !~ '[[:space:][:cntrl:]]');

ALTER TABLE billing.crm_commerce_commands ADD CONSTRAINT "crm_commerce_commands_state_check" CHECK (status IN ('PENDING', 'COMMITTED', 'CANCELLED'));

ALTER TABLE billing.crm_commerce_commands ADD CONSTRAINT "crm_commerce_commands_type_check" CHECK (command_type IN ('AEROCRM_CHECKOUT', 'AEROCRM_SEAT_CHANGE', 'AEROCRM_DISABLE_RENEWAL', 'AEROCRM_CONFIRM_RENEWAL', 'AEROCRM_VERIFY_ORDER'));

ALTER TABLE billing.crm_commerce_commands ADD CONSTRAINT "crm_commerce_commands_hash_check" CHECK (request_hash ~ '^[a-f0-9]{64}$');

ALTER TABLE billing.crm_commerce_commands ADD CONSTRAINT "crm_commerce_commands_version_check" CHECK (expected_version >= 0 AND (result_version IS NULL OR result_version > 0));

ALTER TABLE billing.crm_commerce_commands ADD CONSTRAINT "crm_commerce_commands_actor_check" CHECK (length(actor_subject) BETWEEN 1 AND 256 AND actor_subject !~ '[[:space:][:cntrl:]]');

ALTER TABLE billing.crm_commerce_commands ADD CONSTRAINT "crm_commerce_commands_capacity_check" CHECK (
  (command_type IN ('AEROCRM_CHECKOUT','AEROCRM_SEAT_CHANGE')) = (capacity_fence IS NOT NULL) AND
  (capacity_fence IS NULL OR (
    jsonb_typeof(capacity_fence) = 'object' AND capacity_fence ?& ARRAY['operationId','requestHash','fenceRevision','targetSeats'] AND
    capacity_fence->>'operationId' = command_id::text AND capacity_fence->>'requestHash' = request_hash AND
    jsonb_typeof(capacity_fence->'fenceRevision') = 'number' AND capacity_fence->>'fenceRevision' ~ '^[1-9][0-9]*$' AND (capacity_fence->>'fenceRevision')::numeric BETWEEN 1 AND 2147483646 AND
    jsonb_typeof(capacity_fence->'targetSeats') = 'number' AND capacity_fence->>'targetSeats' ~ '^[1-9][0-9]*$' AND (capacity_fence->>'targetSeats')::numeric BETWEEN 2 AND 10000
  )) IS TRUE);

ALTER TABLE billing.crm_orders ADD CONSTRAINT "crm_orders_state_check" CHECK (status IN ('PENDING', 'SUCCEEDED', 'CANCELLED', 'UNKNOWN'));

ALTER TABLE billing.crm_orders ADD CONSTRAINT "crm_orders_kind_check" CHECK (kind IN ('ONE_TIME', 'RECURRING'));

ALTER TABLE billing.crm_orders ADD CONSTRAINT "crm_orders_cycle_check" CHECK (cycle IN ('MONTHLY', 'YEARLY'));

ALTER TABLE billing.crm_orders ADD CONSTRAINT "crm_orders_money_check" CHECK (amount_minor BETWEEN 1 AND 1000000000000 AND currency = 'RUB');

ALTER TABLE billing.crm_orders ADD CONSTRAINT "crm_orders_version_check" CHECK (version BETWEEN 1 AND 2147483646 AND policy_version > 0);

ALTER TABLE billing.crm_orders ADD CONSTRAINT "crm_orders_seats_check" CHECK (total_seats BETWEEN 2 AND 10000 AND total_seats >= (price_snapshot->>'includedSeats')::integer);

ALTER TABLE billing.crm_orders ADD CONSTRAINT "crm_orders_snapshot_check" CHECK (jsonb_typeof(price_snapshot) = 'object' AND price_snapshot ?& ARRAY['policyVersion','monthlyPriceMinor','yearlyPriceMinor','additionalSeatMonthlyPriceMinor','additionalSeatYearlyPriceMinor','includedSeats','graceDays']);

ALTER TABLE billing.crm_orders ADD CONSTRAINT "crm_orders_key_check" CHECK (provider_idempotency_key ~ '^[a-f0-9]{64}$');

ALTER TABLE billing.crm_orders ADD CONSTRAINT "crm_orders_consent_check" CHECK (NOT auto_renew OR (consent_version IS NOT NULL AND consent_text IS NOT NULL AND consented_at IS NOT NULL));

ALTER TABLE billing.crm_orders ADD CONSTRAINT "crm_orders_success_check" CHECK ((status = 'SUCCEEDED') = (succeeded_at IS NOT NULL));

ALTER TABLE billing.crm_orders ADD CONSTRAINT "crm_orders_attempt_check" CHECK (recurring_attempt BETWEEN 0 AND 2);

ALTER TABLE billing.crm_paid_periods ADD CONSTRAINT "crm_paid_periods_version_check" CHECK (version BETWEEN 1 AND 2147483646);

ALTER TABLE billing.crm_paid_periods ADD CONSTRAINT "crm_paid_periods_cycle_check" CHECK (cycle IN ('MONTHLY', 'YEARLY'));

ALTER TABLE billing.crm_paid_periods ADD CONSTRAINT "crm_paid_periods_seats_check" CHECK (total_seats BETWEEN 2 AND 10000 AND original_seats BETWEEN 2 AND 10000 AND total_seats >= (price_snapshot->>'includedSeats')::integer);

ALTER TABLE billing.crm_paid_periods ADD CONSTRAINT "crm_paid_periods_time_check" CHECK (starts_at < expires_at AND starts_at < original_expires_at AND grace_until >= expires_at);

ALTER TABLE billing.crm_auto_renewals ADD CONSTRAINT "crm_auto_renewals_version_check" CHECK (version BETWEEN 1 AND 2147483646);

ALTER TABLE billing.crm_auto_renewals ADD CONSTRAINT "crm_auto_renewals_state_check" CHECK (status IN ('ACTIVE', 'USER_DISABLED', 'TECHNICAL_PAUSE', 'PRICE_CONFIRMATION_REQUIRED', 'REVOKED'));

ALTER TABLE billing.crm_auto_renewals ADD CONSTRAINT "crm_auto_renewals_cycle_check" CHECK (cycle IN ('MONTHLY', 'YEARLY'));

ALTER TABLE billing.crm_auto_renewals ADD CONSTRAINT "crm_auto_renewals_money_check" CHECK (amount_minor BETWEEN 1 AND 1000000000000);

ALTER TABLE billing.crm_auto_renewals ADD CONSTRAINT "crm_auto_renewals_seats_check" CHECK (total_seats BETWEEN 2 AND 10000);

ALTER TABLE billing.crm_auto_renewals ADD CONSTRAINT "crm_auto_renewals_method_check" CHECK (payment_method_ciphertext LIKE 'v1:%' AND (payment_method_last4 IS NULL OR payment_method_last4 ~ '^[0-9]{4}$'));

ALTER TABLE billing.crm_auto_renewals ADD CONSTRAINT "crm_auto_renewals_attempt_check" CHECK (retry_attempt BETWEEN 0 AND 2);

ALTER TABLE billing.crm_auto_renewal_consents ADD CONSTRAINT "crm_auto_renewal_consents_version_check" CHECK (renewal_version BETWEEN 1 AND 2147483646);

ALTER TABLE billing.crm_auto_renewal_consents ADD CONSTRAINT "crm_auto_renewal_consents_event_check" CHECK (event_type IN ('ENABLED', 'DISABLED', 'PRICE_CONFIRMED', 'SEATS_CHANGED', 'PAUSED', 'REVOKED'));

ALTER TABLE billing.crm_provider_operations ADD CONSTRAINT "crm_provider_operations_state_check" CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'UNKNOWN', 'FAILED'));

ALTER TABLE billing.crm_provider_operations ADD CONSTRAINT "crm_provider_operations_kind_check" CHECK (kind IN ('CREATE', 'VERIFY', 'SYNC_RECEIPT'));

ALTER TABLE billing.crm_provider_operations ADD CONSTRAINT "crm_provider_operations_version_check" CHECK (version BETWEEN 1 AND 2147483646 AND dispatch_attempt >= 0 AND retry_attempt >= 0);

ALTER TABLE billing.crm_provider_operations ADD CONSTRAINT "crm_provider_operations_lease_check" CHECK ((lease_token IS NULL) = (lease_until IS NULL) AND (status = 'PROCESSING') = (lease_token IS NOT NULL AND lease_until IS NOT NULL));

ALTER TABLE billing.crm_provider_operations ADD CONSTRAINT "crm_provider_operations_key_check" CHECK (idempotency_key ~ '^[a-f0-9]{64}$');

ALTER TABLE billing.crm_provider_deliveries ADD CONSTRAINT "crm_provider_deliveries_state_check" CHECK (status IN ('PROCESSING', 'DELIVERED', 'RETRY_SCHEDULED', 'DEAD_LETTERED'));

ALTER TABLE billing.crm_provider_deliveries ADD CONSTRAINT "crm_provider_deliveries_version_check" CHECK (version BETWEEN 1 AND 2147483646);

ALTER TABLE billing.crm_provider_deliveries ADD CONSTRAINT "crm_provider_deliveries_hash_check" CHECK (payload_hash ~ '^[a-f0-9]{64}$');

ALTER TABLE billing.crm_provider_deliveries ADD CONSTRAINT "crm_provider_deliveries_lease_check" CHECK ((lease_token IS NULL) = (lease_until IS NULL) AND (status = 'PROCESSING') = (lease_token IS NOT NULL AND lease_until IS NOT NULL));

ALTER TABLE billing.crm_admin_day_grants ADD CONSTRAINT "crm_admin_day_grants_actor_subject_check" CHECK (length(actor_subject) BETWEEN 1 AND 256 AND actor_subject !~ '[[:space:][:cntrl:]]');

ALTER TABLE billing.crm_admin_day_grants ADD CONSTRAINT "crm_admin_day_grants_actor_role_check" CHECK (actor_role IN ('ADMIN', 'DEV'));

ALTER TABLE billing.crm_admin_day_grants ADD CONSTRAINT "crm_admin_day_grants_days_check" CHECK (days BETWEEN 1 AND 3650);

ALTER TABLE billing.crm_admin_day_grants ADD CONSTRAINT "crm_admin_day_grants_reason_check" CHECK (length(btrim(reason)) BETWEEN 3 AND 1000);

ALTER TABLE billing.crm_admin_day_grants ADD CONSTRAINT "crm_admin_day_grants_target_check" CHECK (target IN ('ENTITLEMENT', 'PAID_PERIOD'));

ALTER TABLE billing.crm_admin_day_grants ADD CONSTRAINT "crm_admin_day_grants_condition_1_check" CHECK ((target = 'PAID_PERIOD') = (period_id IS NOT NULL));

ALTER TABLE billing.crm_admin_day_grants ADD CONSTRAINT "crm_admin_day_grants_condition_2_check" CHECK (new_expires_at > old_expires_at);

CREATE FUNCTION "billing"."reject_crm_commercial_policy_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'aeroCRM commercial policy versions are immutable';
END;
$function$;

REVOKE ALL ON FUNCTION billing.reject_crm_commercial_policy_mutation() FROM PUBLIC;

CREATE FUNCTION billing.protect_aerocrm_commerce_evidence() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE snapshot jsonb; price_key text; amount numeric; purchase billing.crm_orders%ROWTYPE;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') OR (TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'crm_auto_renewal_consents') THEN
    RAISE EXCEPTION 'aeroCRM commerce evidence cannot be removed or rewritten';
  END IF;
  IF TG_TABLE_NAME IN ('crm_orders', 'crm_paid_periods', 'crm_auto_renewals') THEN
    snapshot := NEW.price_snapshot;
    IF jsonb_typeof(snapshot) IS DISTINCT FROM 'object' OR
      NOT snapshot ?& ARRAY['policyVersion','monthlyPriceMinor','yearlyPriceMinor','additionalSeatMonthlyPriceMinor','additionalSeatYearlyPriceMinor','includedSeats','graceDays'] OR
      (SELECT count(*) FROM jsonb_object_keys(snapshot)) <> 7 THEN
      RAISE EXCEPTION 'aeroCRM price snapshot is invalid';
    END IF;
    FOREACH price_key IN ARRAY ARRAY['policyVersion','monthlyPriceMinor','yearlyPriceMinor','additionalSeatMonthlyPriceMinor','additionalSeatYearlyPriceMinor','includedSeats','graceDays'] LOOP
      IF jsonb_typeof(snapshot->price_key) IS DISTINCT FROM 'number' OR (snapshot->>price_key) !~ '^(0|[1-9][0-9]*)$' THEN
        RAISE EXCEPTION 'aeroCRM price snapshot requires bounded integers';
      END IF;
    END LOOP;
    IF NOT ((snapshot->>'policyVersion')::numeric BETWEEN 1 AND 2147483646 AND
      (snapshot->>'monthlyPriceMinor')::numeric BETWEEN 1 AND 100000000 AND
      (snapshot->>'yearlyPriceMinor')::numeric BETWEEN 1 AND 100000000 AND
      (snapshot->>'additionalSeatMonthlyPriceMinor')::numeric BETWEEN 0 AND 100000000 AND
      (snapshot->>'additionalSeatYearlyPriceMinor')::numeric BETWEEN 0 AND 100000000 AND
      (snapshot->>'includedSeats')::numeric BETWEEN 2 AND 10000 AND
      (snapshot->>'graceDays')::numeric = 3 AND NEW.total_seats >= (snapshot->>'includedSeats')::numeric) THEN
      RAISE EXCEPTION 'aeroCRM price snapshot range is invalid';
    END IF;
    IF TG_TABLE_NAME IN ('crm_orders', 'crm_auto_renewals') THEN
      amount := CASE WHEN NEW.cycle = 'MONTHLY' THEN (snapshot->>'monthlyPriceMinor')::numeric ELSE (snapshot->>'yearlyPriceMinor')::numeric END +
        (NEW.total_seats - (snapshot->>'includedSeats')::numeric) *
        CASE WHEN NEW.cycle = 'MONTHLY' THEN (snapshot->>'additionalSeatMonthlyPriceMinor')::numeric ELSE (snapshot->>'additionalSeatYearlyPriceMinor')::numeric END;
      IF NEW.amount_minor IS DISTINCT FROM amount THEN RAISE EXCEPTION 'aeroCRM amount does not match purchase snapshot'; END IF;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'crm_orders' THEN
    IF NEW.policy_version <> (NEW.price_snapshot->>'policyVersion')::integer THEN RAISE EXCEPTION 'aeroCRM order policy binding mismatch'; END IF;
  END IF;
  IF TG_TABLE_NAME IN ('crm_paid_periods', 'crm_provider_operations') THEN
    SELECT * INTO STRICT purchase FROM billing.crm_orders WHERE id = NEW.order_id AND workspace_id = NEW.workspace_id;
    IF TG_TABLE_NAME = 'crm_paid_periods' THEN
      IF purchase.status <> 'SUCCEEDED' OR NEW.cycle <> purchase.cycle OR NEW.original_seats <> purchase.total_seats OR NEW.price_snapshot IS DISTINCT FROM purchase.price_snapshot THEN RAISE EXCEPTION 'aeroCRM period purchase binding mismatch'; END IF;
    END IF;
    IF TG_TABLE_NAME = 'crm_provider_operations' THEN
    IF (
      NEW.request_snapshot->>'orderId' IS DISTINCT FROM purchase.id::text OR
      NEW.request_snapshot->>'workspaceId' IS DISTINCT FROM purchase.workspace_id::text OR
      NEW.request_snapshot->>'kind' IS DISTINCT FROM NEW.kind OR
      NEW.request_snapshot->>'amountMinor' IS DISTINCT FROM purchase.amount_minor::text OR
      NEW.request_snapshot->>'currency' IS DISTINCT FROM purchase.currency OR
      NEW.request_snapshot->>'providerKey' IS DISTINCT FROM purchase.provider_idempotency_key::text OR
      NOT NEW.request_snapshot ?& ARRAY['returnUrl','paymentMethodCiphertext'] OR
      (NEW.kind = 'CREATE' AND purchase.kind = 'ONE_TIME' AND (jsonb_typeof(NEW.request_snapshot->'returnUrl') IS DISTINCT FROM 'string' OR NEW.request_snapshot->'paymentMethodCiphertext' IS DISTINCT FROM 'null'::jsonb)) OR
      (NEW.kind = 'CREATE' AND purchase.kind = 'RECURRING' AND (NEW.request_snapshot->'returnUrl' IS DISTINCT FROM 'null'::jsonb OR jsonb_typeof(NEW.request_snapshot->'paymentMethodCiphertext') IS DISTINCT FROM 'string' OR NEW.request_snapshot->>'paymentMethodCiphertext' NOT LIKE 'v1:%'))
    ) THEN RAISE EXCEPTION 'aeroCRM provider request binding mismatch'; END IF;
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'crm_orders' THEN
    IF OLD.provider_payment_id IS NOT NULL AND NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id THEN RAISE EXCEPTION 'aeroCRM verified provider binding is immutable'; END IF;
    IF OLD.status = 'SUCCEEDED' AND NEW.status <> 'SUCCEEDED' THEN RAISE EXCEPTION 'aeroCRM paid order is terminal'; END IF;
  END IF;
  IF TG_TABLE_NAME = 'crm_orders' AND
    (to_jsonb(NEW) - ARRAY['version','status','provider_payment_id','provider_status','confirmation_url','succeeded_at','cancellation_reason','updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['version','status','provider_payment_id','provider_status','confirmation_url','succeeded_at','cancellation_reason','updated_at']) THEN
    RAISE EXCEPTION 'aeroCRM order purchase snapshot is immutable';
  END IF;
  IF TG_TABLE_NAME = 'crm_provider_operations' AND
    (to_jsonb(NEW) - ARRAY['status','version','provider_payment_id','first_dispatch_at','dispatch_attempt','retry_attempt','available_at','lease_token','lease_until','pending_event_id','outbox_id','last_error_code','updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['status','version','provider_payment_id','first_dispatch_at','dispatch_attempt','retry_attempt','available_at','lease_token','lease_until','pending_event_id','outbox_id','last_error_code','updated_at']) THEN
    RAISE EXCEPTION 'aeroCRM provider request snapshot is immutable';
  END IF;
  IF TG_TABLE_NAME = 'crm_provider_operations' THEN
    IF OLD.first_dispatch_at IS NOT NULL AND NEW.first_dispatch_at IS DISTINCT FROM OLD.first_dispatch_at THEN RAISE EXCEPTION 'aeroCRM first dispatch evidence is immutable'; END IF;
    IF OLD.provider_payment_id IS NOT NULL AND NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id THEN RAISE EXCEPTION 'aeroCRM provider evidence binding is immutable'; END IF;
  END IF;
  IF TG_TABLE_NAME = 'crm_commerce_commands' AND
    (to_jsonb(NEW) - ARRAY['status','period_id','result_version','updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['status','period_id','result_version','updated_at']) THEN
    RAISE EXCEPTION 'aeroCRM command binding is immutable';
  END IF;
  IF TG_TABLE_NAME = 'crm_commerce_commands' THEN
    IF OLD.status <> 'PENDING' AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'aeroCRM terminal command cannot reopen'; END IF;
  END IF;
  IF TG_TABLE_NAME = 'crm_paid_periods' AND
    (to_jsonb(NEW) - ARRAY['version','total_seats','expires_at','grace_until','activation_notified_at','updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['version','total_seats','expires_at','grace_until','activation_notified_at','updated_at']) THEN
    RAISE EXCEPTION 'aeroCRM paid period purchase snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION billing.protect_aerocrm_commerce_evidence() FROM PUBLIC;

CREATE FUNCTION billing.protect_crm_admin_day_grants() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'aeroCRM administrative day grants are append-only';
END;
$$;

REVOKE ALL ON FUNCTION billing.protect_crm_admin_day_grants() FROM PUBLIC;

CREATE FUNCTION billing.protect_crm_admin_command_receipts() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, billing AS $$
BEGIN
  RAISE EXCEPTION 'aeroCRM command receipts are immutable' USING ERRCODE = '23514';
END;
$$;

REVOKE ALL ON FUNCTION billing.protect_crm_admin_command_receipts() FROM PUBLIC;

CREATE FUNCTION billing.enforce_service_identity_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, billing AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Billing service identity cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.service_name IS DISTINCT FROM OLD.service_name
    OR NEW.database_id IS DISTINCT FROM OLD.database_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'Billing database identity marker is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION billing.enforce_service_identity_integrity() FROM PUBLIC;

INSERT INTO billing.service_identity (id, service_name, database_id, updated_at)
VALUES ('singleton', 'billing-service', gen_random_uuid(), CURRENT_TIMESTAMP);
INSERT INTO billing.source_sequences (id, next_value, updated_at)
VALUES ('billing', 1, CURRENT_TIMESTAMP);

CREATE TRIGGER "crm_commercial_policies_append_only"
BEFORE UPDATE OR DELETE ON "billing"."crm_commercial_policies"
FOR EACH ROW EXECUTE FUNCTION "billing"."reject_crm_commercial_policy_mutation"();

CREATE TRIGGER "crm_commercial_policies_no_truncate"
BEFORE TRUNCATE ON "billing"."crm_commercial_policies"
FOR EACH STATEMENT EXECUTE FUNCTION "billing"."reject_crm_commercial_policy_mutation"();

CREATE TRIGGER crm_orders_evidence_protection BEFORE INSERT OR UPDATE OR DELETE ON billing.crm_orders
  FOR EACH ROW EXECUTE FUNCTION billing.protect_aerocrm_commerce_evidence();

CREATE TRIGGER crm_orders_no_truncate BEFORE TRUNCATE ON billing.crm_orders
  FOR EACH STATEMENT EXECUTE FUNCTION billing.protect_aerocrm_commerce_evidence();

CREATE TRIGGER crm_paid_periods_evidence_protection BEFORE INSERT OR UPDATE OR DELETE ON billing.crm_paid_periods
  FOR EACH ROW EXECUTE FUNCTION billing.protect_aerocrm_commerce_evidence();

CREATE TRIGGER crm_paid_periods_no_truncate BEFORE TRUNCATE ON billing.crm_paid_periods
  FOR EACH STATEMENT EXECUTE FUNCTION billing.protect_aerocrm_commerce_evidence();

CREATE TRIGGER crm_auto_renewal_consents_append_only BEFORE UPDATE OR DELETE ON billing.crm_auto_renewal_consents
  FOR EACH ROW EXECUTE FUNCTION billing.protect_aerocrm_commerce_evidence();

CREATE TRIGGER crm_auto_renewal_consents_no_truncate BEFORE TRUNCATE ON billing.crm_auto_renewal_consents
  FOR EACH STATEMENT EXECUTE FUNCTION billing.protect_aerocrm_commerce_evidence();

CREATE TRIGGER crm_provider_operations_evidence_protection BEFORE INSERT OR UPDATE OR DELETE ON billing.crm_provider_operations
  FOR EACH ROW EXECUTE FUNCTION billing.protect_aerocrm_commerce_evidence();

CREATE TRIGGER crm_provider_operations_no_truncate BEFORE TRUNCATE ON billing.crm_provider_operations
  FOR EACH STATEMENT EXECUTE FUNCTION billing.protect_aerocrm_commerce_evidence();

CREATE TRIGGER crm_commerce_commands_evidence_protection BEFORE UPDATE OR DELETE ON billing.crm_commerce_commands
  FOR EACH ROW EXECUTE FUNCTION billing.protect_aerocrm_commerce_evidence();

CREATE TRIGGER crm_commerce_commands_no_truncate BEFORE TRUNCATE ON billing.crm_commerce_commands
  FOR EACH STATEMENT EXECUTE FUNCTION billing.protect_aerocrm_commerce_evidence();

CREATE TRIGGER crm_auto_renewals_snapshot_validation BEFORE INSERT OR UPDATE ON billing.crm_auto_renewals
  FOR EACH ROW EXECUTE FUNCTION billing.protect_aerocrm_commerce_evidence();

CREATE TRIGGER crm_admin_day_grants_append_only BEFORE UPDATE OR DELETE ON billing.crm_admin_day_grants
  FOR EACH ROW EXECUTE FUNCTION billing.protect_crm_admin_day_grants();

CREATE TRIGGER crm_admin_day_grants_no_truncate BEFORE TRUNCATE ON billing.crm_admin_day_grants
  FOR EACH STATEMENT EXECUTE FUNCTION billing.protect_crm_admin_day_grants();

CREATE TRIGGER crm_admin_command_receipts_retention_guard BEFORE UPDATE OR DELETE ON billing.command_receipts
  FOR EACH ROW EXECUTE FUNCTION billing.protect_crm_admin_command_receipts();

CREATE TRIGGER crm_admin_command_receipts_no_truncate BEFORE TRUNCATE ON billing.command_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION billing.protect_crm_admin_command_receipts();

CREATE TRIGGER billing_service_identity_integrity_guard BEFORE UPDATE OR DELETE ON billing.service_identity
FOR EACH ROW EXECUTE FUNCTION billing.enforce_service_identity_integrity();

ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA "billing" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "billing" FROM PUBLIC;

COMMIT;
