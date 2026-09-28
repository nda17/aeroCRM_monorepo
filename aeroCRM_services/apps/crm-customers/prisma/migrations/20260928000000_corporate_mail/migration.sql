-- INT04 additive service-owned mail schema. Historical baselines stay unchanged.
-- CreateTable
CREATE TABLE "crm_customers"."mail_connections" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "delegated_subject" VARCHAR(256) NOT NULL,
    "delegated_membership_id" UUID NOT NULL,
    "provider" VARCHAR(16) NOT NULL,
    "transport" JSONB NOT NULL,
    "auth_mode" VARCHAR(16) NOT NULL,
    "credential_principal" VARCHAR(254) NOT NULL,
    "encrypted_secret" TEXT,
    "key_id" VARCHAR(80) NOT NULL,
    "state" VARCHAR(24) NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_connections_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "crm_customers"."mail_mailboxes" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "owner_subject" VARCHAR(256),
    "owner_membership_id" UUID,
    "canonical_address" VARCHAR(254) NOT NULL,
    "display_name" VARCHAR(200) NOT NULL,
    "imap_login" VARCHAR(254) NOT NULL,
    "smtp_login" VARCHAR(254) NOT NULL,
    "send_mode" VARCHAR(16) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "disconnected_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "safe_error_code" VARCHAR(80),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_mailboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_customers"."mail_mailbox_grants" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "mailbox_id" UUID NOT NULL,
    "subject" VARCHAR(256) NOT NULL,
    "membership_id" UUID NOT NULL,
    "can_read" BOOLEAN NOT NULL,
    "can_send" BOOLEAN NOT NULL,
    "can_manage" BOOLEAN NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "mail_mailbox_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_customers"."mail_folders" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "mailbox_id" UUID NOT NULL,
    "exact_path" VARCHAR(500) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "uid_validity" BIGINT,
    "live_last_uid" BIGINT NOT NULL DEFAULT 0,
    "backfill_last_uid" BIGINT NOT NULL DEFAULT 0,
    "backfill_upper_uid" BIGINT,
    "import_started_at" TIMESTAMP(3),
    "cutoff" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "generation" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "mail_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_customers"."mail_messages" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "mailbox_id" UUID NOT NULL,
    "folder_id" UUID NOT NULL,
    "folder_generation" INTEGER NOT NULL,
    "uid_validity" BIGINT NOT NULL,
    "uid" BIGINT NOT NULL,
    "direction" VARCHAR(16) NOT NULL,
    "message_id" VARCHAR(998),
    "in_reply_to" VARCHAR(998),
    "references" TEXT[],
    "from" JSONB NOT NULL,
    "to" JSONB NOT NULL,
    "cc" JSONB NOT NULL,
    "bcc" JSONB NOT NULL,
    "subject" VARCHAR(300) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3) NOT NULL,
    "plain_text" TEXT,
    "body_status" VARCHAR(24) NOT NULL,
    "source_hash" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_customers"."mail_contact_links" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "mailbox_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "external_email" VARCHAR(254) NOT NULL,
    "contact_id" UUID,
    "state" VARCHAR(16) NOT NULL,
    "method" VARCHAR(16) NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "mail_contact_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_customers"."mail_attachments" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "mailbox_id" UUID NOT NULL,
    "message_id" UUID,
    "contact_id" UUID,
    "upload_actor" VARCHAR(256),
    "upload_membership_id" UUID,
    "source_part" VARCHAR(32),
    "safe_file_name" VARCHAR(200) NOT NULL,
    "declared_mime" VARCHAR(200) NOT NULL,
    "detected_mime" VARCHAR(200),
    "byte_size" INTEGER NOT NULL,
    "sha256" VARCHAR(64),
    "private_object_key" VARCHAR(500),
    "state" VARCHAR(24) NOT NULL,
    "validation_version" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_customers"."mail_send_intents" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "mailbox_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "membership_id" UUID NOT NULL,
    "command_id" UUID NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "mailbox_generation" INTEGER NOT NULL,
    "to" JSONB NOT NULL,
    "cc" JSONB NOT NULL,
    "bcc" JSONB NOT NULL,
    "subject" VARCHAR(300) NOT NULL,
    "text" TEXT NOT NULL,
    "reply_to_message_id" UUID,
    "attachment_ids" UUID[],
    "message_id" VARCHAR(998) NOT NULL,
    "mime_object_key" VARCHAR(500),
    "mime_hash" VARCHAR(64),
    "envelope" JSONB,
    "state" VARCHAR(24) NOT NULL,
    "dispatch_admitted_at" TIMESTAMP(3),
    "accepted" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rejected" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "safe_error_code" VARCHAR(80),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "mail_send_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_customers"."mail_send_attachments" (
    "workspace_id" UUID NOT NULL,
    "send_id" UUID NOT NULL,
    "attachment_id" UUID NOT NULL,

    CONSTRAINT "mail_send_attachments_pkey" PRIMARY KEY ("workspace_id","send_id","attachment_id")
);

