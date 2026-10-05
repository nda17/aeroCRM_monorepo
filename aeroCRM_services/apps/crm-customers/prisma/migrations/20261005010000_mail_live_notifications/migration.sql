-- Transactional invalidations contain only workspace IDs. Notifications remain
-- durable and are still created exclusively by live INBOX import, never backfill.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE TRIGGER mail_notifications_live_change
AFTER INSERT ON crm_customers.mail_notifications
FOR EACH ROW EXECUTE FUNCTION crm_customers.notify_live_change('workspace_id');
CREATE TRIGGER mail_notification_reads_live_change
AFTER INSERT OR UPDATE ON crm_customers.mail_notification_reads
FOR EACH ROW EXECUTE FUNCTION crm_customers.notify_live_change('workspace_id');
CREATE TRIGGER mail_mailbox_grants_live_change
AFTER INSERT OR UPDATE ON crm_customers.mail_mailbox_grants
FOR EACH ROW EXECUTE FUNCTION crm_customers.notify_live_change('workspace_id');
CREATE TRIGGER mail_contact_links_live_change
AFTER INSERT OR UPDATE ON crm_customers.mail_contact_links
FOR EACH ROW EXECUTE FUNCTION crm_customers.notify_live_change('workspace_id');
CREATE TRIGGER mail_messages_live_change
AFTER INSERT ON crm_customers.mail_messages
FOR EACH ROW EXECUTE FUNCTION crm_customers.notify_live_change('workspace_id');
CREATE TRIGGER mail_send_intents_live_change
AFTER INSERT OR UPDATE ON crm_customers.mail_send_intents
FOR EACH ROW EXECUTE FUNCTION crm_customers.notify_live_change('workspace_id');
CREATE TRIGGER mail_mailboxes_live_change
AFTER INSERT OR UPDATE OF enabled, disconnected_at ON crm_customers.mail_mailboxes
FOR EACH ROW EXECUTE FUNCTION crm_customers.notify_live_change('workspace_id');

COMMIT;
