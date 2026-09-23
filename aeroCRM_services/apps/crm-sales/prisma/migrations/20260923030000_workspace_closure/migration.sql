-- WS-01. A business write and the fence installation update the same row.
CREATE TABLE "crm_sales"."workspace_closure_fences" (
  "workspace_id" uuid PRIMARY KEY,
  "revision" bigint NOT NULL DEFAULT 0,
  "closure_id" uuid,
  "generation" bigint,
  "owner_subject" text,
  "requested_at" timestamptz,
  "fenced_at" timestamptz,
  CONSTRAINT "workspace_closure_fences_binding_check" CHECK (
    (closure_id IS NULL AND generation IS NULL AND owner_subject IS NULL AND requested_at IS NULL AND fenced_at IS NULL)
    OR (closure_id IS NOT NULL AND generation = 1 AND owner_subject IS NOT NULL AND length(owner_subject) > 0 AND requested_at IS NOT NULL AND fenced_at IS NOT NULL)
  ),
  CONSTRAINT "workspace_closure_fences_revision_check" CHECK (revision >= 0)
);

CREATE FUNCTION "crm_sales"."workspace_closure_fence_immutable"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, crm_sales AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'crm_workspace_closure_immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR
    (OLD.fenced_at IS NOT NULL AND (NEW.closure_id, NEW.generation, NEW.owner_subject, NEW.requested_at, NEW.fenced_at)
      IS DISTINCT FROM (OLD.closure_id, OLD.generation, OLD.owner_subject, OLD.requested_at, OLD.fenced_at)) OR
    (OLD.fenced_at IS NULL AND NEW.fenced_at IS NULL AND
      (NEW.closure_id, NEW.generation, NEW.owner_subject, NEW.requested_at)
      IS DISTINCT FROM (OLD.closure_id, OLD.generation, OLD.owner_subject, OLD.requested_at)) OR
    NEW.revision < OLD.revision
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'crm_workspace_closure_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER workspace_closure_fence_immutable BEFORE UPDATE OR DELETE ON "crm_sales"."workspace_closure_fences"
FOR EACH ROW EXECUTE FUNCTION "crm_sales"."workspace_closure_fence_immutable"();

CREATE FUNCTION "crm_sales"."assert_workspace_open"(target_workspace uuid) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, crm_sales AS $$
DECLARE admitted uuid;
BEGIN
  INSERT INTO "crm_sales"."workspace_closure_fences" (workspace_id)
  VALUES (target_workspace)
  ON CONFLICT (workspace_id) DO UPDATE SET revision = "workspace_closure_fences".revision + 1
  WHERE "workspace_closure_fences".fenced_at IS NULL
  RETURNING workspace_id INTO admitted;
  IF admitted IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'crm_workspace_closed', DETAIL = 'CRM_WORKSPACE_CLOSED';
  END IF;
END;
$$;

CREATE FUNCTION "crm_sales"."guard_workspace_business_write"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, crm_sales AS $$
DECLARE target_workspace uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_workspace := OLD.workspace_id;
  ELSE
    target_workspace := NEW.workspace_id;
  END IF;
  IF TG_TABLE_NAME = 'intake_operation_slots' AND TG_OP = 'INSERT' THEN
    IF NEW.state <> 'COMMITTED' THEN RETURN NEW; END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.workspace_id IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'crm_workspace_change_refused';
  END IF;
  PERFORM "crm_sales"."assert_workspace_open"(target_workspace);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_workspace_closure BEFORE INSERT OR UPDATE OR DELETE ON "crm_sales"."pipelines" FOR EACH ROW EXECUTE FUNCTION "crm_sales"."guard_workspace_business_write"();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT OR UPDATE OR DELETE ON "crm_sales"."pipeline_stages" FOR EACH ROW EXECUTE FUNCTION "crm_sales"."guard_workspace_business_write"();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT OR UPDATE OR DELETE ON "crm_sales"."pipeline_template_installations" FOR EACH ROW EXECUTE FUNCTION "crm_sales"."guard_workspace_business_write"();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT OR UPDATE OR DELETE ON "crm_sales"."deals" FOR EACH ROW EXECUTE FUNCTION "crm_sales"."guard_workspace_business_write"();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT OR UPDATE OR DELETE ON "crm_sales"."tasks" FOR EACH ROW EXECUTE FUNCTION "crm_sales"."guard_workspace_business_write"();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT OR UPDATE OR DELETE ON "crm_sales"."commerce_catalog_items" FOR EACH ROW EXECUTE FUNCTION "crm_sales"."guard_workspace_business_write"();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT OR UPDATE OR DELETE ON "crm_sales"."commerce_deal_lines" FOR EACH ROW EXECUTE FUNCTION "crm_sales"."guard_workspace_business_write"();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT OR UPDATE OR DELETE ON "crm_sales"."commerce_quotes" FOR EACH ROW EXECUTE FUNCTION "crm_sales"."guard_workspace_business_write"();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT OR UPDATE OR DELETE ON "crm_sales"."commerce_payments" FOR EACH ROW EXECUTE FUNCTION "crm_sales"."guard_workspace_business_write"();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT OR UPDATE OR DELETE ON "crm_sales"."task_series" FOR EACH ROW EXECUTE FUNCTION "crm_sales"."guard_workspace_business_write"();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT OR UPDATE OR DELETE ON "crm_sales"."task_series_occurrences" FOR EACH ROW EXECUTE FUNCTION "crm_sales"."guard_workspace_business_write"();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT OR UPDATE OR DELETE ON "crm_sales"."reminder_rules" FOR EACH ROW EXECUTE FUNCTION "crm_sales"."guard_workspace_business_write"();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT ON "crm_sales"."intake_operation_slots" FOR EACH ROW EXECUTE FUNCTION "crm_sales"."guard_workspace_business_write"();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT ON "crm_sales"."task_notifications" FOR EACH ROW EXECUTE FUNCTION "crm_sales"."guard_workspace_business_write"();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT ON "crm_sales"."commerce_import_previews" FOR EACH ROW EXECUTE FUNCTION "crm_sales"."guard_workspace_business_write"();

REVOKE ALL ON FUNCTION crm_sales.workspace_closure_fence_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION crm_sales.assert_workspace_open(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm_sales.guard_workspace_business_write() FROM PUBLIC;
