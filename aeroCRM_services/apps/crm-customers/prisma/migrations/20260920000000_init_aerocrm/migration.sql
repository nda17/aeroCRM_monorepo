-- Clean aeroCRM baseline for the current service-owned Prisma schema.
-- Additional SQL retains database guards that Prisma cannot represent.
BEGIN;

DO $$ BEGIN
    IF to_regnamespace('crm_customers') IS NULL OR (
        SELECT nspowner FROM pg_namespace WHERE oid = to_regnamespace('crm_customers')
    ) IS DISTINCT FROM to_regrole(CURRENT_USER) THEN
        RAISE EXCEPTION 'crm_customers schema must exist and be owned by the migration role';
    END IF;
END $$;

-- CreateSchema


-- CreateTable
CREATE TABLE "crm_customers"."export_audit" (
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
CREATE TABLE "crm_customers"."service_identity" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "service_name" TEXT NOT NULL DEFAULT 'crm-customers-service',
    "database_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_customers"."companies" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "inn" VARCHAR(12),
    "website" VARCHAR(2048),
    "legal_name" VARCHAR(2000),
    "kpp" VARCHAR(9),
    "ogrn" VARCHAR(15),
    "legal_address" VARCHAR(2000),
    "entity_type" VARCHAR(16),
    "notes" VARCHAR(5000),
    "created_by_subject" VARCHAR(256) NOT NULL,
    "team_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_customers"."contacts" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(16),
    "email" VARCHAR(254),
    "company_id" UUID,
    "time_zone" VARCHAR(100),
    "preferred_call_start" VARCHAR(5),
    "preferred_call_end" VARCHAR(5),
    "notes" VARCHAR(5000),
    "created_by_subject" VARCHAR(256) NOT NULL,
    "team_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_customers"."customer_commands" (
    "command_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "entity_kind" VARCHAR(16) NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_commands_pkey" PRIMARY KEY ("command_id")
);

-- CreateTable
CREATE TABLE "crm_customers"."customer_activities" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "entity_kind" VARCHAR(16) NOT NULL,
    "command_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "action" VARCHAR(16) NOT NULL,
    "entity_version" INTEGER NOT NULL,
    "changed_fields" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_customers"."intake_operation_slots" (
    "operation_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "state" VARCHAR(16) NOT NULL,
    "contact_id" UUID,
    "result" JSONB,
    "committed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intake_operation_slots_pkey" PRIMARY KEY ("operation_id")
);

-- CreateTable
CREATE TABLE "crm_customers"."intake_operation_commands" (
    "command_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intake_operation_commands_pkey" PRIMARY KEY ("command_id")
);

