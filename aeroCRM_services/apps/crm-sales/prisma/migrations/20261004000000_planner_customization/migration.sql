-- Workspace-wide planner configuration. Existing tasks keep their status-default column.
CREATE TABLE crm_sales.planner_settings (
  workspace_id uuid PRIMARY KEY,
  version integer NOT NULL CHECK (version > 0),
  templates jsonb NOT NULL CHECK (jsonb_typeof(templates) = 'array'),
  default_columns jsonb NOT NULL CHECK (jsonb_typeof(default_columns) = 'array'),
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL
);
CREATE TABLE crm_sales.planner_board_columns (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  status crm_sales."SalesTaskStatus" NOT NULL,
  name varchar(100) NOT NULL CHECK (length(btrim(name)) > 0),
  position integer NOT NULL CHECK (position >= 0 AND position < 50),
  archived boolean NOT NULL DEFAULT false,
  CONSTRAINT planner_board_columns_id_workspace_id_key UNIQUE (id, workspace_id)
);
CREATE INDEX planner_board_columns_order_idx ON crm_sales.planner_board_columns(workspace_id, position, id);
CREATE TABLE crm_sales.planner_command_receipts (
  command_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  actor_subject varchar(256) NOT NULL,
  request_hash char(64) NOT NULL,
  result jsonb NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX planner_commands_workspace_idx ON crm_sales.planner_command_receipts(workspace_id, created_at);
ALTER TABLE crm_sales.tasks ADD COLUMN board_column_id uuid;
ALTER TABLE crm_sales.tasks ADD CONSTRAINT tasks_board_column_fkey
  FOREIGN KEY (board_column_id, workspace_id)
  REFERENCES crm_sales.planner_board_columns(id, workspace_id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX tasks_board_column_idx ON crm_sales.tasks(workspace_id, board_column_id, status, due_at, id);

CREATE FUNCTION crm_sales.guard_planner_board_column_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, crm_sales AS $$
BEGIN
  IF OLD.id IS DISTINCT FROM NEW.id OR OLD.workspace_id IS DISTINCT FROM NEW.workspace_id OR OLD.status IS DISTINCT FROM NEW.status THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'crm_planner_column_identity_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION crm_sales.normalize_task_board_column() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, crm_sales AS $$
DECLARE target_status crm_sales."SalesTaskStatus"; target_archived boolean;
BEGIN
  -- Every task writer is fenced before it reads configuration, including legacy
  -- sales, intake and recurring-task writers which know only built-in statuses.
  PERFORM crm_sales.assert_workspace_open(NEW.workspace_id);
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status AND OLD.board_column_id IS NOT DISTINCT FROM NEW.board_column_id THEN
      NEW.board_column_id := NULL;
    END IF;
    IF OLD.status IS NOT DISTINCT FROM NEW.status AND OLD.board_column_id IS NOT DISTINCT FROM NEW.board_column_id THEN
      RETURN NEW; -- An archived placement remains historical and falls back in reads.
    END IF;
  END IF;
  IF NEW.board_column_id IS NULL THEN RETURN NEW; END IF;
  SELECT status, archived INTO target_status, target_archived FROM crm_sales.planner_board_columns
    WHERE id = NEW.board_column_id AND workspace_id = NEW.workspace_id FOR SHARE;
  IF NOT FOUND OR target_archived OR target_status IS DISTINCT FROM NEW.status THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'crm_planner_column_unavailable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER planner_board_column_identity BEFORE UPDATE ON crm_sales.planner_board_columns
  FOR EACH ROW EXECUTE FUNCTION crm_sales.guard_planner_board_column_identity();
CREATE TRIGGER tasks_planner_column BEFORE INSERT OR UPDATE OF status, board_column_id ON crm_sales.tasks
  FOR EACH ROW EXECUTE FUNCTION crm_sales.normalize_task_board_column();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT OR UPDATE OR DELETE ON crm_sales.planner_settings
  FOR EACH ROW EXECUTE FUNCTION crm_sales.guard_workspace_business_write();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT OR UPDATE OR DELETE ON crm_sales.planner_board_columns
  FOR EACH ROW EXECUTE FUNCTION crm_sales.guard_workspace_business_write();
CREATE TRIGGER guard_workspace_closure BEFORE INSERT ON crm_sales.planner_command_receipts
  FOR EACH ROW EXECUTE FUNCTION crm_sales.guard_workspace_business_write();
CREATE TRIGGER planner_commands_append_only BEFORE UPDATE OR DELETE ON crm_sales.planner_command_receipts
  FOR EACH ROW EXECUTE FUNCTION crm_sales.reject_reminder_command_mutation();
CREATE TRIGGER planner_commands_no_truncate BEFORE TRUNCATE ON crm_sales.planner_command_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION crm_sales.reject_reminder_command_mutation();
CREATE TRIGGER planner_settings_live_change AFTER INSERT OR UPDATE ON crm_sales.planner_settings
  FOR EACH ROW EXECUTE FUNCTION crm_sales.notify_live_change('workspace_id');
CREATE TRIGGER planner_columns_live_change AFTER INSERT OR UPDATE ON crm_sales.planner_board_columns
  FOR EACH ROW EXECUTE FUNCTION crm_sales.notify_live_change('workspace_id');
REVOKE ALL ON FUNCTION crm_sales.guard_planner_board_column_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION crm_sales.normalize_task_board_column() FROM PUBLIC;
