CREATE UNIQUE INDEX crm_chat_messages_id_conversation_id_workspace_id_key ON crm_access.crm_chat_messages(id,conversation_id,workspace_id);
CREATE TABLE crm_access.crm_chat_attachments (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, conversation_id uuid NOT NULL,
 upload_actor_membership_id uuid NOT NULL, upload_command_id uuid NOT NULL UNIQUE,
 message_id uuid, subject varchar(256) NOT NULL, request_hash char(64) NOT NULL,
 file_name varchar(200) NOT NULL CHECK(length(file_name)>0), declared_mime varchar(150) NOT NULL, detected_mime varchar(150) NOT NULL,
 byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 5242880), sha256 char(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 private_object_key varchar(200) NOT NULL UNIQUE CHECK(private_object_key='chat/'||workspace_id::text||'/'||conversation_id::text||'/'||id::text), state varchar(16) NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), lease_owner uuid, lease_until timestamp(3),
 expires_at timestamp(3) NOT NULL, created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamp(3) NOT NULL,
 CONSTRAINT crm_chat_attachment_state CHECK(state IN ('UPLOADING','READY','ATTACHED','DELETING','DELETED') AND ((state='ATTACHED')=(message_id IS NOT NULL))),
 FOREIGN KEY(conversation_id,workspace_id) REFERENCES crm_access.crm_chat_conversations(id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(message_id,conversation_id,workspace_id) REFERENCES crm_access.crm_chat_messages(id,conversation_id,workspace_id) ON DELETE RESTRICT
);
CREATE INDEX crm_chat_attachments_workspace_id_state_expires_at_idx ON crm_access.crm_chat_attachments(workspace_id,state,expires_at);
CREATE FUNCTION crm_access.guard_chat_attachment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Chat attachment history is immutable'; END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.id,NEW.workspace_id,NEW.conversation_id,NEW.upload_actor_membership_id,NEW.upload_command_id,NEW.subject,NEW.request_hash,NEW.file_name,NEW.declared_mime,NEW.detected_mime,NEW.byte_size,NEW.sha256,NEW.private_object_key,NEW.expires_at,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.conversation_id,OLD.upload_actor_membership_id,OLD.upload_command_id,OLD.subject,OLD.request_hash,OLD.file_name,OLD.declared_mime,OLD.detected_mime,OLD.byte_size,OLD.sha256,OLD.private_object_key,OLD.expires_at,OLD.created_at)
  OR NEW.version<>OLD.version+1 OR (OLD.message_id IS NOT NULL AND NEW.message_id IS DISTINCT FROM OLD.message_id)
  OR NOT ((OLD.state='UPLOADING' AND NEW.state IN ('UPLOADING','READY','DELETING')) OR (OLD.state='READY' AND NEW.state IN ('ATTACHED','DELETING')) OR (OLD.state='DELETING' AND NEW.state IN ('DELETING','DELETED'))) THEN
   RAISE EXCEPTION 'Invalid chat attachment transition';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER chat_attachment_guard BEFORE UPDATE OR DELETE ON crm_access.crm_chat_attachments FOR EACH ROW EXECUTE FUNCTION crm_access.guard_chat_attachment();
CREATE TRIGGER workspace_closure_business_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_access.crm_chat_attachments FOR EACH ROW EXECUTE FUNCTION crm_access.guard_workspace_business();
