BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Keep the empty-history proof valid until the new CHECK is committed.
LOCK TABLE crm_access.crm_chat_attachments IN ACCESS EXCLUSIVE MODE;
LOCK TABLE crm_access.crm_team_command_receipts IN SHARE MODE;

-- Deparse the exact applied expression with this PostgreSQL version rather
-- than accepting a CHECK by name or relying on version-specific cast spelling.
CREATE TEMP TABLE messenger_storage_legacy_check (
 private_object_key varchar(200), workspace_id uuid, conversation_id uuid, id uuid,
 CONSTRAINT expected_legacy_key CHECK(private_object_key='chat/'||workspace_id::text||'/'||conversation_id::text||'/'||id::text)
) ON COMMIT DROP;

DO $$
DECLARE
 key_column smallint;
 key_check record;
 expected_definition text;
BEGIN
 IF EXISTS (SELECT 1 FROM crm_access.crm_chat_attachments) THEN
  RAISE EXCEPTION 'Messenger prefix migration requires empty attachment history, including DELETED rows';
 END IF;
 IF EXISTS (SELECT 1 FROM crm_access.crm_team_command_receipts WHERE command_type='chat.upload') THEN
  RAISE EXCEPTION 'Messenger prefix migration requires no chat.upload receipts';
 END IF;

 SELECT attnum INTO STRICT key_column FROM pg_attribute
 WHERE attrelid='crm_access.crm_chat_attachments'::regclass
  AND attname='private_object_key' AND NOT attisdropped;
 IF (SELECT count(*) FROM pg_constraint
     WHERE conrelid='crm_access.crm_chat_attachments'::regclass
      AND contype='c' AND key_column=ANY(conkey)) <> 1 THEN
  RAISE EXCEPTION 'Unexpected attachment object key CHECK inventory';
 END IF;
 SELECT conname, convalidated, connoinherit, pg_get_constraintdef(oid) AS definition
 INTO STRICT key_check FROM pg_constraint
 WHERE conrelid='crm_access.crm_chat_attachments'::regclass
  AND contype='c' AND key_column=ANY(conkey);
 SELECT pg_get_constraintdef(oid) INTO STRICT expected_definition
 FROM pg_constraint WHERE conrelid='pg_temp.messenger_storage_legacy_check'::regclass
  AND conname='expected_legacy_key';
 IF NOT key_check.convalidated OR key_check.connoinherit
    OR key_check.definition IS DISTINCT FROM expected_definition THEN
  RAISE EXCEPTION 'Attachment object key CHECK differs from the exact applied legacy contract';
 END IF;

 EXECUTE format('ALTER TABLE crm_access.crm_chat_attachments DROP CONSTRAINT %I', key_check.conname);
 EXECUTE format('ALTER TABLE crm_access.crm_chat_attachments ADD CONSTRAINT %I CHECK(private_object_key=''messenger/''||workspace_id::text||''/''||conversation_id::text||''/''||id::text)', key_check.conname);
END $$;
COMMIT;
