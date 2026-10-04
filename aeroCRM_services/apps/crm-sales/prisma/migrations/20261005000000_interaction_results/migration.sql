ALTER TABLE crm_sales.deal_timeline
  DROP CONSTRAINT deal_timeline_kind_check;

ALTER TABLE crm_sales.deal_timeline
  ADD CONSTRAINT deal_timeline_kind_check CHECK (
    kind IN (
      'CREATED', 'TRANSITIONED', 'TASK_COMPLETED', 'ARCHIVED',
      'CALL_REACHED', 'CALL_NO_ANSWER', 'MEETING_HELD'
    )
  );
