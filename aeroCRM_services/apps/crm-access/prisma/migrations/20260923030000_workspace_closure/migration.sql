-- A workspace fence is the serialization point for every tenant business write.
CREATE TABLE crm_access.workspace_closure_fences (
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

CREATE FUNCTION crm_access.enforce_workspace_closure_fence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, crm_access AS $$
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
REVOKE ALL ON FUNCTION crm_access.enforce_workspace_closure_fence() FROM PUBLIC;
CREATE TRIGGER workspace_closure_fence_immutable BEFORE UPDATE OR DELETE ON crm_access.workspace_closure_fences
  FOR EACH ROW EXECUTE FUNCTION crm_access.enforce_workspace_closure_fence();

CREATE TABLE crm_access.crm_workspace_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE,
  command_id uuid NOT NULL UNIQUE,
  owner_subject text NOT NULL,
  owner_membership_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  display_name_snapshot varchar(200),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation = 1),
  state varchar(16) NOT NULL CHECK (state IN ('CLOSING','CLOSED')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  participants jsonb NOT NULL,
  lease_token uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code varchar(80),
  requested_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  financial_pending_count integer NOT NULL DEFAULT 0 CHECK (financial_pending_count >= 0),
  prior_dispatch_count integer NOT NULL DEFAULT 0 CHECK (prior_dispatch_count >= 0),
  CONSTRAINT crm_workspace_closure_terminal CHECK ((state = 'CLOSED') = (closed_at IS NOT NULL))
);
CREATE INDEX crm_workspace_closures_due_idx ON crm_access.crm_workspace_closures(state,next_attempt_at) WHERE state = 'CLOSING';

CREATE FUNCTION crm_access.enforce_workspace_closure_operation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, crm_access AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'crm_workspace_closed' USING ERRCODE = 'P0001', DETAIL = 'crm_workspace_closed';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR
     NEW.command_id IS DISTINCT FROM OLD.command_id OR NEW.owner_subject IS DISTINCT FROM OLD.owner_subject OR
     NEW.owner_membership_id IS DISTINCT FROM OLD.owner_membership_id OR NEW.request_hash IS DISTINCT FROM OLD.request_hash OR
     NEW.display_name_snapshot IS DISTINCT FROM OLD.display_name_snapshot OR NEW.generation IS DISTINCT FROM OLD.generation OR
     NEW.requested_at IS DISTINCT FROM OLD.requested_at OR
     (OLD.state = 'CLOSED' AND (NEW.state <> 'CLOSED' OR NEW.closed_at IS DISTINCT FROM OLD.closed_at)) THEN
    RAISE EXCEPTION 'crm_workspace_closed' USING ERRCODE = 'P0001', DETAIL = 'crm_workspace_closed';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_access.enforce_workspace_closure_operation() FROM PUBLIC;
CREATE TRIGGER workspace_closure_operation_immutable BEFORE UPDATE OR DELETE ON crm_access.crm_workspace_closures
  FOR EACH ROW EXECUTE FUNCTION crm_access.enforce_workspace_closure_operation();

CREATE FUNCTION crm_access.assert_workspace_open(p_workspace_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, crm_access AS $$
BEGIN
  IF p_workspace_id IS NULL THEN RAISE EXCEPTION 'crm_workspace_closed' USING ERRCODE = 'P0001', DETAIL = 'crm_workspace_closed'; END IF;
  INSERT INTO crm_access.workspace_closure_fences(workspace_id) VALUES (p_workspace_id)
  ON CONFLICT (workspace_id) DO UPDATE SET revision = crm_access.workspace_closure_fences.revision + 1
  WHERE crm_access.workspace_closure_fences.fenced_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'crm_workspace_closed' USING ERRCODE = 'P0001', DETAIL = 'crm_workspace_closed'; END IF;
END $$;
REVOKE ALL ON FUNCTION crm_access.assert_workspace_open(uuid) FROM PUBLIC;

CREATE FUNCTION crm_access.guard_workspace_business() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, crm_access AS $$
DECLARE w uuid;
BEGIN
  w := CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
  IF TG_OP = 'UPDATE' AND NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'crm_workspace_closed' USING ERRCODE = 'P0001', DETAIL = 'crm_workspace_closed';
  END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'crm_workspace_members' THEN
    IF NEW.disabled_at IS NOT NULL AND OLD.disabled_at IS NULL AND
       (to_jsonb(NEW) - 'disabled_at' - 'updated_at' - 'version') =
       (to_jsonb(OLD) - 'disabled_at' - 'updated_at' - 'version') THEN RETURN NEW; END IF;
  END IF;
  PERFORM crm_access.assert_workspace_open(w);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION crm_access.guard_workspace_business() FROM PUBLIC;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['crm_workspace_access','crm_workspace_branding','crm_workspace_members','crm_custom_roles','crm_employee_profiles','crm_teams','crm_member_teams'] LOOP
    EXECUTE format('CREATE TRIGGER workspace_closure_business_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_access.%I FOR EACH ROW EXECUTE FUNCTION crm_access.guard_workspace_business()', t);
  END LOOP;
END $$;

CREATE FUNCTION crm_access.guard_workspace_intent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, crm_access AS $$
BEGIN
  PERFORM crm_access.assert_workspace_open(NEW.workspace_id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_access.guard_workspace_intent() FROM PUBLIC;
CREATE TRIGGER workspace_closure_invitation_intent_guard BEFORE INSERT ON crm_access.crm_invitation_intents
  FOR EACH ROW EXECUTE FUNCTION crm_access.guard_workspace_intent();
CREATE TRIGGER workspace_closure_admission_intent_guard BEFORE INSERT ON crm_access.crm_admissions
  FOR EACH ROW EXECUTE FUNCTION crm_access.guard_workspace_intent();
ALTER DEFAULT PRIVILEGES IN SCHEMA crm_access REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
