-- Incoming mail bell events are append-only; read state belongs to one membership.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE TABLE crm_customers.mail_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
 message_id uuid NOT NULL, created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT mail_notifications_workspace_id_id_key UNIQUE(workspace_id,id),
 CONSTRAINT mail_notifications_workspace_id_message_id_key UNIQUE(workspace_id,message_id),
 CONSTRAINT mail_notifications_message_fkey FOREIGN KEY(workspace_id,message_id)
  REFERENCES crm_customers.mail_messages(workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX mail_notifications_workspace_id_created_at_id_idx ON crm_customers.mail_notifications(workspace_id,created_at,id);
CREATE TABLE crm_customers.mail_notification_reads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
 notification_id uuid NOT NULL, recipient_subject varchar(256) NOT NULL,
 recipient_membership_id uuid NOT NULL, read_at timestamp(3),
 CONSTRAINT mail_notification_reads_recipient_key UNIQUE(notification_id,recipient_subject,recipient_membership_id),
 CONSTRAINT mail_notification_reads_notification_fkey FOREIGN KEY(workspace_id,notification_id)
  REFERENCES crm_customers.mail_notifications(workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT mail_notification_reads_subject_check CHECK(recipient_subject<>'' AND recipient_subject !~ '[[:space:][:cntrl:]]')
);
REVOKE ALL ON crm_customers.mail_notifications,crm_customers.mail_notification_reads FROM PUBLIC;

CREATE OR REPLACE FUNCTION crm_customers.mail_write_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,crm_customers AS $$
DECLARE n jsonb; o jsonb; allowed text[];
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'mail_delete_refused'; END IF;
 n:=to_jsonb(NEW);
 IF TG_OP='INSERT' THEN
  IF TG_TABLE_NAME='mail_send_intents' THEN
   IF NEW.state <> 'QUEUED' OR NEW.dispatch_admitted_at IS NOT NULL OR NEW.mime_hash IS NOT NULL OR NEW.mime_object_key IS NOT NULL OR NEW.envelope IS NOT NULL THEN RAISE EXCEPTION 'mail_invalid_initial_intent'; END IF;
   IF NOT EXISTS (SELECT 1 FROM crm_customers.mail_mailboxes m JOIN crm_customers.mail_connections c ON (c.id,c.workspace_id)=(m.connection_id,m.workspace_id) WHERE m.workspace_id=NEW.workspace_id AND m.id=NEW.mailbox_id AND m.enabled AND m.generation=NEW.mailbox_generation AND c.state='ACTIVE') THEN RAISE EXCEPTION 'mail_generation_mismatch'; END IF;
   IF NEW.reply_to_message_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM crm_customers.mail_messages m JOIN crm_customers.mail_contact_links l ON (l.workspace_id,l.message_id)=(m.workspace_id,m.id) WHERE m.workspace_id=NEW.workspace_id AND m.id=NEW.reply_to_message_id AND m.mailbox_id=NEW.mailbox_id AND l.contact_id=NEW.contact_id AND l.state='LINKED')
     AND NOT EXISTS (SELECT 1 FROM crm_customers.mail_send_intents prior_send WHERE prior_send.workspace_id=NEW.workspace_id AND prior_send.id=NEW.reply_to_message_id AND prior_send.mailbox_id=NEW.mailbox_id AND prior_send.contact_id=NEW.contact_id) THEN RAISE EXCEPTION 'mail_reply_source_mismatch'; END IF;
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
   IF NOT EXISTS(SELECT 1 FROM crm_customers.mail_send_intents i JOIN crm_customers.mail_attachments a ON (a.workspace_id,a.mailbox_id)=(i.workspace_id,i.mailbox_id) WHERE i.workspace_id=NEW.workspace_id AND i.id=NEW.send_id AND a.id=NEW.attachment_id AND NEW.attachment_id=ANY(i.attachment_ids) AND a.state='VALIDATED' AND (a.contact_id IS NULL OR a.contact_id=i.contact_id)) THEN RAISE EXCEPTION 'mail_send_attachment_mismatch'; END IF;
  END IF;
  PERFORM crm_customers.assert_workspace_open(NEW.workspace_id); RETURN NEW;
 END IF;
 o:=to_jsonb(OLD);
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
    IF EXISTS(SELECT 1 FROM unnest(NEW.attachment_ids) attachment_id LEFT JOIN crm_customers.mail_attachments a ON a.id=attachment_id AND a.workspace_id=NEW.workspace_id AND a.mailbox_id=NEW.mailbox_id WHERE a.id IS NULL OR a.state<>'VALIDATED') THEN RAISE EXCEPTION 'mail_attachment_not_validated'; END IF;
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

CREATE TRIGGER mail_notifications_write_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_customers.mail_notifications FOR EACH ROW EXECUTE FUNCTION crm_customers.mail_write_guard();
CREATE TRIGGER mail_notification_reads_write_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_customers.mail_notification_reads FOR EACH ROW EXECUTE FUNCTION crm_customers.mail_write_guard();

COMMIT;
