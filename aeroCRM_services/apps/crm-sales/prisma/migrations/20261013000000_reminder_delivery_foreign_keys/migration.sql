BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Do not repair or remove historical deliveries automatically. The release
-- preflight reports these counts before admission; this guard also closes races.
DO $reminder_delivery_links$
BEGIN
  IF EXISTS (
    SELECT 1 FROM crm_sales.reminder_deliveries d
    LEFT JOIN crm_sales.tasks t ON t.id=d.task_id AND t.workspace_id=d.workspace_id
    LEFT JOIN crm_sales.reminder_rules r ON r.id=d.rule_id AND r.workspace_id=d.workspace_id
    WHERE t.id IS NULL OR r.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Reminder delivery links require an explicit data repair before migration';
  END IF;
END
$reminder_delivery_links$;

ALTER TABLE crm_sales.reminder_deliveries
  ADD CONSTRAINT reminder_deliveries_task_workspace_fkey
  FOREIGN KEY (task_id, workspace_id) REFERENCES crm_sales.tasks(id, workspace_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE crm_sales.reminder_deliveries
  ADD CONSTRAINT reminder_deliveries_rule_workspace_fkey
  FOREIGN KEY (rule_id, workspace_id) REFERENCES crm_sales.reminder_rules(id, workspace_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;
COMMIT;
