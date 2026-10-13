BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- Keep immutable identities and receipts. Only the redundant technical payload
-- is retired; neither user history nor ambiguous dispatch receipts are deleted.
ALTER TABLE crm_access.telegram_webhook_inbox ADD COLUMN payload_purged_at timestamp(3);
ALTER TABLE crm_access.telegram_connect_sessions ADD COLUMN payload_purged_at timestamp(3);
ALTER TABLE crm_access.telegram_webhook_inbox ADD CONSTRAINT telegram_inbox_retired_payload
 CHECK (payload_purged_at IS NULL OR (state IN ('DONE','DEAD') AND raw_body='' AND payload='{}'::jsonb AND lease_token IS NULL AND lease_until IS NULL));
ALTER TABLE crm_access.telegram_connect_sessions ADD CONSTRAINT telegram_session_retired_payload
 CHECK (payload_purged_at IS NULL OR (state IN ('EXPIRED','CANCELLED') AND telegram_user_id IS NULL AND owner_name IS NULL AND owner_username IS NULL AND connection_id IS NULL));
CREATE INDEX telegram_inbox_retention_idx ON crm_access.telegram_webhook_inbox(state,updated_at,id) WHERE payload_purged_at IS NULL AND state IN ('DONE','DEAD');
CREATE INDEX telegram_session_retention_idx ON crm_access.telegram_connect_sessions(expires_at,id) WHERE payload_purged_at IS NULL AND state <> 'CONNECTED';

