CREATE TABLE "crm_sales"."import_previews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "entity" VARCHAR(16) NOT NULL,
    "source_key" VARCHAR(100) NOT NULL,
    "file_digest" CHAR(64) NOT NULL,
    "rows" JSONB NOT NULL,
    "refs" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "commit_command_id" UUID,
    "request_hash" CHAR(64),
    "result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_previews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "import_previews_entity_check" CHECK ("entity" = 'deals'),
    CONSTRAINT "import_previews_rows_check" CHECK (jsonb_typeof("rows") = 'array' AND jsonb_typeof("refs") = 'array'),
    CONSTRAINT "import_previews_receipt_check" CHECK (("commit_command_id" IS NULL AND "request_hash" IS NULL AND "result" IS NULL) OR ("commit_command_id" IS NOT NULL AND "request_hash" IS NOT NULL AND "result" IS NOT NULL))
);

CREATE UNIQUE INDEX "import_previews_commit_command_id_key" ON "crm_sales"."import_previews"("commit_command_id");
CREATE INDEX "import_previews_workspace_id_actor_subject_created_at_idx" ON "crm_sales"."import_previews"("workspace_id", "actor_subject", "created_at");
CREATE INDEX "import_previews_workspace_id_expires_at_idx" ON "crm_sales"."import_previews"("workspace_id", "expires_at");

CREATE TABLE "crm_sales"."import_bindings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "source_key" VARCHAR(100) NOT NULL,
    "entity" VARCHAR(16) NOT NULL,
    "external_id" VARCHAR(200) NOT NULL,
    "deal_id" UUID NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_bindings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "import_bindings_entity_check" CHECK ("entity" = 'deals'),
    CONSTRAINT "import_bindings_source_id_check" CHECK (length("external_id") > 0)
);

CREATE UNIQUE INDEX "import_bindings_workspace_id_source_key_entity_external_id_key" ON "crm_sales"."import_bindings"("workspace_id", "source_key", "entity", "external_id");
CREATE INDEX "import_bindings_workspace_id_deal_id_idx" ON "crm_sales"."import_bindings"("workspace_id", "deal_id");
ALTER TABLE "crm_sales"."import_bindings" ADD CONSTRAINT "import_bindings_deal_id_workspace_id_fkey" FOREIGN KEY ("deal_id", "workspace_id") REFERENCES "crm_sales"."deals"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TRIGGER guard_workspace_closure BEFORE INSERT OR UPDATE OR DELETE ON "crm_sales"."import_previews" FOR EACH ROW EXECUTE FUNCTION "crm_sales"."guard_workspace_business_write"();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT OR UPDATE OR DELETE ON "crm_sales"."import_bindings" FOR EACH ROW EXECUTE FUNCTION "crm_sales"."guard_workspace_business_write"();

CREATE FUNCTION "crm_sales"."import_preview_immutable"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, crm_sales AS $$
BEGIN
    IF TG_OP = 'DELETE' OR OLD.result IS NOT NULL OR
       (NEW.id, NEW.workspace_id, NEW.actor_subject, NEW.entity, NEW.source_key,
        NEW.file_digest, NEW.rows, NEW.refs, NEW.expires_at, NEW.created_at)
         IS DISTINCT FROM
       (OLD.id, OLD.workspace_id, OLD.actor_subject, OLD.entity, OLD.source_key,
        OLD.file_digest, OLD.rows, OLD.refs, OLD.expires_at, OLD.created_at)
       OR NEW.commit_command_id IS NULL OR NEW.request_hash IS NULL OR NEW.result IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'crm_import_preview_immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER import_preview_immutable BEFORE UPDATE OR DELETE ON "crm_sales"."import_previews" FOR EACH ROW EXECUTE FUNCTION "crm_sales"."import_preview_immutable"();

CREATE FUNCTION "crm_sales"."import_binding_immutable"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, crm_sales AS $$
BEGIN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'crm_import_binding_immutable';
END;
$$;
CREATE TRIGGER import_binding_immutable BEFORE UPDATE OR DELETE ON "crm_sales"."import_bindings" FOR EACH ROW EXECUTE FUNCTION "crm_sales"."import_binding_immutable"();
REVOKE ALL ON FUNCTION "crm_sales"."import_preview_immutable"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "crm_sales"."import_binding_immutable"() FROM PUBLIC;
