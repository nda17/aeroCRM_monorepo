BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE crm_sales.deals
  ADD COLUMN lost_at timestamp(3),
  ADD COLUMN loss_reason_id uuid,
  ADD COLUMN loss_reason_title varchar(200),
  ADD CONSTRAINT deals_loss_reason_snapshot_check
    CHECK (
      (loss_reason_id IS NULL) = (loss_reason_title IS NULL)
      AND (status = 'LOST' OR
        (lost_at IS NULL AND loss_reason_id IS NULL AND loss_reason_title IS NULL))
    );
CREATE INDEX deals_loss_report_idx
  ON crm_sales.deals (workspace_id, status, lost_at, id);

CREATE TABLE crm_sales.loss_reason_settings (
  workspace_id uuid PRIMARY KEY,
  version integer NOT NULL CHECK (version > 0),
  reasons jsonb NOT NULL CHECK (jsonb_typeof(reasons) = 'array'),
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL
);
CREATE TABLE crm_sales.loss_reason_commands (
  command_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  actor_subject varchar(256) NOT NULL,
  actor_membership_id uuid,
  request_hash char(64) NOT NULL,
  result jsonb NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX loss_reason_commands_workspace_idx
  ON crm_sales.loss_reason_commands (workspace_id, created_at);

CREATE TABLE crm_sales.bulk_assignment_commands (
  command_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  actor_subject varchar(256) NOT NULL,
  actor_membership_id uuid,
  request_hash char(64) NOT NULL,
  result jsonb NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX bulk_assignment_commands_workspace_idx
  ON crm_sales.bulk_assignment_commands (workspace_id, created_at);

CREATE TRIGGER guard_workspace_closure BEFORE INSERT OR UPDATE OR DELETE
  ON crm_sales.loss_reason_settings FOR EACH ROW
  EXECUTE FUNCTION crm_sales.guard_workspace_business_write();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT
  ON crm_sales.loss_reason_commands FOR EACH ROW
  EXECUTE FUNCTION crm_sales.guard_workspace_business_write();
CREATE TRIGGER loss_reason_commands_append_only BEFORE UPDATE OR DELETE
  ON crm_sales.loss_reason_commands FOR EACH ROW
  EXECUTE FUNCTION crm_sales.reject_reminder_command_mutation();
CREATE TRIGGER loss_reason_commands_no_truncate BEFORE TRUNCATE
  ON crm_sales.loss_reason_commands FOR EACH STATEMENT
  EXECUTE FUNCTION crm_sales.reject_reminder_command_mutation();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT
  ON crm_sales.bulk_assignment_commands FOR EACH ROW
  EXECUTE FUNCTION crm_sales.guard_workspace_business_write();
CREATE TRIGGER bulk_assignment_commands_append_only BEFORE UPDATE OR DELETE
  ON crm_sales.bulk_assignment_commands FOR EACH ROW
  EXECUTE FUNCTION crm_sales.reject_reminder_command_mutation();
CREATE TRIGGER bulk_assignment_commands_no_truncate BEFORE TRUNCATE
  ON crm_sales.bulk_assignment_commands FOR EACH STATEMENT
  EXECUTE FUNCTION crm_sales.reject_reminder_command_mutation();
CREATE TRIGGER loss_reason_settings_live_change AFTER INSERT OR UPDATE
  ON crm_sales.loss_reason_settings FOR EACH ROW
  EXECUTE FUNCTION crm_sales.notify_live_change('workspace_id');

COMMIT;
