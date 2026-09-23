BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "crm_intake"."inbox_notifications"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

COMMIT;
