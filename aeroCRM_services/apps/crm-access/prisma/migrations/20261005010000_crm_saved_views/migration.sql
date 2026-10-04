CREATE TABLE crm_access.crm_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  owner_subject varchar(256) NOT NULL,
  scope varchar(8) NOT NULL,
  name varchar(60) NOT NULL,
  parameters jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  legacy_key varchar(64),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_saved_views_workspace_fkey FOREIGN KEY (workspace_id)
    REFERENCES crm_access.crm_workspace_access(workspace_id) ON DELETE RESTRICT,
  CONSTRAINT crm_saved_views_owner_check CHECK (
    length(owner_subject) BETWEEN 1 AND 256 AND owner_subject = btrim(owner_subject)
  ),
  CONSTRAINT crm_saved_views_scope_check CHECK (scope IN ('DEALS', 'TASKS')),
  CONSTRAINT crm_saved_views_name_check CHECK (
    length(name) BETWEEN 1 AND 60 AND name = btrim(name)
    AND name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT crm_saved_views_version_check CHECK (version > 0),
  CONSTRAINT crm_saved_views_parameters_check CHECK (jsonb_typeof(parameters) = 'object'),
  CONSTRAINT crm_saved_views_legacy_key_check CHECK (
    legacy_key IS NULL OR legacy_key ~ '^[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX crm_saved_views_workspace_id_owner_subject_scope_legacy_key_key
  ON crm_access.crm_saved_views(workspace_id, owner_subject, scope, legacy_key);
CREATE INDEX crm_saved_views_workspace_id_owner_subject_scope_archived_at_created_at_idx
  ON crm_access.crm_saved_views(workspace_id, owner_subject, scope, archived_at, created_at);

CREATE TRIGGER workspace_closure_business_guard
  BEFORE INSERT OR UPDATE OR DELETE ON crm_access.crm_saved_views
  FOR EACH ROW EXECUTE FUNCTION crm_access.guard_workspace_business();
