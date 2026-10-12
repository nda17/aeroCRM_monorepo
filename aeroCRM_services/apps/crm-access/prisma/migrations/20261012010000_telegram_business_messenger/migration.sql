BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
-- Keep pre-existing workspace messages in the same sequence as the trigger
-- installed below. Concurrent inserts resume only after commit.
LOCK TABLE crm_access.crm_chat_messages IN SHARE ROW EXCLUSIVE MODE;

-- CreateTable
CREATE TABLE "crm_access"."workspace_messenger_streams" (
    "workspace_id" UUID NOT NULL,
    "last_sequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "workspace_messenger_streams_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "crm_access"."workspace_messenger_entries" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "internal_message_id" UUID,
    "telegram_message_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_messenger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_access"."workspace_messenger_read_cursors" (
    "workspace_id" UUID NOT NULL,
    "subject" VARCHAR(256) NOT NULL,
    "membership_id" UUID NOT NULL,
    "through_sequence" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_messenger_read_cursors_pkey" PRIMARY KEY ("workspace_id","subject","membership_id")
);

-- CreateTable
CREATE TABLE "crm_access"."telegram_connect_sessions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "actor_membership_id" UUID NOT NULL,
    "channel_id" UUID,
    "command_id" UUID NOT NULL,
    "nonce_hash" CHAR(64) NOT NULL,
    "telegram_user_id" VARCHAR(32),
    "owner_name" VARCHAR(302),
    "owner_username" VARCHAR(100),
    "connection_id" VARCHAR(256),
    "state" VARCHAR(24) NOT NULL DEFAULT 'WAITING_TELEGRAM',
    "version" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_connect_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_access"."telegram_connections" (
    "connection_id" VARCHAR(256) NOT NULL,
    "telegram_user_id" VARCHAR(32) NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "can_reply" BOOLEAN NOT NULL,
    "last_update_id" BIGINT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_connections_pkey" PRIMARY KEY ("connection_id")
);

-- CreateTable
CREATE TABLE "crm_access"."telegram_channels" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "owner_user_id" VARCHAR(32) NOT NULL,
    "owner_name" VARCHAR(302) NOT NULL,
    "owner_username" VARCHAR(100),
    "connection_id" VARCHAR(256) NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(16) NOT NULL,
    "can_reply" BOOLEAN NOT NULL,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnected_at" TIMESTAMP(3),
    "last_inbound_at" TIMESTAMP(3),
    "last_outbound_at" TIMESTAMP(3),
    "last_error_code" VARCHAR(80),

    CONSTRAINT "telegram_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_access"."telegram_dialogs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "provider_chat_id" VARCHAR(32) NOT NULL,
    "peer_name" VARCHAR(302) NOT NULL,
    "last_inbound_at" TIMESTAMP(3),

    CONSTRAINT "telegram_dialogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_access"."telegram_messages" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "dialog_id" UUID NOT NULL,
    "provider_chat_id" VARCHAR(32) NOT NULL,
    "provider_message_id" VARCHAR(32),
    "direction" VARCHAR(8) NOT NULL,
    "origin" VARCHAR(16) NOT NULL,
    "content_kind" VARCHAR(16) NOT NULL,
    "media_available" BOOLEAN NOT NULL DEFAULT false,
    "author_user_id" VARCHAR(32),
    "author_name" VARCHAR(302) NOT NULL,
    "actor_subject" VARCHAR(256),
    "actor_membership_id" UUID,
    "text" VARCHAR(10000) NOT NULL,
    "provider_at" TIMESTAMP(3),
    "edited_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "delivery_status" VARCHAR(16),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_access"."telegram_webhook_inbox" (
    "id" UUID NOT NULL,
    "bot_key" VARCHAR(64) NOT NULL,
    "update_id" BIGINT NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "raw_body" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "state" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_token" UUID,
    "lease_until" TIMESTAMP(3),
    "last_error_code" VARCHAR(80),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_webhook_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_access"."telegram_deliveries" (
    "command_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "actor_membership_id" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "source_message_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "channel_generation" INTEGER NOT NULL,
    "dialog_id" UUID NOT NULL,
    "connection_id" VARCHAR(256) NOT NULL,
    "provider_chat_id" VARCHAR(32) NOT NULL,
    "state" VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_token" UUID,
    "lease_until" TIMESTAMP(3),
    "dispatch_admitted_at" TIMESTAMP(3),
    "last_error_code" VARCHAR(80),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_deliveries_pkey" PRIMARY KEY ("command_id")
);

