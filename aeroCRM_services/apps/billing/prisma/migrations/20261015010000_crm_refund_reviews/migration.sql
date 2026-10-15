BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE billing.crm_refund_reviews (
  id uuid PRIMARY KEY,
  provider varchar(16) NOT NULL DEFAULT 'YOOKASSA',
  shop_id varchar(64) NOT NULL,
  provider_mode varchar(8) NOT NULL,
  provider_refund_id varchar(64) NOT NULL,
  payment_id_hint varchar(64) NOT NULL,
  provider_payment_id varchar(128),
  order_id uuid,
  workspace_id uuid,
  verification_status varchar(16) NOT NULL DEFAULT 'PENDING',
  review_status varchar(16) NOT NULL DEFAULT 'PENDING',
  amount_minor bigint,
  currency char(3),
  provider_created_at timestamp(3),
  verified_at timestamp(3),
  version integer NOT NULL DEFAULT 1,
  lease_token uuid,
  lease_until timestamp(3),
  available_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempts integer NOT NULL DEFAULT 0,
  last_error_code varchar(128),
  reviewed_at timestamp(3),
  reviewed_by varchar(256),
  review_comment varchar(2000),
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL,
  CONSTRAINT crm_refund_reviews_order_fkey FOREIGN KEY (order_id, workspace_id)
    REFERENCES billing.crm_orders(id, workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT crm_refund_reviews_source_check CHECK (
    provider = 'YOOKASSA' AND length(shop_id) BETWEEN 1 AND 64
    AND shop_id !~ '[[:space:][:cntrl:]]' AND provider_mode IN ('LIVE','TEST')
    AND provider_refund_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    AND payment_id_hint ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  ),
  CONSTRAINT crm_refund_reviews_state_check CHECK (
    verification_status IN ('PENDING','VERIFIED','REJECTED','FAILED')
    AND review_status IN ('PENDING','REVIEWED')
    AND version BETWEEN 1 AND 2147483646 AND attempts BETWEEN 0 AND 10
  ),
  CONSTRAINT crm_refund_reviews_lease_check CHECK (
    (lease_token IS NULL) = (lease_until IS NULL)
    AND (lease_token IS NULL OR verification_status = 'PENDING')
  ),
  CONSTRAINT crm_refund_reviews_facts_check CHECK (
    (verification_status = 'VERIFIED' AND provider_payment_id IS NOT NULL
      AND order_id IS NOT NULL AND workspace_id IS NOT NULL
      AND amount_minor IS NOT NULL AND amount_minor BETWEEN 1 AND 1000000000000
      AND currency IS NOT NULL AND currency = 'RUB'
      AND provider_created_at IS NOT NULL AND verified_at IS NOT NULL)
    OR (verification_status <> 'VERIFIED' AND provider_payment_id IS NULL
      AND order_id IS NULL AND workspace_id IS NULL AND amount_minor IS NULL
      AND currency IS NULL AND provider_created_at IS NULL AND verified_at IS NULL)
  ),
  CONSTRAINT crm_refund_reviews_review_check CHECK (
    (review_status = 'PENDING' AND reviewed_at IS NULL AND reviewed_by IS NULL AND review_comment IS NULL)
    OR (review_status = 'REVIEWED' AND verification_status = 'VERIFIED'
      AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
      AND length(reviewed_by) BETWEEN 1 AND 256 AND reviewed_by !~ '[[:space:][:cntrl:]]'
      AND review_comment IS NOT NULL AND length(btrim(review_comment)) BETWEEN 1 AND 2000)
  )
);
CREATE UNIQUE INDEX crm_refund_reviews_provider_key ON billing.crm_refund_reviews(shop_id, provider_refund_id);
CREATE INDEX crm_refund_reviews_verification_idx ON billing.crm_refund_reviews(verification_status, available_at, created_at, id);
CREATE INDEX crm_refund_reviews_list_idx ON billing.crm_refund_reviews(review_status, created_at, id);
CREATE INDEX crm_refund_reviews_order_idx ON billing.crm_refund_reviews(order_id, verification_status);

CREATE TABLE billing.crm_refund_command_receipts (
  actor_subject varchar(256) NOT NULL,
  command_id uuid NOT NULL,
  command_type varchar(16) NOT NULL,
  refund_id uuid NOT NULL REFERENCES billing.crm_refund_reviews(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  request_hash char(64) NOT NULL,
  result jsonb NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (actor_subject, command_id),
  CONSTRAINT crm_refund_commands_binding_check CHECK (
    length(actor_subject) BETWEEN 1 AND 256 AND actor_subject !~ '[[:space:][:cntrl:]]'
    AND command_type IN ('REVIEW','RETRY') AND request_hash ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(result) = 'object'
  )
);
CREATE INDEX crm_refund_commands_refund_idx ON billing.crm_refund_command_receipts(refund_id, created_at);

CREATE FUNCTION billing.protect_crm_refund_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, billing AS $$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') OR TG_TABLE_NAME = 'crm_refund_command_receipts' THEN
    RAISE EXCEPTION 'Refund evidence is immutable' USING ERRCODE = '23514';
  END IF;
  IF (NEW.id, NEW.provider, NEW.shop_id, NEW.provider_mode, NEW.provider_refund_id, NEW.payment_id_hint, NEW.created_at)
    IS DISTINCT FROM
     (OLD.id, OLD.provider, OLD.shop_id, OLD.provider_mode, OLD.provider_refund_id, OLD.payment_id_hint, OLD.created_at)
    OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Refund source binding is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.verification_status = 'VERIFIED' AND
    (to_jsonb(NEW) - ARRAY['version','review_status','reviewed_at','reviewed_by','review_comment','updated_at'])
      IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['version','review_status','reviewed_at','reviewed_by','review_comment','updated_at']) THEN
    RAISE EXCEPTION 'Verified refund facts are immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.review_status = 'REVIEWED' THEN
    RAISE EXCEPTION 'Refund review is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION billing.protect_crm_refund_evidence() FROM PUBLIC;
CREATE TRIGGER crm_refund_reviews_evidence_guard BEFORE UPDATE OR DELETE ON billing.crm_refund_reviews
FOR EACH ROW EXECUTE FUNCTION billing.protect_crm_refund_evidence();
CREATE TRIGGER crm_refund_reviews_no_truncate BEFORE TRUNCATE ON billing.crm_refund_reviews
FOR EACH STATEMENT EXECUTE FUNCTION billing.protect_crm_refund_evidence();
CREATE TRIGGER crm_refund_commands_evidence_guard BEFORE UPDATE OR DELETE ON billing.crm_refund_command_receipts
FOR EACH ROW EXECUTE FUNCTION billing.protect_crm_refund_evidence();
CREATE TRIGGER crm_refund_commands_no_truncate BEFORE TRUNCATE ON billing.crm_refund_command_receipts
FOR EACH STATEMENT EXECUTE FUNCTION billing.protect_crm_refund_evidence();
COMMIT;
