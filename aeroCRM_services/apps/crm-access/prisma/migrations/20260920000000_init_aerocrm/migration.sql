-- Clean aeroCRM baseline for the current service-owned Prisma schema.
-- Additional SQL retains database guards that Prisma cannot represent.
BEGIN;

DO $$ BEGIN
    IF to_regnamespace('crm_access') IS NULL OR (
        SELECT nspowner FROM pg_namespace WHERE oid = to_regnamespace('crm_access')
    ) IS DISTINCT FROM to_regrole(CURRENT_USER) THEN
        RAISE EXCEPTION 'crm_access schema must exist and be owned by the migration role';
    END IF;
END $$;

-- CreateSchema


-- CreateEnum
CREATE TYPE "crm_access"."CrmMemberRole" AS ENUM ('CRM_ADMIN', 'TEAM_LEAD', 'MANAGER', 'ANALYST');

-- CreateEnum
CREATE TYPE "crm_access"."CrmAccessLifecycle" AS ENUM ('ONBOARDING', 'ACTIVE', 'READ_ONLY', 'SUSPENDED');

-- CreateTable
CREATE TABLE "crm_access"."service_identity" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "service_name" TEXT NOT NULL DEFAULT 'crm-access-service',
    "database_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_access"."crm_workspace_access" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "lifecycle" "crm_access"."CrmAccessLifecycle" NOT NULL DEFAULT 'ONBOARDING',
    "activated_by_subject" VARCHAR(256) NOT NULL,
    "billing_entitlement_id" UUID NOT NULL,
    "provisioning_command_id" UUID NOT NULL,
    "provisioning_command_type" VARCHAR(64) NOT NULL,
    "onboarding_command_id" UUID,
    "onboarding_template_key" VARCHAR(64),
    "onboarding_template_version" SMALLINT,
    "onboarding_template_fingerprint" CHAR(64),
    "onboarding_pipeline_id" UUID,
    "onboarding_completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_workspace_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_access"."crm_workspace_branding" (
    "workspace_id" UUID NOT NULL,
    "display_name" VARCHAR(40),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_workspace_branding_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "crm_access"."crm_workspace_members" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "subject" VARCHAR(256) NOT NULL,
    "membership_id" UUID NOT NULL,
    "role" "crm_access"."CrmMemberRole" NOT NULL,
    "disabled_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_access"."crm_employee_profiles" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "subject" VARCHAR(256) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "middle_name" VARCHAR(100),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_employee_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_access"."crm_teams" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_access"."crm_member_teams" (
    "workspace_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,

    CONSTRAINT "crm_member_teams_pkey" PRIMARY KEY ("member_id","team_id")
);

-- CreateTable
CREATE TABLE "crm_access"."crm_invitation_intents" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "first_name" VARCHAR(100),
    "last_name" VARCHAR(100),
    "middle_name" VARCHAR(100),
    "role" "crm_access"."CrmMemberRole" NOT NULL,
    "team_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "inviter_subject" VARCHAR(256) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'REGISTERING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "identity_version" INTEGER,
    "provisioning_command_id" UUID NOT NULL,
    "revoke_command_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_invitation_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_access"."crm_admissions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "intent_id" UUID,
    "source_acceptance_id" UUID,
    "member_id" UUID,
    "expected_member_version" INTEGER,
    "subject" VARCHAR(256) NOT NULL,
    "membership_id" UUID NOT NULL,
    "requested_by_subject" VARCHAR(256) NOT NULL,
    "position" BIGSERIAL NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'WAITING',
    "activated_at" TIMESTAMP(3),
    "cancellation_code" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_admissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_access"."crm_team_command_receipts" (
    "command_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "command_type" VARCHAR(64) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_team_command_receipts_pkey" PRIMARY KEY ("command_id")
);

