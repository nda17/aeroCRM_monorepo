-- Clean aeroCRM baseline for the current service-owned Prisma schema.
-- Additional SQL retains database guards that Prisma cannot represent.
BEGIN;

DO $$ BEGIN
    IF to_regnamespace('identity') IS NULL OR (
        SELECT nspowner FROM pg_namespace WHERE oid = to_regnamespace('identity')
    ) IS DISTINCT FROM to_regrole(CURRENT_USER) THEN
        RAISE EXCEPTION 'identity schema must exist and be owned by the migration role';
    END IF;
END $$;

-- CreateSchema


-- CreateEnum
CREATE TYPE "identity"."Role" AS ENUM ('USER', 'ADMIN', 'DEV');

-- CreateEnum
CREATE TYPE "identity"."UserStatus" AS ENUM ('ACTIVE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "identity"."WorkspaceType" AS ENUM ('PERSONAL', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "identity"."WorkspaceStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "identity"."WorkspaceMemberRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "identity"."WorkspaceMemberStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "identity"."AuthIdentityType" AS ENUM ('EMAIL', 'PHONE', 'GOOGLE', 'YANDEX', 'VK');

-- CreateEnum
CREATE TYPE "identity"."VerificationChallengeType" AS ENUM ('EMAIL', 'PHONE', 'TELEGRAM');

-- CreateEnum
CREATE TYPE "identity"."VerificationChallengePurpose" AS ENUM ('REGISTER', 'BIND_IDENTITY', 'BIND_TELEGRAM_NOTIFICATIONS', 'LOGIN');

-- CreateEnum
CREATE TYPE "identity"."OAuthProvider" AS ENUM ('GOOGLE', 'YANDEX', 'VK');

-- CreateEnum
CREATE TYPE "identity"."OutboxExchange" AS ENUM ('EVENTS', 'AUDIT', 'RETRY', 'MANUAL_RETRY', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "identity"."OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "identity"."AvatarMediaObjectStatus" AS ENUM ('PREPARED', 'ACTIVE', 'DELETE_PENDING', 'DELETING');

-- CreateEnum
CREATE TYPE "identity"."ConsumerReceiptStatus" AS ENUM ('PROCESSING', 'RETRY_SCHEDULED', 'DELIVERED', 'DEAD_LETTERED', 'CLOSED_NO_RETRY');

-- CreateEnum
CREATE TYPE "identity"."ConsumerFailureStatus" AS ENUM ('OPEN', 'RETRYING', 'RESOLVED', 'CLOSED_NO_RETRY');

-- CreateEnum
CREATE TYPE "identity"."TelegramBotKind" AS ENUM ('INFO');

-- CreateEnum
CREATE TYPE "identity"."WebhookReceiptStatus" AS ENUM ('PROCESSING', 'DELIVERED', 'FAILED');

-- CreateTable
CREATE TABLE "identity"."users" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "password" TEXT NOT NULL,
    "avatar_path" TEXT,
    "status" "identity"."UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "personal_data_consent_revoked_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "rights" "identity"."Role"[] DEFAULT ARRAY['USER']::"identity"."Role"[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."user_sessions" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "previous_refresh_token_hash" TEXT,
    "refresh_rotated_at" TIMESTAMP(3),
    "user_agent" VARCHAR(500),
    "ip_address" VARCHAR(128),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."workspaces" (
    "id" UUID NOT NULL,
    "type" "identity"."WorkspaceType" NOT NULL DEFAULT 'PERSONAL',
    "status" "identity"."WorkspaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "personal_owner_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."workspace_members" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "identity"."WorkspaceMemberRole" NOT NULL DEFAULT 'MEMBER',
    "status" "identity"."WorkspaceMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_product" VARCHAR(32),
    "created_by_invitation_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."workspace_invitations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "product_code" VARCHAR(32) NOT NULL DEFAULT 'AEROCRM',
    "inviter_subject" VARCHAR(256) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "accepted_subject" VARCHAR(256),
    "acceptance_id" UUID,
    "accepted_membership_id" UUID,
    "email_verified_at" TIMESTAMP(3),
    "notification_event_id" UUID,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."auth_identities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "identity"."AuthIdentityType" NOT NULL,
    "value" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."telegram_notification_channels" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "telegram_user_id" TEXT,
    "username" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_notification_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."verification_challenges" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "type" "identity"."VerificationChallengeType" NOT NULL,
    "purpose" "identity"."VerificationChallengePurpose" NOT NULL,
    "value" TEXT NOT NULL,
    "password_hash" TEXT,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "telegram_user_id" TEXT,
    "telegram_chat_id" TEXT,
    "telegram_username" TEXT,
    "telegram_first_name" TEXT,
    "telegram_last_name" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "email_delivery_managed" BOOLEAN NOT NULL DEFAULT false,
    "email_resend_available_at" TIMESTAMP(3),
    "delivery_lease_token" UUID,
    "delivery_lease_expires_at" TIMESTAMP(3),

    CONSTRAINT "verification_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."verification_email_attempts" (
    "id" UUID NOT NULL,
    "challenge_id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "password_hash" TEXT,
    "outcome" VARCHAR(16) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_email_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."email_password_recoveries" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "auth_identity_id" TEXT NOT NULL,
    "identity_value" TEXT NOT NULL,
    "identity_verified_at" TIMESTAMP(3),
    "password_hash" TEXT NOT NULL,
    "base_password_hash" TEXT NOT NULL,
    "outcome" VARCHAR(16) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumed_at" TIMESTAMP(3),

    CONSTRAINT "email_password_recoveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."login_otp_challenges" (
    "id" UUID NOT NULL,
    "purpose" VARCHAR(32) NOT NULL DEFAULT 'LOGIN_FALLBACK',
    "channel" VARCHAR(8) NOT NULL,
    "user_id" TEXT,
    "auth_identity_id" TEXT,
    "identity_verified_at" TIMESTAMP(3),
    "destination_hash" CHAR(64) NOT NULL,
    "browser_token_hash" CHAR(64) NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."login_otp_rate_limits" (
    "key" CHAR(64) NOT NULL,
    "count" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "login_otp_rate_limits_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "identity"."auth_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "turnstile_enabled" BOOLEAN NOT NULL DEFAULT true,
    "google_auth_enabled" BOOLEAN NOT NULL DEFAULT true,
    "yandex_auth_enabled" BOOLEAN NOT NULL DEFAULT true,
    "vk_auth_enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."oauth_authorizations" (
    "state_hash" CHAR(64) NOT NULL,
    "provider" "identity"."OAuthProvider" NOT NULL,
    "code_verifier" TEXT NOT NULL,
    "referrer_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_authorizations_pkey" PRIMARY KEY ("state_hash")
);

-- CreateTable
CREATE TABLE "identity"."service_identity" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "service_name" TEXT NOT NULL DEFAULT 'identity-service',
    "database_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."aggregate_versions" (
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "version" BIGINT NOT NULL,
    "source_sequence" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aggregate_versions_pkey" PRIMARY KEY ("aggregate_type","aggregate_id")
);

-- CreateTable
CREATE TABLE "identity"."source_sequences" (
    "id" TEXT NOT NULL,
    "last_value" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."outbox_events" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "deduplication_key" TEXT,
    "exchange" "identity"."OutboxExchange" NOT NULL DEFAULT 'EVENTS',
    "event_type" TEXT NOT NULL,
    "routing_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL DEFAULT '{}',
    "aggregate_type" TEXT,
    "aggregate_id" TEXT,
    "aggregate_version" BIGINT,
    "source_sequence" BIGINT,
    "status" "identity"."OutboxStatus" NOT NULL DEFAULT 'PENDING',
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
CREATE TABLE "identity"."avatar_media_objects" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "object_key" VARCHAR(500) NOT NULL,
    "public_url" VARCHAR(2000) NOT NULL,
    "status" "identity"."AvatarMediaObjectStatus" NOT NULL DEFAULT 'PREPARED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "delete_passes" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "avatar_media_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."consumer_receipts" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "consumer" TEXT NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "status" "identity"."ConsumerReceiptStatus" NOT NULL DEFAULT 'PROCESSING',
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
CREATE TABLE "identity"."consumer_failures" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "consumer" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "routing_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL DEFAULT '{}',
    "payload_hash" CHAR(64) NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "status" "identity"."ConsumerFailureStatus" NOT NULL DEFAULT 'OPEN',
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
CREATE TABLE "identity"."internal_command_receipts" (
    "id" UUID NOT NULL,
    "client" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "internal_command_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."telegram_update_receipts" (
    "bot_kind" "identity"."TelegramBotKind" NOT NULL,
    "update_id" BIGINT NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "status" "identity"."WebhookReceiptStatus" NOT NULL DEFAULT 'PROCESSING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_update_receipts_pkey" PRIMARY KEY ("bot_kind","update_id")
);

-- CreateTable
CREATE TABLE "identity"."heartbeats" (
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
CREATE INDEX "users_status_idx" ON "identity"."users"("status");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "identity"."users"("deleted_at");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_revoked_at_idx" ON "identity"."user_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "user_sessions_expires_at_idx" ON "identity"."user_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_personal_owner_user_id_key" ON "identity"."workspaces"("personal_owner_user_id");

-- CreateIndex
CREATE INDEX "workspaces_status_idx" ON "identity"."workspaces"("status");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_created_by_invitation_id_key" ON "identity"."workspace_members"("created_by_invitation_id");

-- CreateIndex
CREATE INDEX "workspace_members_user_id_status_idx" ON "identity"."workspace_members"("user_id", "status");

-- CreateIndex
CREATE INDEX "workspace_members_workspace_id_status_idx" ON "identity"."workspace_members"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key" ON "identity"."workspace_members"("workspace_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_invitations_acceptance_id_key" ON "identity"."workspace_invitations"("acceptance_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_invitations_notification_event_id_key" ON "identity"."workspace_invitations"("notification_event_id");

-- CreateIndex
CREATE INDEX "workspace_invitations_workspace_id_status_created_at_idx" ON "identity"."workspace_invitations"("workspace_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "auth_identities_user_id_idx" ON "identity"."auth_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identities_type_value_key" ON "identity"."auth_identities"("type", "value");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identities_user_id_type_key" ON "identity"."auth_identities"("user_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_notification_channels_user_id_key" ON "identity"."telegram_notification_channels"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_notification_channels_chat_id_key" ON "identity"."telegram_notification_channels"("chat_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_notification_channels_telegram_user_id_key" ON "identity"."telegram_notification_channels"("telegram_user_id");

-- CreateIndex
CREATE INDEX "telegram_notification_channels_is_active_idx" ON "identity"."telegram_notification_channels"("is_active");

-- CreateIndex
CREATE INDEX "verification_challenges_telegram_user_id_idx" ON "identity"."verification_challenges"("telegram_user_id");

-- CreateIndex
CREATE INDEX "verification_challenges_expires_at_idx" ON "identity"."verification_challenges"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "verification_challenges_user_id_type_purpose_key" ON "identity"."verification_challenges"("user_id", "type", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "verification_challenges_type_purpose_value_key" ON "identity"."verification_challenges"("type", "purpose", "value");

-- CreateIndex
CREATE INDEX "verification_email_attempts_challenge_id_created_at_idx" ON "identity"."verification_email_attempts"("challenge_id", "created_at");

-- CreateIndex
CREATE INDEX "verification_email_attempts_expires_at_id_idx" ON "identity"."verification_email_attempts"("expires_at", "id");

-- CreateIndex
CREATE INDEX "email_password_recoveries_user_id_created_at_idx" ON "identity"."email_password_recoveries"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "email_password_recoveries_expires_at_idx" ON "identity"."email_password_recoveries"("expires_at");

-- CreateIndex
CREATE INDEX "login_otp_challenges_expires_at_id_idx" ON "identity"."login_otp_challenges"("expires_at", "id");

-- CreateIndex
CREATE INDEX "login_otp_challenges_user_id_idx" ON "identity"."login_otp_challenges"("user_id");

-- CreateIndex
CREATE INDEX "login_otp_rate_limits_expires_at_key_idx" ON "identity"."login_otp_rate_limits"("expires_at", "key");

-- CreateIndex
CREATE INDEX "oauth_authorizations_expires_at_idx" ON "identity"."oauth_authorizations"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "service_identity_database_id_key" ON "identity"."service_identity"("database_id");

-- CreateIndex
CREATE INDEX "aggregate_versions_source_sequence_idx" ON "identity"."aggregate_versions"("source_sequence");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_deduplication_key_key" ON "identity"."outbox_events"("deduplication_key");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_created_at_idx" ON "identity"."outbox_events"("status", "available_at", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_status_lease_expires_at_idx" ON "identity"."outbox_events"("status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_aggregate_version_idx" ON "identity"."outbox_events"("aggregate_type", "aggregate_id", "aggregate_version");

-- CreateIndex
CREATE INDEX "outbox_events_source_sequence_idx" ON "identity"."outbox_events"("source_sequence");

-- CreateIndex
CREATE INDEX "outbox_events_published_at_idx" ON "identity"."outbox_events"("published_at");

-- CreateIndex
CREATE UNIQUE INDEX "avatar_media_objects_object_key_key" ON "identity"."avatar_media_objects"("object_key");

-- CreateIndex
CREATE UNIQUE INDEX "avatar_media_objects_public_url_key" ON "identity"."avatar_media_objects"("public_url");

-- CreateIndex
CREATE INDEX "avatar_media_objects_status_available_at_created_at_idx" ON "identity"."avatar_media_objects"("status", "available_at", "created_at");

-- CreateIndex
CREATE INDEX "avatar_media_objects_status_lease_expires_at_idx" ON "identity"."avatar_media_objects"("status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "avatar_media_objects_user_id_status_idx" ON "identity"."avatar_media_objects"("user_id", "status");

-- CreateIndex
CREATE INDEX "consumer_receipts_status_lease_expires_at_idx" ON "identity"."consumer_receipts"("status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "consumer_receipts_consumer_delivered_at_idx" ON "identity"."consumer_receipts"("consumer", "delivered_at");

-- CreateIndex
CREATE UNIQUE INDEX "consumer_receipts_event_id_consumer_key" ON "identity"."consumer_receipts"("event_id", "consumer");

-- CreateIndex
CREATE INDEX "consumer_failures_status_last_failed_at_idx" ON "identity"."consumer_failures"("status", "last_failed_at");

-- CreateIndex
CREATE INDEX "consumer_failures_status_retry_lease_expires_at_idx" ON "identity"."consumer_failures"("status", "retry_lease_expires_at");

-- CreateIndex
CREATE INDEX "consumer_failures_retry_requested_by_id_idx" ON "identity"."consumer_failures"("retry_requested_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "consumer_failures_event_id_consumer_key" ON "identity"."consumer_failures"("event_id", "consumer");

-- CreateIndex
CREATE UNIQUE INDEX "internal_command_receipts_client_command_idempotency_key_key" ON "identity"."internal_command_receipts"("client", "command", "idempotency_key");

-- CreateIndex
CREATE INDEX "telegram_update_receipts_status_lease_expires_at_idx" ON "identity"."telegram_update_receipts"("status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "heartbeats_role_last_seen_at_idx" ON "identity"."heartbeats"("role", "last_seen_at");

-- CreateIndex
CREATE INDEX "heartbeats_last_seen_at_idx" ON "identity"."heartbeats"("last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "heartbeats_role_instance_id_key" ON "identity"."heartbeats"("role", "instance_id");

-- AddForeignKey
ALTER TABLE "identity"."user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."workspaces" ADD CONSTRAINT "workspaces_personal_owner_user_id_fkey" FOREIGN KEY ("personal_owner_user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "identity"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."auth_identities" ADD CONSTRAINT "auth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."telegram_notification_channels" ADD CONSTRAINT "telegram_notification_channels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."verification_challenges" ADD CONSTRAINT "verification_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."verification_email_attempts" ADD CONSTRAINT "verification_email_attempts_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "identity"."verification_challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."email_password_recoveries" ADD CONSTRAINT "email_password_recoveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."login_otp_challenges" ADD CONSTRAINT "login_otp_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "identity"."service_identity" ALTER COLUMN "database_id" SET DEFAULT gen_random_uuid();

ALTER TABLE identity.workspace_members ADD CONSTRAINT workspace_members_created_by_invitation_id_fkey FOREIGN KEY (created_by_invitation_id) REFERENCES identity.workspace_invitations(id) ON DELETE RESTRICT;
ALTER TABLE identity.workspace_invitations ADD CONSTRAINT workspace_invitations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES identity.workspaces(id) ON DELETE RESTRICT;
ALTER TABLE identity.workspace_invitations ADD CONSTRAINT workspace_invitations_accepted_membership_id_fkey FOREIGN KEY (accepted_membership_id) REFERENCES identity.workspace_members(id) ON DELETE RESTRICT;

ALTER TABLE "identity"."users" ADD CONSTRAINT "users_rights_nonempty_check" CHECK (CARDINALITY("rights") > 0);

ALTER TABLE "identity"."outbox_events" ADD CONSTRAINT "outbox_events_aggregate_identity_check" CHECK (
    ("aggregate_type" IS NULL AND "aggregate_id" IS NULL AND "aggregate_version" IS NULL)
    OR
    ("aggregate_type" IS NOT NULL AND "aggregate_id" IS NOT NULL AND "aggregate_version" IS NOT NULL)
);

ALTER TABLE "identity"."service_identity" ADD CONSTRAINT "service_identity_singleton_check" CHECK (
        "id" = 'singleton' AND "service_name" = 'identity-service'
    );

ALTER TABLE "identity"."user_sessions" ADD CONSTRAINT "user_sessions_previous_refresh_pair_check" CHECK (
        ("previous_refresh_token_hash" IS NULL) = ("refresh_rotated_at" IS NULL)
    );

ALTER TABLE "identity"."workspaces" ADD CONSTRAINT "workspaces_personal_owner_check" CHECK (
        ("type" = 'PERSONAL' AND "personal_owner_user_id" IS NOT NULL)
        OR ("type" = 'ORGANIZATION' AND "personal_owner_user_id" IS NULL)
    );

ALTER TABLE identity.workspace_members ADD CONSTRAINT "workspace_members_version_check" CHECK (version > 0);

ALTER TABLE identity.workspace_members ADD CONSTRAINT "workspace_members_product_origin_check" CHECK (
    (created_by_product IS NULL AND created_by_invitation_id IS NULL)
    OR (created_by_product IS NOT NULL AND created_by_product = 'AEROCRM' AND created_by_invitation_id IS NOT NULL AND role = 'MEMBER')
  );

ALTER TABLE identity.workspace_invitations ADD CONSTRAINT "workspace_invitations_product_code_check" CHECK (product_code = 'AEROCRM');

ALTER TABLE identity.workspace_invitations ADD CONSTRAINT "workspace_invitations_email_check" CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254);

ALTER TABLE identity.workspace_invitations ADD CONSTRAINT "workspace_invitations_status_check" CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED'));

ALTER TABLE identity.workspace_invitations ADD CONSTRAINT "workspace_invitations_version_check" CHECK (version > 0);

ALTER TABLE identity.workspace_invitations ADD CONSTRAINT "workspace_invitations_acceptance_check" CHECK (
    (accepted_at IS NULL AND accepted_subject IS NULL AND acceptance_id IS NULL AND accepted_membership_id IS NULL AND email_verified_at IS NULL AND status <> 'ACCEPTED')
    OR (accepted_at IS NOT NULL AND accepted_subject IS NOT NULL AND acceptance_id IS NOT NULL AND accepted_membership_id IS NOT NULL AND email_verified_at IS NOT NULL AND status IN ('ACCEPTED', 'REVOKED'))
  );

ALTER TABLE identity.workspace_invitations ADD CONSTRAINT "workspace_invitations_revoke_check" CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL));

ALTER TABLE identity.workspace_invitations ADD CONSTRAINT "workspace_invitations_expiry_check" CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '7 days');

ALTER TABLE identity.login_otp_challenges ADD CONSTRAINT "login_otp_challenges_purpose_check" CHECK (purpose = 'LOGIN_FALLBACK');

ALTER TABLE identity.login_otp_challenges ADD CONSTRAINT "login_otp_challenges_channel_check" CHECK (channel IN ('EMAIL', 'SMS'));

ALTER TABLE identity.login_otp_challenges ADD CONSTRAINT "login_otp_challenges_destination_hash_check" CHECK (destination_hash ~ '^[a-f0-9]{64}$');

ALTER TABLE identity.login_otp_challenges ADD CONSTRAINT "login_otp_challenges_browser_token_hash_check" CHECK (browser_token_hash ~ '^[a-f0-9]{64}$');

ALTER TABLE identity.login_otp_challenges ADD CONSTRAINT "login_otp_challenges_attempts_check" CHECK (attempts BETWEEN 0 AND 5);

ALTER TABLE identity.login_otp_challenges ADD CONSTRAINT "login_otp_challenges_subject_check" CHECK (
    (user_id IS NULL AND auth_identity_id IS NULL AND identity_verified_at IS NULL)
    OR (user_id IS NOT NULL AND auth_identity_id IS NOT NULL AND identity_verified_at IS NOT NULL)
  );

ALTER TABLE identity.login_otp_challenges ADD CONSTRAINT "login_otp_challenges_expiry_check" CHECK (
    expires_at > created_at AND expires_at <= created_at + INTERVAL '5 minutes'
  );

ALTER TABLE identity.login_otp_rate_limits ADD CONSTRAINT "login_otp_rate_limits_key_check" CHECK (key ~ '^[a-f0-9]{64}$');

ALTER TABLE identity.login_otp_rate_limits ADD CONSTRAINT "login_otp_rate_limits_count_check" CHECK (count > 0);

ALTER TABLE identity.verification_email_attempts ADD CONSTRAINT "verification_email_attempts_outcome_check" CHECK (outcome IN ('SENDING', 'ACCEPTED', 'FAILED', 'UNKNOWN'));

ALTER TABLE identity.email_password_recoveries ADD CONSTRAINT "email_password_recoveries_outcome_check" CHECK (outcome IN ('SENDING', 'ACCEPTED', 'FAILED', 'UNKNOWN'));

ALTER TABLE "identity"."service_identity" ADD CONSTRAINT "service_identity_name_check" CHECK ("service_name" = 'identity-service');

CREATE UNIQUE INDEX "auth_identities_email_normalized_unique"
ON "identity"."auth_identities" (LOWER(BTRIM("value")))
WHERE "type" = 'EMAIL'::"identity"."AuthIdentityType";

CREATE FUNCTION "identity"."enforce_service_identity_integrity"() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, identity AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Service identity cannot be deleted' USING ERRCODE = '23514';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.service_name IS DISTINCT FROM OLD.service_name
        OR NEW.database_id IS DISTINCT FROM OLD.database_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.updated_at < OLD.updated_at THEN
        RAISE EXCEPTION 'Service database identity marker is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "identity"."enforce_service_identity_integrity"() FROM PUBLIC;

INSERT INTO "identity"."service_identity" ("id", "service_name", "database_id", "updated_at")
VALUES ('singleton', 'identity-service', gen_random_uuid(), CURRENT_TIMESTAMP);
INSERT INTO "identity"."auth_settings" ("id", "updated_at") VALUES ('singleton', CURRENT_TIMESTAMP);
INSERT INTO "identity"."source_sequences" ("id", "last_value", "updated_at") VALUES
('identity.user.changed.v1', 0, CURRENT_TIMESTAMP),
('billing.identity.changed.v1', 0, CURRENT_TIMESTAMP),
('admin.audit.identity.v1', 0, CURRENT_TIMESTAMP);

CREATE TRIGGER service_identity_integrity_guard BEFORE UPDATE OR DELETE ON "identity"."service_identity"
FOR EACH ROW EXECUTE FUNCTION "identity"."enforce_service_identity_integrity"();

ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA "identity" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "identity" FROM PUBLIC;

COMMIT;
