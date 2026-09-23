CREATE TABLE identity.workspace_closure_fences (
  workspace_id uuid PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0,
  closure_id uuid,
  generation bigint,
  owner_subject text,
  requested_at timestamptz,
  fenced_at timestamptz,
  CONSTRAINT workspace_closure_fence_binding CHECK (
    (closure_id IS NULL AND generation IS NULL AND owner_subject IS NULL AND requested_at IS NULL AND fenced_at IS NULL)
    OR (closure_id IS NOT NULL AND generation = 1 AND owner_subject IS NOT NULL AND requested_at IS NOT NULL AND fenced_at IS NOT NULL)
  )
);

CREATE FUNCTION identity.enforce_workspace_closure_fence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, identity AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.fenced_at IS NOT NULL) THEN
    RAISE EXCEPTION 'crm_workspace_closed' USING ERRCODE = 'P0001', DETAIL = 'crm_workspace_closed';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR
      NEW.revision <> OLD.revision + 1 OR
      (NEW.fenced_at IS NULL AND (NEW.closure_id IS DISTINCT FROM OLD.closure_id OR
       NEW.generation IS DISTINCT FROM OLD.generation OR NEW.owner_subject IS DISTINCT FROM OLD.owner_subject OR
       NEW.requested_at IS DISTINCT FROM OLD.requested_at))) THEN
    RAISE EXCEPTION 'crm_workspace_closed' USING ERRCODE = 'P0001', DETAIL = 'crm_workspace_closed';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION identity.enforce_workspace_closure_fence() FROM PUBLIC;
CREATE TRIGGER workspace_closure_fence_immutable BEFORE UPDATE OR DELETE ON identity.workspace_closure_fences
  FOR EACH ROW EXECUTE FUNCTION identity.enforce_workspace_closure_fence();

CREATE FUNCTION identity.assert_workspace_open(p_workspace_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, identity AS $$
BEGIN
  IF p_workspace_id IS NULL THEN RAISE EXCEPTION 'crm_workspace_closed' USING ERRCODE = 'P0001', DETAIL = 'crm_workspace_closed'; END IF;
  INSERT INTO identity.workspace_closure_fences(workspace_id) VALUES (p_workspace_id)
  ON CONFLICT (workspace_id) DO UPDATE SET revision = identity.workspace_closure_fences.revision + 1
  WHERE identity.workspace_closure_fences.fenced_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'crm_workspace_closed' USING ERRCODE = 'P0001', DETAIL = 'crm_workspace_closed'; END IF;
END $$;
REVOKE ALL ON FUNCTION identity.assert_workspace_open(uuid) FROM PUBLIC;

CREATE FUNCTION identity.guard_workspace_admission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, identity AS $$
DECLARE w uuid;
BEGIN
  w := CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
  IF TG_OP = 'UPDATE' AND NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'crm_workspace_closed' USING ERRCODE = 'P0001', DETAIL = 'crm_workspace_closed';
  END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'workspace_members' THEN
    IF NEW.status <> 'ACTIVE' AND
       (to_jsonb(NEW) - 'status' - 'updated_at' - 'version') = (to_jsonb(OLD) - 'status' - 'updated_at' - 'version') THEN RETURN NEW; END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'workspace_invitations' THEN
    IF NEW.status IN ('REVOKED','EXPIRED') AND
       (to_jsonb(NEW) - 'status' - 'revoked_at' - 'updated_at' - 'version') = (to_jsonb(OLD) - 'status' - 'revoked_at' - 'updated_at' - 'version') THEN RETURN NEW; END IF;
  END IF;
  PERFORM identity.assert_workspace_open(w);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION identity.guard_workspace_admission() FROM PUBLIC;
CREATE TRIGGER workspace_closure_member_guard BEFORE INSERT OR UPDATE OR DELETE ON identity.workspace_members
  FOR EACH ROW EXECUTE FUNCTION identity.guard_workspace_admission();
CREATE TRIGGER workspace_closure_invitation_guard BEFORE INSERT OR UPDATE OR DELETE ON identity.workspace_invitations
  FOR EACH ROW EXECUTE FUNCTION identity.guard_workspace_admission();

CREATE FUNCTION identity.guard_workspace_reactivation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, identity AS $$
BEGIN
  IF NEW.status = 'ACTIVE' AND (TG_OP = 'INSERT' OR OLD.status <> 'ACTIVE') THEN PERFORM identity.assert_workspace_open(NEW.id); END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION identity.guard_workspace_reactivation() FROM PUBLIC;
CREATE TRIGGER workspace_closure_reactivation_guard BEFORE INSERT OR UPDATE ON identity.workspaces
  FOR EACH ROW EXECUTE FUNCTION identity.guard_workspace_reactivation();
ALTER DEFAULT PRIVILEGES IN SCHEMA identity REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
