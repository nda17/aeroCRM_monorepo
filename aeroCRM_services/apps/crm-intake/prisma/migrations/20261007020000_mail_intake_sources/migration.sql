CREATE TABLE "crm_intake"."mail_intake_sources" (
  "id" uuid PRIMARY KEY,
  "workspace_id" uuid NOT NULL,
  "entry_id" uuid NOT NULL UNIQUE,
  "message_id" uuid NOT NULL,
  "mailbox_id" uuid NOT NULL,
  "actor_membership_id" uuid NOT NULL,
  "actor_subject" varchar(256) NOT NULL,
  "command_id" uuid NOT NULL UNIQUE,
  "source_hash" char(64) NOT NULL,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mail_intake_sources_workspace_id_entry_id_key" UNIQUE ("workspace_id", "entry_id"),
  CONSTRAINT "mail_intake_sources_workspace_id_message_id_key" UNIQUE ("workspace_id", "message_id"),
  CONSTRAINT "mail_intake_sources_entry_binding_fkey" FOREIGN KEY ("workspace_id", "entry_id")
    REFERENCES "crm_intake"."inbox_entries" ("workspace_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "mail_intake_sources_source_hash_check" CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "mail_intake_sources_actor_check" CHECK (length(actor_subject) > 0)
);

CREATE FUNCTION "crm_intake"."mail_intake_source_immutable"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, crm_intake AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'crm_mail_intake_source_immutable';
END;
$$;
CREATE TRIGGER mail_intake_source_immutable BEFORE UPDATE OR DELETE ON "crm_intake"."mail_intake_sources"
FOR EACH ROW EXECUTE FUNCTION "crm_intake"."mail_intake_source_immutable"();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT ON "crm_intake"."mail_intake_sources"
FOR EACH ROW EXECUTE FUNCTION "crm_intake"."guard_workspace_business_write"();
