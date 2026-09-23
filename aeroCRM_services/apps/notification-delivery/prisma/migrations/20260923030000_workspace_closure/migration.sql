-- WS-01. A business write and the fence installation update the same row.
CREATE TABLE "notification_delivery"."workspace_closure_fences" (
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

CREATE FUNCTION "notification_delivery"."workspace_closure_fence_immutable"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, notification_delivery AS $$
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
CREATE TRIGGER workspace_closure_fence_immutable BEFORE UPDATE OR DELETE ON "notification_delivery"."workspace_closure_fences"
FOR EACH ROW EXECUTE FUNCTION "notification_delivery"."workspace_closure_fence_immutable"();

CREATE FUNCTION "notification_delivery"."assert_workspace_open"(target_workspace uuid) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, notification_delivery AS $$
DECLARE admitted uuid;
BEGIN
  INSERT INTO "notification_delivery"."workspace_closure_fences" (workspace_id)
  VALUES (target_workspace)
  ON CONFLICT (workspace_id) DO UPDATE SET revision = "workspace_closure_fences".revision + 1
  WHERE "workspace_closure_fences".fenced_at IS NULL
  RETURNING workspace_id INTO admitted;
  IF admitted IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'crm_workspace_closed', DETAIL = 'CRM_WORKSPACE_CLOSED';
  END IF;
END;
$$;

ALTER TABLE notification_delivery.delivery_receipts ADD COLUMN crm_workspace_id uuid;
ALTER TABLE notification_delivery.delivery_receipts ADD COLUMN crm_dispatch_started_at timestamptz;
CREATE INDEX delivery_receipts_crm_workspace_dispatch_idx ON notification_delivery.delivery_receipts (crm_workspace_id, crm_dispatch_started_at);

CREATE FUNCTION notification_delivery.guard_crm_dispatch_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, notification_delivery AS $$
BEGIN
  IF NEW.crm_dispatch_started_at IS NOT NULL AND NEW.crm_workspace_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'crm_dispatch_workspace_required';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.crm_workspace_id IS NOT NULL AND NEW.crm_workspace_id IS DISTINCT FROM OLD.crm_workspace_id)
      OR (OLD.crm_dispatch_started_at IS NOT NULL AND NEW.crm_dispatch_started_at IS DISTINCT FROM OLD.crm_dispatch_started_at) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'crm_dispatch_scope_immutable';
    END IF;
    IF NEW.crm_dispatch_started_at IS NOT NULL AND OLD.crm_dispatch_started_at IS NULL THEN
      PERFORM notification_delivery.assert_workspace_open(NEW.crm_workspace_id);
    END IF;
  ELSIF NEW.crm_dispatch_started_at IS NOT NULL THEN
    PERFORM notification_delivery.assert_workspace_open(NEW.crm_workspace_id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_crm_dispatch_scope BEFORE INSERT OR UPDATE ON notification_delivery.delivery_receipts
FOR EACH ROW EXECUTE FUNCTION notification_delivery.guard_crm_dispatch_scope();

REVOKE ALL ON FUNCTION notification_delivery.workspace_closure_fence_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION notification_delivery.assert_workspace_open(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION notification_delivery.guard_crm_dispatch_scope() FROM PUBLIC;
