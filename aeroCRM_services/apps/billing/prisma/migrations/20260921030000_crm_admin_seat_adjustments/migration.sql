SET lock_timeout = '5s';

CREATE TABLE billing.crm_admin_seat_adjustments (
  command_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  actor_subject VARCHAR(256) NOT NULL,
  actor_role VARCHAR(16) NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  target VARCHAR(32) NOT NULL,
  period_id UUID,
  old_total_seats INTEGER NOT NULL,
  new_total_seats INTEGER NOT NULL,
  effective_until TIMESTAMP(3) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  capacity_fence JSONB NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT crm_admin_seat_adjustments_pkey PRIMARY KEY (command_id),
  CONSTRAINT crm_admin_seat_adjustments_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES billing.crm_entitlements(workspace_id) ON DELETE RESTRICT,
  CONSTRAINT crm_admin_seat_adjustments_period_workspace_fkey
    FOREIGN KEY (period_id, workspace_id) REFERENCES billing.crm_paid_periods(id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT crm_admin_seat_adjustments_actor_subject_check
    CHECK (length(actor_subject) BETWEEN 1 AND 256 AND actor_subject !~ '[[:space:][:cntrl:]]'),
  CONSTRAINT crm_admin_seat_adjustments_actor_role_check CHECK (actor_role IN ('ADMIN', 'DEV')),
  CONSTRAINT crm_admin_seat_adjustments_reason_check CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  CONSTRAINT crm_admin_seat_adjustments_target_check CHECK (target IN ('ENTITLEMENT', 'PAID_PERIOD')),
  CONSTRAINT crm_admin_seat_adjustments_target_period_check CHECK ((target = 'PAID_PERIOD') = (period_id IS NOT NULL)),
  CONSTRAINT crm_admin_seat_adjustments_seats_check CHECK (
    old_total_seats BETWEEN 2 AND 10000 AND new_total_seats BETWEEN 2 AND 10000 AND old_total_seats <> new_total_seats
  ),
  CONSTRAINT crm_admin_seat_adjustments_request_hash_check CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT crm_admin_seat_adjustments_capacity_fence_check CHECK ((
    jsonb_typeof(capacity_fence) = 'object'
    AND capacity_fence ?& ARRAY['operationId','requestHash','fenceRevision','targetSeats']
    AND capacity_fence - ARRAY['operationId','requestHash','fenceRevision','targetSeats'] = '{}'::jsonb
    AND jsonb_typeof(capacity_fence->'operationId') = 'string'
    AND jsonb_typeof(capacity_fence->'requestHash') = 'string'
    AND jsonb_typeof(capacity_fence->'fenceRevision') = 'number'
    AND jsonb_typeof(capacity_fence->'targetSeats') = 'number'
    AND capacity_fence->>'operationId' = command_id::text
    AND capacity_fence->>'requestHash' = request_hash
    AND CASE WHEN capacity_fence->>'fenceRevision' ~ '^[1-9][0-9]*$'
      THEN (capacity_fence->>'fenceRevision')::numeric BETWEEN 1 AND 2147483646 ELSE false END
    AND capacity_fence->>'targetSeats' = new_total_seats::text
  ) IS TRUE)
);

CREATE INDEX crm_admin_seat_adjustments_workspace_id_created_at_command_id_idx
  ON billing.crm_admin_seat_adjustments(workspace_id, created_at, command_id);

CREATE INDEX crm_admin_seat_adjustments_period_id_workspace_id_idx
  ON billing.crm_admin_seat_adjustments(period_id, workspace_id) WHERE period_id IS NOT NULL;

CREATE FUNCTION billing.protect_crm_admin_seat_adjustments() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'aeroCRM administrative seat adjustments are append-only';
END;
$$;

REVOKE ALL ON FUNCTION billing.protect_crm_admin_seat_adjustments() FROM PUBLIC;

CREATE TRIGGER crm_admin_seat_adjustments_append_only
  BEFORE UPDATE OR DELETE ON billing.crm_admin_seat_adjustments
  FOR EACH ROW EXECUTE FUNCTION billing.protect_crm_admin_seat_adjustments();

CREATE TRIGGER crm_admin_seat_adjustments_no_truncate
  BEFORE TRUNCATE ON billing.crm_admin_seat_adjustments
  FOR EACH STATEMENT EXECUTE FUNCTION billing.protect_crm_admin_seat_adjustments();
