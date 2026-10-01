CREATE TABLE crm_customers.import_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  actor_subject varchar(256) NOT NULL,
  entity varchar(16) NOT NULL,
  source_key varchar(100) NOT NULL,
  file_digest char(64) NOT NULL,
  rows jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  commit_command_id uuid,
  request_hash char(64),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_previews_entity_check CHECK (entity IN ('companies','contacts')),
  CONSTRAINT import_previews_rows_check CHECK (jsonb_typeof(rows) = 'array'),
  CONSTRAINT import_previews_commit_check CHECK ((commit_command_id IS NULL AND request_hash IS NULL AND result IS NULL) OR (commit_command_id IS NOT NULL AND request_hash IS NOT NULL AND result IS NOT NULL)),
  CONSTRAINT import_previews_workspace_id_id_key UNIQUE (workspace_id,id)
);
CREATE UNIQUE INDEX import_previews_commit_command_id_key ON crm_customers.import_previews(commit_command_id);
CREATE INDEX import_previews_workspace_actor_expiry_idx ON crm_customers.import_previews(workspace_id,actor_subject,expires_at);

CREATE TABLE crm_customers.import_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  source_key varchar(100) NOT NULL,
  entity varchar(16) NOT NULL,
  external_id varchar(256) NOT NULL,
  payload_hash char(64) NOT NULL,
  company_id uuid,
  contact_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_bindings_kind_check CHECK ((entity='companies' AND company_id IS NOT NULL AND contact_id IS NULL) OR (entity='contacts' AND contact_id IS NOT NULL AND company_id IS NULL)),
  CONSTRAINT import_bindings_company_fkey FOREIGN KEY (workspace_id,company_id) REFERENCES crm_customers.companies(workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT import_bindings_contact_fkey FOREIGN KEY (workspace_id,contact_id) REFERENCES crm_customers.contacts(workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT import_bindings_workspace_source_entity_external_key UNIQUE (workspace_id,source_key,entity,external_id)
);
CREATE INDEX import_bindings_workspace_company_idx ON crm_customers.import_bindings(workspace_id,company_id);
CREATE INDEX import_bindings_workspace_contact_idx ON crm_customers.import_bindings(workspace_id,contact_id);
CREATE TRIGGER guard_workspace_closure BEFORE INSERT OR UPDATE OR DELETE ON crm_customers.import_previews FOR EACH ROW EXECUTE FUNCTION crm_customers.guard_workspace_business_write();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT OR UPDATE OR DELETE ON crm_customers.import_bindings FOR EACH ROW EXECUTE FUNCTION crm_customers.guard_workspace_business_write();

CREATE FUNCTION crm_customers.import_preview_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, crm_customers AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.result IS NOT NULL OR
     (NEW.id,NEW.workspace_id,NEW.actor_subject,NEW.entity,NEW.source_key,NEW.file_digest,NEW.rows,NEW.expires_at,NEW.created_at)
       IS DISTINCT FROM
     (OLD.id,OLD.workspace_id,OLD.actor_subject,OLD.entity,OLD.source_key,OLD.file_digest,OLD.rows,OLD.expires_at,OLD.created_at)
     OR NEW.commit_command_id IS NULL OR NEW.request_hash IS NULL OR NEW.result IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='crm_import_preview_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER import_preview_immutable BEFORE UPDATE OR DELETE ON crm_customers.import_previews FOR EACH ROW EXECUTE FUNCTION crm_customers.import_preview_immutable();

CREATE FUNCTION crm_customers.import_binding_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, crm_customers AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='crm_import_binding_immutable';
END;
$$;
CREATE TRIGGER import_binding_immutable BEFORE UPDATE OR DELETE ON crm_customers.import_bindings FOR EACH ROW EXECUTE FUNCTION crm_customers.import_binding_immutable();
REVOKE ALL ON FUNCTION crm_customers.import_preview_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION crm_customers.import_binding_immutable() FROM PUBLIC;
