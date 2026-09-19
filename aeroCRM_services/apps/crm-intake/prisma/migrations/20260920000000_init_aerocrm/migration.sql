-- The owner role receives a pre-created private schema from deployment bootstrap.
DO $aerocrm_schema_owner$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_namespace
    WHERE nspname = 'crm_intake' AND nspowner = to_regrole(CURRENT_USER)
  ) THEN
    RAISE EXCEPTION 'crm_intake schema must exist and be owned by the migration role';
  END IF;
END
$aerocrm_schema_owner$;

-- CreateTable
CREATE TABLE "crm_intake"."export_audit" (
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
CREATE TABLE "crm_intake"."service_identity" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "service_name" TEXT NOT NULL DEFAULT 'crm-intake-service',
    "database_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_intake"."sla_rules" (
    "workspace_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "owner_binding" JSONB NOT NULL,
    "effective_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_rules_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "crm_intake"."sla_commands" (
    "command_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "action" VARCHAR(24) NOT NULL,
    "entity_id" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sla_commands_pkey" PRIMARY KEY ("command_id")
);

-- CreateTable
CREATE TABLE "crm_intake"."sla_jobs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "rule_version" INTEGER NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "recipient_cursor" UUID,
    "active_event_id" UUID NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    "breached_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_intake"."sla_notifications" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "recipient_subject" VARCHAR(256) NOT NULL,
    "recipient_membership_id" UUID,
    "channel" VARCHAR(16) NOT NULL,
    "deduplication_key" CHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sla_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_intake"."sla_receipts" (
    "event_id" UUID NOT NULL,
    "consumer" VARCHAR(64) NOT NULL,
    "workspace_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "lease_token" UUID,
    "lease_until" TIMESTAMP(3),
    "retry_attempt" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_receipts_pkey" PRIMARY KEY ("event_id","consumer")
);

-- CreateTable
CREATE TABLE "crm_intake"."sla_outbox" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "deduplication_key" VARCHAR(256) NOT NULL,
    "route" VARCHAR(16) NOT NULL DEFAULT 'MAIN',
    "payload" JSONB NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_token" UUID,
    "lease_until" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "retry_attempt" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" VARCHAR(64),
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sla_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_intake"."inbox_entries" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(16),
    "email" VARCHAR(254),
    "message" VARCHAR(5000),
    "origin" VARCHAR(16) NOT NULL,
    "source_id" UUID,
    "status" VARCHAR(16) NOT NULL DEFAULT 'NEW',
    "created_by_subject" VARCHAR(256) NOT NULL,
    "team_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "contact_id" UUID,
    "deal_id" UUID,
    "rejection_reason" VARCHAR(2000),
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),

    CONSTRAINT "inbox_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_intake"."intake_sources" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "kind" VARCHAR(16) NOT NULL DEFAULT 'API',
    "token_hash" CHAR(64) NOT NULL,
    "token_version" INTEGER NOT NULL DEFAULT 1,
    "created_by_subject" VARCHAR(256) NOT NULL,
    "team_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intake_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_intake"."intake_commands" (
    "command_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "entity_kind" VARCHAR(16) NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intake_commands_pkey" PRIMARY KEY ("command_id")
);

-- CreateTable
CREATE TABLE "crm_intake"."intake_activities" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "entity_kind" VARCHAR(16) NOT NULL,
    "command_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "action" VARCHAR(32) NOT NULL,
    "entity_version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intake_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_intake"."csv_imports" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "created_by_subject" VARCHAR(256) NOT NULL,
    "team_id" UUID,
    "label" VARCHAR(200) NOT NULL,
    "row_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "csv_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_intake"."csv_import_rows" (
    "import_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "row_number" SMALLINT NOT NULL,
    "entry_id" UUID NOT NULL,
    "audit_command_id" UUID NOT NULL,

    CONSTRAINT "csv_import_rows_pkey" PRIMARY KEY ("import_id","row_number")
);

-- CreateTable
CREATE TABLE "crm_intake"."inbound_receipts" (
    "source_id" UUID NOT NULL,
    "external_command_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "audit_command_id" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbound_receipts_pkey" PRIMARY KEY ("source_id","external_command_id")
);

-- CreateTable
CREATE TABLE "crm_intake"."ingestion_rate_buckets" (
    "bucket_key" VARCHAR(80) NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "ingestion_rate_buckets_pkey" PRIMARY KEY ("bucket_key","window_start")
);

