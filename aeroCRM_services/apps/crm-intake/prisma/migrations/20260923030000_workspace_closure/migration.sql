-- WS-01. A business write and the fence installation update the same row.
CREATE TABLE "crm_intake"."workspace_closure_fences" (
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

CREATE FUNCTION "crm_intake"."workspace_closure_fence_immutable"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, crm_intake AS $$
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
CREATE TRIGGER workspace_closure_fence_immutable BEFORE UPDATE OR DELETE ON "crm_intake"."workspace_closure_fences"
FOR EACH ROW EXECUTE FUNCTION "crm_intake"."workspace_closure_fence_immutable"();

CREATE FUNCTION "crm_intake"."assert_workspace_open"(target_workspace uuid) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, crm_intake AS $$
DECLARE admitted uuid;
BEGIN
  INSERT INTO "crm_intake"."workspace_closure_fences" (workspace_id)
  VALUES (target_workspace)
  ON CONFLICT (workspace_id) DO UPDATE SET revision = "workspace_closure_fences".revision + 1
  WHERE "workspace_closure_fences".fenced_at IS NULL
  RETURNING workspace_id INTO admitted;
  IF admitted IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'crm_workspace_closed', DETAIL = 'CRM_WORKSPACE_CLOSED';
  END IF;
END;
$$;

CREATE FUNCTION "crm_intake"."guard_workspace_business_write"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, crm_intake AS $$
DECLARE target_workspace uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_workspace := OLD.workspace_id;
  ELSE
    target_workspace := NEW.workspace_id;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.workspace_id IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'crm_workspace_change_refused';
  END IF;
  PERFORM "crm_intake"."assert_workspace_open"(target_workspace);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_workspace_closure BEFORE INSERT OR UPDATE OR DELETE ON "crm_intake"."intake_sources" FOR EACH ROW EXECUTE FUNCTION "crm_intake"."guard_workspace_business_write"();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT OR UPDATE OR DELETE ON "crm_intake"."csv_imports" FOR EACH ROW EXECUTE FUNCTION "crm_intake"."guard_workspace_business_write"();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT OR UPDATE OR DELETE ON "crm_intake"."csv_import_rows" FOR EACH ROW EXECUTE FUNCTION "crm_intake"."guard_workspace_business_write"();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT OR UPDATE OR DELETE ON "crm_intake"."sla_rules" FOR EACH ROW EXECUTE FUNCTION "crm_intake"."guard_workspace_business_write"();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT ON "crm_intake"."sla_notifications" FOR EACH ROW EXECUTE FUNCTION "crm_intake"."guard_workspace_business_write"();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT ON "crm_intake"."inbox_notifications" FOR EACH ROW EXECUTE FUNCTION "crm_intake"."guard_workspace_business_write"();

-- The only post-fence entry mutation is a proven terminal acceptance.
CREATE FUNCTION "crm_intake"."guard_workspace_inbox_entry"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, crm_intake AS $$
DECLARE proof_exists boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.workspace_id IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'crm_workspace_change_refused';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'NEW' AND NEW.status = 'ACCEPTED'
    AND NEW.contact_id IS NOT NULL AND NEW.deal_id IS NOT NULL
    AND NEW.version = OLD.version + 1
    AND (to_jsonb(NEW) - ARRAY['status','contact_id','deal_id','accepted_at','version','updated_at'])
       = (to_jsonb(OLD) - ARRAY['status','contact_id','deal_id','accepted_at','version','updated_at'])
    AND EXISTS (SELECT 1 FROM crm_intake.workspace_closure_fences f
      WHERE f.workspace_id = NEW.workspace_id AND f.fenced_at IS NOT NULL)
  THEN
    SELECT EXISTS (
      SELECT 1 FROM crm_intake.acceptances a
      WHERE a.workspace_id = NEW.workspace_id AND a.entry_id = NEW.id
        AND a.status = 'COMPLETED' AND a.contact_id = NEW.contact_id AND a.deal_id = NEW.deal_id
        AND a.contact_proof->>'state' = 'COMMITTED' AND a.sales_proof->>'state' = 'COMMITTED'
        AND a.contact_proof->'result'->>'contactId' = NEW.contact_id::text
        AND a.sales_proof->'result'->>'contactId' = NEW.contact_id::text
        AND a.sales_proof->'result'->>'dealId' = NEW.deal_id::text
        AND a.contact_proof->>'schemaVersion' = '1'
        AND a.sales_proof->>'schemaVersion' = '1'
        AND a.contact_proof->>'workspaceId' = a.workspace_id::text
        AND a.sales_proof->>'workspaceId' = a.workspace_id::text
        AND a.contact_proof->>'workflowId' = a.id::text
        AND a.sales_proof->>'workflowId' = a.id::text
        AND a.contact_proof->>'actorSubject' = a.actor_subject
        AND a.sales_proof->>'actorSubject' = a.actor_subject
        AND a.contact_proof->>'committedAt' IS NOT NULL
        AND a.sales_proof->>'committedAt' IS NOT NULL
        AND a.contact_proof->>'operationId' = a.contact_operation_id::text
        AND a.sales_proof->>'operationId' = a.sales_operation_id::text
        AND a.contact_proof->>'payloadHash' = a.contact_payload_hash
        AND a.sales_proof->>'payloadHash' = a.sales_payload_hash
    ) INTO proof_exists;
    IF proof_exists THEN RETURN NEW; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM crm_intake.assert_workspace_open(OLD.workspace_id);
  ELSE
    PERFORM crm_intake.assert_workspace_open(NEW.workspace_id);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_workspace_closure BEFORE INSERT OR UPDATE OR DELETE ON crm_intake.inbox_entries
FOR EACH ROW EXECUTE FUNCTION crm_intake.guard_workspace_inbox_entry();

CREATE FUNCTION crm_intake.guard_acceptance_admission() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, crm_intake AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM crm_intake.assert_workspace_open(NEW.workspace_id);
  ELSIF NEW.status IN ('QUEUED','RUNNING','RECOVERING','RETRY_WAIT')
    AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.generation IS DISTINCT FROM NEW.generation) THEN
    PERFORM crm_intake.assert_workspace_open(NEW.workspace_id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_acceptance_admission BEFORE INSERT OR UPDATE ON crm_intake.acceptances
FOR EACH ROW EXECUTE FUNCTION crm_intake.guard_acceptance_admission();

CREATE FUNCTION crm_intake.guard_acceptance_outbox() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, crm_intake AS $$
BEGIN
  PERFORM crm_intake.assert_workspace_open((NEW.payload->>'workspaceId')::uuid);
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_acceptance_outbox BEFORE INSERT ON crm_intake.acceptance_outbox
FOR EACH ROW EXECUTE FUNCTION crm_intake.guard_acceptance_outbox();

REVOKE ALL ON FUNCTION crm_intake.workspace_closure_fence_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION crm_intake.assert_workspace_open(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm_intake.guard_workspace_business_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION crm_intake.guard_workspace_inbox_entry() FROM PUBLIC;
REVOKE ALL ON FUNCTION crm_intake.guard_acceptance_admission() FROM PUBLIC;
REVOKE ALL ON FUNCTION crm_intake.guard_acceptance_outbox() FROM PUBLIC;
