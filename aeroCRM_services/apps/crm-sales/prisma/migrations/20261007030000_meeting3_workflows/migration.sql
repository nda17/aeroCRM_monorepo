ALTER TABLE crm_sales.deal_timeline ADD COLUMN details jsonb;
ALTER TABLE crm_sales.deal_timeline DROP CONSTRAINT deal_timeline_kind_check;
ALTER TABLE crm_sales.deal_timeline ADD CONSTRAINT deal_timeline_kind_check CHECK (
  kind IN ('CREATED','TRANSITIONED','TASK_COMPLETED','ARCHIVED',
    'CALL_REACHED','CALL_NO_ANSWER','MEETING_HELD','ASSIGNEE_CHANGED')
);
ALTER TABLE crm_sales.deal_timeline ADD CONSTRAINT deal_timeline_details_check CHECK (
  CASE WHEN kind = 'ASSIGNEE_CHANGED' THEN
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
  ELSE details IS NULL END
);
