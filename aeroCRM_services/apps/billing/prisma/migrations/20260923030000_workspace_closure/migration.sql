CREATE TABLE billing.workspace_closure_fences (
  workspace_id uuid PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0,
  closure_id uuid,
  generation bigint,
  owner_subject text,
  requested_at timestamptz,
  fenced_at timestamptz,
  financial_pending_count integer NOT NULL DEFAULT 0 CHECK (financial_pending_count >= 0),
  CONSTRAINT workspace_closure_fence_binding CHECK (
    (closure_id IS NULL AND generation IS NULL AND owner_subject IS NULL AND requested_at IS NULL AND fenced_at IS NULL)
    OR (closure_id IS NOT NULL AND generation = 1 AND owner_subject IS NOT NULL AND requested_at IS NOT NULL AND fenced_at IS NOT NULL)
  )
);

CREATE FUNCTION billing.enforce_workspace_closure_fence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, billing AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'crm_workspace_closed' USING ERRCODE = 'P0001', DETAIL = 'crm_workspace_closed';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.fenced_at IS NOT NULL THEN
    IF NEW.revision = OLD.revision + 1 AND
       (to_jsonb(NEW) - 'revision') = (to_jsonb(OLD) - 'revision') THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'crm_workspace_closed' USING ERRCODE = 'P0001', DETAIL = 'crm_workspace_closed';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR
      NEW.revision <> OLD.revision + 1 OR
      (NEW.fenced_at IS NULL AND (NEW.closure_id IS DISTINCT FROM OLD.closure_id OR
       NEW.generation IS DISTINCT FROM OLD.generation OR NEW.owner_subject IS DISTINCT FROM OLD.owner_subject OR
       NEW.requested_at IS DISTINCT FROM OLD.requested_at OR
       NEW.financial_pending_count IS DISTINCT FROM OLD.financial_pending_count))) THEN
    RAISE EXCEPTION 'crm_workspace_closed' USING ERRCODE = 'P0001', DETAIL = 'crm_workspace_closed';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION billing.enforce_workspace_closure_fence() FROM PUBLIC;
CREATE TRIGGER workspace_closure_fence_immutable BEFORE UPDATE OR DELETE ON billing.workspace_closure_fences
  FOR EACH ROW EXECUTE FUNCTION billing.enforce_workspace_closure_fence();

CREATE FUNCTION billing.assert_workspace_open(p_workspace_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, billing AS $$
BEGIN
  IF p_workspace_id IS NULL THEN RAISE EXCEPTION 'crm_workspace_closed' USING ERRCODE = 'P0001', DETAIL = 'crm_workspace_closed'; END IF;
  INSERT INTO billing.workspace_closure_fences(workspace_id) VALUES (p_workspace_id)
  ON CONFLICT (workspace_id) DO UPDATE SET revision = billing.workspace_closure_fences.revision + 1
  WHERE billing.workspace_closure_fences.fenced_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'crm_workspace_closed' USING ERRCODE = 'P0001', DETAIL = 'crm_workspace_closed'; END IF;
END $$;
REVOKE ALL ON FUNCTION billing.assert_workspace_open(uuid) FROM PUBLIC;

-- Financial outcomes are still recorded after closure. This writes the same row
-- without changing or clearing the immutable closure binding.
CREATE FUNCTION billing.touch_workspace_fence(p_workspace_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, billing AS $$
DECLARE closed boolean;
BEGIN
  INSERT INTO billing.workspace_closure_fences(workspace_id) VALUES (p_workspace_id)
  ON CONFLICT (workspace_id) DO UPDATE SET revision = billing.workspace_closure_fences.revision + 1
  RETURNING fenced_at IS NOT NULL INTO closed;
  RETURN closed;
END $$;
REVOKE ALL ON FUNCTION billing.touch_workspace_fence(uuid) FROM PUBLIC;

CREATE FUNCTION billing.guard_workspace_new_finance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, billing AS $$
BEGIN
  PERFORM billing.assert_workspace_open(NEW.workspace_id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION billing.guard_workspace_new_finance() FROM PUBLIC;
CREATE TRIGGER workspace_closure_order_guard BEFORE INSERT ON billing.crm_orders
  FOR EACH ROW EXECUTE FUNCTION billing.guard_workspace_new_finance();
CREATE TRIGGER workspace_closure_admin_grant_guard BEFORE INSERT ON billing.crm_admin_day_grants
  FOR EACH ROW EXECUTE FUNCTION billing.guard_workspace_new_finance();
CREATE TRIGGER workspace_closure_admin_seat_guard BEFORE INSERT ON billing.crm_admin_seat_adjustments
  FOR EACH ROW EXECUTE FUNCTION billing.guard_workspace_new_finance();

CREATE FUNCTION billing.guard_workspace_renewal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, billing AS $$
BEGIN
  IF NEW.status = 'ACTIVE' THEN PERFORM billing.assert_workspace_open(NEW.workspace_id); END IF;
  IF TG_OP = 'UPDATE' AND NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'crm_workspace_closed' USING ERRCODE = 'P0001', DETAIL = 'crm_workspace_closed';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION billing.guard_workspace_renewal() FROM PUBLIC;
CREATE TRIGGER workspace_closure_renewal_guard BEFORE INSERT OR UPDATE ON billing.crm_auto_renewals
  FOR EACH ROW EXECUTE FUNCTION billing.guard_workspace_renewal();
ALTER DEFAULT PRIVILEGES IN SCHEMA billing REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
