BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE crm_customers.mail_template_settings (
  workspace_id uuid PRIMARY KEY,
  version integer NOT NULL CHECK (version > 0),
  templates jsonb NOT NULL CHECK (jsonb_typeof(templates) = 'array'),
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL
);
CREATE TABLE crm_customers.mail_template_commands (
  command_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  actor_subject varchar(256) NOT NULL,
  actor_membership_id uuid NOT NULL,
  request_hash char(64) NOT NULL,
  result jsonb NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX mail_template_commands_workspace_idx
  ON crm_customers.mail_template_commands (workspace_id, created_at);

CREATE TRIGGER guard_workspace_closure BEFORE INSERT OR UPDATE OR DELETE
  ON crm_customers.mail_template_settings FOR EACH ROW
  EXECUTE FUNCTION crm_customers.guard_workspace_business_write();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT
  ON crm_customers.mail_template_commands FOR EACH ROW
  EXECUTE FUNCTION crm_customers.guard_workspace_business_write();
CREATE FUNCTION crm_customers.reject_mail_template_command_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, crm_customers AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'crm_mail_template_command_immutable';
END;
$$;
REVOKE ALL ON FUNCTION crm_customers.reject_mail_template_command_mutation() FROM PUBLIC;
CREATE TRIGGER mail_template_commands_append_only BEFORE UPDATE OR DELETE
  ON crm_customers.mail_template_commands FOR EACH ROW
  EXECUTE FUNCTION crm_customers.reject_mail_template_command_mutation();
CREATE TRIGGER mail_template_commands_no_truncate BEFORE TRUNCATE
  ON crm_customers.mail_template_commands FOR EACH STATEMENT
  EXECUTE FUNCTION crm_customers.reject_mail_template_command_mutation();
CREATE TRIGGER mail_template_settings_live_change AFTER INSERT OR UPDATE
  ON crm_customers.mail_template_settings FOR EACH ROW
  EXECUTE FUNCTION crm_customers.notify_live_change('workspace_id');

COMMIT;
