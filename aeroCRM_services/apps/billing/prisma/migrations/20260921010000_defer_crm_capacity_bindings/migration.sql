BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "billing"."crm_orders"
  ALTER CONSTRAINT "crm_orders_capacity_command_id_workspace_id_owner_subject_fkey"
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "billing"."crm_commerce_accounts"
  ALTER CONSTRAINT "crm_commerce_accounts_capacity_owner_fkey"
  DEFERRABLE INITIALLY DEFERRED;

COMMIT;