-- CreateTable
CREATE TABLE "crm_customers"."mail_jobs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "mailbox_id" UUID NOT NULL,
    "generation" INTEGER NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "target_id" UUID,
    "work_key" VARCHAR(200) NOT NULL,
    "state" VARCHAR(16) NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_owner" UUID,
    "lease_until" TIMESTAMP(3),
    "lease_version" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "safe_error_code" VARCHAR(80),

    CONSTRAINT "mail_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_customers"."mail_commands" (
    "command_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_commands_pkey" PRIMARY KEY ("command_id")
);

-- CreateTable
CREATE TABLE "crm_customers"."mail_audit" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "mailbox_id" UUID,
    "actor_subject" VARCHAR(256) NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "entity_id" UUID NOT NULL,
    "command_id" UUID,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "mail_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mail_connections_workspace_id_id_key" ON "crm_customers"."mail_connections"("workspace_id", "id");


-- CreateIndex
CREATE UNIQUE INDEX "mail_mailboxes_workspace_id_id_key" ON "crm_customers"."mail_mailboxes"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "mail_mailboxes_workspace_id_canonical_address_key" ON "crm_customers"."mail_mailboxes"("workspace_id", "canonical_address");

-- CreateIndex
CREATE UNIQUE INDEX "mail_mailbox_grants_workspace_id_mailbox_id_subject_members_key" ON "crm_customers"."mail_mailbox_grants"("workspace_id", "mailbox_id", "subject", "membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "mail_folders_workspace_id_id_key" ON "crm_customers"."mail_folders"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "mail_folders_workspace_id_mailbox_id_exact_path_key" ON "crm_customers"."mail_folders"("workspace_id", "mailbox_id", "exact_path");

-- CreateIndex
CREATE INDEX "mail_messages_workspace_id_mailbox_id_created_at_id_idx" ON "crm_customers"."mail_messages"("workspace_id", "mailbox_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "mail_messages_workspace_id_id_key" ON "crm_customers"."mail_messages"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "mail_messages_source_uid_key" ON "crm_customers"."mail_messages"("workspace_id", "folder_id", "folder_generation", "uid_validity", "uid");

-- CreateIndex
CREATE INDEX "mail_contact_links_workspace_id_contact_id_message_id_idx" ON "crm_customers"."mail_contact_links"("workspace_id", "contact_id", "message_id");

-- CreateIndex
CREATE UNIQUE INDEX "mail_contact_links_workspace_id_message_id_external_email_key" ON "crm_customers"."mail_contact_links"("workspace_id", "message_id", "external_email");

-- CreateIndex
CREATE UNIQUE INDEX "mail_attachments_workspace_id_id_key" ON "crm_customers"."mail_attachments"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "mail_send_intents_workspace_id_state_created_at_idx" ON "crm_customers"."mail_send_intents"("workspace_id", "state", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "mail_send_intents_workspace_id_id_key" ON "crm_customers"."mail_send_intents"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "mail_send_intents_command_id_key" ON "crm_customers"."mail_send_intents"("command_id");

-- CreateIndex
CREATE UNIQUE INDEX "mail_send_intents_message_id_key" ON "crm_customers"."mail_send_intents"("message_id");

-- CreateIndex
CREATE INDEX "mail_jobs_state_due_at_idx" ON "crm_customers"."mail_jobs"("state", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "mail_jobs_work_key_key" ON "crm_customers"."mail_jobs"("work_key");
ALTER TABLE crm_customers.mail_mailboxes ADD CONSTRAINT mail_mailboxes_connection_id_fk FOREIGN KEY (workspace_id,connection_id) REFERENCES crm_customers.mail_connections(workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE crm_customers.mail_mailbox_grants ADD CONSTRAINT mail_mailbox_grants_mailbox_id_fk FOREIGN KEY (workspace_id,mailbox_id) REFERENCES crm_customers.mail_mailboxes(workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE crm_customers.mail_folders ADD CONSTRAINT mail_folders_mailbox_id_fk FOREIGN KEY (workspace_id,mailbox_id) REFERENCES crm_customers.mail_mailboxes(workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE crm_customers.mail_messages ADD CONSTRAINT mail_messages_mailbox_id_fk FOREIGN KEY (workspace_id,mailbox_id) REFERENCES crm_customers.mail_mailboxes(workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE crm_customers.mail_messages ADD CONSTRAINT mail_messages_folder_id_fk FOREIGN KEY (workspace_id,folder_id) REFERENCES crm_customers.mail_folders(workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE crm_customers.mail_contact_links ADD CONSTRAINT mail_contact_links_mailbox_id_fk FOREIGN KEY (workspace_id,mailbox_id) REFERENCES crm_customers.mail_mailboxes(workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE crm_customers.mail_contact_links ADD CONSTRAINT mail_contact_links_message_id_fk FOREIGN KEY (workspace_id,message_id) REFERENCES crm_customers.mail_messages(workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE crm_customers.mail_contact_links ADD CONSTRAINT mail_contact_links_contact_id_fk FOREIGN KEY (workspace_id,contact_id) REFERENCES crm_customers.contacts(workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE crm_customers.mail_attachments ADD CONSTRAINT mail_attachments_mailbox_id_fk FOREIGN KEY (workspace_id,mailbox_id) REFERENCES crm_customers.mail_mailboxes(workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE crm_customers.mail_attachments ADD CONSTRAINT mail_attachments_message_id_fk FOREIGN KEY (workspace_id,message_id) REFERENCES crm_customers.mail_messages(workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE crm_customers.mail_attachments ADD CONSTRAINT mail_attachments_contact_id_fk FOREIGN KEY (workspace_id,contact_id) REFERENCES crm_customers.contacts(workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE crm_customers.mail_send_intents ADD CONSTRAINT mail_send_intents_mailbox_id_fk FOREIGN KEY (workspace_id,mailbox_id) REFERENCES crm_customers.mail_mailboxes(workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE crm_customers.mail_send_intents ADD CONSTRAINT mail_send_intents_contact_id_fk FOREIGN KEY (workspace_id,contact_id) REFERENCES crm_customers.contacts(workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE crm_customers.mail_send_attachments ADD CONSTRAINT mail_send_attachments_send_id_fk FOREIGN KEY (workspace_id,send_id) REFERENCES crm_customers.mail_send_intents(workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE crm_customers.mail_send_attachments ADD CONSTRAINT mail_send_attachments_attachment_id_fk FOREIGN KEY (workspace_id,attachment_id) REFERENCES crm_customers.mail_attachments(workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE crm_customers.mail_jobs ADD CONSTRAINT mail_jobs_mailbox_id_fk FOREIGN KEY (workspace_id,mailbox_id) REFERENCES crm_customers.mail_mailboxes(workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE crm_customers.mail_audit ADD CONSTRAINT mail_audit_mailbox_id_fk FOREIGN KEY (workspace_id,mailbox_id) REFERENCES crm_customers.mail_mailboxes(workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE crm_customers.mail_connections ADD CHECK (version > 0);
ALTER TABLE crm_customers.mail_mailboxes ADD CHECK (version > 0);
ALTER TABLE crm_customers.mail_contact_links ADD CHECK (version > 0);
ALTER TABLE crm_customers.mail_send_intents ADD CHECK (version > 0);
ALTER TABLE crm_customers.mail_connections ADD CHECK (generation > 0);
ALTER TABLE crm_customers.mail_mailboxes ADD CHECK (generation > 0);
ALTER TABLE crm_customers.mail_folders ADD CHECK (generation > 0);
ALTER TABLE crm_customers.mail_jobs ADD CHECK (generation > 0);

ALTER TABLE crm_customers.mail_connections ADD CHECK (provider = 'IMAP_SMTP' AND auth_mode = 'PASSWORD' AND state IN ('PENDING','ACTIVE','REAUTH_REQUIRED','DISCONNECTED'));
ALTER TABLE crm_customers.mail_mailboxes ADD CHECK (kind IN ('SHARED','PERSONAL') AND send_mode IN ('AS','ON_BEHALF') AND ((kind='PERSONAL' AND owner_subject IS NOT NULL AND owner_membership_id IS NOT NULL) OR (kind='SHARED' AND owner_subject IS NULL AND owner_membership_id IS NULL)));
ALTER TABLE crm_customers.mail_mailbox_grants ADD CHECK ((NOT can_send OR can_read) AND (NOT can_manage OR can_read));
ALTER TABLE crm_customers.mail_folders ADD CHECK (kind IN ('INBOX','SENT'));
CREATE UNIQUE INDEX mail_selected_folder_kind ON crm_customers.mail_folders(workspace_id,mailbox_id,kind) WHERE selected;
ALTER TABLE crm_customers.mail_contact_links ADD CHECK (state IN ('UNMATCHED','AMBIGUOUS','LINKED') AND method IN ('EXACT','MANUAL') AND ((state='LINKED')=(contact_id IS NOT NULL)));
ALTER TABLE crm_customers.mail_attachments ADD CHECK (byte_size >= 0 AND state IN ('DEFERRED','UPLOADING','QUARANTINED','VALIDATED','REJECTED','UNAVAILABLE') AND (state <> 'VALIDATED' OR byte_size <= 5242880));
ALTER TABLE crm_customers.mail_send_intents ADD CHECK (state IN ('QUEUED','SENDING','ACCEPTED','PARTIAL_ACCEPTED','FAILED','UNKNOWN','CANCELLED') AND ((state IN ('SENDING','ACCEPTED','PARTIAL_ACCEPTED','UNKNOWN')) <= (dispatch_admitted_at IS NOT NULL)));
ALTER TABLE crm_customers.mail_send_intents ADD CHECK (octet_length(text) <= 24576 AND cardinality(attachment_ids) <= 10);
ALTER TABLE crm_customers.mail_jobs ADD CHECK (state IN ('QUEUED','RUNNING','DONE','FAILED','CANCELLED') AND attempts >= 0 AND lease_version >= 0);

CREATE FUNCTION crm_customers.mail_write_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,crm_customers AS $$
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
     AND NOT EXISTS (SELECT 1 FROM crm_customers.mail_send_intents old WHERE old.workspace_id=NEW.workspace_id AND old.id=NEW.reply_to_message_id AND old.mailbox_id=NEW.mailbox_id AND old.contact_id=NEW.contact_id) THEN RAISE EXCEPTION 'mail_reply_source_mismatch'; END IF;
   END IF;
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
 IF TG_TABLE_NAME IN ('mail_commands','mail_audit','mail_messages','mail_send_attachments') THEN RAISE EXCEPTION 'mail_append_only'; END IF;
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
REVOKE ALL ON FUNCTION crm_customers.mail_write_guard() FROM PUBLIC;
CREATE TRIGGER mail_write_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_customers.mail_mailboxes FOR EACH ROW EXECUTE FUNCTION crm_customers.mail_write_guard();
CREATE TRIGGER mail_write_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_customers.mail_contact_links FOR EACH ROW EXECUTE FUNCTION crm_customers.mail_write_guard();
CREATE TRIGGER mail_write_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_customers.mail_attachments FOR EACH ROW EXECUTE FUNCTION crm_customers.mail_write_guard();
CREATE TRIGGER mail_write_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_customers.mail_commands FOR EACH ROW EXECUTE FUNCTION crm_customers.mail_write_guard();
CREATE TRIGGER mail_write_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_customers.mail_jobs FOR EACH ROW EXECUTE FUNCTION crm_customers.mail_write_guard();
CREATE TRIGGER mail_write_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_customers.mail_audit FOR EACH ROW EXECUTE FUNCTION crm_customers.mail_write_guard();
CREATE TRIGGER mail_write_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_customers.mail_send_attachments FOR EACH ROW EXECUTE FUNCTION crm_customers.mail_write_guard();
CREATE TRIGGER mail_write_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_customers.mail_messages FOR EACH ROW EXECUTE FUNCTION crm_customers.mail_write_guard();
CREATE TRIGGER mail_write_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_customers.mail_mailbox_grants FOR EACH ROW EXECUTE FUNCTION crm_customers.mail_write_guard();
CREATE TRIGGER mail_write_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_customers.mail_send_intents FOR EACH ROW EXECUTE FUNCTION crm_customers.mail_write_guard();
CREATE TRIGGER mail_write_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_customers.mail_folders FOR EACH ROW EXECUTE FUNCTION crm_customers.mail_write_guard();

-- Service grants are reconciled by reviewed CI/CD database-access inventory.
-- No PUBLIC table/function grants; append-only ledgers receive SELECT/INSERT only.

CREATE TRIGGER mail_write_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_customers.mail_connections FOR EACH ROW EXECUTE FUNCTION crm_customers.mail_write_guard();

ALTER TABLE crm_customers.mail_messages ADD CHECK (folder_generation>0 AND uid>0 AND uid_validity>0 AND octet_length(plain_text)<=262144 AND direction IN ('INBOUND','OUTBOUND') AND body_status IN ('COMPLETE','TOO_LARGE','UNAVAILABLE'));
ALTER TABLE crm_customers.mail_attachments ADD CHECK (state<>'VALIDATED' OR (private_object_key IS NOT NULL AND sha256 ~ '^[a-f0-9]{64}$' AND detected_mime IS NOT NULL));

CREATE UNIQUE INDEX mail_attachment_private_object_key ON crm_customers.mail_attachments(private_object_key) WHERE private_object_key IS NOT NULL;
CREATE UNIQUE INDEX mail_intent_mime_object_key ON crm_customers.mail_send_intents(mime_object_key) WHERE mime_object_key IS NOT NULL;

ALTER TABLE crm_customers.mail_messages ALTER COLUMN "references" SET NOT NULL;
ALTER TABLE crm_customers.mail_send_intents ALTER COLUMN attachment_ids SET NOT NULL;
ALTER TABLE crm_customers.mail_send_intents ALTER COLUMN accepted SET NOT NULL;
ALTER TABLE crm_customers.mail_send_intents ALTER COLUMN rejected SET NOT NULL;
ALTER TABLE crm_customers.mail_messages ADD CHECK (cardinality("references") <= 30 AND jsonb_typeof("from")='array' AND jsonb_typeof("to")='array' AND jsonb_typeof(cc)='array' AND jsonb_typeof(bcc)='array');
ALTER TABLE crm_customers.mail_send_intents ADD CHECK (jsonb_typeof("to")='array' AND jsonb_typeof(cc)='array' AND jsonb_typeof(bcc)='array' AND jsonb_array_length("to")>=1 AND jsonb_array_length("to")+jsonb_array_length(cc)+jsonb_array_length(bcc)<=20);
ALTER TABLE crm_customers.mail_send_intents ADD CHECK ((state <> 'ACCEPTED' OR (cardinality(accepted)>0 AND cardinality(rejected)=0)) AND (state <> 'PARTIAL_ACCEPTED' OR (cardinality(accepted)>0 AND cardinality(rejected)>0)));
ALTER TABLE crm_customers.mail_jobs ADD CHECK (kind IN ('LIVE_SYNC','BACKFILL','FETCH_ATTACHMENT','VALIDATE_ATTACHMENT','SEND','RECONCILE') AND target_id IS NOT NULL);