-- CreateTable
CREATE TABLE "crm_intake"."acceptances" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'QUEUED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "mode" VARCHAR(16) NOT NULL DEFAULT 'EXECUTE',
    "contact_operation_id" UUID NOT NULL,
    "sales_operation_id" UUID NOT NULL,
    "contact_command_id" UUID NOT NULL,
    "sales_command_id" UUID NOT NULL,
    "contact_payload" JSONB NOT NULL,
    "sales_payload" JSONB NOT NULL,
    "contact_payload_hash" CHAR(64) NOT NULL,
    "sales_payload_hash" CHAR(64) NOT NULL,
    "contact_proof" JSONB,
    "sales_proof" JSONB,
    "contact_id" UUID,
    "deal_id" UUID,
    "first_task_id" UUID,
    "recovery_subject" VARCHAR(256),
    "recovery_contact_command_id" UUID,
    "recovery_sales_command_id" UUID,
    "last_error_code" VARCHAR(64),
    "retry_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_intake"."acceptance_outbox" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "deduplication_key" VARCHAR(256) NOT NULL,
    "route" VARCHAR(16) NOT NULL DEFAULT 'MAIN',
    "payload" JSONB NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_token" UUID,
    "lease_until" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "retry_attempt" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" VARCHAR(64),
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acceptance_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_intake"."acceptance_receipts" (
    "event_id" UUID NOT NULL,
    "consumer" VARCHAR(80) NOT NULL,
    "workspace_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "lease_token" UUID,
    "lease_until" TIMESTAMP(3),
    "retry_attempt" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "acceptance_receipts_pkey" PRIMARY KEY ("event_id","consumer")
);

-- CreateTable
CREATE TABLE "crm_intake"."inbox_notifications" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_intake"."inbox_notification_reads" (
    "notification_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "recipient_subject" VARCHAR(256) NOT NULL,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "inbox_notification_reads_pkey" PRIMARY KEY ("notification_id","recipient_subject")
);

