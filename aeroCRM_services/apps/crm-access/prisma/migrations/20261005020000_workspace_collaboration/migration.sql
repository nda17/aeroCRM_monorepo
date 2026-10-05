BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
-- CreateTable
CREATE TABLE "crm_access"."crm_directory_entries" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "source_key" VARCHAR(300) NOT NULL,
    "subject" VARCHAR(256),
    "invitation_id" UUID,
    "first_name" VARCHAR(100),
    "last_name" VARCHAR(100),
    "middle_name" VARCHAR(100),
    "phone" VARCHAR(64),
    "email" VARCHAR(254),
    "position" VARCHAR(100),
    "department" VARCHAR(100),
    "extension" VARCHAR(20),
    "telegram" VARCHAR(100),
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_directory_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_access"."crm_chat_conversations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "pair_key" VARCHAR(64) NOT NULL,
    "last_sequence" INTEGER NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_chat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_access"."crm_chat_participants" (
    "workspace_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "subject" VARCHAR(256) NOT NULL,
    "membership_id" UUID NOT NULL,
    "read_through_sequence" INTEGER NOT NULL DEFAULT 0,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "crm_chat_participants_pkey" PRIMARY KEY ("conversation_id","subject")
);

-- CreateTable
CREATE TABLE "crm_access"."crm_chat_messages" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "sender_subject" VARCHAR(256) NOT NULL,
    "sender_membership_id" UUID NOT NULL,
    "sender_name" VARCHAR(302) NOT NULL,
    "text" VARCHAR(10000) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_directory_entries_workspace_id_archived_at_last_name_fi_idx" ON "crm_access"."crm_directory_entries"("workspace_id", "archived_at", "last_name", "first_name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_directory_entries_id_workspace_id_key" ON "crm_access"."crm_directory_entries"("id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_directory_entries_workspace_id_source_key_key" ON "crm_access"."crm_directory_entries"("workspace_id", "source_key");

-- CreateIndex
CREATE UNIQUE INDEX "crm_directory_entries_workspace_id_subject_key" ON "crm_access"."crm_directory_entries"("workspace_id", "subject");

