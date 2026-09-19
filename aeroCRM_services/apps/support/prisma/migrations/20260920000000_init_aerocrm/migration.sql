-- Clean aeroCRM baseline for the current service-owned Prisma schema.
-- Additional SQL retains database guards that Prisma cannot represent.
BEGIN;

DO $$ BEGIN
    IF to_regnamespace('support') IS NULL OR (
        SELECT nspowner FROM pg_namespace WHERE oid = to_regnamespace('support')
    ) IS DISTINCT FROM to_regrole(CURRENT_USER) THEN
        RAISE EXCEPTION 'support schema must exist and be owned by the migration role';
    END IF;
END $$;

-- CreateSchema


-- CreateEnum
CREATE TYPE "support"."SupportInboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'RETRY_SCHEDULED', 'DELIVERED', 'DEAD_LETTERED', 'CLOSED_NO_RETRY', 'IGNORED');

-- CreateEnum
CREATE TYPE "support"."SupportInboxOutcome" AS ENUM ('USER_MESSAGE_FORWARDED', 'START_REPLIED', 'ADMIN_REPLY_DELIVERED', 'USER_MESSAGE_REJECTED', 'IGNORED_BOT', 'IGNORED_CHAT', 'IGNORED_UNMAPPED_REPLY');

-- CreateEnum
CREATE TYPE "support"."SupportMappingKind" AS ENUM ('USER_COPY', 'USER_CONTEXT');

-- CreateEnum
CREATE TYPE "support"."TelegramOutboundMethod" AS ENUM ('SEND_MESSAGE', 'COPY_MESSAGE');

-- CreateEnum
CREATE TYPE "support"."TelegramOutboundDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED');

