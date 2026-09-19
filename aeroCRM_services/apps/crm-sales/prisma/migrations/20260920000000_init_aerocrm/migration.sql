-- Clean aeroCRM baseline for the current service-owned Prisma schema.
-- Additional SQL retains database guards that Prisma cannot represent.
BEGIN;

DO $$ BEGIN
    IF to_regnamespace('crm_sales') IS NULL OR (
        SELECT nspowner FROM pg_namespace WHERE oid = to_regnamespace('crm_sales')
    ) IS DISTINCT FROM to_regrole(CURRENT_USER) THEN
        RAISE EXCEPTION 'crm_sales schema must exist and be owned by the migration role';
    END IF;
END $$;

-- CreateSchema


-- CreateEnum
CREATE TYPE "crm_sales"."CrmPipelineStageState" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "crm_sales"."SalesTaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "crm_sales"."export_audit" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "entity" VARCHAR(16) NOT NULL,
    "format" VARCHAR(4) NOT NULL,
    "row_count" INTEGER NOT NULL,
    "byte_count" INTEGER NOT NULL,
    "snapshot_at" TIMESTAMP(3) NOT NULL,
    "prepared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales"."service_identity" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "service_name" TEXT NOT NULL DEFAULT 'crm-sales-service',
    "database_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales"."pipelines" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "template_key" VARCHAR(64) NOT NULL,
    "template_version" SMALLINT NOT NULL,
    "template_fingerprint" CHAR(64) NOT NULL,
    "installed_by_subject" VARCHAR(256) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales"."pipeline_stages" (
    "id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "position" SMALLINT NOT NULL,
    "state" "crm_sales"."CrmPipelineStageState" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales"."pipeline_template_installations" (
    "id" UUID NOT NULL,
    "initial_command_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "template_key" VARCHAR(64) NOT NULL,
    "template_version" SMALLINT NOT NULL,
    "template_fingerprint" CHAR(64) NOT NULL,
    "installed_by_subject" VARCHAR(256) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_template_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales"."pipeline_template_installation_commands" (
    "command_id" UUID NOT NULL,
    "installation_id" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "request_hash_version" SMALLINT NOT NULL DEFAULT 1,
    "requested_by_subject" VARCHAR(256) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_template_installation_commands_pkey" PRIMARY KEY ("command_id")
);

-- CreateTable
CREATE TABLE "crm_sales"."deals" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" VARCHAR(200) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'RUB',
    "amount_minor" INTEGER NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "status" "crm_sales"."CrmPipelineStageState" NOT NULL DEFAULT 'OPEN',
    "contact_id" UUID NOT NULL,
    "contact_name" VARCHAR(200) NOT NULL,
    "assigned_to_subject" VARCHAR(256) NOT NULL,
    "team_id" UUID,
    "next_task_id" UUID,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales"."tasks" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "deal_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" VARCHAR(200) NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "status" "crm_sales"."SalesTaskStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_to_subject" VARCHAR(256) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "assigned_to_membership_id" UUID,
    "assignment_version" INTEGER,
    "assignment_at" TIMESTAMP(3),
    "team_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales"."task_series" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "creator_subject" VARCHAR(256) NOT NULL,
    "creator_membership_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "deal_id" UUID,
    "team_id" UUID,
    "assigned_to_subject" VARCHAR(256) NOT NULL,
    "assigned_to_membership_id" UUID,
    "frequency" VARCHAR(8) NOT NULL,
    "start_date" CHAR(10) NOT NULL,
    "local_time" CHAR(5) NOT NULL,
    "time_zone" VARCHAR(100) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "next_index" INTEGER NOT NULL DEFAULT 0,
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "next_check_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blocked_reason" VARCHAR(32),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales"."task_series_commands" (
    "command_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "series_id" UUID NOT NULL,
    "before" JSONB,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_series_commands_pkey" PRIMARY KEY ("command_id")
);

-- CreateTable
CREATE TABLE "crm_sales"."task_series_occurrences" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "series_id" UUID NOT NULL,
    "period_index" INTEGER NOT NULL,
    "series_version" INTEGER NOT NULL,
    "task_id" UUID NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_series_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales"."task_notifications" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "recipient_subject" VARCHAR(256) NOT NULL,
    "recipient_membership_id" UUID,
    "assignment_version" INTEGER NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "available_at" TIMESTAMP(3) NOT NULL,
    "read_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales"."task_command_receipts" (
    "command_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "command_type" VARCHAR(32) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "task_id" UUID NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_command_receipts_pkey" PRIMARY KEY ("command_id")
);

-- CreateTable
CREATE TABLE "crm_sales"."task_timeline" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "command_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_timeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales"."reminder_rules" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "scope" VARCHAR(16) NOT NULL,
    "owner_subject" VARCHAR(256) NOT NULL,
    "owner_membership_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "configuration" JSONB NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminder_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales"."reminder_rule_commands" (
    "command_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "actor_membership_id" UUID,
    "command_type" VARCHAR(16) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "rule_id" UUID NOT NULL,
    "before" JSONB,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_rule_commands_pkey" PRIMARY KEY ("command_id")
);

