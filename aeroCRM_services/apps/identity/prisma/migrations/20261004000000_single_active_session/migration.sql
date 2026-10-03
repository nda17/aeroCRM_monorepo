BEGIN;
LOCK TABLE identity.user_sessions IN SHARE ROW EXCLUSIVE MODE;

-- Preserve history, keeping the newest usable session for every account.
UPDATE identity.user_sessions SET revoked_at = CURRENT_TIMESTAMP
WHERE revoked_at IS NULL AND expires_at <= CURRENT_TIMESTAMP;
WITH ranked AS (
 SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS position
 FROM identity.user_sessions WHERE revoked_at IS NULL
)
UPDATE identity.user_sessions SET revoked_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT id FROM ranked WHERE position > 1);

CREATE UNIQUE INDEX user_sessions_one_active_per_user
ON identity.user_sessions (user_id) WHERE revoked_at IS NULL;

CREATE FUNCTION identity.enforce_single_active_session() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, identity AS $$
DECLARE account_status identity."UserStatus"; account_deleted timestamp;
BEGIN
 IF TG_OP = 'UPDATE' THEN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL) THEN
   RAISE EXCEPTION 'Session identity and revocation are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
 END IF;
 SELECT status, deleted_at INTO account_status, account_deleted
 FROM identity.users WHERE id = NEW.user_id FOR UPDATE;
 IF NOT FOUND OR account_status <> 'ACTIVE' OR account_deleted IS NOT NULL THEN
  RAISE EXCEPTION 'Account is inactive' USING ERRCODE = '23514';
 END IF;
 IF NEW.revoked_at IS NULL THEN
  UPDATE identity.user_sessions SET revoked_at = CURRENT_TIMESTAMP
  WHERE user_id = NEW.user_id AND revoked_at IS NULL;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER user_sessions_single_active
BEFORE INSERT OR UPDATE ON identity.user_sessions
FOR EACH ROW EXECUTE FUNCTION identity.enforce_single_active_session();

CREATE FUNCTION identity.notify_session_revoked() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, identity AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  PERFORM pg_notify('identity_session_revoked_v1', OLD.id::text);
  RETURN OLD;
 END IF;
 IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
  PERFORM pg_notify('identity_session_revoked_v1', NEW.id::text);
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER user_sessions_revocation_signal
AFTER UPDATE OR DELETE ON identity.user_sessions
FOR EACH ROW EXECUTE FUNCTION identity.notify_session_revoked();
REVOKE ALL ON FUNCTION identity.enforce_single_active_session() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.notify_session_revoked() FROM PUBLIC;
COMMIT;
