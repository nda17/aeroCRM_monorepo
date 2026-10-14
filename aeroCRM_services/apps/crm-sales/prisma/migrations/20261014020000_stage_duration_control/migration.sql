BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE "crm_sales"."pipeline_stages"
  ADD COLUMN "stage_duration_days" INTEGER;
ALTER TABLE "crm_sales"."pipeline_stages"
  ADD CONSTRAINT "pipeline_stages_stage_duration_check" CHECK (
    "stage_duration_days" IS NULL
    OR ("state" = 'OPEN' AND "stage_duration_days" BETWEEN 1 AND 3650)
  );
ALTER TABLE "crm_sales"."deals"
  ADD COLUMN "stage_entered_at" TIMESTAMP(3);

CREATE INDEX "deals_stage_duration_idx" ON "crm_sales"."deals"
  ("workspace_id", "pipeline_id", "stage_id", "stage_entered_at", "id")
  WHERE "status" = 'OPEN' AND "archived_at" IS NULL AND "stage_entered_at" IS NOT NULL;

-- Only a recorded creation or an actual stage change proves the entry time.
-- In particular an imported business created_at and same-stage task changes
-- provide no evidence. Conflicting events at the latest instant stay unknown.
WITH entries AS (
  SELECT workspace_id, deal_id, to_stage_id, created_at
  FROM "crm_sales"."deal_timeline"
  WHERE (kind = 'CREATED' AND from_stage_id IS NULL AND to_stage_id IS NOT NULL)
     OR (kind = 'TRANSITIONED' AND from_stage_id IS NOT NULL
         AND to_stage_id IS NOT NULL AND from_stage_id <> to_stage_id)
), latest AS (
  SELECT workspace_id, deal_id, max(created_at) AS entered_at
  FROM entries GROUP BY workspace_id, deal_id
), proven AS (
  SELECT e.workspace_id, e.deal_id, max(e.to_stage_id::text)::uuid AS stage_id,
         l.entered_at
  FROM entries e JOIN latest l
    ON l.workspace_id = e.workspace_id AND l.deal_id = e.deal_id
   AND l.entered_at = e.created_at
  GROUP BY e.workspace_id, e.deal_id, l.entered_at
  HAVING count(*) = 1
)
UPDATE "crm_sales"."deals" d SET stage_entered_at = p.entered_at
FROM proven p
WHERE d.workspace_id = p.workspace_id AND d.id = p.deal_id
  AND d.stage_id = p.stage_id
  AND p.entered_at <= (clock_timestamp() AT TIME ZONE 'UTC')
  AND NOT EXISTS (
    SELECT 1 FROM "crm_sales"."workspace_closure_fences" f
    WHERE f.workspace_id = d.workspace_id AND f.fenced_at IS NOT NULL
  );

-- Keep the invariant for every write path, including the previous binary,
-- Intake, and imports with a historical business creation date.
CREATE FUNCTION "crm_sales"."track_deal_stage_entry"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, crm_sales AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.stage_entered_at := clock_timestamp() AT TIME ZONE 'UTC';
  ELSIF (NEW.pipeline_id, NEW.stage_id) IS DISTINCT FROM (OLD.pipeline_id, OLD.stage_id) THEN
    NEW.stage_entered_at := clock_timestamp() AT TIME ZONE 'UTC';
  ELSE
    NEW.stage_entered_at := OLD.stage_entered_at;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER track_deal_stage_entry BEFORE INSERT OR UPDATE ON "crm_sales"."deals"
FOR EACH ROW EXECUTE FUNCTION "crm_sales"."track_deal_stage_entry"();
REVOKE ALL ON FUNCTION "crm_sales"."track_deal_stage_entry"() FROM PUBLIC;

COMMIT;