-- CreateTable
CREATE TABLE "crm_access"."crm_team_audit" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "command_id" UUID NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "target_id" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_team_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_access"."crm_team_outbox" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "deduplication_key" VARCHAR(256) NOT NULL,
    "exchange" VARCHAR(64) NOT NULL DEFAULT 'aerocrm.events',
    "event_type" VARCHAR(100) NOT NULL,
    "routing_key" VARCHAR(150) NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "last_error" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_team_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_access"."crm_team_deliveries" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "consumer" VARCHAR(64) NOT NULL,
    "workspace_id" UUID,
    "payload_hash" CHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'PROCESSING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMP(3),
    "retry_attempt" INTEGER NOT NULL DEFAULT 0,
    "manual_retry_cycle" INTEGER NOT NULL DEFAULT 0,
    "delivered_at" TIMESTAMP(3),
    "last_error" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_team_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_access"."crm_billing_capacity" (
    "workspace_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "admission_ceiling" INTEGER,
    "pending_operation_id" UUID,
    "pending_target_seats" INTEGER,
    "latest_committed_operation_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_billing_capacity_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "crm_access"."crm_billing_operations" (
    "command_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "command_type" VARCHAR(64) NOT NULL,
    "request_hash" CHAR(64),
    "request" JSONB,
    "fence_revision" INTEGER,
    "target_seats" INTEGER,
    "state" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "release_fence" BOOLEAN NOT NULL DEFAULT false,
    "billing_version" VARCHAR(20),
    "hold_until" TIMESTAMP(3),
    "next_check_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proof" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_billing_operations_pkey" PRIMARY KEY ("command_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_identity_database_id_key" ON "crm_access"."service_identity"("database_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_workspace_access_workspace_id_key" ON "crm_access"."crm_workspace_access"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_workspace_access_billing_entitlement_id_key" ON "crm_access"."crm_workspace_access"("billing_entitlement_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_workspace_access_provisioning_command_id_key" ON "crm_access"."crm_workspace_access"("provisioning_command_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_workspace_access_onboarding_command_id_key" ON "crm_access"."crm_workspace_access"("onboarding_command_id");

-- CreateIndex
CREATE INDEX "crm_workspace_access_lifecycle_updated_at_idx" ON "crm_access"."crm_workspace_access"("lifecycle", "updated_at");

-- CreateIndex
CREATE INDEX "crm_workspace_members_workspace_id_disabled_at_idx" ON "crm_access"."crm_workspace_members"("workspace_id", "disabled_at");

-- CreateIndex
CREATE UNIQUE INDEX "crm_workspace_members_workspace_id_subject_key" ON "crm_access"."crm_workspace_members"("workspace_id", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "crm_workspace_members_workspace_id_membership_id_key" ON "crm_access"."crm_workspace_members"("workspace_id", "membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_workspace_members_id_workspace_id_key" ON "crm_access"."crm_workspace_members"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "crm_employee_profiles_workspace_id_last_name_first_name_id_idx" ON "crm_access"."crm_employee_profiles"("workspace_id", "last_name", "first_name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_employee_profiles_workspace_id_subject_key" ON "crm_access"."crm_employee_profiles"("workspace_id", "subject");

-- CreateIndex
CREATE INDEX "crm_teams_workspace_id_archived_at_idx" ON "crm_access"."crm_teams"("workspace_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "crm_teams_id_workspace_id_key" ON "crm_access"."crm_teams"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "crm_member_teams_workspace_id_team_id_idx" ON "crm_access"."crm_member_teams"("workspace_id", "team_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_invitation_intents_provisioning_command_id_key" ON "crm_access"."crm_invitation_intents"("provisioning_command_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_invitation_intents_revoke_command_id_key" ON "crm_access"."crm_invitation_intents"("revoke_command_id");

-- CreateIndex
CREATE INDEX "crm_invitation_intents_workspace_id_status_created_at_idx" ON "crm_access"."crm_invitation_intents"("workspace_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "crm_invitation_intents_id_workspace_id_key" ON "crm_access"."crm_invitation_intents"("id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_admissions_intent_id_key" ON "crm_access"."crm_admissions"("intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_admissions_source_acceptance_id_key" ON "crm_access"."crm_admissions"("source_acceptance_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_admissions_position_key" ON "crm_access"."crm_admissions"("position");

-- CreateIndex
CREATE INDEX "crm_admissions_workspace_id_status_position_idx" ON "crm_access"."crm_admissions"("workspace_id", "status", "position");

-- CreateIndex
CREATE UNIQUE INDEX "crm_team_audit_command_id_key" ON "crm_access"."crm_team_audit"("command_id");

-- CreateIndex
CREATE INDEX "crm_team_audit_workspace_id_created_at_idx" ON "crm_access"."crm_team_audit"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "crm_team_outbox_deduplication_key_key" ON "crm_access"."crm_team_outbox"("deduplication_key");

-- CreateIndex
CREATE INDEX "crm_team_outbox_status_available_at_created_at_idx" ON "crm_access"."crm_team_outbox"("status", "available_at", "created_at");

-- CreateIndex
CREATE INDEX "crm_team_deliveries_workspace_id_status_updated_at_idx" ON "crm_access"."crm_team_deliveries"("workspace_id", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "crm_team_deliveries_event_id_consumer_key" ON "crm_access"."crm_team_deliveries"("event_id", "consumer");

-- CreateIndex
CREATE INDEX "crm_billing_operations_workspace_id_state_created_at_idx" ON "crm_access"."crm_billing_operations"("workspace_id", "state", "created_at");

-- CreateIndex
CREATE INDEX "crm_billing_operations_release_fence_next_check_at_command__idx" ON "crm_access"."crm_billing_operations"("release_fence", "next_check_at", "command_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_billing_operations_command_id_workspace_id_key" ON "crm_access"."crm_billing_operations"("command_id", "workspace_id");

-- AddForeignKey
ALTER TABLE "crm_access"."crm_member_teams" ADD CONSTRAINT "crm_member_teams_member_id_workspace_id_fkey" FOREIGN KEY ("member_id", "workspace_id") REFERENCES "crm_access"."crm_workspace_members"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_access"."crm_member_teams" ADD CONSTRAINT "crm_member_teams_team_id_workspace_id_fkey" FOREIGN KEY ("team_id", "workspace_id") REFERENCES "crm_access"."crm_teams"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "crm_access"."service_identity" ALTER COLUMN "database_id" SET DEFAULT gen_random_uuid();

ALTER TABLE "crm_access"."crm_workspace_access" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "crm_access"."crm_workspace_members" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE crm_access.crm_workspace_members ADD CONSTRAINT crm_workspace_members_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES crm_access.crm_workspace_access(workspace_id) ON DELETE RESTRICT;
ALTER TABLE crm_access.crm_teams ADD CONSTRAINT crm_teams_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES crm_access.crm_workspace_access(workspace_id) ON DELETE RESTRICT;
ALTER TABLE crm_access.crm_invitation_intents ADD CONSTRAINT crm_invitation_intents_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES crm_access.crm_workspace_access(workspace_id) ON DELETE RESTRICT;
ALTER TABLE crm_access.crm_admissions ADD CONSTRAINT crm_admissions_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES crm_access.crm_workspace_access(workspace_id) ON DELETE RESTRICT;
ALTER TABLE crm_access.crm_admissions ADD CONSTRAINT crm_admissions_intent_workspace_fkey FOREIGN KEY (intent_id, workspace_id) REFERENCES crm_access.crm_invitation_intents(id, workspace_id) ON DELETE RESTRICT;
ALTER TABLE crm_access.crm_admissions ADD CONSTRAINT crm_admissions_member_workspace_fkey FOREIGN KEY (member_id, workspace_id) REFERENCES crm_access.crm_workspace_members(id, workspace_id) ON DELETE RESTRICT;
ALTER TABLE crm_access.crm_billing_capacity ADD CONSTRAINT crm_billing_capacity_pending_fk FOREIGN KEY (pending_operation_id, workspace_id) REFERENCES crm_access.crm_billing_operations(command_id, workspace_id) ON DELETE RESTRICT;
ALTER TABLE crm_access.crm_billing_capacity ADD CONSTRAINT crm_billing_capacity_committed_fk FOREIGN KEY (latest_committed_operation_id, workspace_id) REFERENCES crm_access.crm_billing_operations(command_id, workspace_id) ON DELETE RESTRICT;
ALTER TABLE crm_access.crm_billing_operations ADD CONSTRAINT crm_billing_operations_command_id_fkey FOREIGN KEY (command_id) REFERENCES crm_access.crm_team_command_receipts(command_id) ON DELETE RESTRICT;
ALTER TABLE crm_access.crm_employee_profiles ADD CONSTRAINT crm_employee_profiles_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES crm_access.crm_workspace_access(workspace_id) ON DELETE RESTRICT;
ALTER TABLE crm_access.crm_workspace_branding ADD CONSTRAINT crm_workspace_branding_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES crm_access.crm_workspace_access(workspace_id) ON DELETE RESTRICT;

ALTER TABLE "crm_access"."service_identity" ADD CONSTRAINT "service_identity_singleton_check" CHECK ("id" = 'singleton');

ALTER TABLE "crm_access"."service_identity" ADD CONSTRAINT "service_identity_name_check" CHECK ("service_name" = 'crm-access-service');

ALTER TABLE "crm_access"."crm_workspace_access" ADD CONSTRAINT "crm_workspace_access_subject_check" CHECK (
        char_length("activated_by_subject") BETWEEN 1 AND 256
        AND "activated_by_subject" = btrim("activated_by_subject")
    );

ALTER TABLE "crm_access"."crm_workspace_access" ADD CONSTRAINT "crm_workspace_access_onboarding_state_check" CHECK (
        (
            "lifecycle" = 'ONBOARDING'
            AND
            "onboarding_command_id" IS NULL
            AND "onboarding_template_key" IS NULL
            AND "onboarding_template_version" IS NULL
            AND "onboarding_template_fingerprint" IS NULL
            AND "onboarding_pipeline_id" IS NULL
            AND "onboarding_completed_at" IS NULL
        )
        OR (
            "lifecycle" IN ('ACTIVE', 'READ_ONLY', 'SUSPENDED')
            AND
            "onboarding_command_id" IS NOT NULL
            AND "onboarding_template_key" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
            AND "onboarding_template_version" > 0
            AND "onboarding_template_fingerprint" ~ '^[0-9a-f]{64}$'
            AND "onboarding_pipeline_id" IS NOT NULL
            AND "onboarding_completed_at" IS NOT NULL
        )
    );

ALTER TABLE "crm_access"."crm_workspace_access" ADD CONSTRAINT "crm_workspace_access_provisioning_command_type_check" CHECK ("provisioning_command_type" ~ '^[A-Z][A-Z0-9_]{0,63}$');

ALTER TABLE "crm_access"."crm_workspace_members" ADD CONSTRAINT "crm_workspace_members_subject_check" CHECK (length("subject") BETWEEN 1 AND 256 AND "subject" = btrim("subject"));

ALTER TABLE "crm_access"."crm_workspace_members" ADD CONSTRAINT "crm_workspace_members_version_check" CHECK ("version" > 0);

ALTER TABLE "crm_access"."crm_team_deliveries" ADD CONSTRAINT "crm_team_deliveries_version_check" CHECK (version > 0);

ALTER TABLE crm_access.crm_teams ADD CONSTRAINT "crm_teams_name_check" CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 100);

ALTER TABLE crm_access.crm_teams ADD CONSTRAINT "crm_teams_version_check" CHECK (version > 0);

ALTER TABLE crm_access.crm_invitation_intents ADD CONSTRAINT "crm_invitation_intents_version_check" CHECK (version > 0 AND (identity_version IS NULL OR identity_version > 0));

ALTER TABLE crm_access.crm_invitation_intents ADD CONSTRAINT "crm_invitation_intents_email_check" CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254);

ALTER TABLE crm_access.crm_invitation_intents ADD CONSTRAINT "crm_invitation_intents_status_check" CHECK (status IN ('REGISTERING', 'INVITED', 'ACCEPTED', 'REVOKED', 'EXPIRED'));

ALTER TABLE crm_access.crm_invitation_intents ADD CONSTRAINT "crm_invitation_intents_teams_check" CHECK (cardinality(team_ids) <= 1000);

ALTER TABLE crm_access.crm_invitation_intents ADD CONSTRAINT "crm_invitation_intents_expiry_check" CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '7 days');

ALTER TABLE crm_access.crm_invitation_intents ADD CONSTRAINT "crm_invitation_intents_revoke_check" CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL AND revoke_command_id IS NOT NULL));

ALTER TABLE crm_access.crm_admissions ADD CONSTRAINT "crm_admissions_status_check" CHECK (status IN ('WAITING', 'ACTIVE', 'CANCELLED'));

ALTER TABLE crm_access.crm_admissions ADD CONSTRAINT "crm_admissions_activation_check" CHECK ((status = 'ACTIVE') = (activated_at IS NOT NULL));

ALTER TABLE crm_access.crm_admissions ADD CONSTRAINT "crm_admissions_origin_check" CHECK (
    (intent_id IS NOT NULL AND source_acceptance_id IS NOT NULL AND expected_member_version IS NULL)
    OR (intent_id IS NULL AND source_acceptance_id IS NULL AND member_id IS NOT NULL AND expected_member_version IS NOT NULL AND expected_member_version > 0)
  );

ALTER TABLE crm_access.crm_team_outbox ADD CONSTRAINT "crm_team_outbox_status_check" CHECK (status IN ('PENDING','PROCESSING','PUBLISHED'));

ALTER TABLE crm_access.crm_team_outbox ADD CONSTRAINT "crm_team_outbox_exchange_check" CHECK (exchange IN ('aerocrm.events','aerocrm.retry','aerocrm.dead-letter','aerocrm.manual-retry'));

ALTER TABLE crm_access.crm_team_outbox ADD CONSTRAINT "crm_team_outbox_attempts_check" CHECK (attempts >= 0);

ALTER TABLE crm_access.crm_team_deliveries ADD CONSTRAINT "crm_team_deliveries_status_check" CHECK (status IN ('PROCESSING','RETRY_SCHEDULED','DELIVERED','DEAD_LETTERED'));

ALTER TABLE crm_access.crm_team_deliveries ADD CONSTRAINT "crm_team_deliveries_attempts_check" CHECK (retry_attempt >= 0 AND manual_retry_cycle >= 0);

ALTER TABLE crm_access.crm_billing_capacity ADD CONSTRAINT "crm_billing_capacity_revision_check" CHECK (revision BETWEEN 0 AND 2147483646);

ALTER TABLE crm_access.crm_billing_capacity ADD CONSTRAINT "crm_billing_capacity_admission_ceiling_check" CHECK (admission_ceiling BETWEEN 2 AND 10000);

ALTER TABLE crm_access.crm_billing_capacity ADD CONSTRAINT "crm_billing_capacity_pending_target_seats_check" CHECK (pending_target_seats BETWEEN 2 AND 10000);

ALTER TABLE crm_access.crm_billing_capacity ADD CONSTRAINT "crm_billing_capacity_condition_1_check" CHECK ((pending_operation_id IS NULL) = (pending_target_seats IS NULL));

ALTER TABLE crm_access.crm_billing_operations ADD CONSTRAINT "crm_billing_operations_actor_subject_check" CHECK (length(actor_subject) BETWEEN 1 AND 256 AND actor_subject !~ '[[:space:][:cntrl:]]');

ALTER TABLE crm_access.crm_billing_operations ADD CONSTRAINT "crm_billing_operations_command_type_check" CHECK (command_type IN ('AEROCRM_CHECKOUT','AEROCRM_SEAT_CHANGE','AEROCRM_DISABLE_RENEWAL','AEROCRM_CONFIRM_RENEWAL','AEROCRM_VERIFY_ORDER','AEROCRM_NOT_STARTED'));

ALTER TABLE crm_access.crm_billing_operations ADD CONSTRAINT "crm_billing_operations_fence_revision_check" CHECK (fence_revision BETWEEN 1 AND 2147483646);

ALTER TABLE crm_access.crm_billing_operations ADD CONSTRAINT "crm_billing_operations_target_seats_check" CHECK (target_seats BETWEEN 2 AND 10000);

ALTER TABLE crm_access.crm_billing_operations ADD CONSTRAINT "crm_billing_operations_state_check" CHECK (state IN ('PENDING','COMMITTED','CANCELLED','NOT_STARTED'));

ALTER TABLE crm_access.crm_billing_operations ADD CONSTRAINT "crm_billing_operations_billing_version_check" CHECK (billing_version ~ '^(0|[1-9][0-9]*)$');

ALTER TABLE crm_access.crm_billing_operations ADD CONSTRAINT "crm_billing_operations_condition_1_check" CHECK ((fence_revision IS NULL) = (target_seats IS NULL));

ALTER TABLE crm_access.crm_billing_operations ADD CONSTRAINT "crm_billing_operations_condition_2_check" CHECK ((command_type IN ('AEROCRM_CHECKOUT','AEROCRM_SEAT_CHANGE')) = (fence_revision IS NOT NULL));

ALTER TABLE crm_access.crm_billing_operations ADD CONSTRAINT "crm_billing_operations_condition_3_check" CHECK ((state = 'NOT_STARTED' AND command_type = 'AEROCRM_NOT_STARTED' AND request_hash IS NULL AND request IS NULL AND proof IS NULL AND release_fence)
     OR (state <> 'NOT_STARTED' AND command_type <> 'AEROCRM_NOT_STARTED' AND request_hash IS NOT NULL AND request_hash ~ '^[0-9a-f]{64}$' AND request IS NOT NULL AND jsonb_typeof(request) = 'object'));

ALTER TABLE crm_access.crm_billing_operations ADD CONSTRAINT "crm_billing_operations_condition_4_check" CHECK (NOT release_fence OR state IN ('COMMITTED','CANCELLED','NOT_STARTED'));

ALTER TABLE crm_access.crm_billing_operations ADD CONSTRAINT "crm_billing_operations_condition_5_check" CHECK (hold_until IS NULL OR (state = 'COMMITTED' AND NOT release_fence));

ALTER TABLE crm_access.crm_employee_profiles ADD CONSTRAINT "crm_employee_profiles_subject_check" CHECK (length(subject) BETWEEN 1 AND 256 AND subject !~ '[[:space:][:cntrl:]]');

ALTER TABLE crm_access.crm_employee_profiles ADD CONSTRAINT "crm_employee_profiles_first_name_check" CHECK (length(btrim(first_name)) BETWEEN 1 AND 100 AND first_name !~ '[[:cntrl:]]');

ALTER TABLE crm_access.crm_employee_profiles ADD CONSTRAINT "crm_employee_profiles_last_name_check" CHECK (length(btrim(last_name)) BETWEEN 1 AND 100 AND last_name !~ '[[:cntrl:]]');

ALTER TABLE crm_access.crm_employee_profiles ADD CONSTRAINT "crm_employee_profiles_middle_name_check" CHECK (length(btrim(middle_name)) BETWEEN 1 AND 100 AND middle_name !~ '[[:cntrl:]]');

ALTER TABLE crm_access.crm_employee_profiles ADD CONSTRAINT "crm_employee_profiles_version_check" CHECK (version BETWEEN 1 AND 2147483647);

ALTER TABLE crm_access.crm_invitation_intents ADD CONSTRAINT "crm_invitation_employee_name_check" CHECK (
    (first_name IS NULL AND last_name IS NULL AND middle_name IS NULL) OR
    (first_name IS NOT NULL AND last_name IS NOT NULL
      AND length(btrim(first_name)) BETWEEN 1 AND 100 AND first_name !~ '[[:cntrl:]]'
      AND length(btrim(last_name)) BETWEEN 1 AND 100 AND last_name !~ '[[:cntrl:]]'
      AND (middle_name IS NULL OR (length(btrim(middle_name)) BETWEEN 1 AND 100 AND middle_name !~ '[[:cntrl:]]')))
  );

ALTER TABLE crm_access.crm_workspace_branding ADD CONSTRAINT "crm_workspace_branding_version_check" CHECK (version BETWEEN 1 AND 2147483647);

ALTER TABLE crm_access.crm_workspace_branding ADD CONSTRAINT "crm_workspace_branding_display_name_check" CHECK (
    display_name IS NULL OR (
      char_length(display_name) BETWEEN 1 AND 40
      AND display_name = btrim(display_name)
      AND display_name = normalize(display_name, NFC)
      AND display_name !~ '[[:cntrl:]<>]'
      AND display_name !~ U&'[\2028\2029]'
    )
  );

CREATE UNIQUE INDEX crm_teams_active_name_key ON crm_access.crm_teams(workspace_id, lower(name)) WHERE archived_at IS NULL;

CREATE UNIQUE INDEX crm_invitation_intents_active_email_key ON crm_access.crm_invitation_intents(workspace_id, email) WHERE status IN ('REGISTERING','INVITED');

CREATE UNIQUE INDEX crm_admissions_waiting_subject_key ON crm_access.crm_admissions(workspace_id, subject) WHERE status = 'WAITING';

CREATE INDEX crm_billing_operations_release_fence_next_check_at_command_id_idx ON crm_access.crm_billing_operations(release_fence,next_check_at,command_id);

CREATE FUNCTION crm_access.reject_team_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $history$
BEGIN
  RAISE EXCEPTION 'aeroCRM team audit and command receipts are append-only';
END
$history$;

REVOKE ALL ON FUNCTION crm_access.reject_team_history_mutation() FROM PUBLIC;

CREATE FUNCTION crm_access.guard_billing_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
  IF NOT EXISTS (SELECT 1 FROM crm_access.crm_team_command_receipts r WHERE r.command_id=NEW.command_id AND r.workspace_id=NEW.workspace_id AND r.actor_subject=NEW.actor_subject AND r.command_type=NEW.command_type AND r.request_hash=COALESCE(NEW.request_hash,repeat('0',64))) THEN
   RAISE EXCEPTION 'CRM billing receipt binding is invalid' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'CRM billing operation is retained' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.command_id,NEW.workspace_id,NEW.actor_subject,NEW.command_type,NEW.request_hash,NEW.request,NEW.fence_revision,NEW.target_seats,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.command_id,OLD.workspace_id,OLD.actor_subject,OLD.command_type,OLD.request_hash,OLD.request,OLD.fence_revision,OLD.target_seats,OLD.created_at)
  OR (OLD.state <> 'PENDING' AND NEW.state <> OLD.state)
  OR (OLD.release_fence AND NOT NEW.release_fence)
  OR (OLD.billing_version IS NOT NULL AND (NEW.billing_version IS NULL OR NEW.billing_version::numeric < OLD.billing_version::numeric))
 THEN RAISE EXCEPTION 'CRM billing operation binding is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION crm_access.guard_billing_operation() FROM PUBLIC;

CREATE FUNCTION crm_access.guard_billing_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'CRM billing capacity is retained' USING ERRCODE='23514'; END IF;
 IF NEW.workspace_id <> OLD.workspace_id OR NEW.created_at <> OLD.created_at OR NEW.revision < OLD.revision THEN
  RAISE EXCEPTION 'CRM billing capacity binding is immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.pending_operation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM crm_access.crm_billing_operations o WHERE o.command_id=NEW.pending_operation_id AND o.workspace_id=NEW.workspace_id AND o.fence_revision=NEW.revision AND o.target_seats=NEW.pending_target_seats AND NOT o.release_fence AND o.state IN ('PENDING','COMMITTED')) THEN
  RAISE EXCEPTION 'CRM pending capacity binding is invalid' USING ERRCODE='23514';
 END IF;
 IF NEW.latest_committed_operation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM crm_access.crm_billing_operations o WHERE o.command_id=NEW.latest_committed_operation_id AND o.workspace_id=NEW.workspace_id AND o.state='COMMITTED' AND o.target_seats IS NOT NULL) THEN
  RAISE EXCEPTION 'CRM committed capacity binding is invalid' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION crm_access.guard_billing_capacity() FROM PUBLIC;

CREATE FUNCTION "crm_access"."enforce_service_identity_integrity"() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, crm_access AS $$
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
REVOKE ALL ON FUNCTION "crm_access"."enforce_service_identity_integrity"() FROM PUBLIC;

INSERT INTO "crm_access"."service_identity" ("id", "service_name", "database_id", "updated_at")
VALUES ('singleton', 'crm-access-service', gen_random_uuid(), CURRENT_TIMESTAMP);

CREATE TRIGGER crm_team_audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_access.crm_team_audit FOR EACH STATEMENT EXECUTE FUNCTION crm_access.reject_team_history_mutation();

CREATE TRIGGER crm_team_receipts_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_access.crm_team_command_receipts FOR EACH STATEMENT EXECUTE FUNCTION crm_access.reject_team_history_mutation();

CREATE TRIGGER crm_billing_operations_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_access.crm_billing_operations FOR EACH ROW EXECUTE FUNCTION crm_access.guard_billing_operation();

CREATE TRIGGER crm_billing_capacity_guard BEFORE UPDATE OR DELETE ON crm_access.crm_billing_capacity FOR EACH ROW EXECUTE FUNCTION crm_access.guard_billing_capacity();

CREATE TRIGGER service_identity_integrity_guard BEFORE UPDATE OR DELETE ON "crm_access"."service_identity"
FOR EACH ROW EXECUTE FUNCTION "crm_access"."enforce_service_identity_integrity"();

ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA "crm_access" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "crm_access" FROM PUBLIC;

COMMIT;
