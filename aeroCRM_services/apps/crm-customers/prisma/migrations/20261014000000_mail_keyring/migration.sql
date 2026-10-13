-- Additive key identifiers preserve immutable legacy command receipts (NULL = legacy HMAC).
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE crm_customers.mail_commands ADD COLUMN request_hash_key_id varchar(80);
ALTER TABLE crm_customers.mail_send_intents ADD COLUMN request_hash_key_id varchar(80);
ALTER TABLE crm_customers.mail_commands ADD CONSTRAINT mail_command_hash_key_check CHECK (request_hash_key_id IS NULL OR request_hash_key_id ~ '^[a-zA-Z0-9_-]{1,80}$');
ALTER TABLE crm_customers.mail_send_intents ADD CONSTRAINT mail_send_hash_key_check CHECK (request_hash_key_id IS NULL OR request_hash_key_id ~ '^[a-zA-Z0-9_-]{1,80}$');
CREATE INDEX mail_connections_rewrap_idx ON crm_customers.mail_connections(key_id,id) WHERE state='ACTIVE' AND encrypted_secret IS NOT NULL;

CREATE OR REPLACE FUNCTION crm_customers.mail_write_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,crm_customers AS $$
DECLARE n jsonb; o jsonb; allowed text[];
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'mail_delete_refused'; END IF;
 n:=to_jsonb(NEW);
 IF TG_OP='INSERT' THEN
  IF TG_TABLE_NAME='mail_send_intents' THEN
   IF NEW.state <> 'QUEUED' OR NEW.dispatch_admitted_at IS NOT NULL OR NEW.mime_hash IS NOT NULL OR NEW.mime_object_key IS NOT NULL OR NEW.envelope IS NOT NULL THEN RAISE EXCEPTION 'mail_invalid_initial_intent'; END IF;
   IF NOT EXISTS (SELECT 1 FROM crm_customers.mail_mailboxes m JOIN crm_customers.mail_connections c ON (c.id,c.workspace_id)=(m.connection_id,m.workspace_id) WHERE m.workspace_id=NEW.workspace_id AND m.id=NEW.mailbox_id AND m.enabled AND m.generation=NEW.mailbox_generation AND c.state='ACTIVE') THEN RAISE EXCEPTION 'mail_generation_mismatch'; END IF;
   IF NEW.scope_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crm_customers.mail_messages m WHERE m.workspace_id=NEW.workspace_id AND m.id=NEW.scope_message_id AND m.mailbox_id=NEW.mailbox_id) THEN RAISE EXCEPTION 'mail_reply_scope_mismatch'; END IF;
   IF NEW.contact_id IS NOT NULL AND NEW.scope_message_id IS NOT NULL THEN RAISE EXCEPTION 'mail_reply_scope_mismatch'; END IF;
   IF NEW.reply_to_message_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM crm_customers.mail_messages m WHERE m.workspace_id=NEW.workspace_id AND m.id=NEW.reply_to_message_id AND m.mailbox_id=NEW.mailbox_id AND (
     (NEW.contact_id IS NOT NULL AND EXISTS(SELECT 1 FROM crm_customers.mail_contact_links l WHERE l.workspace_id=m.workspace_id AND l.message_id=m.id AND l.contact_id=NEW.contact_id AND l.state='LINKED')) OR
     (NEW.contact_id IS NULL AND NEW.scope_message_id=m.id AND NOT EXISTS(SELECT 1 FROM crm_customers.mail_contact_links l WHERE l.workspace_id=m.workspace_id AND l.message_id=m.id AND l.state='LINKED'))))
     AND NOT EXISTS (SELECT 1 FROM crm_customers.mail_send_intents prior_send WHERE prior_send.workspace_id=NEW.workspace_id AND prior_send.id=NEW.reply_to_message_id AND prior_send.mailbox_id=NEW.mailbox_id AND prior_send.contact_id IS NOT DISTINCT FROM NEW.contact_id AND prior_send.scope_message_id IS NOT DISTINCT FROM NEW.scope_message_id AND (NEW.contact_id IS NOT NULL OR NEW.scope_message_id IS NULL OR NOT EXISTS(SELECT 1 FROM crm_customers.mail_contact_links l WHERE l.workspace_id=NEW.workspace_id AND l.message_id=NEW.scope_message_id AND l.state='LINKED'))) THEN RAISE EXCEPTION 'mail_reply_source_mismatch'; END IF;
   ELSIF NEW.scope_message_id IS NOT NULL THEN RAISE EXCEPTION 'mail_reply_scope_mismatch';
   END IF;
  ELSIF TG_TABLE_NAME='mail_notifications' THEN
   IF NOT EXISTS(SELECT 1 FROM crm_customers.mail_messages m JOIN crm_customers.mail_folders f ON (f.workspace_id,f.id)=(m.workspace_id,m.folder_id) WHERE m.workspace_id=NEW.workspace_id AND m.id=NEW.message_id AND m.direction='INBOUND' AND f.kind='INBOX') THEN RAISE EXCEPTION 'mail_notification_source_mismatch'; END IF;
  ELSIF TG_TABLE_NAME='mail_mailbox_grants' THEN
   IF NOT EXISTS(SELECT 1 FROM crm_customers.mail_mailboxes m WHERE m.workspace_id=NEW.workspace_id AND m.id=NEW.mailbox_id AND m.kind='SHARED') THEN RAISE EXCEPTION 'mail_personal_grants_refused'; END IF;
  ELSIF TG_TABLE_NAME='mail_messages' THEN
   IF NOT EXISTS(SELECT 1 FROM crm_customers.mail_folders f WHERE f.workspace_id=NEW.workspace_id AND f.id=NEW.folder_id AND f.mailbox_id=NEW.mailbox_id AND f.generation=NEW.folder_generation AND f.selected AND f.uid_validity=NEW.uid_validity) THEN RAISE EXCEPTION 'mail_folder_source_mismatch'; END IF;
  ELSIF TG_TABLE_NAME='mail_contact_links' THEN
   IF NOT EXISTS(SELECT 1 FROM crm_customers.mail_messages m WHERE m.workspace_id=NEW.workspace_id AND m.id=NEW.message_id AND m.mailbox_id=NEW.mailbox_id) THEN RAISE EXCEPTION 'mail_link_source_mismatch'; END IF;
  ELSIF TG_TABLE_NAME='mail_attachments' THEN
   IF NEW.message_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM crm_customers.mail_messages m WHERE m.workspace_id=NEW.workspace_id AND m.id=NEW.message_id AND m.mailbox_id=NEW.mailbox_id) THEN RAISE EXCEPTION 'mail_attachment_source_mismatch'; END IF;
   END IF;
  ELSIF TG_TABLE_NAME='mail_send_attachments' THEN
   IF EXISTS(SELECT 1 FROM crm_customers.mail_send_intents i WHERE i.workspace_id=NEW.workspace_id AND i.id=NEW.send_id AND i.contact_id IS NULL) THEN
    PERFORM 1 FROM crm_customers.mail_attachments a WHERE a.workspace_id=NEW.workspace_id AND a.id=NEW.attachment_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM crm_customers.mail_send_attachments a WHERE a.workspace_id=NEW.workspace_id AND a.attachment_id=NEW.attachment_id AND a.send_id<>NEW.send_id) THEN RAISE EXCEPTION 'mail_send_attachment_scope_reuse'; END IF;
   END IF;
   IF NOT EXISTS(SELECT 1 FROM crm_customers.mail_send_intents i JOIN crm_customers.mail_attachments a ON (a.workspace_id,a.mailbox_id)=(i.workspace_id,i.mailbox_id) WHERE i.workspace_id=NEW.workspace_id AND i.id=NEW.send_id AND a.id=NEW.attachment_id AND NEW.attachment_id=ANY(i.attachment_ids) AND a.state='VALIDATED' AND ((a.message_id IS NULL AND a.contact_id IS NOT DISTINCT FROM i.contact_id AND (i.contact_id IS NOT NULL OR (a.upload_actor=i.actor_subject AND a.upload_membership_id=i.membership_id))) OR (a.message_id IS NOT NULL AND i.contact_id IS NOT NULL AND EXISTS(SELECT 1 FROM crm_customers.mail_contact_links l WHERE l.workspace_id=i.workspace_id AND l.message_id=a.message_id AND l.contact_id=i.contact_id AND l.state='LINKED')))) THEN RAISE EXCEPTION 'mail_send_attachment_mismatch'; END IF;
  END IF;
  PERFORM crm_customers.assert_workspace_open(NEW.workspace_id); RETURN NEW;
 END IF;
 o:=to_jsonb(OLD);
 -- Only the owner executing the narrow rewrap routine may update ciphertext across a fence.
 -- Runtime cannot forge current_user with a custom GUC or mutate other connection fields.
 IF TG_TABLE_NAME='mail_connections' THEN
  IF current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID))
   AND OLD.state='ACTIVE' AND OLD.encrypted_secret IS NOT NULL
   AND NEW.key_id<>OLD.key_id AND NEW.key_id ~ '^[a-zA-Z0-9_-]{1,80}$'
   AND NEW.encrypted_secret IS NOT NULL AND octet_length(NEW.encrypted_secret)<=16384
   AND split_part(NEW.encrypted_secret,'.',1)=NEW.key_id
   AND NEW.version=OLD.version+1
   AND (n-ARRAY['encrypted_secret','key_id','version','updated_at'])=(o-ARRAY['encrypted_secret','key_id','version','updated_at'])
  THEN RETURN NEW; END IF;
 END IF;
 IF (n->'workspace_id',n->'id') IS DISTINCT FROM (o->'workspace_id',o->'id') THEN RAISE EXCEPTION 'mail_binding_immutable'; END IF;
 IF TG_TABLE_NAME IN ('mail_commands','mail_audit','mail_messages','mail_send_attachments','mail_notifications') THEN RAISE EXCEPTION 'mail_append_only'; END IF;
 IF TG_TABLE_NAME='mail_send_intents' THEN
  allowed:=ARRAY['state','dispatch_admitted_at','accepted','rejected','safe_error_code','version','settled_at','mime_object_key','mime_hash','envelope'];
  IF (n-allowed) IS DISTINCT FROM (o-allowed) OR NEW.version<=OLD.version THEN RAISE EXCEPTION 'mail_send_payload_immutable'; END IF;
  IF OLD.mime_hash IS NOT NULL THEN
   IF (NEW.mime_hash,NEW.mime_object_key,NEW.envelope) IS DISTINCT FROM (OLD.mime_hash,OLD.mime_object_key,OLD.envelope) THEN RAISE EXCEPTION 'mail_mime_immutable'; END IF;
  END IF;
  IF OLD.dispatch_admitted_at IS NOT NULL THEN
   IF NEW.dispatch_admitted_at IS DISTINCT FROM OLD.dispatch_admitted_at THEN RAISE EXCEPTION 'mail_admission_immutable'; END IF;
  END IF;
  IF OLD.state='QUEUED' AND NEW.state IN ('QUEUED','SENDING') THEN
   IF NEW.state='QUEUED' AND NEW.dispatch_admitted_at IS NOT NULL THEN RAISE EXCEPTION 'mail_invalid_transport_permit'; END IF;
   IF NEW.state='SENDING' THEN
    IF NEW.dispatch_admitted_at IS NULL OR NEW.mime_hash IS NULL OR NEW.mime_object_key IS NULL OR NEW.envelope IS NULL THEN RAISE EXCEPTION 'mail_missing_transport_permit'; END IF;
    IF NOT EXISTS(SELECT 1 FROM crm_customers.mail_mailboxes m JOIN crm_customers.mail_connections c ON(c.id,c.workspace_id)=(m.connection_id,m.workspace_id) WHERE m.workspace_id=NEW.workspace_id AND m.id=NEW.mailbox_id AND m.enabled AND m.generation=NEW.mailbox_generation AND c.state='ACTIVE') THEN RAISE EXCEPTION 'mail_generation_mismatch'; END IF;
    IF NEW.contact_id IS NULL AND NEW.scope_message_id IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM crm_customers.mail_messages m WHERE m.workspace_id=NEW.workspace_id AND m.id=NEW.scope_message_id AND m.mailbox_id=NEW.mailbox_id) OR EXISTS(SELECT 1 FROM crm_customers.mail_contact_links l WHERE l.workspace_id=NEW.workspace_id AND l.message_id=NEW.scope_message_id AND l.state='LINKED')) THEN RAISE EXCEPTION 'mail_reply_scope_mismatch'; END IF;
    IF EXISTS(SELECT 1 FROM unnest(NEW.attachment_ids) attachment_id LEFT JOIN crm_customers.mail_attachments a ON a.id=attachment_id AND a.workspace_id=NEW.workspace_id AND a.mailbox_id=NEW.mailbox_id WHERE a.id IS NULL OR a.state<>'VALIDATED') THEN RAISE EXCEPTION 'mail_attachment_not_validated'; END IF;
    IF NEW.contact_id IS NULL AND EXISTS(SELECT 1 FROM unnest(NEW.attachment_ids) attachment_id JOIN crm_customers.mail_attachments a ON a.id=attachment_id AND a.workspace_id=NEW.workspace_id WHERE a.message_id IS NOT NULL OR a.contact_id IS NOT NULL OR a.upload_actor IS DISTINCT FROM NEW.actor_subject OR a.upload_membership_id IS DISTINCT FROM NEW.membership_id) THEN RAISE EXCEPTION 'mail_send_attachment_mismatch'; END IF;
   END IF;
   PERFORM crm_customers.assert_workspace_open(NEW.workspace_id); RETURN NEW;
  END IF;
  IF OLD.state='QUEUED' AND NEW.state IN ('CANCELLED','FAILED') AND NEW.dispatch_admitted_at IS NULL AND (n-ARRAY['state','safe_error_code','version','settled_at'])=(o-ARRAY['state','safe_error_code','version','settled_at']) THEN RETURN NEW; END IF;
  IF OLD.state='SENDING' AND NEW.state IN ('ACCEPTED','PARTIAL_ACCEPTED','FAILED','UNKNOWN') AND NEW.dispatch_admitted_at=OLD.dispatch_admitted_at AND (n-ARRAY['state','accepted','rejected','safe_error_code','version','settled_at'])=(o-ARRAY['state','accepted','rejected','safe_error_code','version','settled_at']) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'mail_invalid_send_transition';
 ELSIF TG_TABLE_NAME='mail_notification_reads' THEN
  IF (n-'read_at') IS DISTINCT FROM (o-'read_at') THEN RAISE EXCEPTION 'mail_notification_reader_immutable'; END IF;
 ELSIF TG_TABLE_NAME='mail_connections' THEN
 allowed:=ARRAY['state','encrypted_secret','version','generation','updated_at'];
  IF (n-allowed) IS DISTINCT FROM (o-allowed) OR NEW.version<=OLD.version OR NEW.generation<OLD.generation THEN RAISE EXCEPTION 'mail_connection_binding_immutable'; END IF;
  IF NEW.state IN ('DISCONNECTED','REAUTH_REQUIRED') AND NEW.encrypted_secret IS NULL THEN RETURN NEW; END IF;
  IF NEW.encrypted_secret IS DISTINCT FROM OLD.encrypted_secret THEN RAISE EXCEPTION 'mail_connection_binding_immutable'; END IF;
 ELSIF TG_TABLE_NAME='mail_mailboxes' THEN
  allowed:=ARRAY['connection_id','imap_login','smtp_login','enabled','disconnected_at','generation','version','safe_error_code','last_sync_at'];
  IF (n-allowed) IS DISTINCT FROM (o-allowed) OR NEW.generation<OLD.generation OR NEW.version<OLD.version THEN RAISE EXCEPTION 'mail_mailbox_binding_immutable'; END IF;
  IF NOT NEW.enabled AND NEW.disconnected_at IS NOT NULL AND (n-ARRAY['enabled','disconnected_at','version','generation','safe_error_code'])=(o-ARRAY['enabled','disconnected_at','version','generation','safe_error_code']) THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='mail_mailbox_grants' THEN
  IF (n-ARRAY['can_read','can_send','can_manage','revoked_at']) IS DISTINCT FROM (o-ARRAY['can_read','can_send','can_manage','revoked_at']) THEN RAISE EXCEPTION 'mail_grant_binding_immutable'; END IF;
  IF NEW.revoked_at IS NOT NULL AND (n-'revoked_at')=(o-'revoked_at') THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='mail_folders' THEN
  IF (n-ARRAY['kind','selected','uid_validity','live_last_uid','backfill_last_uid','backfill_upper_uid','import_started_at','cutoff','completed_at','generation']) IS DISTINCT FROM (o-ARRAY['kind','selected','uid_validity','live_last_uid','backfill_last_uid','backfill_upper_uid','import_started_at','cutoff','completed_at','generation']) OR NEW.generation<OLD.generation THEN RAISE EXCEPTION 'mail_folder_binding_immutable'; END IF;
 ELSIF TG_TABLE_NAME='mail_contact_links' THEN
  IF (n-ARRAY['contact_id','state','method','actor_subject','version']) IS DISTINCT FROM (o-ARRAY['contact_id','state','method','actor_subject','version']) OR NEW.version<=OLD.version THEN RAISE EXCEPTION 'mail_link_binding_immutable'; END IF;
 ELSIF TG_TABLE_NAME='mail_jobs' THEN
  allowed:=ARRAY['state','due_at','lease_owner','lease_until','lease_version','attempts','safe_error_code'];
  IF (n-allowed) IS DISTINCT FROM (o-allowed) OR NEW.lease_version<OLD.lease_version THEN RAISE EXCEPTION 'mail_job_binding_immutable'; END IF;
  IF NEW.state IN ('DONE','FAILED','CANCELLED') AND (n-ARRAY['state','lease_owner','lease_until','safe_error_code','lease_version','attempts'])=(o-ARRAY['state','lease_owner','lease_until','safe_error_code','lease_version','attempts']) THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='mail_attachments' THEN
  IF (n-ARRAY['detected_mime','byte_size','sha256','private_object_key','state']) IS DISTINCT FROM (o-ARRAY['detected_mime','byte_size','sha256','private_object_key','state']) THEN RAISE EXCEPTION 'mail_attachment_binding_immutable'; END IF;
  IF NEW.state='UNAVAILABLE' AND (n-'state')=(o-'state') AND OLD.upload_actor IS NOT NULL AND OLD.expires_at<clock_timestamp() AND NOT EXISTS(SELECT 1 FROM crm_customers.mail_send_attachments a WHERE a.workspace_id=OLD.workspace_id AND a.attachment_id=OLD.id) THEN RETURN NEW; END IF;
  IF OLD.state='VALIDATED' AND n IS DISTINCT FROM o THEN
   IF NEW.state='UNAVAILABLE' AND (n-'state')=(o-'state') AND OLD.expires_at<clock_timestamp() AND NOT EXISTS(SELECT 1 FROM crm_customers.mail_send_attachments a WHERE a.workspace_id=OLD.workspace_id AND a.attachment_id=OLD.id) THEN RETURN NEW; END IF;
   RAISE EXCEPTION 'mail_validated_attachment_immutable';
  END IF;
 END IF;
 PERFORM crm_customers.assert_workspace_open(NEW.workspace_id); RETURN NEW;