-- CreateIndex
CREATE INDEX "workspace_messenger_entries_workspace_id_sequence_idx" ON "crm_access"."workspace_messenger_entries"("workspace_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_messenger_entries_workspace_id_sequence_key" ON "crm_access"."workspace_messenger_entries"("workspace_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_messenger_entries_workspace_id_internal_message_i_key" ON "crm_access"."workspace_messenger_entries"("workspace_id", "internal_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_messenger_entries_workspace_id_telegram_message_i_key" ON "crm_access"."workspace_messenger_entries"("workspace_id", "telegram_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_connect_sessions_command_id_key" ON "crm_access"."telegram_connect_sessions"("command_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_connect_sessions_nonce_hash_key" ON "crm_access"."telegram_connect_sessions"("nonce_hash");

-- CreateIndex
CREATE INDEX "telegram_connect_sessions_workspace_id_state_expires_at_idx" ON "crm_access"."telegram_connect_sessions"("workspace_id", "state", "expires_at");

-- CreateIndex
CREATE INDEX "telegram_connect_sessions_telegram_user_id_state_idx" ON "crm_access"."telegram_connect_sessions"("telegram_user_id", "state");

-- CreateIndex
CREATE INDEX "telegram_connections_telegram_user_id_idx" ON "crm_access"."telegram_connections"("telegram_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_channels_connection_id_key" ON "crm_access"."telegram_channels"("connection_id");

-- CreateIndex
CREATE INDEX "telegram_channels_workspace_id_status_idx" ON "crm_access"."telegram_channels"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_channels_workspace_id_id_key" ON "crm_access"."telegram_channels"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_channels_owner_user_id_key" ON "crm_access"."telegram_channels"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_dialogs_id_workspace_id_key" ON "crm_access"."telegram_dialogs"("id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_dialogs_channel_id_provider_chat_id_key" ON "crm_access"."telegram_dialogs"("channel_id", "provider_chat_id");

-- CreateIndex
CREATE INDEX "telegram_messages_workspace_id_created_at_idx" ON "crm_access"."telegram_messages"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_messages_id_workspace_id_key" ON "crm_access"."telegram_messages"("id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_messages_channel_id_provider_chat_id_provider_mess_key" ON "crm_access"."telegram_messages"("channel_id", "provider_chat_id", "provider_message_id");

-- CreateIndex
CREATE INDEX "telegram_webhook_inbox_state_next_run_at_idx" ON "crm_access"."telegram_webhook_inbox"("state", "next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_webhook_inbox_bot_key_update_id_key" ON "crm_access"."telegram_webhook_inbox"("bot_key", "update_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_deliveries_message_id_key" ON "crm_access"."telegram_deliveries"("message_id");

-- CreateIndex
CREATE INDEX "telegram_deliveries_state_next_run_at_idx" ON "crm_access"."telegram_deliveries"("state", "next_run_at");

-- CreateIndex
CREATE INDEX "telegram_deliveries_workspace_id_actor_subject_actor_member_idx" ON "crm_access"."telegram_deliveries"("workspace_id", "actor_subject", "actor_membership_id");

-- AddForeignKey
ALTER TABLE "crm_access"."workspace_messenger_streams" ADD CONSTRAINT "workspace_messenger_streams_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "crm_access"."crm_workspace_access"("workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_access"."workspace_messenger_entries" ADD CONSTRAINT "workspace_messenger_entries_internal_message_id_workspace__fkey" FOREIGN KEY ("internal_message_id", "workspace_id") REFERENCES "crm_access"."crm_chat_messages"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "crm_access"."workspace_messenger_entries" ADD CONSTRAINT "workspace_messenger_entries_telegram_message_id_workspace__fkey" FOREIGN KEY ("telegram_message_id", "workspace_id") REFERENCES "crm_access"."telegram_messages"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "crm_access"."telegram_channels" ADD CONSTRAINT "telegram_channels_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "crm_access"."crm_workspace_access"("workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_access"."telegram_dialogs" ADD CONSTRAINT "telegram_dialogs_channel_id_workspace_id_fkey" FOREIGN KEY ("channel_id", "workspace_id") REFERENCES "crm_access"."telegram_channels"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_access"."telegram_messages" ADD CONSTRAINT "telegram_messages_channel_id_workspace_id_fkey" FOREIGN KEY ("channel_id", "workspace_id") REFERENCES "crm_access"."telegram_channels"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_access"."telegram_messages" ADD CONSTRAINT "telegram_messages_dialog_id_workspace_id_fkey" FOREIGN KEY ("dialog_id", "workspace_id") REFERENCES "crm_access"."telegram_dialogs"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE crm_access.workspace_messenger_streams
  ADD CONSTRAINT workspace_messenger_stream_sequence_check CHECK (last_sequence >= 0);
ALTER TABLE crm_access.workspace_messenger_entries
  ADD CONSTRAINT workspace_messenger_entry_check CHECK (
    sequence > 0 AND ((kind='INTERNAL' AND internal_message_id IS NOT NULL AND telegram_message_id IS NULL)
      OR (kind IN ('TELEGRAM_INBOUND','TELEGRAM_OUTBOUND') AND telegram_message_id IS NOT NULL AND internal_message_id IS NULL))
  );
ALTER TABLE crm_access.workspace_messenger_read_cursors
  ADD CONSTRAINT workspace_messenger_read_sequence_check CHECK (through_sequence >= 0);
ALTER TABLE crm_access.telegram_connect_sessions
  ADD CONSTRAINT telegram_connect_session_state_check CHECK (state IN ('WAITING_TELEGRAM','OWNER_VERIFIED','CONNECTION_READY','CONNECTED','EXPIRED','CANCELLED') AND version > 0);
ALTER TABLE crm_access.telegram_channels
  ADD CONSTRAINT telegram_channel_state_check CHECK (status IN ('ACTIVE','DISCONNECTED','REVOKED','DEGRADED') AND generation > 0 AND version > 0);
ALTER TABLE crm_access.telegram_messages
  ADD CONSTRAINT telegram_message_state_check CHECK (
    direction IN ('INBOUND','OUTBOUND') AND origin IN ('CUSTOMER','BUSINESS_ACCOUNT','CRM')
    AND content_kind IN ('TEXT','PHOTO','VIDEO','DOCUMENT','VOICE','OTHER')
    AND (delivery_status IS NULL OR delivery_status IN ('QUEUED','SENDING','SENT','FAILED','UNKNOWN','CANCELLED'))
    AND length(text) BETWEEN 1 AND 10000
  );
ALTER TABLE crm_access.telegram_webhook_inbox
  ADD CONSTRAINT telegram_webhook_inbox_state_check CHECK (state IN ('PENDING','PROCESSING','DONE','DEAD') AND attempts >= 0 AND length(raw_body) <= 262144);
ALTER TABLE crm_access.telegram_deliveries
  ADD CONSTRAINT telegram_delivery_state_check CHECK (state IN ('QUEUED','SENDING','SENT','FAILED','UNKNOWN','CANCELLED') AND attempts >= 0 AND channel_generation > 0);
ALTER TABLE crm_access.telegram_deliveries
  ADD CONSTRAINT telegram_delivery_source_fk FOREIGN KEY (source_message_id,workspace_id) REFERENCES crm_access.telegram_messages(id,workspace_id) ON DELETE RESTRICT;
ALTER TABLE crm_access.telegram_deliveries
  ADD CONSTRAINT telegram_delivery_message_fk FOREIGN KEY (message_id,workspace_id) REFERENCES crm_access.telegram_messages(id,workspace_id) ON DELETE RESTRICT;
ALTER TABLE crm_access.telegram_connect_sessions
  ADD CONSTRAINT telegram_session_channel_fk FOREIGN KEY (channel_id,workspace_id) REFERENCES crm_access.telegram_channels(id,workspace_id) ON DELETE RESTRICT;

INSERT INTO crm_access.workspace_messenger_streams(workspace_id,last_sequence)
SELECT workspace_id,0 FROM crm_access.crm_workspace_access
ON CONFLICT(workspace_id) DO NOTHING;
INSERT INTO crm_access.workspace_messenger_entries(id,workspace_id,sequence,kind,internal_message_id,created_at)
SELECT gen_random_uuid(),m.workspace_id,
       row_number() OVER (PARTITION BY m.workspace_id ORDER BY m.created_at,m.conversation_id,m.sequence,m.id),
       'INTERNAL',m.id,m.created_at
FROM crm_access.crm_chat_messages m
JOIN crm_access.crm_chat_conversations c ON c.id=m.conversation_id AND c.workspace_id=m.workspace_id
WHERE c.kind='WORKSPACE';
UPDATE crm_access.workspace_messenger_streams s SET last_sequence=e.max_sequence
FROM (SELECT workspace_id,max(sequence) AS max_sequence FROM crm_access.workspace_messenger_entries GROUP BY workspace_id) e
WHERE e.workspace_id=s.workspace_id;
-- Carry the existing common-chat read position into the unified feed. The old
-- message sequence and the new workspace feed sequence have different scopes.
INSERT INTO crm_access.workspace_messenger_read_cursors
  (workspace_id,subject,membership_id,through_sequence,updated_at)
SELECT p.workspace_id,p.subject,p.membership_id,
       COALESCE(max(e.sequence),0),COALESCE(p.read_at,now())
FROM crm_access.crm_chat_participants p
JOIN crm_access.crm_chat_conversations c
  ON c.id=p.conversation_id AND c.workspace_id=p.workspace_id AND c.kind='WORKSPACE'
LEFT JOIN crm_access.crm_chat_messages m
  ON m.conversation_id=c.id AND m.workspace_id=c.workspace_id
  AND m.sequence<=p.read_through_sequence
LEFT JOIN crm_access.workspace_messenger_entries e
  ON e.internal_message_id=m.id AND e.workspace_id=m.workspace_id
GROUP BY p.workspace_id,p.subject,p.membership_id,p.read_at
ON CONFLICT (workspace_id,subject,membership_id) DO NOTHING;

CREATE FUNCTION crm_access.project_workspace_messenger_internal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,crm_access AS $$
DECLARE next_sequence integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM crm_access.crm_chat_conversations c
                 WHERE c.id=NEW.conversation_id AND c.workspace_id=NEW.workspace_id AND c.kind='WORKSPACE') THEN
    RETURN NEW;
  END IF;
  INSERT INTO crm_access.workspace_messenger_streams(workspace_id,last_sequence)
  VALUES(NEW.workspace_id,1)
  ON CONFLICT(workspace_id) DO UPDATE SET last_sequence=crm_access.workspace_messenger_streams.last_sequence+1
  RETURNING last_sequence INTO next_sequence;
  INSERT INTO crm_access.workspace_messenger_entries(id,workspace_id,sequence,kind,internal_message_id,created_at)
  VALUES(gen_random_uuid(),NEW.workspace_id,next_sequence,'INTERNAL',NEW.id,NEW.created_at);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_access.project_workspace_messenger_internal() FROM PUBLIC;
CREATE TRIGGER workspace_messenger_internal_projection AFTER INSERT ON crm_access.crm_chat_messages
  FOR EACH ROW EXECUTE FUNCTION crm_access.project_workspace_messenger_internal();

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['workspace_messenger_streams','workspace_messenger_entries','workspace_messenger_read_cursors','telegram_connect_sessions','telegram_channels','telegram_dialogs','telegram_messages','telegram_deliveries'] LOOP
  EXECUTE format('CREATE TRIGGER workspace_closure_business_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_access.%I FOR EACH ROW EXECUTE FUNCTION crm_access.guard_workspace_business()',t);
 END LOOP;
END $$;
CREATE TRIGGER workspace_messenger_entry_immutable BEFORE UPDATE OR DELETE ON crm_access.workspace_messenger_entries
  FOR EACH ROW EXECUTE FUNCTION crm_access.reject_team_history_mutation();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['workspace_messenger_entries','telegram_channels','telegram_messages'] LOOP
  EXECUTE format('CREATE TRIGGER workspace_collaboration_signal AFTER INSERT OR UPDATE OR DELETE ON crm_access.%I FOR EACH ROW EXECUTE FUNCTION crm_access.signal_workspace_collaboration()',t);
 END LOOP;
END $$;
COMMIT;