-- SECURITY INVOKER is intentional: a nested SECURITY DEFINER maintenance
-- routine has the table owner's identity, an ordinary runtime UPDATE does not.
-- A caller-controlled setting must never authorize crossing a closure fence.
CREATE FUNCTION crm_access.guard_workspace_retention() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,crm_access AS $$
DECLARE n jsonb; o jsonb; owner_call boolean; closed boolean;
BEGIN
 IF TG_OP='INSERT' AND TG_TABLE_NAME='telegram_connect_sessions' THEN
  IF NEW.payload_purged_at IS NOT NULL THEN RAISE EXCEPTION 'telegram_retired_insert_refused'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
  RAISE EXCEPTION 'crm_workspace_closed' USING ERRCODE='P0001';
 END IF;
 IF TG_OP='UPDATE' THEN
  n:=to_jsonb(NEW); o:=to_jsonb(OLD);
  SELECT current_user=pg_get_userbyid(relowner) INTO owner_call FROM pg_class WHERE oid=TG_RELID;
  IF TG_TABLE_NAME='telegram_connect_sessions' THEN
   IF owner_call AND OLD.payload_purged_at IS NULL AND OLD.expires_at<now()-interval '30 days'
    AND OLD.state IN ('WAITING_TELEGRAM','OWNER_VERIFIED','CONNECTION_READY','EXPIRED','CANCELLED')
    AND NEW.state=(CASE WHEN OLD.state='CANCELLED' THEN 'CANCELLED' ELSE 'EXPIRED' END)
    AND NEW.telegram_user_id IS NULL AND NEW.owner_name IS NULL AND NEW.owner_username IS NULL AND NEW.connection_id IS NULL
    AND NEW.payload_purged_at=now()::timestamp(3) AND NEW.version=OLD.version+1
    AND (n-ARRAY['state','telegram_user_id','owner_name','owner_username','connection_id','payload_purged_at','version','updated_at'])
      =(o-ARRAY['state','telegram_user_id','owner_name','owner_username','connection_id','payload_purged_at','version','updated_at']) THEN RETURN NEW; END IF;
   IF OLD.payload_purged_at IS NOT NULL OR NEW.payload_purged_at IS DISTINCT FROM OLD.payload_purged_at THEN
    RAISE EXCEPTION 'telegram_session_retention_refused';
   END IF;
  END IF;
  IF owner_call THEN
   SELECT EXISTS(SELECT 1 FROM crm_access.crm_workspace_closures c WHERE c.workspace_id=OLD.workspace_id AND c.state='CLOSED' AND c.closed_at<now()-interval '30 days') INTO closed;
   IF closed AND TG_TABLE_NAME='crm_chat_attachments' THEN
    IF OLD.message_id IS NULL AND OLD.expires_at<now() AND NEW.version=OLD.version+1
     AND (n-ARRAY['state','version','lease_owner','lease_until','updated_at'])=(o-ARRAY['state','version','lease_owner','lease_until','updated_at'])
     AND ((OLD.state IN ('UPLOADING','READY','DELETING') AND NEW.state='DELETING'
       AND (OLD.lease_until IS NULL OR OLD.lease_until<=now()) AND NEW.lease_owner IS NOT NULL AND NEW.lease_until=(now()+interval '120 seconds')::timestamp(3))
      OR (OLD.state='DELETING' AND NEW.state='DELETED' AND OLD.lease_owner IS NOT NULL AND OLD.lease_until>now()
       AND NEW.lease_owner IS NULL AND NEW.lease_until IS NULL)) THEN RETURN NEW; END IF;
   ELSIF closed AND TG_TABLE_NAME='telegram_deliveries' THEN
    IF OLD.state IN ('QUEUED','SENDING') AND (OLD.lease_until IS NULL OR OLD.lease_until<=now())
     AND NEW.state=(CASE WHEN OLD.state='QUEUED' THEN 'CANCELLED' ELSE 'UNKNOWN' END)
     AND NEW.last_error_code=(CASE WHEN OLD.state='QUEUED' THEN 'WORKSPACE_CLOSED' ELSE 'STALE_SENDING' END)
     AND NEW.lease_token IS NULL AND NEW.lease_until IS NULL
     AND (n-ARRAY['state','last_error_code','lease_token','lease_until','updated_at'])=(o-ARRAY['state','last_error_code','lease_token','lease_until','updated_at']) THEN RETURN NEW; END IF;
   ELSIF closed AND TG_TABLE_NAME='telegram_messages' THEN
    IF (n-'delivery_status')=(o-'delivery_status')
     AND NEW.delivery_status IN ('CANCELLED','UNKNOWN')
     AND OLD.delivery_status IN ('QUEUED','SENDING')
     AND EXISTS(SELECT 1 FROM crm_access.telegram_deliveries d WHERE d.message_id=OLD.id AND d.workspace_id=OLD.workspace_id
       AND d.state=NEW.delivery_status AND ((d.state='CANCELLED' AND d.last_error_code='WORKSPACE_CLOSED') OR (d.state='UNKNOWN' AND d.last_error_code='STALE_SENDING')))
     THEN RETURN NEW; END IF;
   END IF;
  END IF;
 END IF;
 PERFORM crm_access.assert_workspace_open(CASE WHEN TG_OP='DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END);
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION crm_access.guard_workspace_retention() FROM PUBLIC;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['telegram_connect_sessions','telegram_deliveries','telegram_messages','crm_chat_attachments'] LOOP
  EXECUTE format('DROP TRIGGER workspace_closure_business_guard ON crm_access.%I',t);
  EXECUTE format('CREATE TRIGGER workspace_closure_business_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_access.%I FOR EACH ROW EXECUTE FUNCTION crm_access.guard_workspace_retention()',t);
 END LOOP;
END $$;

CREATE FUNCTION crm_access.guard_telegram_retention() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,crm_access AS $$
DECLARE n jsonb; o jsonb; owner_call boolean;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.payload_purged_at IS NOT NULL THEN RAISE EXCEPTION 'telegram_retired_insert_refused'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'telegram_receipt_immutable'; END IF;
 n:=to_jsonb(NEW); o:=to_jsonb(OLD);
 IF (NEW.id,NEW.bot_key,NEW.update_id,NEW.payload_hash,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.bot_key,OLD.update_id,OLD.payload_hash,OLD.created_at)
  OR OLD.payload_purged_at IS NOT NULL THEN RAISE EXCEPTION 'telegram_receipt_immutable'; END IF;
 IF (NEW.raw_body,NEW.payload,NEW.payload_purged_at) IS DISTINCT FROM (OLD.raw_body,OLD.payload,OLD.payload_purged_at) THEN
  SELECT current_user=pg_get_userbyid(relowner) INTO owner_call FROM pg_class WHERE oid=TG_RELID;
  IF NOT (owner_call AND OLD.state IN ('DONE','DEAD') AND OLD.lease_token IS NULL AND OLD.lease_until IS NULL
   AND OLD.updated_at<now()-(CASE WHEN OLD.state='DONE' THEN interval '30 days' ELSE interval '90 days' END)
   AND NEW.raw_body='' AND NEW.payload='{}'::jsonb AND NEW.payload_purged_at=now()::timestamp(3)
   AND (n-ARRAY['raw_body','payload','payload_purged_at','updated_at'])=(o-ARRAY['raw_body','payload','payload_purged_at','updated_at']))
   THEN RAISE EXCEPTION 'telegram_payload_retention_refused'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_access.guard_telegram_retention() FROM PUBLIC;
CREATE TRIGGER telegram_retention_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_access.telegram_webhook_inbox FOR EACH ROW EXECUTE FUNCTION crm_access.guard_telegram_retention();

CREATE FUNCTION crm_access.retire_telegram_technical_data() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,crm_access AS $$
DECLARE inbox_count integer; session_count integer; delivery_count integer:=0; row record;
BEGIN
 WITH candidates AS (
  SELECT id FROM crm_access.telegram_webhook_inbox WHERE payload_purged_at IS NULL AND lease_token IS NULL AND lease_until IS NULL
   AND ((state='DONE' AND updated_at<now()-interval '30 days') OR (state='DEAD' AND updated_at<now()-interval '90 days'))
   ORDER BY updated_at,id FOR UPDATE SKIP LOCKED LIMIT 100
 ) UPDATE crm_access.telegram_webhook_inbox i SET raw_body='',payload='{}'::jsonb,payload_purged_at=now(),updated_at=now() FROM candidates c WHERE i.id=c.id;
 GET DIAGNOSTICS inbox_count=ROW_COUNT;
 WITH candidates AS (
  SELECT id FROM crm_access.telegram_connect_sessions WHERE payload_purged_at IS NULL AND expires_at<now()-interval '30 days'
   AND state IN ('WAITING_TELEGRAM','OWNER_VERIFIED','CONNECTION_READY','EXPIRED','CANCELLED')
   ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT 100
 ) UPDATE crm_access.telegram_connect_sessions s SET state=CASE WHEN s.state='CANCELLED' THEN 'CANCELLED' ELSE 'EXPIRED' END,
   telegram_user_id=NULL,owner_name=NULL,owner_username=NULL,connection_id=NULL,payload_purged_at=now(),version=version+1,updated_at=now()
   FROM candidates c WHERE s.id=c.id;
 GET DIAGNOSTICS session_count=ROW_COUNT;
 FOR row IN SELECT d.command_id,d.message_id FROM crm_access.telegram_deliveries d
  JOIN crm_access.crm_workspace_closures c ON c.workspace_id=d.workspace_id AND c.state='CLOSED' AND c.closed_at<now()-interval '30 days'
  WHERE d.state IN ('QUEUED','SENDING') AND (d.lease_until IS NULL OR d.lease_until<=now())
  ORDER BY d.created_at,d.command_id FOR UPDATE OF d SKIP LOCKED LIMIT 100 LOOP
  UPDATE crm_access.telegram_deliveries SET state=CASE WHEN state='QUEUED' THEN 'CANCELLED' ELSE 'UNKNOWN' END,
   last_error_code=CASE WHEN state='QUEUED' THEN 'WORKSPACE_CLOSED' ELSE 'STALE_SENDING' END,lease_token=NULL,lease_until=NULL,updated_at=now()
   WHERE command_id=row.command_id;
  UPDATE crm_access.telegram_messages m SET delivery_status=d.state FROM crm_access.telegram_deliveries d
   WHERE d.command_id=row.command_id AND m.id=d.message_id AND m.workspace_id=d.workspace_id AND m.delivery_status IN ('QUEUED','SENDING');
  delivery_count:=delivery_count+1;
 END LOOP;
 RETURN jsonb_build_object('inboxPurged',inbox_count,'sessionsPurged',session_count,'deliveriesSettled',delivery_count);
END $$;
REVOKE ALL ON FUNCTION crm_access.retire_telegram_technical_data() FROM PUBLIC;

CREATE FUNCTION crm_access.claim_closed_chat_attachments() RETURNS SETOF crm_access.crm_chat_attachments
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,crm_access AS $$
BEGIN
 RETURN QUERY WITH candidates AS (
  SELECT a.id FROM crm_access.crm_chat_attachments a
  JOIN crm_access.crm_workspace_closures c ON c.workspace_id=a.workspace_id AND c.state='CLOSED' AND c.closed_at<now()-interval '30 days'
  WHERE a.state IN ('UPLOADING','READY','DELETING') AND a.message_id IS NULL AND a.expires_at<now() AND (a.lease_until IS NULL OR a.lease_until<=now())
  ORDER BY a.expires_at,a.id FOR UPDATE OF a SKIP LOCKED LIMIT 100
 ) UPDATE crm_access.crm_chat_attachments a SET state='DELETING',version=version+1,lease_owner=gen_random_uuid(),lease_until=now()+interval '120 seconds',updated_at=now()
   FROM candidates c WHERE a.id=c.id RETURNING a.*;
END $$;
REVOKE ALL ON FUNCTION crm_access.claim_closed_chat_attachments() FROM PUBLIC;

CREATE FUNCTION crm_access.complete_closed_chat_attachment(p_id uuid,p_lease_owner uuid,p_version integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,crm_access AS $$
DECLARE changed integer;
BEGIN
 UPDATE crm_access.crm_chat_attachments a SET state='DELETED',version=version+1,lease_owner=NULL,lease_until=NULL,updated_at=now()
 WHERE a.id=p_id AND a.version=p_version AND a.lease_owner=p_lease_owner AND a.lease_until>now() AND a.state='DELETING' AND a.message_id IS NULL
  AND a.expires_at<now() AND EXISTS(SELECT 1 FROM crm_access.crm_workspace_closures c WHERE c.workspace_id=a.workspace_id AND c.state='CLOSED' AND c.closed_at<now()-interval '30 days');
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN changed=1;
END $$;
REVOKE ALL ON FUNCTION crm_access.complete_closed_chat_attachment(uuid,uuid,integer) FROM PUBLIC;
COMMIT;
