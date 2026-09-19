-- Applied after the immutable aeroCRM baseline. The runtime readiness check
-- requires this owner-DB identity, and rerunning the seed must not rotate it.
INSERT INTO "operations"."service_identity" (
    "id", "service_name", "database_id", "updated_at"
) VALUES (
    'singleton', 'operations-service', gen_random_uuid(), CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;

DO $operations_identity$
BEGIN
    IF (SELECT count(*) FROM "operations"."service_identity") <> 1
       OR NOT EXISTS (
           SELECT 1 FROM "operations"."service_identity"
           WHERE "id" = 'singleton'
             AND "service_name" = 'operations-service'
             AND "database_id" IS NOT NULL
       ) THEN
        RAISE EXCEPTION 'Operations service identity is invalid';
    END IF;
END
$operations_identity$;
