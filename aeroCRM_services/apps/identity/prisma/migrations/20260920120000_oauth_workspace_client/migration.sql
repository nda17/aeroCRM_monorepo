ALTER TABLE "identity"."oauth_authorizations"
  ADD COLUMN "client_kind" VARCHAR(16) NOT NULL DEFAULT 'main',
  ADD COLUMN "return_path" VARCHAR(2048);

ALTER TABLE "identity"."oauth_authorizations"
  ADD CONSTRAINT "oauth_authorizations_client_kind_check"
  CHECK ("client_kind" IN ('main', 'workspace'));