-- CreateIndex
CREATE INDEX "export_audit_workspace_prepared_idx" ON "crm_intake"."export_audit"("workspace_id", "prepared_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "service_identity_database_id_key" ON "crm_intake"."service_identity"("database_id");

-- CreateIndex
CREATE INDEX "sla_commands_workspace_id_created_at_command_id_idx" ON "crm_intake"."sla_commands"("workspace_id", "created_at", "command_id");

-- CreateIndex
CREATE UNIQUE INDEX "sla_jobs_active_event_id_key" ON "crm_intake"."sla_jobs"("active_event_id");

-- CreateIndex
CREATE INDEX "sla_jobs_workspace_id_status_due_at_id_idx" ON "crm_intake"."sla_jobs"("workspace_id", "status", "due_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sla_jobs_workspace_id_entry_id_rule_version_key" ON "crm_intake"."sla_jobs"("workspace_id", "entry_id", "rule_version");

-- CreateIndex
CREATE UNIQUE INDEX "sla_jobs_workspace_id_id_key" ON "crm_intake"."sla_jobs"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sla_notifications_deduplication_key_key" ON "crm_intake"."sla_notifications"("deduplication_key");

-- CreateIndex
CREATE INDEX "sla_notifications_workspace_id_job_id_idx" ON "crm_intake"."sla_notifications"("workspace_id", "job_id");

-- CreateIndex
CREATE INDEX "sla_receipts_status_lease_until_idx" ON "crm_intake"."sla_receipts"("status", "lease_until");

-- CreateIndex
CREATE UNIQUE INDEX "sla_outbox_deduplication_key_key" ON "crm_intake"."sla_outbox"("deduplication_key");

-- CreateIndex
CREATE INDEX "sla_outbox_status_available_at_id_idx" ON "crm_intake"."sla_outbox"("status", "available_at", "id");

-- CreateIndex
CREATE INDEX "inbox_entries_workspace_id_status_received_at_id_idx" ON "crm_intake"."inbox_entries"("workspace_id", "status", "received_at", "id");

-- CreateIndex
CREATE INDEX "inbox_entries_workspace_id_created_by_subject_status_idx" ON "crm_intake"."inbox_entries"("workspace_id", "created_by_subject", "status");

-- CreateIndex
CREATE INDEX "inbox_entries_workspace_id_team_id_status_idx" ON "crm_intake"."inbox_entries"("workspace_id", "team_id", "status");

-- CreateIndex
CREATE INDEX "inbox_entries_workspace_id_source_id_idx" ON "crm_intake"."inbox_entries"("workspace_id", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "inbox_entries_workspace_id_id_key" ON "crm_intake"."inbox_entries"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "intake_sources_token_hash_key" ON "crm_intake"."intake_sources"("token_hash");

-- CreateIndex
CREATE INDEX "intake_sources_workspace_id_created_at_id_idx" ON "crm_intake"."intake_sources"("workspace_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "intake_sources_workspace_id_id_key" ON "crm_intake"."intake_sources"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "intake_commands_workspace_id_entity_id_idx" ON "crm_intake"."intake_commands"("workspace_id", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "intake_activities_command_id_key" ON "crm_intake"."intake_activities"("command_id");

-- CreateIndex
CREATE INDEX "intake_activities_entity_created_idx" ON "crm_intake"."intake_activities"("workspace_id", "entity_kind", "entity_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "csv_imports_workspace_id_created_by_subject_created_at_idx" ON "crm_intake"."csv_imports"("workspace_id", "created_by_subject", "created_at");

-- CreateIndex
CREATE INDEX "csv_imports_workspace_id_team_id_created_at_idx" ON "crm_intake"."csv_imports"("workspace_id", "team_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "csv_imports_workspace_id_id_key" ON "crm_intake"."csv_imports"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "csv_import_rows_audit_command_id_key" ON "crm_intake"."csv_import_rows"("audit_command_id");

-- CreateIndex
CREATE UNIQUE INDEX "csv_import_rows_workspace_id_entry_id_key" ON "crm_intake"."csv_import_rows"("workspace_id", "entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_receipts_audit_command_id_key" ON "crm_intake"."inbound_receipts"("audit_command_id");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_receipts_workspace_id_entry_id_key" ON "crm_intake"."inbound_receipts"("workspace_id", "entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "acceptances_contact_operation_id_key" ON "crm_intake"."acceptances"("contact_operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "acceptances_sales_operation_id_key" ON "crm_intake"."acceptances"("sales_operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "acceptances_contact_command_id_key" ON "crm_intake"."acceptances"("contact_command_id");

-- CreateIndex
CREATE UNIQUE INDEX "acceptances_sales_command_id_key" ON "crm_intake"."acceptances"("sales_command_id");

-- CreateIndex
CREATE INDEX "acceptances_workspace_id_entry_id_created_at_idx" ON "crm_intake"."acceptances"("workspace_id", "entry_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "acceptance_outbox_deduplication_key_key" ON "crm_intake"."acceptance_outbox"("deduplication_key");

-- CreateIndex
CREATE INDEX "acceptance_outbox_status_available_at_id_idx" ON "crm_intake"."acceptance_outbox"("status", "available_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "inbox_notifications_entry_id_key" ON "crm_intake"."inbox_notifications"("entry_id");

-- CreateIndex
CREATE INDEX "inbox_notifications_workspace_id_created_at_id_idx" ON "crm_intake"."inbox_notifications"("workspace_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "inbox_notifications_id_workspace_id_key" ON "crm_intake"."inbox_notifications"("id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "inbox_notifications_workspace_id_entry_id_key" ON "crm_intake"."inbox_notifications"("workspace_id", "entry_id");

-- AddForeignKey
ALTER TABLE "crm_intake"."inbox_entries" ADD CONSTRAINT "inbox_entries_workspace_id_source_id_fkey" FOREIGN KEY ("workspace_id", "source_id") REFERENCES "crm_intake"."intake_sources"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "crm_intake"."csv_imports" ADD CONSTRAINT "csv_imports_id_fkey" FOREIGN KEY ("id") REFERENCES "crm_intake"."intake_commands"("command_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "crm_intake"."csv_import_rows" ADD CONSTRAINT "csv_import_rows_workspace_id_import_id_fkey" FOREIGN KEY ("workspace_id", "import_id") REFERENCES "crm_intake"."csv_imports"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "crm_intake"."csv_import_rows" ADD CONSTRAINT "csv_import_rows_workspace_id_entry_id_fkey" FOREIGN KEY ("workspace_id", "entry_id") REFERENCES "crm_intake"."inbox_entries"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "crm_intake"."csv_import_rows" ADD CONSTRAINT "csv_import_rows_audit_command_id_fkey" FOREIGN KEY ("audit_command_id") REFERENCES "crm_intake"."intake_activities"("command_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "crm_intake"."inbound_receipts" ADD CONSTRAINT "inbound_receipts_workspace_id_source_id_fkey" FOREIGN KEY ("workspace_id", "source_id") REFERENCES "crm_intake"."intake_sources"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "crm_intake"."inbound_receipts" ADD CONSTRAINT "inbound_receipts_workspace_id_entry_id_fkey" FOREIGN KEY ("workspace_id", "entry_id") REFERENCES "crm_intake"."inbox_entries"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "crm_intake"."inbox_notifications" ADD CONSTRAINT "inbox_notifications_workspace_id_entry_id_fkey" FOREIGN KEY ("workspace_id", "entry_id") REFERENCES "crm_intake"."inbox_entries"("workspace_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "crm_intake"."inbox_notification_reads" ADD CONSTRAINT "inbox_notification_reads_notification_id_workspace_id_fkey" FOREIGN KEY ("notification_id", "workspace_id") REFERENCES "crm_intake"."inbox_notifications"("id", "workspace_id") ON DELETE CASCADE ON UPDATE NO ACTION;


-- Service-owned steady-state constraints omitted by Prisma's datamodel diff.
ALTER TABLE crm_intake.service_identity ADD CONSTRAINT service_identity_singleton_check CHECK (id = 'singleton');
ALTER TABLE crm_intake.service_identity ADD CONSTRAINT service_identity_name_check CHECK (service_name = 'crm-intake-service');
INSERT INTO crm_intake.service_identity (id, service_name, database_id, created_at, updated_at)
VALUES ('singleton', 'crm-intake-service', gen_random_uuid(), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

ALTER TABLE crm_intake.intake_sources ADD CONSTRAINT intake_sources_name_check CHECK (char_length(btrim(name)) > 0 AND name = btrim(name));
ALTER TABLE crm_intake.intake_sources ADD CONSTRAINT intake_sources_kind_check CHECK (kind = 'API');
ALTER TABLE crm_intake.intake_sources ADD CONSTRAINT intake_sources_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE crm_intake.intake_sources ADD CONSTRAINT intake_sources_version_check CHECK (version > 0 AND token_version > 0);
ALTER TABLE crm_intake.intake_sources ADD CONSTRAINT intake_sources_actor_check CHECK (char_length(created_by_subject) > 0);

ALTER TABLE crm_intake.inbox_entries ADD CONSTRAINT inbox_entries_title_check CHECK (char_length(btrim(title)) > 0 AND title = btrim(title));
ALTER TABLE crm_intake.inbox_entries ADD CONSTRAINT inbox_entries_name_check CHECK (char_length(btrim(name)) > 0 AND name = btrim(name));
ALTER TABLE crm_intake.inbox_entries ADD CONSTRAINT inbox_entries_phone_check CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$');
ALTER TABLE crm_intake.inbox_entries ADD CONSTRAINT inbox_entries_origin_check CHECK (origin IN ('MANUAL','API','CSV'));
ALTER TABLE crm_intake.inbox_entries ADD CONSTRAINT inbox_entries_origin_source_check CHECK ((origin IN ('MANUAL','CSV') AND source_id IS NULL) OR (origin = 'API' AND source_id IS NOT NULL));
ALTER TABLE crm_intake.inbox_entries ADD CONSTRAINT inbox_entries_status_check CHECK (status IN ('NEW','ACCEPTED','REJECTED'));
ALTER TABLE crm_intake.inbox_entries ADD CONSTRAINT inbox_entries_actor_check CHECK (char_length(created_by_subject) > 0);
ALTER TABLE crm_intake.inbox_entries ADD CONSTRAINT inbox_entries_version_check CHECK (version > 0);
ALTER TABLE crm_intake.inbox_entries ADD CONSTRAINT inbox_entries_outcome_check CHECK (
 (status = 'NEW' AND contact_id IS NULL AND deal_id IS NULL AND accepted_at IS NULL AND rejected_at IS NULL AND rejection_reason IS NULL)
 OR (status = 'ACCEPTED' AND contact_id IS NOT NULL AND deal_id IS NOT NULL AND accepted_at IS NOT NULL AND rejected_at IS NULL AND rejection_reason IS NULL)
 OR (status = 'REJECTED' AND contact_id IS NULL AND deal_id IS NULL AND accepted_at IS NULL AND rejected_at IS NOT NULL AND rejection_reason IS NOT NULL AND char_length(btrim(rejection_reason)) > 0)
);

ALTER TABLE crm_intake.intake_commands ADD CONSTRAINT intake_commands_entity_kind_check CHECK (entity_kind IN ('entry','source','import'));
ALTER TABLE crm_intake.intake_commands ADD CONSTRAINT intake_commands_actor_check CHECK (char_length(actor_subject) > 0);
ALTER TABLE crm_intake.intake_commands ADD CONSTRAINT intake_commands_request_hash_check CHECK (request_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE crm_intake.intake_commands ADD CONSTRAINT intake_commands_response_check CHECK (jsonb_typeof(response) = 'object');
ALTER TABLE crm_intake.intake_activities ADD CONSTRAINT intake_activities_entity_kind_check CHECK (entity_kind IN ('entry','source'));
ALTER TABLE crm_intake.intake_activities ADD CONSTRAINT intake_activities_action_check CHECK (action IN ('CREATED','REJECTED','SOURCE_CREATED','SOURCE_TOKEN_ROTATED','SOURCE_REVOKED','ACCEPTANCE_REQUESTED','ACCEPTANCE_RETRIED','ACCEPTANCE_RECOVERY_REQUESTED','ACCEPTANCE_CANCELLED','ACCEPTED'));
ALTER TABLE crm_intake.intake_activities ADD CONSTRAINT intake_activities_version_check CHECK (entity_version > 0);

ALTER TABLE crm_intake.inbound_receipts ADD CONSTRAINT inbound_receipts_request_hash_check CHECK (request_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE crm_intake.ingestion_rate_buckets ADD CONSTRAINT ingestion_rate_buckets_count_check CHECK (count > 0);
ALTER TABLE crm_intake.csv_imports ADD CONSTRAINT csv_imports_actor_check CHECK (char_length(created_by_subject) BETWEEN 1 AND 256 AND created_by_subject !~ '[[:space:][:cntrl:]]');
ALTER TABLE crm_intake.csv_imports ADD CONSTRAINT csv_imports_label_check CHECK (char_length(btrim(label)) > 0 AND label !~ '[/\\[:cntrl:]]' AND label NOT IN ('.', '..'));
ALTER TABLE crm_intake.csv_imports ADD CONSTRAINT csv_imports_row_count_check CHECK (row_count BETWEEN 1 AND 250);
ALTER TABLE crm_intake.csv_import_rows ADD CONSTRAINT csv_import_rows_row_number_check CHECK (row_number BETWEEN 1 AND 250);
ALTER TABLE crm_intake.csv_imports ALTER CONSTRAINT csv_imports_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE crm_intake.export_audit ADD CONSTRAINT export_audit_actor_check CHECK (char_length(actor_subject) BETWEEN 1 AND 256 AND actor_subject !~ '[[:space:][:cntrl:]]');
ALTER TABLE crm_intake.export_audit ADD CONSTRAINT export_audit_entity_check CHECK (entity IN ('inbox'));
ALTER TABLE crm_intake.export_audit ADD CONSTRAINT export_audit_format_check CHECK (format IN ('json','csv'));
ALTER TABLE crm_intake.export_audit ADD CONSTRAINT export_audit_count_check CHECK (row_count BETWEEN 0 AND 10000 AND byte_count BETWEEN 1 AND 16777216);

ALTER TABLE crm_intake.acceptances ADD CONSTRAINT acceptances_status_check CHECK (status IN ('QUEUED','RUNNING','RETRY_WAIT','BLOCKED','FAILED','RECOVERING','CANCELLED','COMPLETED'));
ALTER TABLE crm_intake.acceptances ADD CONSTRAINT acceptances_mode_check CHECK (mode IN ('EXECUTE','RECOVER'));
ALTER TABLE crm_intake.acceptances ADD CONSTRAINT acceptances_version_check CHECK (version > 0 AND generation > 0);
ALTER TABLE crm_intake.acceptances ADD CONSTRAINT acceptances_payload_check CHECK (jsonb_typeof(contact_payload) = 'object' AND jsonb_typeof(sales_payload) = 'object');
ALTER TABLE crm_intake.acceptances ADD CONSTRAINT acceptances_payload_hash_check CHECK (contact_payload_hash ~ '^[a-f0-9]{64}$' AND sales_payload_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE crm_intake.acceptances ADD CONSTRAINT acceptances_completed_check CHECK (status <> 'COMPLETED' OR (contact_id IS NOT NULL AND deal_id IS NOT NULL AND first_task_id IS NOT NULL AND contact_proof IS NOT NULL AND sales_proof IS NOT NULL AND completed_at IS NOT NULL));
ALTER TABLE crm_intake.acceptances ADD CONSTRAINT acceptances_recovery_check CHECK (mode <> 'RECOVER' OR (recovery_subject IS NOT NULL AND recovery_contact_command_id IS NOT NULL AND recovery_sales_command_id IS NOT NULL));
CREATE UNIQUE INDEX acceptances_active_entry_key ON crm_intake.acceptances(workspace_id, entry_id) WHERE status <> 'CANCELLED';
ALTER TABLE crm_intake.acceptance_outbox ADD CONSTRAINT acceptance_outbox_route_check CHECK (route IN ('MAIN','RETRY_1','RETRY_2','RETRY_3','DLQ'));
ALTER TABLE crm_intake.acceptance_outbox ADD CONSTRAINT acceptance_outbox_payload_check CHECK (jsonb_typeof(payload) = 'object');
ALTER TABLE crm_intake.acceptance_outbox ADD CONSTRAINT acceptance_outbox_status_check CHECK (status IN ('PENDING','PUBLISHING','PUBLISHED'));
ALTER TABLE crm_intake.acceptance_outbox ADD CONSTRAINT acceptance_outbox_lease_check CHECK ((status='PUBLISHING' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR (status<>'PUBLISHING' AND lease_token IS NULL AND lease_until IS NULL));
ALTER TABLE crm_intake.acceptance_receipts ADD CONSTRAINT acceptance_receipts_hash_check CHECK (payload_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE crm_intake.acceptance_receipts ADD CONSTRAINT acceptance_receipts_status_check CHECK (status IN ('PROCESSING','DELIVERED','RETRY_SCHEDULED','DEAD_LETTERED'));
ALTER TABLE crm_intake.acceptance_receipts ADD CONSTRAINT acceptance_receipts_lease_check CHECK ((status='PROCESSING' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR (status<>'PROCESSING' AND lease_token IS NULL AND lease_until IS NULL));

-- Immutable CSV import proof.
CREATE FUNCTION crm_intake.check_csv_import_integrity() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    batch_id UUID;
    batch crm_intake.csv_imports%ROWTYPE;
BEGIN
    IF TG_TABLE_NAME = 'csv_imports' THEN batch_id := NEW.id;
    ELSE batch_id := NEW.import_id; END IF;
    SELECT * INTO STRICT batch FROM crm_intake.csv_imports WHERE id = batch_id;
    IF (SELECT count(*) FROM crm_intake.csv_import_rows WHERE import_id = batch_id) <> batch.row_count
       OR EXISTS (
           SELECT 1 FROM crm_intake.csv_import_rows r
           JOIN crm_intake.inbox_entries e ON e.workspace_id = r.workspace_id AND e.id = r.entry_id
           JOIN crm_intake.intake_activities a ON a.command_id = r.audit_command_id
           WHERE r.import_id = batch_id AND (
               r.row_number > batch.row_count OR e.origin <> 'CSV' OR e.source_id IS NOT NULL
               OR e.created_by_subject <> batch.created_by_subject OR e.team_id IS DISTINCT FROM batch.team_id
               OR a.workspace_id <> batch.workspace_id OR a.entity_id <> e.id OR a.entity_kind <> 'entry'
               OR a.actor_subject <> batch.created_by_subject OR a.action <> 'CREATED' OR a.entity_version <> 1
           )
       ) OR NOT EXISTS (
           SELECT 1 FROM crm_intake.intake_commands c WHERE c.command_id = batch_id
           AND c.workspace_id = batch.workspace_id AND c.entity_id = batch_id
           AND c.entity_kind = 'import' AND c.actor_subject = batch.created_by_subject
       ) THEN
        RAISE EXCEPTION 'Invalid CSV import proof' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER csv_imports_integrity_check AFTER INSERT ON crm_intake.csv_imports
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crm_intake.check_csv_import_integrity();
CREATE CONSTRAINT TRIGGER csv_import_rows_integrity_check AFTER INSERT ON crm_intake.csv_import_rows
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crm_intake.check_csv_import_integrity();

-- SLA cancellation and immutable receipt/outbox bindings.
CREATE FUNCTION crm_intake.cancel_entry_sla() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status <> 'NEW' OR EXISTS (
  SELECT 1 FROM crm_intake.acceptances a WHERE a.workspace_id=NEW.workspace_id AND a.entry_id=NEW.id
 ) THEN
  UPDATE crm_intake.sla_jobs SET status = 'CANCELLED', updated_at = clock_timestamp() AT TIME ZONE 'UTC'
   WHERE workspace_id = NEW.workspace_id AND entry_id = NEW.id AND status <> 'CANCELLED';
 END IF;
 RETURN NEW;
END $$;
-- Acceptance commits its request and increments entry.version while status is still NEW.
CREATE TRIGGER inbox_entries_cancel_sla AFTER UPDATE OF status,version ON crm_intake.inbox_entries
 FOR EACH ROW EXECUTE FUNCTION crm_intake.cancel_entry_sla();

CREATE FUNCTION crm_intake.sla_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME = 'sla_jobs' THEN
 IF
  ROW(NEW.id,NEW.workspace_id,NEW.entry_id,NEW.rule_version,NEW.due_at,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.entry_id,OLD.rule_version,OLD.due_at,OLD.created_at) THEN
  RAISE EXCEPTION 'immutable SLA job binding';
 END IF;
 ELSIF TG_TABLE_NAME = 'sla_receipts' THEN
 IF
  ROW(NEW.event_id,NEW.consumer,NEW.workspace_id,NEW.job_id,NEW.payload_hash,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.event_id,OLD.consumer,OLD.workspace_id,OLD.job_id,OLD.payload_hash,OLD.created_at) THEN
  RAISE EXCEPTION 'immutable SLA receipt binding';
 END IF;
 ELSIF TG_TABLE_NAME = 'sla_outbox' THEN
 IF
  ROW(NEW.id,NEW.event_id,NEW.deduplication_key,NEW.route,NEW.payload,NEW.retry_attempt,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.id,OLD.event_id,OLD.deduplication_key,OLD.route,OLD.payload,OLD.retry_attempt,OLD.created_at) THEN
  RAISE EXCEPTION 'immutable SLA Outbox binding';
 END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sla_jobs_immutable BEFORE UPDATE ON crm_intake.sla_jobs FOR EACH ROW EXECUTE FUNCTION crm_intake.sla_immutable();
CREATE TRIGGER sla_receipts_immutable BEFORE UPDATE ON crm_intake.sla_receipts FOR EACH ROW EXECUTE FUNCTION crm_intake.sla_immutable();
CREATE TRIGGER sla_outbox_immutable BEFORE UPDATE ON crm_intake.sla_outbox FOR EACH ROW EXECUTE FUNCTION crm_intake.sla_immutable();

-- Workspace-scoped live notifications.
CREATE FUNCTION crm_intake.notify_live_change() RETURNS trigger
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
REVOKE ALL ON FUNCTION crm_intake.notify_live_change() FROM PUBLIC;
CREATE TRIGGER inbox_entries_live_change AFTER INSERT OR UPDATE OR DELETE ON crm_intake.inbox_entries
FOR EACH ROW EXECUTE FUNCTION crm_intake.notify_live_change('workspace_id');
CREATE TRIGGER intake_sources_live_change AFTER INSERT OR UPDATE OR DELETE ON crm_intake.intake_sources
FOR EACH ROW EXECUTE FUNCTION crm_intake.notify_live_change('workspace_id');
CREATE TRIGGER intake_activities_live_change AFTER INSERT OR UPDATE OR DELETE ON crm_intake.intake_activities
FOR EACH ROW EXECUTE FUNCTION crm_intake.notify_live_change('workspace_id');
CREATE TRIGGER csv_imports_live_change AFTER INSERT OR UPDATE OR DELETE ON crm_intake.csv_imports
FOR EACH ROW EXECUTE FUNCTION crm_intake.notify_live_change('workspace_id');
CREATE TRIGGER acceptances_live_change AFTER INSERT OR UPDATE OR DELETE ON crm_intake.acceptances
FOR EACH ROW EXECUTE FUNCTION crm_intake.notify_live_change('workspace_id');
CREATE TRIGGER sla_jobs_live_change AFTER INSERT OR UPDATE OR DELETE ON crm_intake.sla_jobs
FOR EACH ROW EXECUTE FUNCTION crm_intake.notify_live_change('workspace_id');

-- New inbox entries have one durable notification.
CREATE FUNCTION crm_intake.record_inbox_notification() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 INSERT INTO crm_intake.inbox_notifications(workspace_id, entry_id) VALUES(NEW.workspace_id, NEW.id);
 RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION crm_intake.record_inbox_notification() FROM PUBLIC;
CREATE TRIGGER inbox_entries_notification AFTER INSERT ON crm_intake.inbox_entries
FOR EACH ROW EXECUTE FUNCTION crm_intake.record_inbox_notification();
CREATE TRIGGER inbox_notification_reads_live_change AFTER INSERT OR UPDATE ON crm_intake.inbox_notification_reads
FOR EACH ROW EXECUTE FUNCTION crm_intake.notify_live_change('workspace_id');

-- SLA state, durable retry and tenant bindings.
ALTER TABLE crm_intake.sla_rules ADD CONSTRAINT sla_rules_version_check CHECK (version > 0);
ALTER TABLE crm_intake.sla_rules ADD CONSTRAINT sla_rules_config_check CHECK (jsonb_typeof(config) = 'object' AND config ? 'enabled' AND config->'enabled' = to_jsonb(enabled));
ALTER TABLE crm_intake.sla_rules ADD CONSTRAINT sla_rules_owner_check CHECK (jsonb_typeof(owner_binding) = 'object' AND owner_binding ?& ARRAY['subject','membershipId']);
ALTER TABLE crm_intake.sla_commands ADD CONSTRAINT sla_commands_actor_check CHECK (length(actor_subject) > 0);
ALTER TABLE crm_intake.sla_commands ADD CONSTRAINT sla_commands_action_check CHECK (action IN ('RULE_SAVED','JOB_RETRIED'));
ALTER TABLE crm_intake.sla_commands ADD CONSTRAINT sla_commands_hash_check CHECK (request_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE crm_intake.sla_jobs ADD CONSTRAINT sla_jobs_version_check CHECK (rule_version > 0 AND generation > 0);
ALTER TABLE crm_intake.sla_jobs ADD CONSTRAINT sla_jobs_status_check CHECK (status IN ('PENDING','PROCESSING','BREACHED','CANCELLED','DEAD'));
ALTER TABLE crm_intake.sla_jobs ADD CONSTRAINT sla_jobs_breached_check CHECK (status <> 'BREACHED' OR breached_at IS NOT NULL);
ALTER TABLE crm_intake.sla_jobs ADD CONSTRAINT sla_jobs_rule_fkey FOREIGN KEY (workspace_id) REFERENCES crm_intake.sla_rules(workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE crm_intake.sla_jobs ADD CONSTRAINT sla_jobs_entry_fkey FOREIGN KEY (workspace_id,entry_id) REFERENCES crm_intake.inbox_entries(workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE crm_intake.sla_notifications ADD CONSTRAINT sla_notifications_recipient_check CHECK (length(recipient_subject) > 0);
ALTER TABLE crm_intake.sla_notifications ADD CONSTRAINT sla_notifications_channel_check CHECK (channel IN ('EMAIL','TELEGRAM'));
ALTER TABLE crm_intake.sla_notifications ADD CONSTRAINT sla_notifications_deduplication_check CHECK (deduplication_key ~ '^[a-f0-9]{64}$');
ALTER TABLE crm_intake.sla_notifications ADD CONSTRAINT sla_notifications_job_fkey FOREIGN KEY (workspace_id,job_id) REFERENCES crm_intake.sla_jobs(workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE crm_intake.sla_receipts ADD CONSTRAINT sla_receipts_hash_check CHECK (payload_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE crm_intake.sla_receipts ADD CONSTRAINT sla_receipts_status_check CHECK (status IN ('PROCESSING','DELIVERED','RETRY_SCHEDULED','DEAD_LETTERED'));
ALTER TABLE crm_intake.sla_receipts ADD CONSTRAINT sla_receipts_retry_check CHECK (retry_attempt BETWEEN 0 AND 3);
ALTER TABLE crm_intake.sla_receipts ADD CONSTRAINT sla_receipts_lease_check CHECK ((status = 'PROCESSING') = (lease_token IS NOT NULL AND lease_until IS NOT NULL));
ALTER TABLE crm_intake.sla_outbox ADD CONSTRAINT sla_outbox_route_check CHECK (route IN ('MAIN','DLQ','ND_EMAIL','ND_TELEGRAM'));
ALTER TABLE crm_intake.sla_outbox ADD CONSTRAINT sla_outbox_payload_check CHECK (jsonb_typeof(payload) = 'object');
ALTER TABLE crm_intake.sla_outbox ADD CONSTRAINT sla_outbox_status_check CHECK (status IN ('PENDING','PUBLISHING','PUBLISHED'));
ALTER TABLE crm_intake.sla_outbox ADD CONSTRAINT sla_outbox_attempts_check CHECK (attempts >= 0 AND retry_attempt BETWEEN 0 AND 3);
ALTER TABLE crm_intake.sla_outbox ADD CONSTRAINT sla_outbox_lease_check CHECK ((status = 'PUBLISHING') = (lease_token IS NOT NULL AND lease_until IS NOT NULL));