-- CreateIndex
CREATE INDEX "export_audit_workspace_prepared_idx" ON "crm_customers"."export_audit"("workspace_id", "prepared_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "service_identity_database_id_key" ON "crm_customers"."service_identity"("database_id");

-- CreateIndex
CREATE INDEX "companies_workspace_id_archived_at_created_at_id_idx" ON "crm_customers"."companies"("workspace_id", "archived_at", "created_at", "id");

-- CreateIndex
CREATE INDEX "companies_workspace_id_created_by_subject_archived_at_idx" ON "crm_customers"."companies"("workspace_id", "created_by_subject", "archived_at");

-- CreateIndex
CREATE INDEX "companies_workspace_id_team_id_archived_at_idx" ON "crm_customers"."companies"("workspace_id", "team_id", "archived_at");

-- CreateIndex
CREATE INDEX "companies_workspace_id_inn_idx" ON "crm_customers"."companies"("workspace_id", "inn");

-- CreateIndex
CREATE UNIQUE INDEX "companies_workspace_id_id_key" ON "crm_customers"."companies"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "contacts_workspace_id_archived_at_created_at_id_idx" ON "crm_customers"."contacts"("workspace_id", "archived_at", "created_at", "id");

-- CreateIndex
CREATE INDEX "contacts_workspace_id_created_by_subject_archived_at_idx" ON "crm_customers"."contacts"("workspace_id", "created_by_subject", "archived_at");

-- CreateIndex
CREATE INDEX "contacts_workspace_id_team_id_archived_at_idx" ON "crm_customers"."contacts"("workspace_id", "team_id", "archived_at");

-- CreateIndex
CREATE INDEX "contacts_workspace_id_phone_idx" ON "crm_customers"."contacts"("workspace_id", "phone");

-- CreateIndex
CREATE INDEX "contacts_workspace_id_email_idx" ON "crm_customers"."contacts"("workspace_id", "email");

-- CreateIndex
CREATE INDEX "contacts_workspace_id_company_id_idx" ON "crm_customers"."contacts"("workspace_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_workspace_id_id_key" ON "crm_customers"."contacts"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "customer_commands_workspace_id_entity_id_idx" ON "crm_customers"."customer_commands"("workspace_id", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_activities_command_id_key" ON "crm_customers"."customer_activities"("command_id");

-- CreateIndex
CREATE INDEX "customer_activities_entity_created_idx" ON "crm_customers"."customer_activities"("workspace_id", "entity_kind", "entity_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "intake_operation_slots_workspace_id_workflow_id_key" ON "crm_customers"."intake_operation_slots"("workspace_id", "workflow_id");

-- AddForeignKey
ALTER TABLE "crm_customers"."contacts" ADD CONSTRAINT "contacts_workspace_id_company_id_fkey" FOREIGN KEY ("workspace_id", "company_id") REFERENCES "crm_customers"."companies"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "crm_customers"."service_identity" ALTER COLUMN "database_id" SET DEFAULT gen_random_uuid();

ALTER TABLE "crm_customers"."companies" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "crm_customers"."contacts" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "crm_customers"."customer_activities" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "crm_customers"."export_audit" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "crm_customers"."service_identity" ADD CONSTRAINT "service_identity_singleton_check" CHECK ("id" = 'singleton');

ALTER TABLE "crm_customers"."service_identity" ADD CONSTRAINT "service_identity_name_check" CHECK ("service_name" = 'crm-customers-service');

ALTER TABLE "crm_customers"."companies" ADD CONSTRAINT "companies_name_check" CHECK (char_length(btrim("name")) > 0 AND "name" = btrim("name"));

ALTER TABLE "crm_customers"."companies" ADD CONSTRAINT "companies_inn_check" CHECK ("inn" IS NULL OR "inn" ~ '^([0-9]{10}|[0-9]{12})$');

ALTER TABLE "crm_customers"."companies" ADD CONSTRAINT "companies_created_by_subject_check" CHECK (char_length("created_by_subject") > 0);

ALTER TABLE "crm_customers"."companies" ADD CONSTRAINT "companies_version_check" CHECK ("version" > 0);

ALTER TABLE "crm_customers"."contacts" ADD CONSTRAINT "contacts_name_check" CHECK (char_length(btrim("name")) > 0 AND "name" = btrim("name"));

ALTER TABLE "crm_customers"."contacts" ADD CONSTRAINT "contacts_phone_check" CHECK ("phone" IS NULL OR "phone" ~ '^\+[1-9][0-9]{6,14}$');

ALTER TABLE "crm_customers"."contacts" ADD CONSTRAINT "contacts_created_by_subject_check" CHECK (char_length("created_by_subject") > 0);

ALTER TABLE "crm_customers"."contacts" ADD CONSTRAINT "contacts_version_check" CHECK ("version" > 0);

ALTER TABLE "crm_customers"."customer_commands" ADD CONSTRAINT "customer_commands_entity_kind_check" CHECK ("entity_kind" IN ('contact', 'company'));

ALTER TABLE "crm_customers"."customer_commands" ADD CONSTRAINT "customer_commands_actor_subject_check" CHECK (char_length("actor_subject") > 0);

ALTER TABLE "crm_customers"."customer_commands" ADD CONSTRAINT "customer_commands_request_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "crm_customers"."customer_commands" ADD CONSTRAINT "customer_commands_response_check" CHECK (jsonb_typeof("response") = 'object');

ALTER TABLE "crm_customers"."customer_activities" ADD CONSTRAINT "customer_activities_entity_kind_check" CHECK ("entity_kind" IN ('contact', 'company'));

ALTER TABLE "crm_customers"."customer_activities" ADD CONSTRAINT "customer_activities_actor_subject_check" CHECK (char_length("actor_subject") > 0);

ALTER TABLE "crm_customers"."customer_activities" ADD CONSTRAINT "customer_activities_action_check" CHECK ("action" IN ('CREATED', 'UPDATED', 'ARCHIVED'));

ALTER TABLE "crm_customers"."customer_activities" ADD CONSTRAINT "customer_activities_entity_version_check" CHECK ("entity_version" > 0);

ALTER TABLE crm_customers.intake_operation_slots ADD CONSTRAINT "intake_operation_slots_actor_subject_check" CHECK (char_length(actor_subject) > 0);

ALTER TABLE crm_customers.intake_operation_slots ADD CONSTRAINT "intake_operation_slots_payload_hash_check" CHECK (payload_hash ~ '^[a-f0-9]{64}$');

ALTER TABLE crm_customers.intake_operation_slots ADD CONSTRAINT "intake_operation_slots_state_check" CHECK (state IN ('COMMITTED', 'CANCELLED'));

ALTER TABLE crm_customers.intake_operation_slots ADD CONSTRAINT "intake_operation_slots_condition_1_check" CHECK ((state = 'COMMITTED' AND contact_id IS NOT NULL AND committed_at IS NOT NULL AND result IS NOT NULL AND jsonb_typeof(result) = 'object' AND result ? 'contactId' AND result->>'contactId' = contact_id::text) OR (state = 'CANCELLED' AND contact_id IS NULL AND committed_at IS NULL AND result IS NULL));

ALTER TABLE crm_customers.intake_operation_commands ADD CONSTRAINT "intake_operation_commands_actor_subject_check" CHECK (char_length(actor_subject) > 0);

ALTER TABLE crm_customers.intake_operation_commands ADD CONSTRAINT "intake_operation_commands_request_hash_check" CHECK (request_hash ~ '^[a-f0-9]{64}$');

ALTER TABLE crm_customers.intake_operation_commands ADD CONSTRAINT "intake_operation_commands_result_check" CHECK (jsonb_typeof(result) = 'object');

ALTER TABLE crm_customers.export_audit ADD CONSTRAINT "export_audit_actor_subject_check" CHECK (char_length(actor_subject) BETWEEN 1 AND 256 AND actor_subject !~ '[[:space:][:cntrl:]]');

ALTER TABLE crm_customers.export_audit ADD CONSTRAINT "export_audit_entity_check" CHECK (entity IN ('contacts','companies'));

ALTER TABLE crm_customers.export_audit ADD CONSTRAINT "export_audit_format_check" CHECK (format IN ('json','csv'));

ALTER TABLE crm_customers.export_audit ADD CONSTRAINT "export_audit_row_count_check" CHECK (row_count BETWEEN 0 AND 10000);

ALTER TABLE crm_customers.export_audit ADD CONSTRAINT "export_audit_byte_count_check" CHECK (byte_count BETWEEN 1 AND 16777216);

ALTER TABLE "crm_customers"."companies" ADD CONSTRAINT "companies_kpp_format_check" CHECK ("kpp" IS NULL OR "kpp" ~ '^[0-9]{9}$');

ALTER TABLE "crm_customers"."companies" ADD CONSTRAINT "companies_ogrn_format_check" CHECK ("ogrn" IS NULL OR "ogrn" ~ '^([0-9]{13}|[0-9]{15})$');

ALTER TABLE "crm_customers"."companies" ADD CONSTRAINT "companies_entity_type_check" CHECK ("entity_type" IS NULL OR "entity_type" IN ('LEGAL', 'INDIVIDUAL'));

ALTER TABLE "crm_customers"."contacts" ADD CONSTRAINT "contacts_preferred_call_window_check" CHECK (
    ("preferred_call_start" IS NULL AND "preferred_call_end" IS NULL)
    OR (
      "time_zone" IS NOT NULL
      AND "preferred_call_start" IS NOT NULL
      AND "preferred_call_end" IS NOT NULL
      AND "preferred_call_start" ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'
      AND "preferred_call_end" ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'
      AND "preferred_call_start" <> "preferred_call_end"
    )
  );

CREATE FUNCTION crm_customers.notify_live_change() RETURNS trigger
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

REVOKE ALL ON FUNCTION crm_customers.notify_live_change() FROM PUBLIC;

CREATE FUNCTION "crm_customers"."enforce_service_identity_integrity"() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, crm_customers AS $$
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
REVOKE ALL ON FUNCTION "crm_customers"."enforce_service_identity_integrity"() FROM PUBLIC;

INSERT INTO "crm_customers"."service_identity" ("id", "service_name", "database_id", "updated_at")
VALUES ('singleton', 'crm-customers-service', gen_random_uuid(), CURRENT_TIMESTAMP);

CREATE TRIGGER contacts_live_change AFTER INSERT OR UPDATE OR DELETE ON crm_customers.contacts
FOR EACH ROW EXECUTE FUNCTION crm_customers.notify_live_change('workspace_id');

CREATE TRIGGER companies_live_change AFTER INSERT OR UPDATE OR DELETE ON crm_customers.companies
FOR EACH ROW EXECUTE FUNCTION crm_customers.notify_live_change('workspace_id');

CREATE TRIGGER customer_activities_live_change AFTER INSERT OR UPDATE OR DELETE ON crm_customers.customer_activities
FOR EACH ROW EXECUTE FUNCTION crm_customers.notify_live_change('workspace_id');

CREATE TRIGGER service_identity_integrity_guard BEFORE UPDATE OR DELETE ON "crm_customers"."service_identity"
FOR EACH ROW EXECUTE FUNCTION "crm_customers"."enforce_service_identity_integrity"();

ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA "crm_customers" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "crm_customers" FROM PUBLIC;

COMMIT;
