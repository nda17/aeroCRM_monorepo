BEGIN;

CREATE FUNCTION "crm_access"."is_valid_custom_role_permissions"(value TEXT[]) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog
AS $permissions$
  SELECT cardinality(value) BETWEEN 1 AND 7
    AND value <@ ARRAY['customers:read','customers:write','intake:read','intake:write','sales:read','sales:write','sales:analytics']::TEXT[]
    AND cardinality(value) = (SELECT count(DISTINCT permission) FROM unnest(value) AS permission)
    AND ('customers:write' <> ALL(value) OR 'customers:read' = ANY(value))
    AND ('intake:write' <> ALL(value) OR 'intake:read' = ANY(value))
    AND ('sales:write' <> ALL(value) OR 'sales:read' = ANY(value));
$permissions$;
REVOKE ALL ON FUNCTION "crm_access"."is_valid_custom_role_permissions"(TEXT[]) FROM PUBLIC;

CREATE TABLE "crm_access"."crm_custom_roles" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "name_key" VARCHAR(80) NOT NULL,
    "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "data_scope" VARCHAR(8) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_custom_roles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crm_custom_roles_id_workspace_id_key" UNIQUE ("id", "workspace_id"),
    CONSTRAINT "crm_custom_roles_version_check" CHECK (version BETWEEN 1 AND 2147483647),
    CONSTRAINT "crm_custom_roles_name_check" CHECK (
      char_length(name) BETWEEN 1 AND 80
      AND name = normalize(name, NFC)
      AND name ~ U&'^[\0410-\042F\0401][\0410-\044F\0401\04510-9 -]{0,79}$'
    ),
    CONSTRAINT "crm_custom_roles_name_key_check" CHECK (
      char_length(name_key) BETWEEN 1 AND 80 AND name_key = replace(lower(name), ' ', '')
    ),
    CONSTRAINT "crm_custom_roles_scope_check" CHECK (data_scope IN ('OWN', 'TEAM', 'ALL')),
    CONSTRAINT "crm_custom_roles_permissions_check" CHECK ("crm_access"."is_valid_custom_role_permissions"(permissions))
);

CREATE UNIQUE INDEX "crm_custom_roles_active_name_key"
ON "crm_access"."crm_custom_roles"("workspace_id", "name_key")
WHERE "archived_at" IS NULL;

CREATE INDEX "crm_custom_roles_workspace_id_archived_at_name_key_id_idx"
ON "crm_access"."crm_custom_roles"("workspace_id", "archived_at", "name_key", "id");

ALTER TABLE "crm_access"."crm_workspace_members" ADD COLUMN "custom_role_id" UUID;
ALTER TABLE "crm_access"."crm_invitation_intents" ADD COLUMN "custom_role_id" UUID;

ALTER TABLE "crm_access"."crm_workspace_members"
  ADD CONSTRAINT "crm_workspace_members_custom_role_binding_check"
  CHECK ((role = 'CUSTOM' AND custom_role_id IS NOT NULL) OR (role <> 'CUSTOM' AND custom_role_id IS NULL)),
  ADD CONSTRAINT "crm_workspace_members_custom_role_id_workspace_id_fkey"
  FOREIGN KEY ("custom_role_id", "workspace_id") REFERENCES "crm_access"."crm_custom_roles"("id", "workspace_id") ON DELETE RESTRICT;

ALTER TABLE "crm_access"."crm_invitation_intents"
  ADD CONSTRAINT "crm_invitation_intents_custom_role_binding_check"
  CHECK ((role = 'CUSTOM' AND custom_role_id IS NOT NULL) OR (role <> 'CUSTOM' AND custom_role_id IS NULL)),
  ADD CONSTRAINT "crm_invitation_intents_custom_role_id_workspace_id_fkey"
  FOREIGN KEY ("custom_role_id", "workspace_id") REFERENCES "crm_access"."crm_custom_roles"("id", "workspace_id") ON DELETE RESTRICT;

COMMIT;
