CREATE TABLE identity.marketing_email_preferences (
  user_id TEXT PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  bound_auth_identity_id TEXT,
  bound_email_hash CHAR(64),
  bound_verified_at TIMESTAMP(3),
  consent_text_version VARCHAR(64) NOT NULL,
  consented_at TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL,
  CONSTRAINT marketing_email_binding_required CHECK (NOT enabled OR
    (bound_auth_identity_id IS NOT NULL AND bound_email_hash IS NOT NULL AND
     bound_verified_at IS NOT NULL AND consented_at IS NOT NULL))
);
CREATE TABLE identity.marketing_unsubscribe_tokens (
  token_hash CHAR(64) PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  auth_identity_id TEXT NOT NULL,
  email_hash CHAR(64) NOT NULL,
  verified_at TIMESTAMP(3) NOT NULL,
  event_id UUID NOT NULL,
  delivery_id UUID NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  consumed_at TIMESTAMP(3)
);
CREATE INDEX marketing_unsubscribe_tokens_user_id_idx ON identity.marketing_unsubscribe_tokens(user_id);