-- CreateTable
CREATE TABLE "crm_sales"."reminder_jobs" (
    "id" UUID NOT NULL,
    "period_key" VARCHAR(160) NOT NULL,
    "workspace_id" UUID,
    "task_id" UUID,
    "cursor" UUID,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "reminder_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales"."reminder_deliveries" (
    "id" UUID NOT NULL,
    "deduplication_key" CHAR(64) NOT NULL,
    "workspace_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "task_version" INTEGER NOT NULL,
    "assignment_version" INTEGER,
    "rule_version" INTEGER NOT NULL,
    "occurrence_index" INTEGER NOT NULL,
    "recipient_subject" VARCHAR(256) NOT NULL,
    "recipient_membership_id" UUID,
    "channel" VARCHAR(16) NOT NULL,
    "nominal_at" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales"."reminder_outbox" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "event_type" VARCHAR(120) NOT NULL,
    "payload" JSONB NOT NULL,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "reminder_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales"."reminder_runtime" (
    "id" VARCHAR(32) NOT NULL,
    "revision" VARCHAR(64) NOT NULL,
    "ready" BOOLEAN NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminder_runtime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales"."deal_timeline" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "outcome" VARCHAR(4000) NOT NULL,
    "from_stage_id" UUID,
    "to_stage_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_timeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales"."command_receipts" (
    "command_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "command_type" VARCHAR(64) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "deal_id" UUID NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "command_receipts_pkey" PRIMARY KEY ("command_id")
);

-- CreateTable
CREATE TABLE "crm_sales"."intake_operation_slots" (
    "operation_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "state" VARCHAR(16) NOT NULL,
    "contact_id" UUID,
    "deal_id" UUID,
    "first_task_id" UUID,
    "committed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intake_operation_slots_pkey" PRIMARY KEY ("operation_id")
);

-- CreateTable
CREATE TABLE "crm_sales"."intake_operation_commands" (
    "command_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intake_operation_commands_pkey" PRIMARY KEY ("command_id")
);

-- CreateIndex
CREATE INDEX "export_audit_workspace_prepared_idx" ON "crm_sales"."export_audit"("workspace_id", "prepared_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "service_identity_database_id_key" ON "crm_sales"."service_identity"("database_id");

-- CreateIndex
CREATE INDEX "pipelines_workspace_id_created_at_idx" ON "crm_sales"."pipelines"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "pipelines_id_workspace_id_key" ON "crm_sales"."pipelines"("id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_pipeline_id_key_key" ON "crm_sales"."pipeline_stages"("pipeline_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_pipeline_id_position_key" ON "crm_sales"."pipeline_stages"("pipeline_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_id_pipeline_id_workspace_id_key" ON "crm_sales"."pipeline_stages"("id", "pipeline_id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_template_installations_initial_command_id_key" ON "crm_sales"."pipeline_template_installations"("initial_command_id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_template_installations_workspace_id_key" ON "crm_sales"."pipeline_template_installations"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_template_installations_pipeline_id_key" ON "crm_sales"."pipeline_template_installations"("pipeline_id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_template_installations_pipeline_id_workspace_id_key" ON "crm_sales"."pipeline_template_installations"("pipeline_id", "workspace_id");

-- CreateIndex
CREATE INDEX "pipeline_template_installation_commands_installation_id_cre_idx" ON "crm_sales"."pipeline_template_installation_commands"("installation_id", "created_at");

-- CreateIndex
CREATE INDEX "deals_workspace_id_archived_at_created_at_idx" ON "crm_sales"."deals"("workspace_id", "archived_at", "created_at");

-- CreateIndex
CREATE INDEX "deals_workspace_id_assigned_to_subject_created_at_idx" ON "crm_sales"."deals"("workspace_id", "assigned_to_subject", "created_at");

-- CreateIndex
CREATE INDEX "deals_workspace_id_team_id_created_at_idx" ON "crm_sales"."deals"("workspace_id", "team_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "deals_id_workspace_id_key" ON "crm_sales"."deals"("id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "deals_id_workspace_id_contact_id_key" ON "crm_sales"."deals"("id", "workspace_id", "contact_id");

-- CreateIndex
CREATE INDEX "tasks_workspace_id_status_due_at_idx" ON "crm_sales"."tasks"("workspace_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "tasks_team_workday_idx" ON "crm_sales"."tasks"("workspace_id", "team_id", "status", "due_at", "id");

-- CreateIndex
CREATE INDEX "tasks_assignee_workday_idx" ON "crm_sales"."tasks"("workspace_id", "assigned_to_subject", "status", "due_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_id_workspace_id_key" ON "crm_sales"."tasks"("id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_id_deal_id_workspace_id_key" ON "crm_sales"."tasks"("id", "deal_id", "workspace_id");

-- CreateIndex
CREATE INDEX "task_series_list_idx" ON "crm_sales"."task_series"("workspace_id", "status", "created_at", "id");

-- CreateIndex
CREATE INDEX "task_series_schedule_idx" ON "crm_sales"."task_series"("status", "next_run_at", "next_check_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "task_series_id_workspace_id_key" ON "crm_sales"."task_series"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "task_series_commands_history_idx" ON "crm_sales"."task_series_commands"("workspace_id", "series_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "task_series_occurrences_task_id_key" ON "crm_sales"."task_series_occurrences"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_series_period_key" ON "crm_sales"."task_series_occurrences"("series_id", "period_index");

-- CreateIndex
CREATE UNIQUE INDEX "task_series_occurrences_task_id_workspace_id_key" ON "crm_sales"."task_series_occurrences"("task_id", "workspace_id");

-- CreateIndex
CREATE INDEX "task_notifications_recipient_idx" ON "crm_sales"."task_notifications"("workspace_id", "recipient_subject", "available_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "task_notifications_occurrence_key" ON "crm_sales"."task_notifications"("task_id", "assignment_version", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "task_timeline_command_id_key" ON "crm_sales"."task_timeline"("command_id");

-- CreateIndex
CREATE INDEX "task_timeline_workspace_id_task_id_created_at_id_idx" ON "crm_sales"."task_timeline"("workspace_id", "task_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "reminder_rules_list_idx" ON "crm_sales"."reminder_rules"("workspace_id", "scope", "owner_subject", "owner_membership_id", "archived_at", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_rules_id_workspace_id_key" ON "crm_sales"."reminder_rules"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "reminder_rule_commands_history_idx" ON "crm_sales"."reminder_rule_commands"("workspace_id", "rule_id", "created_at", "command_id");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_jobs_period_key_key" ON "crm_sales"."reminder_jobs"("period_key");

-- CreateIndex
CREATE INDEX "reminder_jobs_status_available_at_idx" ON "crm_sales"."reminder_jobs"("status", "available_at");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_deliveries_deduplication_key_key" ON "crm_sales"."reminder_deliveries"("deduplication_key");

-- CreateIndex
CREATE INDEX "reminder_deliveries_workspace_id_task_id_status_idx" ON "crm_sales"."reminder_deliveries"("workspace_id", "task_id", "status");

-- CreateIndex
CREATE INDEX "reminder_deliveries_workspace_id_rule_id_status_idx" ON "crm_sales"."reminder_deliveries"("workspace_id", "rule_id", "status");

-- CreateIndex
CREATE INDEX "reminder_outbox_status_available_at_created_at_idx" ON "crm_sales"."reminder_outbox"("status", "available_at", "created_at");

-- CreateIndex
CREATE INDEX "deal_timeline_workspace_id_deal_id_created_at_idx" ON "crm_sales"."deal_timeline"("workspace_id", "deal_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "intake_operation_slots_workspace_id_workflow_id_key" ON "crm_sales"."intake_operation_slots"("workspace_id", "workflow_id");

-- AddForeignKey
ALTER TABLE "crm_sales"."pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_id_workspace_id_fkey" FOREIGN KEY ("pipeline_id", "workspace_id") REFERENCES "crm_sales"."pipelines"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sales"."pipeline_template_installations" ADD CONSTRAINT "pipeline_template_installations_pipeline_id_workspace_id_fkey" FOREIGN KEY ("pipeline_id", "workspace_id") REFERENCES "crm_sales"."pipelines"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sales"."pipeline_template_installation_commands" ADD CONSTRAINT "pipeline_template_installation_commands_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "crm_sales"."pipeline_template_installations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sales"."deals" ADD CONSTRAINT "deals_pipeline_id_workspace_id_fkey" FOREIGN KEY ("pipeline_id", "workspace_id") REFERENCES "crm_sales"."pipelines"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sales"."deals" ADD CONSTRAINT "deals_stage_id_pipeline_id_workspace_id_fkey" FOREIGN KEY ("stage_id", "pipeline_id", "workspace_id") REFERENCES "crm_sales"."pipeline_stages"("id", "pipeline_id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sales"."deals" ADD CONSTRAINT "deals_next_task_fkey" FOREIGN KEY ("next_task_id", "id", "workspace_id") REFERENCES "crm_sales"."tasks"("id", "deal_id", "workspace_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "crm_sales"."tasks" ADD CONSTRAINT "tasks_deal_id_workspace_id_fkey" FOREIGN KEY ("deal_id", "workspace_id") REFERENCES "crm_sales"."deals"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sales"."task_series" ADD CONSTRAINT "task_series_deal_fkey" FOREIGN KEY ("deal_id", "workspace_id") REFERENCES "crm_sales"."deals"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sales"."task_series_commands" ADD CONSTRAINT "task_series_commands_series_id_workspace_id_fkey" FOREIGN KEY ("series_id", "workspace_id") REFERENCES "crm_sales"."task_series"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sales"."task_series_occurrences" ADD CONSTRAINT "task_series_occurrences_series_id_workspace_id_fkey" FOREIGN KEY ("series_id", "workspace_id") REFERENCES "crm_sales"."task_series"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sales"."task_series_occurrences" ADD CONSTRAINT "task_series_occurrences_task_id_workspace_id_fkey" FOREIGN KEY ("task_id", "workspace_id") REFERENCES "crm_sales"."tasks"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sales"."task_command_receipts" ADD CONSTRAINT "task_command_receipts_task_id_workspace_id_fkey" FOREIGN KEY ("task_id", "workspace_id") REFERENCES "crm_sales"."tasks"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sales"."task_timeline" ADD CONSTRAINT "task_timeline_task_id_workspace_id_fkey" FOREIGN KEY ("task_id", "workspace_id") REFERENCES "crm_sales"."tasks"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sales"."reminder_rule_commands" ADD CONSTRAINT "reminder_rule_commands_rule_id_workspace_id_fkey" FOREIGN KEY ("rule_id", "workspace_id") REFERENCES "crm_sales"."reminder_rules"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sales"."deal_timeline" ADD CONSTRAINT "deal_timeline_deal_id_workspace_id_fkey" FOREIGN KEY ("deal_id", "workspace_id") REFERENCES "crm_sales"."deals"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sales"."intake_operation_slots" ADD CONSTRAINT "intake_operation_slots_deal_id_workspace_id_contact_id_fkey" FOREIGN KEY ("deal_id", "workspace_id", "contact_id") REFERENCES "crm_sales"."deals"("id", "workspace_id", "contact_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "crm_sales"."intake_operation_slots" ADD CONSTRAINT "intake_operation_slots_first_task_id_deal_id_workspace_id_fkey" FOREIGN KEY ("first_task_id", "deal_id", "workspace_id") REFERENCES "crm_sales"."tasks"("id", "deal_id", "workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "crm_sales"."service_identity" ALTER COLUMN "database_id" SET DEFAULT gen_random_uuid();

ALTER TABLE "crm_sales"."pipelines" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "crm_sales"."pipeline_stages" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "crm_sales"."pipeline_template_installations" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "crm_sales"."export_audit" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE crm_sales.deals ALTER CONSTRAINT deals_next_task_fkey DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "crm_sales"."service_identity" ADD CONSTRAINT "service_identity_singleton_check" CHECK ("id" = 'singleton');

ALTER TABLE "crm_sales"."service_identity" ADD CONSTRAINT "service_identity_name_check" CHECK ("service_name" = 'crm-sales-service');

ALTER TABLE "crm_sales"."pipelines" ADD CONSTRAINT "pipelines_name_check" CHECK (
        char_length("name") BETWEEN 1 AND 200
        AND "name" = btrim("name")
    );

ALTER TABLE "crm_sales"."pipelines" ADD CONSTRAINT "pipelines_template_key_check" CHECK (
        "template_key" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
    );

ALTER TABLE "crm_sales"."pipelines" ADD CONSTRAINT "pipelines_template_version_check" CHECK (
        "template_version" > 0
    );

ALTER TABLE "crm_sales"."pipelines" ADD CONSTRAINT "pipelines_template_fingerprint_check" CHECK (
        "template_fingerprint" ~ '^[0-9a-f]{64}$'
    );

ALTER TABLE "crm_sales"."pipelines" ADD CONSTRAINT "pipelines_installed_by_subject_check" CHECK (
        char_length("installed_by_subject") BETWEEN 1 AND 256
        AND "installed_by_subject" = btrim("installed_by_subject")
    );

ALTER TABLE "crm_sales"."pipeline_stages" ADD CONSTRAINT "pipeline_stages_key_check" CHECK (
        "key" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
    );

ALTER TABLE "crm_sales"."pipeline_stages" ADD CONSTRAINT "pipeline_stages_name_check" CHECK (
        char_length("name") BETWEEN 1 AND 200
        AND "name" = btrim("name")
    );

ALTER TABLE "crm_sales"."pipeline_stages" ADD CONSTRAINT "pipeline_stages_position_check" CHECK ("position" > 0);

ALTER TABLE "crm_sales"."pipeline_template_installations" ADD CONSTRAINT "pipeline_template_installations_template_key_check" CHECK (
        "template_key" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
    );

ALTER TABLE "crm_sales"."pipeline_template_installations" ADD CONSTRAINT "pipeline_template_installations_template_version_check" CHECK (
        "template_version" > 0
    );

ALTER TABLE "crm_sales"."pipeline_template_installations" ADD CONSTRAINT "pipeline_template_installations_fingerprint_check" CHECK (
        "template_fingerprint" ~ '^[0-9a-f]{64}$'
    );

ALTER TABLE "crm_sales"."pipeline_template_installations" ADD CONSTRAINT "pipeline_template_installations_subject_check" CHECK (
        char_length("installed_by_subject") BETWEEN 1 AND 256
        AND "installed_by_subject" = btrim("installed_by_subject")
    );

ALTER TABLE "crm_sales"."pipeline_template_installation_commands" ADD CONSTRAINT "pipeline_template_installation_commands_request_hash_check" CHECK (
        "request_hash" ~ '^[0-9a-f]{64}$'
        AND "request_hash_version" = 1
    );

ALTER TABLE "crm_sales"."pipeline_template_installation_commands" ADD CONSTRAINT "pipeline_template_installation_commands_subject_check" CHECK (
        char_length("requested_by_subject") BETWEEN 1 AND 256
        AND "requested_by_subject" = btrim("requested_by_subject")
    );

ALTER TABLE "crm_sales"."deals" ADD CONSTRAINT "deals_version_check" CHECK ("version" > 0);

ALTER TABLE "crm_sales"."deals" ADD CONSTRAINT "deals_title_check" CHECK (length(btrim("title")) > 0);

ALTER TABLE "crm_sales"."deals" ADD CONSTRAINT "deals_currency_check" CHECK ("currency" = 'RUB');

ALTER TABLE "crm_sales"."deals" ADD CONSTRAINT "deals_amount_minor_check" CHECK ("amount_minor" >= 0);

ALTER TABLE "crm_sales"."deals" ADD CONSTRAINT "deals_assigned_to_subject_check" CHECK (length(btrim("assigned_to_subject")) > 0);

ALTER TABLE "crm_sales"."tasks" ADD CONSTRAINT "tasks_version_check" CHECK ("version" > 0);

ALTER TABLE "crm_sales"."tasks" ADD CONSTRAINT "tasks_title_check" CHECK (length(btrim("title")) > 0);

ALTER TABLE "crm_sales"."deal_timeline" ADD CONSTRAINT "deal_timeline_kind_check" CHECK ("kind" IN ('CREATED', 'TRANSITIONED', 'TASK_COMPLETED', 'ARCHIVED'));

ALTER TABLE "crm_sales"."command_receipts" ADD CONSTRAINT "command_receipts_request_hash_check" CHECK ("request_hash" ~ '^[a-f0-9]{64}$');

ALTER TABLE crm_sales.intake_operation_slots ADD CONSTRAINT "intake_operation_slots_payload_hash_check" CHECK (payload_hash ~ '^[a-f0-9]{64}$');

ALTER TABLE crm_sales.intake_operation_slots ADD CONSTRAINT "intake_operation_slots_state_check" CHECK (state IN ('COMMITTED', 'CANCELLED'));

ALTER TABLE crm_sales.intake_operation_slots ADD CONSTRAINT "intake_operation_slots_committed_check" CHECK (
    (state = 'COMMITTED' AND contact_id IS NOT NULL AND deal_id IS NOT NULL AND first_task_id IS NOT NULL AND committed_at IS NOT NULL)
    OR (state = 'CANCELLED' AND contact_id IS NULL AND deal_id IS NULL AND first_task_id IS NULL AND committed_at IS NULL)
  );

ALTER TABLE crm_sales.intake_operation_commands ADD CONSTRAINT "intake_operation_commands_request_hash_check" CHECK (request_hash ~ '^[a-f0-9]{64}$');

ALTER TABLE crm_sales.intake_operation_slots ADD CONSTRAINT "intake_operation_slots_actor_subject_check" CHECK (length(actor_subject) BETWEEN 1 AND 256 AND actor_subject !~ '[[:space:][:cntrl:]]');

ALTER TABLE crm_sales.intake_operation_commands ADD CONSTRAINT "intake_operation_commands_actor_subject_check" CHECK (length(actor_subject) BETWEEN 1 AND 256 AND actor_subject !~ '[[:space:][:cntrl:]]');

ALTER TABLE crm_sales.export_audit ADD CONSTRAINT "export_audit_actor_subject_check" CHECK (char_length(actor_subject) BETWEEN 1 AND 256 AND actor_subject !~ '[[:space:][:cntrl:]]');

ALTER TABLE crm_sales.export_audit ADD CONSTRAINT "export_audit_entity_check" CHECK (entity IN ('deals','tasks'));

ALTER TABLE crm_sales.export_audit ADD CONSTRAINT "export_audit_format_check" CHECK (format IN ('json','csv'));

ALTER TABLE crm_sales.export_audit ADD CONSTRAINT "export_audit_row_count_check" CHECK (row_count BETWEEN 0 AND 10000);

ALTER TABLE crm_sales.export_audit ADD CONSTRAINT "export_audit_byte_count_check" CHECK (byte_count BETWEEN 1 AND 16777216);

ALTER TABLE crm_sales.tasks ADD CONSTRAINT "tasks_completed_at_check" CHECK (
  (status IN ('OPEN', 'IN_PROGRESS') AND completed_at IS NULL)
  OR (status IN ('COMPLETED', 'CANCELLED') AND completed_at IS NOT NULL)
);

ALTER TABLE crm_sales.deals ADD CONSTRAINT "deals_next_task_required_check" CHECK (
  (status = 'OPEN' AND archived_at IS NULL) OR next_task_id IS NULL
);

ALTER TABLE "crm_sales"."reminder_rules" ADD CONSTRAINT "reminder_rules_scope_check" CHECK ("scope" IN ('WORKSPACE', 'PERSONAL'));

ALTER TABLE "crm_sales"."reminder_rules" ADD CONSTRAINT "reminder_rules_version_check" CHECK ("version" >= 1);

ALTER TABLE "crm_sales"."reminder_rules" ADD CONSTRAINT "reminder_rules_subject_check" CHECK (length("owner_subject") BETWEEN 1 AND 256 AND "owner_subject" !~ '[[:space:][:cntrl:]]');

ALTER TABLE "crm_sales"."reminder_rules" ADD CONSTRAINT "reminder_rules_configuration_binding_check" CHECK ((
        jsonb_typeof("configuration") = 'object'
        AND "configuration"->>'schemaVersion' = '1'
        AND ("configuration"->>'id')::uuid = "id"
        AND "configuration"->>'scope' = "scope"
        AND "configuration"->'ownerBinding'->>'subject' = "owner_subject"
        AND ("configuration"->'ownerBinding'->>'membershipId')::uuid IS NOT DISTINCT FROM "owner_membership_id"
        AND jsonb_typeof("configuration"->'enabled') = 'boolean'
    ) IS TRUE);

ALTER TABLE "crm_sales"."reminder_rule_commands" ADD CONSTRAINT "reminder_rule_commands_actor_check" CHECK (length("actor_subject") BETWEEN 1 AND 256 AND "actor_subject" !~ '[[:space:][:cntrl:]]');

ALTER TABLE "crm_sales"."reminder_rule_commands" ADD CONSTRAINT "reminder_rule_commands_type_check" CHECK ("command_type" IN ('CREATED','EDITED','ARCHIVED'));

ALTER TABLE "crm_sales"."reminder_rule_commands" ADD CONSTRAINT "reminder_rule_commands_hash_check" CHECK ("request_hash" ~ '^[a-f0-9]{64}$');

ALTER TABLE crm_sales.reminder_jobs ADD CONSTRAINT "reminder_jobs_status_check" CHECK (status IN ('PENDING','PROCESSING','COMPLETED'));

ALTER TABLE crm_sales.reminder_jobs ADD CONSTRAINT "reminder_jobs_attempts_check" CHECK (attempts>=0);

ALTER TABLE crm_sales.reminder_deliveries ADD CONSTRAINT "reminder_deliveries_deduplication_key_check" CHECK (deduplication_key ~ '^[a-f0-9]{64}$');

ALTER TABLE crm_sales.reminder_deliveries ADD CONSTRAINT "reminder_deliveries_task_version_check" CHECK (task_version>=1);

ALTER TABLE crm_sales.reminder_deliveries ADD CONSTRAINT "reminder_deliveries_rule_version_check" CHECK (rule_version>=1);

ALTER TABLE crm_sales.reminder_deliveries ADD CONSTRAINT "reminder_deliveries_occurrence_index_check" CHECK (occurrence_index BETWEEN 0 AND 999);

ALTER TABLE crm_sales.reminder_deliveries ADD CONSTRAINT "reminder_deliveries_recipient_subject_check" CHECK (char_length(recipient_subject) BETWEEN 1 AND 256 AND recipient_subject !~ '[[:space:][:cntrl:]]');

ALTER TABLE crm_sales.reminder_deliveries ADD CONSTRAINT "reminder_deliveries_channel_check" CHECK (channel IN ('EMAIL','TELEGRAM'));

ALTER TABLE crm_sales.reminder_deliveries ADD CONSTRAINT "reminder_deliveries_status_check" CHECK (status IN ('PENDING','CANCELLED'));

ALTER TABLE crm_sales.reminder_outbox ADD CONSTRAINT "reminder_outbox_payload_check" CHECK (jsonb_typeof(payload)='object');

ALTER TABLE crm_sales.reminder_outbox ADD CONSTRAINT "reminder_outbox_status_check" CHECK (status IN ('PENDING','PROCESSING','PUBLISHED'));

ALTER TABLE crm_sales.reminder_outbox ADD CONSTRAINT "reminder_outbox_attempts_check" CHECK (attempts>=0);

ALTER TABLE crm_sales.reminder_runtime ADD CONSTRAINT "reminder_runtime_id_check" CHECK (id='reminders');

ALTER TABLE crm_sales.task_series ADD CONSTRAINT "task_series_version_check" CHECK (version >= 1);

ALTER TABLE crm_sales.task_series ADD CONSTRAINT "task_series_title_check" CHECK (length(trim(title)) > 0);

ALTER TABLE crm_sales.task_series ADD CONSTRAINT "task_series_frequency_check" CHECK (frequency IN ('DAILY', 'WEEKLY', 'MONTHLY'));

ALTER TABLE crm_sales.task_series ADD CONSTRAINT "task_series_start_date_check" CHECK (start_date ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$');

ALTER TABLE crm_sales.task_series ADD CONSTRAINT "task_series_local_time_check" CHECK (local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

ALTER TABLE crm_sales.task_series ADD CONSTRAINT "task_series_status_check" CHECK (status IN ('ACTIVE', 'PAUSED', 'CANCELLED'));

ALTER TABLE crm_sales.task_series ADD CONSTRAINT "task_series_next_index_check" CHECK (next_index >= 0);

ALTER TABLE crm_sales.task_series ADD CONSTRAINT "task_series_creator_subject_check" CHECK (length(creator_subject) BETWEEN 1 AND 256 AND creator_subject !~ '[[:space:][:cntrl:]]');

ALTER TABLE crm_sales.task_series ADD CONSTRAINT "task_series_assignee_subject_check" CHECK (length(assigned_to_subject) BETWEEN 1 AND 256 AND assigned_to_subject !~ '[[:space:][:cntrl:]]');

ALTER TABLE crm_sales.task_series ADD CONSTRAINT "task_series_blocked_reason_check" CHECK (blocked_reason IS NULL OR blocked_reason IN ('READ_ONLY', 'CREATOR_REVOKED', 'ASSIGNEE_REVOKED', 'SCOPE_CHANGED', 'DEAL_CLOSED'));

ALTER TABLE crm_sales.task_series_commands ADD CONSTRAINT "task_series_commands_request_hash_check" CHECK (request_hash ~ '^[a-f0-9]{64}$');

ALTER TABLE crm_sales.task_series_occurrences ADD CONSTRAINT "task_series_occurrences_period_index_check" CHECK (period_index >= 0);

ALTER TABLE crm_sales.task_series_occurrences ADD CONSTRAINT "task_series_occurrences_series_version_check" CHECK (series_version >= 1);

ALTER TABLE crm_sales.tasks ADD CONSTRAINT "tasks_assignment_clock_pair" CHECK ((assignment_version IS NULL) = (assignment_at IS NULL));

ALTER TABLE crm_sales.task_notifications ADD CONSTRAINT "task_notifications_assignment_version_check" CHECK (assignment_version >= 1);

ALTER TABLE crm_sales.task_notifications ADD CONSTRAINT "task_notifications_kind_check" CHECK (kind IN ('ASSIGNED','DUE'));

CREATE INDEX "pipeline_template_installation_commands_installation_id_created_at_idx"
    ON "crm_sales"."pipeline_template_installation_commands"("installation_id", "created_at");

CREATE INDEX tasks_active_deal_idx ON crm_sales.tasks (workspace_id, deal_id, due_at, id)
  WHERE deal_id IS NOT NULL AND status IN ('OPEN', 'IN_PROGRESS');

CREATE OR REPLACE FUNCTION crm_sales.check_sales_next_action() RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE
  affected_ids UUID[];
  affected_workspaces UUID[];
  affected RECORD;
  deal_record crm_sales.deals%ROWTYPE;
  active_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'deals' THEN
    affected_ids := ARRAY[NEW.id, OLD.id];
  ELSE
    affected_ids := ARRAY[NEW.deal_id, OLD.deal_id];
  END IF;
  affected_workspaces := ARRAY[NEW.workspace_id, OLD.workspace_id];

  FOR affected IN
    SELECT DISTINCT id, workspace_id
    FROM unnest(affected_ids, affected_workspaces) AS targets(id, workspace_id)
    WHERE id IS NOT NULL AND workspace_id IS NOT NULL
    ORDER BY workspace_id, id
  LOOP
    SELECT * INTO deal_record FROM crm_sales.deals
      WHERE id = affected.id AND workspace_id = affected.workspace_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM crm_sales.pipeline_stages
      WHERE id = deal_record.stage_id AND pipeline_id = deal_record.pipeline_id
        AND workspace_id = deal_record.workspace_id AND state = deal_record.status
    ) THEN
      RAISE EXCEPTION 'Deal status must match its pipeline stage';
    END IF;
    SELECT count(*) INTO active_count FROM crm_sales.tasks
      WHERE deal_id = affected.id AND workspace_id = affected.workspace_id
        AND status IN ('OPEN', 'IN_PROGRESS');
    IF deal_record.status = 'OPEN' AND deal_record.archived_at IS NULL THEN
      IF (active_count = 0 AND deal_record.next_task_id IS NOT NULL)
        OR (active_count > 0 AND NOT EXISTS (
          SELECT 1 FROM crm_sales.tasks
          WHERE id = deal_record.next_task_id AND deal_id = affected.id
            AND workspace_id = affected.workspace_id AND status IN ('OPEN', 'IN_PROGRESS')
        )) THEN
        RAISE EXCEPTION 'Deal next action must match its active tasks';
      END IF;
    ELSIF deal_record.archived_at IS NOT NULL AND active_count <> 0 THEN
      RAISE EXCEPTION 'Archived deal cannot retain an active task';
    ELSIF deal_record.status <> 'OPEN' AND TG_TABLE_NAME = 'tasks' AND TG_OP <> 'DELETE' THEN
      IF NEW.deal_id = affected.id AND NEW.workspace_id = affected.workspace_id
        AND NEW.status IN ('OPEN', 'IN_PROGRESS')
        AND (TG_OP = 'INSERT' OR NEW.deal_id IS DISTINCT FROM OLD.deal_id
          OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id) THEN
        RAISE EXCEPTION 'Cannot add an active task to a closed deal';
      END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION crm_sales.check_sales_next_action() FROM PUBLIC;

CREATE FUNCTION crm_sales.reject_intake_proof_mutation() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'Intake operation proofs are append-only' USING ERRCODE = '55000';
END;
$function$;

REVOKE ALL ON FUNCTION crm_sales.reject_intake_proof_mutation() FROM PUBLIC;

CREATE FUNCTION "crm_sales"."reject_reminder_command_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Reminder command evidence is append only';
END;
$$;

REVOKE ALL ON FUNCTION crm_sales.reject_reminder_command_mutation() FROM PUBLIC;

CREATE OR REPLACE FUNCTION crm_sales.wake_task_reminders() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE job_id uuid := gen_random_uuid(); event_id uuid := gen_random_uuid();
 period text; target_task uuid; instant timestamp(3) := (clock_timestamp() AT TIME ZONE 'UTC');
BEGIN
 IF TG_TABLE_NAME='tasks' THEN
   target_task := NEW.id;
   IF TG_OP='UPDATE' THEN
     UPDATE crm_sales.reminder_deliveries SET status='CANCELLED'
     WHERE workspace_id=NEW.workspace_id AND task_id=NEW.id AND status='PENDING'
       AND (assignment_version IS NULL
         OR assignment_version IS DISTINCT FROM NEW.assignment_version
         OR NEW.status NOT IN ('OPEN','IN_PROGRESS'));
   END IF;
   period := 'task:'||NEW.id::text||':'||NEW.version::text||':'||event_id::text;
 ELSE
   UPDATE crm_sales.reminder_deliveries SET status='CANCELLED'
   WHERE workspace_id=NEW.workspace_id AND rule_id=NEW.id AND status='PENDING';
   period := 'rule:'||NEW.id::text||':'||NEW.version::text||':'||event_id::text;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM crm_sales.reminder_rules WHERE workspace_id=NEW.workspace_id
   AND archived_at IS NULL AND configuration->>'enabled'='true') THEN RETURN NEW; END IF;
 INSERT INTO crm_sales.reminder_jobs(id,period_key,workspace_id,task_id)
 VALUES(job_id,period,NEW.workspace_id,target_task);
 INSERT INTO crm_sales.reminder_outbox(id,message_id,event_type,payload)
 VALUES(event_id,event_id,'crm.sales.reminder.tick.v1',jsonb_build_object(
   'schemaVersion',1,'eventId',event_id,'eventType','crm.sales.reminder.tick.v1',
   'occurredAt',to_char(instant,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'jobId',job_id));
 RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION crm_sales.wake_task_reminders() FROM PUBLIC;

CREATE FUNCTION crm_sales.guard_task_series_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW.workspace_id, NEW.creator_subject, NEW.creator_membership_id, NEW.deal_id, NEW.team_id, NEW.frequency, NEW.start_date)
      IS DISTINCT FROM ROW(OLD.id, OLD.workspace_id, OLD.creator_subject, OLD.creator_membership_id, OLD.deal_id, OLD.team_id, OLD.frequency, OLD.start_date)
      OR NEW.next_index < OLD.next_index
      OR (OLD.status = 'CANCELLED' AND NEW.status <> 'CANCELLED') THEN
    RAISE EXCEPTION 'Task series identity, calendar and consumed periods are immutable';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION crm_sales.guard_task_series_identity() FROM PUBLIC;

CREATE FUNCTION crm_sales.track_task_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   NEW.assignment_version := 1;
   NEW.assignment_at := clock_timestamp() AT TIME ZONE 'UTC';
 ELSIF NEW.assigned_to_subject IS DISTINCT FROM OLD.assigned_to_subject
    OR NEW.assigned_to_membership_id IS DISTINCT FROM OLD.assigned_to_membership_id THEN
   NEW.assignment_version := coalesce(OLD.assignment_version,0) + 1;
   NEW.assignment_at := clock_timestamp() AT TIME ZONE 'UTC';
 ELSE
   NEW.assignment_version := OLD.assignment_version;
   NEW.assignment_at := OLD.assignment_at;
 END IF;
 RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION crm_sales.track_task_assignment() FROM PUBLIC;

CREATE FUNCTION crm_sales.record_task_notifications() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE instant timestamp(3) := clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
 IF TG_OP='INSERT' OR NEW.assignment_version IS DISTINCT FROM OLD.assignment_version THEN
   UPDATE crm_sales.task_notifications SET cancelled_at=instant
   WHERE task_id=NEW.id AND cancelled_at IS NULL;
   IF NEW.assignment_version IS NOT NULL AND NEW.status IN ('OPEN','IN_PROGRESS') THEN
     INSERT INTO crm_sales.task_notifications
       (id,workspace_id,task_id,recipient_subject,recipient_membership_id,assignment_version,kind,available_at)
     VALUES
       (gen_random_uuid(),NEW.workspace_id,NEW.id,NEW.assigned_to_subject,NEW.assigned_to_membership_id,NEW.assignment_version,'ASSIGNED',instant),
       (gen_random_uuid(),NEW.workspace_id,NEW.id,NEW.assigned_to_subject,NEW.assigned_to_membership_id,NEW.assignment_version,'DUE',NEW.due_at);
   END IF;
 ELSIF NEW.status NOT IN ('OPEN','IN_PROGRESS') THEN
   UPDATE crm_sales.task_notifications SET cancelled_at=instant
   WHERE task_id=NEW.id AND cancelled_at IS NULL;
 ELSIF NEW.due_at IS DISTINCT FROM OLD.due_at OR OLD.status NOT IN ('OPEN','IN_PROGRESS') THEN
   UPDATE crm_sales.task_notifications
   SET available_at=NEW.due_at,read_at=NULL,cancelled_at=NULL
   WHERE task_id=NEW.id AND assignment_version=NEW.assignment_version AND kind='DUE';
 END IF;
 RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION crm_sales.record_task_notifications() FROM PUBLIC;

CREATE FUNCTION crm_sales.notify_live_change() RETURNS trigger
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

REVOKE ALL ON FUNCTION crm_sales.notify_live_change() FROM PUBLIC;

CREATE FUNCTION "crm_sales"."enforce_service_identity_integrity"() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, crm_sales AS $$
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
REVOKE ALL ON FUNCTION "crm_sales"."enforce_service_identity_integrity"() FROM PUBLIC;

INSERT INTO "crm_sales"."service_identity" ("id", "service_name", "database_id", "updated_at")
VALUES ('singleton', 'crm-sales-service', gen_random_uuid(), CURRENT_TIMESTAMP);

CREATE CONSTRAINT TRIGGER "deals_next_action_integrity" AFTER INSERT OR UPDATE ON "crm_sales"."deals" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "crm_sales"."check_sales_next_action"();

CREATE CONSTRAINT TRIGGER "tasks_next_action_integrity" AFTER INSERT OR UPDATE OR DELETE ON "crm_sales"."tasks" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "crm_sales"."check_sales_next_action"();

CREATE TRIGGER intake_operation_slots_append_only BEFORE UPDATE OR DELETE ON crm_sales.intake_operation_slots
  FOR EACH ROW EXECUTE FUNCTION crm_sales.reject_intake_proof_mutation();

CREATE TRIGGER intake_operation_slots_no_truncate BEFORE TRUNCATE ON crm_sales.intake_operation_slots
  FOR EACH STATEMENT EXECUTE FUNCTION crm_sales.reject_intake_proof_mutation();

CREATE TRIGGER intake_operation_commands_append_only BEFORE UPDATE OR DELETE ON crm_sales.intake_operation_commands
  FOR EACH ROW EXECUTE FUNCTION crm_sales.reject_intake_proof_mutation();

CREATE TRIGGER intake_operation_commands_no_truncate BEFORE TRUNCATE ON crm_sales.intake_operation_commands
  FOR EACH STATEMENT EXECUTE FUNCTION crm_sales.reject_intake_proof_mutation();

CREATE TRIGGER "reminder_rule_commands_append_only" BEFORE UPDATE OR DELETE ON "crm_sales"."reminder_rule_commands" FOR EACH ROW EXECUTE FUNCTION "crm_sales"."reject_reminder_command_mutation"();

CREATE TRIGGER "reminder_rule_commands_no_truncate" BEFORE TRUNCATE ON "crm_sales"."reminder_rule_commands" FOR EACH STATEMENT EXECUTE FUNCTION "crm_sales"."reject_reminder_command_mutation"();

CREATE TRIGGER tasks_reminder_wake AFTER INSERT OR UPDATE OF version,due_at,status,assigned_to_subject,assigned_to_membership_id,team_id ON crm_sales.tasks
FOR EACH ROW EXECUTE FUNCTION crm_sales.wake_task_reminders();

CREATE TRIGGER rules_reminder_wake AFTER INSERT OR UPDATE OF version,configuration,archived_at ON crm_sales.reminder_rules
FOR EACH ROW EXECUTE FUNCTION crm_sales.wake_task_reminders();

CREATE TRIGGER task_series_identity_guard BEFORE UPDATE ON crm_sales.task_series FOR EACH ROW EXECUTE FUNCTION crm_sales.guard_task_series_identity();

CREATE TRIGGER task_series_commands_append_only BEFORE UPDATE OR DELETE ON crm_sales.task_series_commands FOR EACH ROW EXECUTE FUNCTION crm_sales.reject_reminder_command_mutation();

CREATE TRIGGER task_series_commands_no_truncate BEFORE TRUNCATE ON crm_sales.task_series_commands FOR EACH STATEMENT EXECUTE FUNCTION crm_sales.reject_reminder_command_mutation();

CREATE TRIGGER task_series_occurrences_append_only BEFORE UPDATE OR DELETE ON crm_sales.task_series_occurrences FOR EACH ROW EXECUTE FUNCTION crm_sales.reject_reminder_command_mutation();

CREATE TRIGGER task_series_occurrences_no_truncate BEFORE TRUNCATE ON crm_sales.task_series_occurrences FOR EACH STATEMENT EXECUTE FUNCTION crm_sales.reject_reminder_command_mutation();

CREATE TRIGGER tasks_assignment_clock BEFORE INSERT OR UPDATE ON crm_sales.tasks
FOR EACH ROW EXECUTE FUNCTION crm_sales.track_task_assignment();

CREATE TRIGGER tasks_notification_center AFTER INSERT OR UPDATE ON crm_sales.tasks
FOR EACH ROW EXECUTE FUNCTION crm_sales.record_task_notifications();

CREATE TRIGGER deals_live_change AFTER INSERT OR UPDATE OR DELETE ON crm_sales.deals
FOR EACH ROW EXECUTE FUNCTION crm_sales.notify_live_change('workspace_id');

CREATE TRIGGER tasks_live_change AFTER INSERT OR UPDATE OR DELETE ON crm_sales.tasks
FOR EACH ROW EXECUTE FUNCTION crm_sales.notify_live_change('workspace_id');

CREATE TRIGGER pipelines_live_change AFTER INSERT OR UPDATE OR DELETE ON crm_sales.pipelines
FOR EACH ROW EXECUTE FUNCTION crm_sales.notify_live_change('workspace_id');

CREATE TRIGGER pipeline_stages_live_change AFTER INSERT OR UPDATE OR DELETE ON crm_sales.pipeline_stages
FOR EACH ROW EXECUTE FUNCTION crm_sales.notify_live_change('workspace_id');

CREATE TRIGGER task_series_live_change AFTER INSERT OR UPDATE OR DELETE ON crm_sales.task_series
FOR EACH ROW EXECUTE FUNCTION crm_sales.notify_live_change('workspace_id');

CREATE TRIGGER task_timeline_live_change AFTER INSERT OR UPDATE OR DELETE ON crm_sales.task_timeline
FOR EACH ROW EXECUTE FUNCTION crm_sales.notify_live_change('workspace_id');

CREATE TRIGGER task_notifications_live_change AFTER INSERT OR UPDATE OR DELETE ON crm_sales.task_notifications
FOR EACH ROW EXECUTE FUNCTION crm_sales.notify_live_change('workspace_id');

CREATE TRIGGER deal_timeline_live_change AFTER INSERT OR UPDATE OR DELETE ON crm_sales.deal_timeline
FOR EACH ROW EXECUTE FUNCTION crm_sales.notify_live_change('workspace_id');

CREATE TRIGGER service_identity_integrity_guard BEFORE UPDATE OR DELETE ON "crm_sales"."service_identity"
FOR EACH ROW EXECUTE FUNCTION "crm_sales"."enforce_service_identity_integrity"();

ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA "crm_sales" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "crm_sales" FROM PUBLIC;

COMMIT;
