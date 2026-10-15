import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const requirePg = createRequire(
  new URL("../apps/crm-access/package.json", import.meta.url),
);
const { Client } = requirePg("pg");

const services = ["identity", "campaigns", "billing"];
const testSuffix = process.env.RISK_CONTROLS_TEST_SUFFIX ?? "";
assert.match(testSuffix, /^(?:_[a-z0-9_]+)?$/);
const connections = {};
for (const service of services) {
  connections[service] = {
    runtime: localTestUrl(
      `RISK_CONTROLS_${service.toUpperCase()}_RUNTIME_URL`,
      service,
    ),
    migration: localTestUrl(
      `RISK_CONTROLS_${service.toUpperCase()}_MIGRATION_URL`,
      service,
    ),
  };
}

for (const service of services) {
  assert.equal(
    await query(connections[service].runtime, "SELECT current_database()"),
    expectedDatabase(service),
  );
}

await expectValue(
  connections.identity.runtime,
  `
DO $$ BEGIN
  IF NOT has_table_privilege(current_user, 'identity.marketing_email_preferences', 'SELECT,INSERT,UPDATE')
    OR NOT has_table_privilege(current_user, 'identity.marketing_unsubscribe_tokens', 'SELECT,INSERT,UPDATE') THEN
    RAISE EXCEPTION 'identity runtime role is missing consent table privileges';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'identity.marketing_email_preferences'::regclass AND conname = 'marketing_email_binding_required') THEN
    RAISE EXCEPTION 'marketing email binding constraint is missing';
  END IF;
END $$;
SELECT 'ok';`,
  "ok",
);

await expectValue(
  connections.campaigns.runtime,
  `
DO $$ BEGIN
  PERFORM 'SKIPPED'::campaigns."CampaignDeliveryStatus";
  IF NOT has_table_privilege(current_user, 'campaigns.campaigns', 'SELECT,UPDATE')
    OR NOT has_table_privilege(current_user, 'campaigns.deliveries', 'SELECT,UPDATE') THEN
    RAISE EXCEPTION 'campaigns runtime role is missing campaign write privileges';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'campaigns.campaigns'::regclass AND conname = 'campaigns_skipped_count_nonnegative') THEN
    RAISE EXCEPTION 'campaign skipped counter constraint is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='campaigns' AND table_name='deliveries' AND column_name='recipient_user_id') THEN
    RAISE EXCEPTION 'campaign recipient binding column is missing';
  END IF;
END $$;
SELECT 'ok';`,
  "ok",
);

await expectValue(
  connections.billing.runtime,
  `
DO $$ BEGIN
  IF NOT has_table_privilege(current_user, 'billing.crm_refund_reviews', 'SELECT,INSERT,UPDATE')
    OR NOT has_table_privilege(current_user, 'billing.crm_refund_command_receipts', 'SELECT,INSERT')
    OR has_table_privilege(current_user, 'billing.crm_refund_command_receipts', 'UPDATE,DELETE') THEN
    RAISE EXCEPTION 'billing runtime role has incorrect refund evidence privileges';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='billing.crm_refund_reviews'::regclass AND tgname='crm_refund_reviews_evidence_guard' AND NOT tgisinternal)
    OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='billing.crm_refund_command_receipts'::regclass AND tgname='crm_refund_commands_evidence_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'refund evidence immutability triggers are missing';
  END IF;
END $$;
SELECT 'ok';`,
  "ok",
);

const refundId = randomUUID();
const providerRefundId = randomUUID();
const paymentIdHint = randomUUID();
const commandId = randomUUID();
const shopId = `risk-${randomUUID()}`;
const billingOwner = connections.billing.migration;
await expectValue(
  billingOwner,
  `
BEGIN;
INSERT INTO billing.crm_refund_reviews (id, shop_id, provider_mode, provider_refund_id, payment_id_hint, updated_at)
VALUES ('${refundId}', '${shopId}', 'TEST', '${providerRefundId}', '${paymentIdHint}', CURRENT_TIMESTAMP);
DO $$ DECLARE rejected boolean := false; code text;
BEGIN
  BEGIN
    UPDATE billing.crm_refund_reviews SET provider_refund_id='${randomUUID()}', version=version+1 WHERE id='${refundId}';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE;
    IF code='23514' THEN rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'refund source binding mutation was accepted'; END IF;
END $$;
INSERT INTO billing.crm_refund_command_receipts (actor_subject, command_id, command_type, refund_id, request_hash, result)
VALUES ('integration-actor', '${commandId}', 'REVIEW', '${refundId}', repeat('a',64), '{}'::jsonb);
DO $$ DECLARE rejected boolean := false; code text;
BEGIN
  BEGIN
    UPDATE billing.crm_refund_command_receipts SET result='{"changed":true}'::jsonb
      WHERE actor_subject='integration-actor' AND command_id='${commandId}';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE;
    IF code='23514' THEN rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'refund command receipt mutation was accepted'; END IF;
END $$;
DO $$ DECLARE rejected boolean := false; code text;
BEGIN
  BEGIN
    DELETE FROM billing.crm_refund_reviews WHERE id='${refundId}';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE;
    IF code='23514' THEN rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'refund evidence deletion was accepted'; END IF;
END $$;
ROLLBACK;
SELECT 'ok';`,
  "ok",
);

console.log(
  "Risk controls PostgreSQL 18 ACL and immutable-evidence integration passed",
);

function localTestUrl(variable, service) {
  const value = process.env[variable]?.trim();
  if (!value) throw new Error(`${variable} is required`);
  const parsed = new URL(value);
  const database = decodeURIComponent(parsed.pathname.slice(1));
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
    database !== expectedDatabase(service)
  ) {
    throw new Error(
      `${variable} must point to local ${service} test database ${expectedDatabase(service)}`,
    );
  }
  parsed.searchParams.delete("schema");
  return parsed.toString();
}

function expectedDatabase(service) {
  return `aerocrm_${service}_test_risk${testSuffix}`;
}

async function query(connectionString, sql) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    application_name: "risk-controls-postgres18-test",
  });
  try {
    await client.connect();
    const result = await client.query(sql);
    const finalResult = Array.isArray(result) ? result.at(-1) : result;
    return (finalResult?.rows ?? [])
      .map((row) => Object.values(row).join("|"))
      .join("\n")
      .trim();
  } catch (error) {
    const message = String(error?.message ?? "").replace(
      /postgres(?:ql)?:\/\/[^\s]*/gi,
      "[database-url]",
    );
    throw new Error(`PostgreSQL integration query failed: ${message}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function expectValue(connectionString, sql, expected) {
  assert.equal(await query(connectionString, sql), expected);
}