-- CreateEnum
CREATE TYPE "support"."OutboxExchange" AS ENUM ('EVENTS', 'AUDIT', 'RETRY', 'MANUAL_RETRY', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "support"."OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "support"."ConsumerReceiptStatus" AS ENUM ('PROCESSING', 'RETRY_SCHEDULED', 'DELIVERED', 'DEAD_LETTERED', 'CLOSED_NO_RETRY');

-- CreateEnum
CREATE TYPE "support"."ConsumerFailureStatus" AS ENUM ('OPEN', 'RETRYING', 'RESOLVED', 'CLOSED_NO_RETRY');

-- CreateEnum
CREATE TYPE "support"."SupportConversationStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'RESOLVED');

-- CreateEnum
CREATE TYPE "support"."SupportSenderKind" AS ENUM ('CLIENT', 'OPERATOR');

-- CreateEnum
CREATE TYPE "support"."SupportAttachmentStatus" AS ENUM ('PREPARED', 'TEMPORARY', 'ATTACHED', 'DELETE_PENDING', 'DELETING', 'DELETED');

-- CreateTable
CREATE TABLE "support"."service_identity" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "service_name" TEXT NOT NULL DEFAULT 'support-service',
    "database_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support"."routing_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "admin_chat_id" TEXT NOT NULL DEFAULT '',
    "support_thread_id" INTEGER,
    "aggregate_version" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support"."telegram_webhook_inbox" (
    "id" UUID NOT NULL,
    "update_id" BIGINT NOT NULL,
    "body_hash" CHAR(64) NOT NULL,
    "raw_payload" BYTEA NOT NULL,
    "status" "support"."SupportInboxStatus" NOT NULL DEFAULT 'PENDING',
    "outcome" "support"."SupportInboxOutcome",
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMP(3),
    "last_error" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_webhook_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support"."telegram_outbound_deliveries" (
    "id" UUID NOT NULL,
    "inbox_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "method" "support"."TelegramOutboundMethod" NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "request" JSONB NOT NULL,
    "status" "support"."TelegramOutboundDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMP(3),
    "response_message_id" INTEGER,
    "last_error" TEXT,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_outbound_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support"."support_message_mappings" (
    "id" UUID NOT NULL,
    "inbox_id" UUID,
    "kind" "support"."SupportMappingKind" NOT NULL,
    "admin_chat_id" TEXT NOT NULL,
    "admin_message_id" INTEGER NOT NULL,
    "user_chat_id" TEXT NOT NULL,
    "telegram_user_id" TEXT,
    "username" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_message_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support"."outbox_events" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "deduplication_key" TEXT,
    "exchange" "support"."OutboxExchange" NOT NULL DEFAULT 'EVENTS',
    "event_type" TEXT NOT NULL,
    "routing_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL DEFAULT '{}',
    "aggregate_type" TEXT,
    "aggregate_id" TEXT,
    "aggregate_version" BIGINT,
    "status" "support"."OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support"."consumer_receipts" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "consumer" TEXT NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "status" "support"."ConsumerReceiptStatus" NOT NULL DEFAULT 'PROCESSING',
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "lock_token" UUID,
    "lease_expires_at" TIMESTAMP(3),
    "retry_attempt" INTEGER,
    "manual_retry_cycle" INTEGER NOT NULL DEFAULT 0,
    "delivered_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consumer_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support"."consumer_failures" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "consumer" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "routing_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL DEFAULT '{}',
    "payload_hash" CHAR(64) NOT NULL,
    "correlation_id" UUID NOT NULL,
    "status" "support"."ConsumerFailureStatus" NOT NULL DEFAULT 'OPEN',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "manual_retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT NOT NULL,
    "last_failed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retry_requested_at" TIMESTAMP(3),
    "retry_requested_by_id" TEXT,
    "retry_token" UUID,
    "retry_lease_expires_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "resolution_comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consumer_failures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support"."messaging_heartbeats" (
    "id" UUID NOT NULL,
    "service" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messaging_heartbeats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support"."web_conversations" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "author_subject" TEXT NOT NULL,
    "author_name" TEXT,
    "workspace_id" UUID,
    "company_name" TEXT,
    "subject" VARCHAR(160) NOT NULL,
    "status" "support"."SupportConversationStatus" NOT NULL DEFAULT 'NEW',
    "section" VARCHAR(32) NOT NULL,
    "app_version" VARCHAR(64) NOT NULL,
    "last_sequence" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support"."web_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_subject" TEXT NOT NULL,
    "sender_kind" "support"."SupportSenderKind" NOT NULL,
    "sender_name" TEXT,
    "text" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support"."web_commands" (
    "id" UUID NOT NULL,
    "actor_subject" TEXT NOT NULL,
    "command_id" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support"."web_read_states" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "reader_subject" TEXT NOT NULL,
    "through_sequence" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_read_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support"."web_attachments" (
    "id" UUID NOT NULL,
    "owner_subject" TEXT NOT NULL,
    "command_id" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "draft_id" UUID,
    "conversation_id" UUID,
    "message_id" UUID,
    "storage_key" TEXT NOT NULL,
    "file_name" VARCHAR(160) NOT NULL,
    "media_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "status" "support"."SupportAttachmentStatus" NOT NULL DEFAULT 'PREPARED',
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "delete_passes" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support"."web_notification_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "version" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "email_enabled" BOOLEAN NOT NULL DEFAULT false,
    "staff_emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "telegram_enabled" BOOLEAN NOT NULL DEFAULT false,
    "telegram_chat_id" TEXT,
    "telegram_thread_id" INTEGER,
    "client_email_enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support"."web_notification_intents" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "notification_type" TEXT NOT NULL,
    "recipient_subject" TEXT,
    "recipient_email" TEXT,
    "telegram_chat_id" TEXT,
    "telegram_thread_id" INTEGER,
    "settings_version" INTEGER NOT NULL,
    "group_key" CHAR(64) NOT NULL,
    "first_sequence" INTEGER NOT NULL,
    "last_sequence" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "outcome_event_id" UUID,
    "window_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_notification_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support"."web_rate_buckets" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_rate_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_webhook_inbox_update_id_key" ON "support"."telegram_webhook_inbox"("update_id");

-- CreateIndex
CREATE INDEX "telegram_webhook_inbox_status_lease_expires_at_created_at_idx" ON "support"."telegram_webhook_inbox"("status", "lease_expires_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_outbound_deliveries_idempotency_key_key" ON "support"."telegram_outbound_deliveries"("idempotency_key");

-- CreateIndex
CREATE INDEX "telegram_outbound_deliveries_inbox_id_created_at_idx" ON "support"."telegram_outbound_deliveries"("inbox_id", "created_at");

-- CreateIndex
CREATE INDEX "telegram_outbound_deliveries_status_lease_expires_at_idx" ON "support"."telegram_outbound_deliveries"("status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "support_message_mappings_user_chat_id_created_at_idx" ON "support"."support_message_mappings"("user_chat_id", "created_at");

-- CreateIndex
CREATE INDEX "support_message_mappings_inbox_id_idx" ON "support"."support_message_mappings"("inbox_id");

-- CreateIndex
CREATE UNIQUE INDEX "support_message_mappings_admin_chat_id_admin_message_id_key" ON "support"."support_message_mappings"("admin_chat_id", "admin_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_deduplication_key_key" ON "support"."outbox_events"("deduplication_key");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_created_at_idx" ON "support"."outbox_events"("status", "available_at", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_status_lease_expires_at_idx" ON "support"."outbox_events"("status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "outbox_events_published_at_idx" ON "support"."outbox_events"("published_at");

-- CreateIndex
CREATE INDEX "consumer_receipts_status_lease_expires_at_idx" ON "support"."consumer_receipts"("status", "lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "consumer_receipts_event_id_consumer_key" ON "support"."consumer_receipts"("event_id", "consumer");

-- CreateIndex
CREATE INDEX "consumer_failures_status_last_failed_at_idx" ON "support"."consumer_failures"("status", "last_failed_at");

-- CreateIndex
CREATE INDEX "consumer_failures_status_retry_lease_expires_at_idx" ON "support"."consumer_failures"("status", "retry_lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "consumer_failures_event_id_consumer_key" ON "support"."consumer_failures"("event_id", "consumer");

-- CreateIndex
CREATE INDEX "messaging_heartbeats_service_last_seen_at_idx" ON "support"."messaging_heartbeats"("service", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_heartbeats_service_instance_id_key" ON "support"."messaging_heartbeats"("service", "instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "web_conversations_number_key" ON "support"."web_conversations"("number");

-- CreateIndex
CREATE INDEX "web_conversations_author_subject_last_message_at_id_idx" ON "support"."web_conversations"("author_subject", "last_message_at", "id");

-- CreateIndex
CREATE INDEX "web_conversations_status_last_message_at_id_idx" ON "support"."web_conversations"("status", "last_message_at", "id");

-- CreateIndex
CREATE INDEX "web_messages_conversation_id_sender_kind_sequence_idx" ON "support"."web_messages"("conversation_id", "sender_kind", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "web_messages_conversation_id_sequence_key" ON "support"."web_messages"("conversation_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "web_commands_actor_subject_command_id_key" ON "support"."web_commands"("actor_subject", "command_id");

-- CreateIndex
CREATE UNIQUE INDEX "web_read_states_conversation_id_reader_subject_key" ON "support"."web_read_states"("conversation_id", "reader_subject");

-- CreateIndex
CREATE UNIQUE INDEX "web_attachments_storage_key_key" ON "support"."web_attachments"("storage_key");

-- CreateIndex
CREATE INDEX "web_attachments_status_expires_at_lease_expires_at_idx" ON "support"."web_attachments"("status", "expires_at", "lease_expires_at");

-- CreateIndex
CREATE INDEX "web_attachments_owner_subject_status_idx" ON "support"."web_attachments"("owner_subject", "status");

-- CreateIndex
CREATE UNIQUE INDEX "web_attachments_owner_subject_command_id_key" ON "support"."web_attachments"("owner_subject", "command_id");

-- CreateIndex
CREATE UNIQUE INDEX "web_notification_intents_event_id_key" ON "support"."web_notification_intents"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "web_notification_intents_group_key_key" ON "support"."web_notification_intents"("group_key");

-- CreateIndex
CREATE INDEX "web_notification_intents_conversation_id_created_at_idx" ON "support"."web_notification_intents"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "web_rate_buckets_expires_at_idx" ON "support"."web_rate_buckets"("expires_at");

-- AddForeignKey
ALTER TABLE "support"."telegram_outbound_deliveries" ADD CONSTRAINT "telegram_outbound_deliveries_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "support"."telegram_webhook_inbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support"."support_message_mappings" ADD CONSTRAINT "support_message_mappings_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "support"."telegram_webhook_inbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support"."web_messages" ADD CONSTRAINT "web_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "support"."web_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support"."web_read_states" ADD CONSTRAINT "web_read_states_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "support"."web_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support"."web_attachments" ADD CONSTRAINT "web_attachments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "support"."web_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support"."web_attachments" ADD CONSTRAINT "web_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "support"."web_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support"."web_notification_intents" ADD CONSTRAINT "web_notification_intents_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "support"."web_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "support"."service_identity" ALTER COLUMN "database_id" SET DEFAULT gen_random_uuid();

ALTER TABLE "support"."service_identity" ADD CONSTRAINT "service_identity_singleton_check" CHECK ("id" = 'singleton');

ALTER TABLE "support"."service_identity" ADD CONSTRAINT "service_identity_name_check" CHECK ("service_name" = 'support-service');

ALTER TABLE "support"."routing_settings" ADD CONSTRAINT "routing_settings_singleton_check" CHECK ("id" = 'singleton');

ALTER TABLE "support"."routing_settings" ADD CONSTRAINT "routing_settings_chat_check" CHECK (
        "admin_chat_id" = ''
        OR "admin_chat_id" ~ '^-?[1-9][0-9]*$'
        OR "admin_chat_id" ~ '^@[A-Za-z][A-Za-z0-9_]{4,31}$'
    );

ALTER TABLE "support"."routing_settings" ADD CONSTRAINT "routing_settings_thread_check" CHECK ("support_thread_id" IS NULL OR "support_thread_id" > 0);

ALTER TABLE "support"."routing_settings" ADD CONSTRAINT "routing_settings_pair_check" CHECK (
        ("admin_chat_id" = '' AND "support_thread_id" IS NULL)
        OR ("admin_chat_id" <> '' AND "support_thread_id" > 0)
    );

ALTER TABLE "support"."routing_settings" ADD CONSTRAINT "routing_settings_version_check" CHECK ("aggregate_version" >= 0);

ALTER TABLE "support"."telegram_webhook_inbox" ADD CONSTRAINT "telegram_webhook_inbox_update_check" CHECK ("update_id" >= 0);

ALTER TABLE "support"."telegram_webhook_inbox" ADD CONSTRAINT "telegram_webhook_inbox_hash_check" CHECK ("body_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "support"."telegram_webhook_inbox" ADD CONSTRAINT "telegram_webhook_inbox_payload_check" CHECK (octet_length("raw_payload") BETWEEN 1 AND 524288);

ALTER TABLE "support"."telegram_webhook_inbox" ADD CONSTRAINT "telegram_webhook_inbox_attempt_check" CHECK ("attempts" >= 0);

ALTER TABLE "support"."telegram_webhook_inbox" ADD CONSTRAINT "telegram_webhook_inbox_lease_check" CHECK (
        ("status" = 'PROCESSING' AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
        OR ("status" <> 'PROCESSING' AND "lease_token" IS NULL AND "lease_expires_at" IS NULL)
    );

ALTER TABLE "support"."telegram_webhook_inbox" ADD CONSTRAINT "telegram_webhook_inbox_outcome_check" CHECK (
        ("status" IN ('DELIVERED', 'IGNORED') AND "outcome" IS NOT NULL AND "processed_at" IS NOT NULL)
        OR ("status" = 'CLOSED_NO_RETRY' AND "processed_at" IS NOT NULL)
        OR ("status" NOT IN ('DELIVERED', 'IGNORED', 'CLOSED_NO_RETRY') AND "outcome" IS NULL AND "processed_at" IS NULL)
    );

ALTER TABLE "support"."support_message_mappings" ADD CONSTRAINT "support_message_mappings_message_check" CHECK ("admin_message_id" > 0);

ALTER TABLE "support"."support_message_mappings" ADD CONSTRAINT "support_message_mappings_chat_check" CHECK ("admin_chat_id" <> '' AND "user_chat_id" <> '');

ALTER TABLE "support"."telegram_outbound_deliveries" ADD CONSTRAINT "telegram_outbound_deliveries_key_check" CHECK (char_length("idempotency_key") BETWEEN 1 AND 255);

ALTER TABLE "support"."telegram_outbound_deliveries" ADD CONSTRAINT "telegram_outbound_deliveries_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "support"."telegram_outbound_deliveries" ADD CONSTRAINT "telegram_outbound_deliveries_attempt_check" CHECK ("attempts" >= 0);

ALTER TABLE "support"."telegram_outbound_deliveries" ADD CONSTRAINT "telegram_outbound_deliveries_request_check" CHECK (jsonb_typeof("request") = 'object');

ALTER TABLE "support"."telegram_outbound_deliveries" ADD CONSTRAINT "telegram_outbound_deliveries_state_check" CHECK (
        (
            "status" = 'PENDING'
            AND "lease_token" IS NULL
            AND "lease_expires_at" IS NULL
            AND "response_message_id" IS NULL
            AND "delivered_at" IS NULL
        )
        OR (
            "status" = 'PROCESSING'
            AND "lease_token" IS NOT NULL
            AND "lease_expires_at" IS NOT NULL
            AND "response_message_id" IS NULL
            AND "delivered_at" IS NULL
        )
        OR (
            "status" = 'DELIVERED'
            AND "lease_token" IS NULL
            AND "lease_expires_at" IS NULL
            AND "response_message_id" > 0
            AND "delivered_at" IS NOT NULL
        )
    );

ALTER TABLE "support"."outbox_events" ADD CONSTRAINT "outbox_events_attempt_check" CHECK ("attempts" >= 0);

ALTER TABLE "support"."outbox_events" ADD CONSTRAINT "outbox_events_lease_check" CHECK (
        (
            "status" = 'PROCESSING'
            AND "locked_at" IS NOT NULL
            AND "locked_by" IS NOT NULL
            AND "lease_token" IS NOT NULL
            AND "lease_expires_at" IS NOT NULL
            AND "published_at" IS NULL
        )
        OR (
            "status" = 'PENDING'
            AND "locked_at" IS NULL
            AND "locked_by" IS NULL
            AND "lease_token" IS NULL
            AND "lease_expires_at" IS NULL
            AND "published_at" IS NULL
        )
        OR (
            "status" = 'PUBLISHED'
            AND "locked_at" IS NULL
            AND "locked_by" IS NULL
            AND "lease_token" IS NULL
            AND "lease_expires_at" IS NULL
            AND "published_at" IS NOT NULL
        )
    );

ALTER TABLE "support"."outbox_events" ADD CONSTRAINT "outbox_events_aggregate_check" CHECK (
        ("aggregate_type" IS NULL AND "aggregate_id" IS NULL AND "aggregate_version" IS NULL)
        OR ("aggregate_type" IS NOT NULL AND "aggregate_id" IS NOT NULL)
    );

ALTER TABLE "support"."consumer_receipts" ADD CONSTRAINT "consumer_receipts_hash_check" CHECK ("payload_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "support"."consumer_receipts" ADD CONSTRAINT "consumer_receipts_attempt_check" CHECK (
        ("retry_attempt" IS NULL OR "retry_attempt" >= 0) AND "manual_retry_cycle" >= 0
    );

ALTER TABLE "support"."consumer_receipts" ADD CONSTRAINT "consumer_receipts_lease_check" CHECK (
        (
            "status" = 'PROCESSING'
            AND "locked_at" IS NOT NULL
            AND "locked_by" IS NOT NULL
            AND "lock_token" IS NOT NULL
            AND "lease_expires_at" IS NOT NULL
            AND "delivered_at" IS NULL
        )
        OR (
            "status" = 'RETRY_SCHEDULED'
            AND "locked_at" IS NULL
            AND "locked_by" IS NULL
            AND "lock_token" IS NOT NULL
            AND "lease_expires_at" IS NULL
            AND "delivered_at" IS NULL
        )
        OR (
            "status" IN ('DEAD_LETTERED', 'CLOSED_NO_RETRY')
            AND "locked_at" IS NULL
            AND "locked_by" IS NULL
            AND "lock_token" IS NULL
            AND "lease_expires_at" IS NULL
            AND "delivered_at" IS NULL
        )
        OR (
            "status" = 'DELIVERED'
            AND "locked_at" IS NULL
            AND "locked_by" IS NULL
            AND "lock_token" IS NULL
            AND "lease_expires_at" IS NULL
            AND "delivered_at" IS NOT NULL
        )
    );

ALTER TABLE "support"."consumer_failures" ADD CONSTRAINT "consumer_failures_hash_check" CHECK ("payload_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "support"."consumer_failures" ADD CONSTRAINT "consumer_failures_attempt_check" CHECK ("attempts" >= 0 AND "manual_retry_count" >= 0);

ALTER TABLE "support"."consumer_failures" ADD CONSTRAINT "consumer_failures_state_check" CHECK (
        (
            "status" = 'OPEN'
            AND "retry_token" IS NULL
            AND "retry_lease_expires_at" IS NULL
            AND "resolved_at" IS NULL
        )
        OR (
            "status" = 'RETRYING'
            AND "retry_requested_at" IS NOT NULL
            AND "retry_requested_by_id" IS NOT NULL
            AND "retry_token" IS NOT NULL
            AND "retry_lease_expires_at" IS NOT NULL
            AND "resolved_at" IS NULL
        )
        OR (
            "status" IN ('RESOLVED', 'CLOSED_NO_RETRY')
            AND "retry_token" IS NULL
            AND "retry_lease_expires_at" IS NULL
            AND "resolved_at" IS NOT NULL
        )
    );

ALTER TABLE "support"."messaging_heartbeats" ADD CONSTRAINT "messaging_heartbeats_service_check" CHECK ("service" IN ('support-api', 'support-worker', 'support-outbox-publisher'));

ALTER TABLE "support"."messaging_heartbeats" ADD CONSTRAINT "messaging_heartbeats_instance_check" CHECK (char_length("instance_id") BETWEEN 1 AND 255);

ALTER TABLE "support"."messaging_heartbeats" ADD CONSTRAINT "messaging_heartbeats_revision_check" CHECK (char_length("revision") BETWEEN 1 AND 255);

ALTER TABLE support.web_conversations ADD CONSTRAINT "web_conversation_content_check" CHECK (
  length(btrim(subject)) BETWEEN 1 AND 160 AND last_sequence >= 0 AND version >= 0
  AND section IN ('inbox','customers','deals','planner','settings','other')
  AND app_version ~ '^[A-Za-z0-9._+-]{1,64}$'
);

ALTER TABLE support.web_messages ADD CONSTRAINT "web_message_content_check" CHECK (
  sequence > 0 AND length(btrim(text)) BETWEEN 1 AND 10000
);

ALTER TABLE support.web_read_states ADD CONSTRAINT "web_read_sequence_check" CHECK (through_sequence >= 0);

ALTER TABLE support.web_commands ADD CONSTRAINT "web_command_status_check" CHECK (status IN ('PENDING','COMPLETED'));

ALTER TABLE support.web_attachments ADD CONSTRAINT "web_attachment_content_check" CHECK (
  byte_size BETWEEN 1 AND 5242880 AND width > 0 AND height > 0
  AND width::bigint * height <= 40000000
  AND media_type IN ('image/png','image/jpeg','image/webp')
  AND storage_key ~ '^support/attachments/[0-9a-f-]{36}$'
  AND (status <> 'ATTACHED' OR (message_id IS NOT NULL AND conversation_id IS NOT NULL AND draft_id IS NULL))
  AND (message_id IS NULL OR status='ATTACHED')
);

ALTER TABLE support.web_notification_settings ADD CONSTRAINT "web_settings_check" CHECK (
  id='singleton' AND version>=0 AND cardinality(staff_emails)<=10
  AND (NOT email_enabled OR cardinality(staff_emails)>0)
  AND ((telegram_chat_id IS NULL AND telegram_thread_id IS NULL)
       OR (telegram_chat_id ~ '^-[1-9][0-9]{0,19}$' AND telegram_thread_id>0))
  AND (NOT telegram_enabled OR (telegram_chat_id IS NOT NULL AND telegram_thread_id IS NOT NULL))
);

ALTER TABLE support.web_notification_intents ADD CONSTRAINT "web_intent_check" CHECK (
  kind IN ('support-team-email','support-team-telegram','support-client-email')
  AND notification_type IN ('NEW_CONVERSATION','CLIENT_MESSAGE','OPERATOR_REPLY')
  AND status IN ('PENDING','DELIVERED','FAILED','SKIPPED')
  AND first_sequence>0 AND last_sequence>=first_sequence AND settings_version>=0
);

CREATE FUNCTION "support"."enforce_service_identity_integrity"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, support
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'Support service identity cannot be deleted';
    END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id"
        OR NEW."service_name" IS DISTINCT FROM OLD."service_name"
        OR NEW."database_id" IS DISTINCT FROM OLD."database_id"
        OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
        OR NEW."updated_at" < OLD."updated_at" THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'Support database identity marker is immutable';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION support.enforce_service_identity_integrity() FROM PUBLIC;

CREATE FUNCTION support.notify_live_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE current_scope text; previous_scope text;
BEGIN
 IF TG_OP = 'UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN RETURN NULL; END IF;
 IF TG_OP <> 'DELETE' THEN current_scope := to_jsonb(NEW)->>TG_ARGV[0]; END IF;
 IF TG_OP <> 'INSERT' THEN previous_scope := to_jsonb(OLD)->>TG_ARGV[0]; END IF;
 IF current_scope IS NOT NULL THEN PERFORM pg_notify('crm_live_changes_v1', current_scope); END IF;
 IF previous_scope IS NOT NULL AND previous_scope IS DISTINCT FROM current_scope THEN
  PERFORM pg_notify('crm_live_changes_v1', previous_scope);
 END IF;
 RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION support.notify_live_change() FROM PUBLIC;

CREATE FUNCTION support.notify_live_read() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE recipient text;
BEGIN
 IF TG_OP = 'UPDATE' AND OLD.through_sequence = NEW.through_sequence THEN RETURN NULL; END IF;
 SELECT author_subject INTO recipient FROM support.web_conversations WHERE id = NEW.conversation_id;
 IF recipient IS NOT NULL THEN PERFORM pg_notify('crm_live_changes_v1', recipient); END IF;
 RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION support.notify_live_read() FROM PUBLIC;

INSERT INTO "support"."service_identity" ("id", "service_name", "database_id", "updated_at")
VALUES ('singleton', 'support-service', gen_random_uuid(), CURRENT_TIMESTAMP);
INSERT INTO "support"."routing_settings" ("id", "updated_at") VALUES ('singleton', CURRENT_TIMESTAMP);

CREATE TRIGGER "service_identity_integrity_guard"
BEFORE UPDATE OR DELETE ON "support"."service_identity"
FOR EACH ROW
EXECUTE FUNCTION "support"."enforce_service_identity_integrity"();

CREATE TRIGGER web_conversations_live_change AFTER INSERT OR UPDATE OR DELETE ON support.web_conversations
FOR EACH ROW EXECUTE FUNCTION support.notify_live_change('author_subject');

CREATE TRIGGER web_read_states_live_change AFTER INSERT OR UPDATE ON support.web_read_states
FOR EACH ROW EXECUTE FUNCTION support.notify_live_read();

ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA "support" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "support" FROM PUBLIC;

COMMIT;