-- CreateIndex
CREATE INDEX "crm_chat_conversations_workspace_id_last_message_at_id_idx" ON "crm_access"."crm_chat_conversations"("workspace_id", "last_message_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_chat_conversations_id_workspace_id_key" ON "crm_access"."crm_chat_conversations"("id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_chat_conversations_workspace_id_pair_key_key" ON "crm_access"."crm_chat_conversations"("workspace_id", "pair_key");

-- CreateIndex
CREATE INDEX "crm_chat_participants_workspace_id_subject_membership_id_idx" ON "crm_access"."crm_chat_participants"("workspace_id", "subject", "membership_id");

-- CreateIndex
CREATE INDEX "crm_chat_messages_workspace_id_conversation_id_sequence_idx" ON "crm_access"."crm_chat_messages"("workspace_id", "conversation_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "crm_chat_messages_id_workspace_id_key" ON "crm_access"."crm_chat_messages"("id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_chat_messages_conversation_id_sequence_key" ON "crm_access"."crm_chat_messages"("conversation_id", "sequence");

-- AddForeignKey
ALTER TABLE "crm_access"."crm_directory_entries" ADD CONSTRAINT "crm_directory_entries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "crm_access"."crm_workspace_access"("workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_access"."crm_chat_conversations" ADD CONSTRAINT "crm_chat_conversations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "crm_access"."crm_workspace_access"("workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_access"."crm_chat_participants" ADD CONSTRAINT "crm_chat_participants_conversation_id_workspace_id_fkey" FOREIGN KEY ("conversation_id", "workspace_id") REFERENCES "crm_access"."crm_chat_conversations"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_access"."crm_chat_messages" ADD CONSTRAINT "crm_chat_messages_conversation_id_workspace_id_fkey" FOREIGN KEY ("conversation_id", "workspace_id") REFERENCES "crm_access"."crm_chat_conversations"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE crm_access.crm_chat_conversations ADD CONSTRAINT crm_chat_kind_check CHECK (kind IN ('DIRECT','WORKSPACE'));
ALTER TABLE crm_access.crm_chat_conversations ADD CONSTRAINT crm_chat_sequence_check CHECK (last_sequence >= 0);
ALTER TABLE crm_access.crm_chat_participants ADD CONSTRAINT crm_chat_read_sequence_check CHECK (read_through_sequence >= 0);
ALTER TABLE crm_access.crm_chat_messages ADD CONSTRAINT crm_chat_message_check CHECK (sequence > 0 AND length(btrim(text)) BETWEEN 1 AND 10000);
ALTER TABLE crm_access.crm_directory_entries ADD CONSTRAINT crm_directory_invitation_fk FOREIGN KEY (invitation_id,workspace_id) REFERENCES crm_access.crm_invitation_intents(id,workspace_id) ON DELETE RESTRICT;

-- Additive local backfill. No Identity database is queried or referenced.
INSERT INTO crm_access.crm_directory_entries (id,workspace_id,source_key,subject,first_name,last_name,middle_name,updated_at)
SELECT gen_random_uuid(), a.workspace_id, 'subject:' || a.activated_by_subject, a.activated_by_subject,p.first_name,p.last_name,p.middle_name,now()
FROM crm_access.crm_workspace_access a LEFT JOIN crm_access.crm_employee_profiles p ON p.workspace_id=a.workspace_id AND p.subject=a.activated_by_subject;
INSERT INTO crm_access.crm_directory_entries (id,workspace_id,source_key,subject,first_name,last_name,middle_name,updated_at)
SELECT gen_random_uuid(), m.workspace_id,'subject:' || m.subject,m.subject,p.first_name,p.last_name,p.middle_name,now()
FROM crm_access.crm_workspace_members m JOIN crm_access.crm_workspace_access a ON a.workspace_id=m.workspace_id
LEFT JOIN crm_access.crm_employee_profiles p ON p.workspace_id=m.workspace_id AND p.subject=m.subject
ON CONFLICT (workspace_id,subject) DO NOTHING;
-- Retain the latest invitation per normalized credential email, while contact email remains editable.
INSERT INTO crm_access.crm_directory_entries (id,workspace_id,source_key,invitation_id,first_name,last_name,middle_name,email,updated_at)
SELECT gen_random_uuid(),i.workspace_id,'email:'||i.email,i.id,i.first_name,i.last_name,i.middle_name,i.email,now()
FROM (SELECT DISTINCT ON (workspace_id,email) * FROM crm_access.crm_invitation_intents ORDER BY workspace_id,email,created_at DESC,id DESC) i
JOIN crm_access.crm_workspace_access a ON a.workspace_id=i.workspace_id
WHERE NOT EXISTS (SELECT 1 FROM crm_access.crm_admissions d WHERE d.intent_id=i.id AND d.status='ACTIVE');
UPDATE crm_access.crm_directory_entries e SET invitation_id=i.id,source_key='email:'||i.email,email=i.email
FROM crm_access.crm_admissions d JOIN crm_access.crm_invitation_intents i ON i.id=d.intent_id
WHERE d.status='ACTIVE' AND e.workspace_id=d.workspace_id AND e.subject=d.subject
AND NOT EXISTS (SELECT 1 FROM crm_access.crm_directory_entries other WHERE other.workspace_id=e.workspace_id AND other.source_key='email:'||i.email AND other.id<>e.id);
INSERT INTO crm_access.crm_chat_conversations (id,workspace_id,kind,pair_key)
SELECT gen_random_uuid(),workspace_id,'WORKSPACE','workspace' FROM crm_access.crm_workspace_access;

CREATE FUNCTION crm_access.provision_workspace_collaboration() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,crm_access AS $$
BEGIN
 INSERT INTO crm_access.crm_directory_entries(id,workspace_id,source_key,subject,updated_at)
 VALUES(gen_random_uuid(),NEW.workspace_id,'subject:'||NEW.activated_by_subject,NEW.activated_by_subject,now())
 ON CONFLICT(workspace_id,subject) DO NOTHING;
 INSERT INTO crm_access.crm_chat_conversations(id,workspace_id,kind,pair_key)
 VALUES(gen_random_uuid(),NEW.workspace_id,'WORKSPACE','workspace') ON CONFLICT(workspace_id,pair_key) DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_access.provision_workspace_collaboration() FROM PUBLIC;
CREATE TRIGGER provision_workspace_collaboration AFTER INSERT ON crm_access.crm_workspace_access
 FOR EACH ROW EXECUTE FUNCTION crm_access.provision_workspace_collaboration();

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['crm_directory_entries','crm_chat_conversations','crm_chat_participants','crm_chat_messages'] LOOP
  EXECUTE format('CREATE TRIGGER workspace_closure_business_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_access.%I FOR EACH ROW EXECUTE FUNCTION crm_access.guard_workspace_business()',t);
 END LOOP;
END $$;
CREATE TRIGGER crm_chat_message_immutable BEFORE UPDATE OR DELETE ON crm_access.crm_chat_messages
 FOR EACH ROW EXECUTE FUNCTION crm_access.reject_team_history_mutation();

CREATE FUNCTION crm_access.signal_workspace_collaboration() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,crm_access AS $$
BEGIN
 PERFORM pg_notify('crm_access_live_v1', CASE WHEN TG_OP='DELETE' THEN OLD.workspace_id::text ELSE NEW.workspace_id::text END);
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION crm_access.signal_workspace_collaboration() FROM PUBLIC;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['crm_directory_entries','crm_chat_conversations','crm_chat_participants','crm_chat_messages','crm_workspace_members','crm_invitation_intents','crm_admissions'] LOOP
  EXECUTE format('CREATE TRIGGER workspace_collaboration_signal AFTER INSERT OR UPDATE OR DELETE ON crm_access.%I FOR EACH ROW EXECUTE FUNCTION crm_access.signal_workspace_collaboration()',t);
 END LOOP;
END $$;

CREATE UNIQUE INDEX crm_chat_participants_conversation_id_subject_workspace_id_key ON crm_access.crm_chat_participants(conversation_id,subject,workspace_id);
ALTER TABLE crm_access.crm_chat_messages ADD CONSTRAINT crm_chat_sender_fk FOREIGN KEY(conversation_id,sender_subject,workspace_id) REFERENCES crm_access.crm_chat_participants(conversation_id,subject,workspace_id) ON DELETE RESTRICT;
COMMIT;
