BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE crm_sales.deal_timeline DROP CONSTRAINT deal_timeline_details_check;
ALTER TABLE crm_sales.deal_timeline ADD CONSTRAINT deal_timeline_details_check CHECK (
  CASE
    WHEN kind = 'ASSIGNEE_CHANGED' THEN
      details IS NOT NULL AND jsonb_typeof(details) = 'object'
      AND details ?& ARRAY['beforeSubject','afterSubject','afterMembershipId','transferredTaskCount']
      AND (details - ARRAY['beforeSubject','afterSubject','afterMembershipId','transferredTaskCount']) = '{}'::jsonb
      AND jsonb_typeof(details->'beforeSubject') = 'string'
      AND jsonb_typeof(details->'afterSubject') = 'string'
      AND length(details->>'beforeSubject') BETWEEN 1 AND 256
      AND length(details->>'afterSubject') BETWEEN 1 AND 256
      AND jsonb_typeof(details->'afterMembershipId') = 'string'
      AND (details->>'afterMembershipId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND jsonb_typeof(details->'transferredTaskCount') = 'number'
      AND (details->>'transferredTaskCount') ~ '^(0|[1-9][0-9]*)$'
    WHEN kind = 'TRANSITIONED' THEN
      details IS NULL OR (
        jsonb_typeof(details) = 'object'
        AND details ? 'loss'
        AND (details - 'loss') = '{}'::jsonb
        AND jsonb_typeof(details->'loss') = 'object'
        AND (details->'loss') ?& ARRAY['lostAt','reason']
        AND ((details->'loss') - ARRAY['lostAt','reason']) = '{}'::jsonb
        AND (
          jsonb_typeof(details->'loss'->'lostAt') = 'null'
          OR (
            jsonb_typeof(details->'loss'->'lostAt') = 'string'
            AND (details->'loss'->>'lostAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
          )
        )
        AND (
          jsonb_typeof(details->'loss'->'reason') = 'null'
          OR (
            jsonb_typeof(details->'loss'->'reason') = 'object'
            AND (details->'loss'->'reason') ?& ARRAY['id','title']
            AND ((details->'loss'->'reason') - ARRAY['id','title']) = '{}'::jsonb
            AND jsonb_typeof(details->'loss'->'reason'->'id') = 'string'
            AND (details->'loss'->'reason'->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            AND jsonb_typeof(details->'loss'->'reason'->'title') = 'string'
            AND length(details->'loss'->'reason'->>'title') BETWEEN 1 AND 200
          )
        )
      )
    ELSE details IS NULL
  END
);

COMMIT;
