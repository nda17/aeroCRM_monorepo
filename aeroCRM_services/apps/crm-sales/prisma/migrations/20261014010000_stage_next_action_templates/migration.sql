BEGIN;

ALTER TABLE "crm_sales"."pipeline_stages"
  ADD COLUMN "next_action_title" VARCHAR(200),
  ADD COLUMN "next_action_delay_hours" INTEGER;

ALTER TABLE "crm_sales"."pipeline_stages"
  ADD CONSTRAINT "pipeline_stages_next_action_template_check" CHECK (
    ("next_action_title" IS NULL AND "next_action_delay_hours" IS NULL)
    OR (
      "next_action_title" IS NOT NULL
      AND "next_action_delay_hours" IS NOT NULL
      AND "state" = 'OPEN'
      AND btrim("next_action_title") <> ''
      AND "next_action_title" !~ '[[:cntrl:]]'
      AND "next_action_delay_hours" BETWEEN 1 AND 2160
    )
  );

COMMIT;