END; $$;

CREATE FUNCTION crm_customers.rewrap_mail_credential(p_id uuid,p_version integer,p_old text,p_new text,p_key_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,crm_customers AS $$
BEGIN
 IF p_version IS NULL OR p_version<1 OR p_old IS NULL OR p_new IS NULL
    OR p_key_id IS NULL OR p_key_id !~ '^[a-zA-Z0-9_-]{1,80}$'
    OR octet_length(p_new)>16384 OR p_old=p_new OR split_part(p_new,'.',1)<>p_key_id
    OR p_new !~ '^[a-zA-Z0-9_-]+\.[A-Za-z0-9+/]{16}\.[A-Za-z0-9+/]{22}==\.[A-Za-z0-9+/]+={0,2}$'
 THEN RAISE EXCEPTION 'mail_rewrap_input_invalid'; END IF;
 UPDATE crm_customers.mail_connections
 SET encrypted_secret=p_new,key_id=p_key_id,version=version+1,updated_at=clock_timestamp()
 WHERE id=p_id AND version=p_version AND encrypted_secret=p_old
   AND state='ACTIVE' AND key_id<>p_key_id;
 RETURN FOUND;
END; $$;
REVOKE ALL ON FUNCTION crm_customers.rewrap_mail_credential(uuid,integer,text,text,text) FROM PUBLIC;
COMMIT;
