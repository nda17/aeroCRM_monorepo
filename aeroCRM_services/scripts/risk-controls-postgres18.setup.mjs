import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const requirePg = createRequire(
  new URL("../apps/crm-access/package.json", import.meta.url),
);
const { Client } = requirePg("pg");
const services = ["identity", "campaigns", "billing"];
const suffix = testSuffix(process.env.RISK_CONTROLS_TEST_SUFFIX);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const adminUrl = localAdminUrl(process.env.RISK_CONTROLS_PG_ADMIN_URL);
const admin = new Client({
  connectionString: adminUrl,
  application_name: "risk-controls-pg-bootstrap",
});

try {
  await admin.connect();
  const version = await admin.query("SHOW server_version_num");
  assert.ok(
    Number(version.rows[0].server_version_num) >= 180000,
    "PostgreSQL 18 is required",
  );

  const configs = {};
  for (const service of services) {
    const role = `aerocrm_${service}_migration${suffix}`;
    const runtime = `aerocrm_${service}_runtime${suffix}`;
    const backup = `aerocrm_${service}_backup${suffix}`;
    const database = `aerocrm_${service}_test_risk${suffix}`;
    for (const name of [role, runtime, backup]) {
      const exists = await admin.query(
        "SELECT 1 FROM pg_roles WHERE rolname=$1",
        [name],
      );
      assert.equal(
        exists.rowCount,
        0,
        `Refusing to reuse existing test role ${name}`,
      );
    }
    const dbExists = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname=$1",
      [database],
    );
    assert.equal(
      dbExists.rowCount,
      0,
      `Refusing to reuse existing test database ${database}`,
    );

    const passwords = [
      randomBytes(24).toString("base64url"),
      randomBytes(24).toString("base64url"),
      randomBytes(24).toString("base64url"),
    ];
    for (const [name, password] of [
      [role, passwords[0]],
      [runtime, passwords[1]],
      [backup, passwords[2]],
    ]) {
      await admin.query(
        `CREATE ROLE ${ident(name)} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${literal(password)}'`,
      );
    }
    await admin.query(
      `CREATE DATABASE ${ident(database)} OWNER ${ident(role)}`,
    );
    configs[service] = { role, runtime, backup, database, passwords };
  }

  for (const service of services) {
    const config = configs[service];
    const serviceUrl = databaseUrl(
      adminUrl,
      config.database,
      config.role,
      config.passwords[0],
    );
    await runMigrations(service, serviceUrl, config);
    await applyAcl(service, serviceUrl, config);
    const runtimeUrl = databaseUrl(
      adminUrl,
      config.database,
      config.runtime,
      config.passwords[1],
    );
    const migrationUrl = serviceUrl;
    process.env[`RISK_CONTROLS_${service.toUpperCase()}_RUNTIME_URL`] =
      runtimeUrl;
    process.env[`RISK_CONTROLS_${service.toUpperCase()}_MIGRATION_URL`] =
      migrationUrl;
  }

  const integration = spawnSync(
    process.execPath,
    [
      join(
        dirname(fileURLToPath(import.meta.url)),
        "risk-controls-postgres18.integration.mjs",
      ),
    ],
    {
      env: { ...process.env, RISK_CONTROLS_TEST_SUFFIX: suffix },
      encoding: "utf8",
      stdio: "inherit",
    },
  );
  assert.equal(integration.status, 0, "PostgreSQL 18 integration failed");
} finally {
  await admin.end().catch(() => undefined);
}

async function runMigrations(service, connectionString, config) {
  const client = new Client({
    connectionString,
    application_name: "risk-controls-pg-migrations",
  });
  await client.connect();
  try {
    await client.query(
      `CREATE SCHEMA ${ident(service)} AUTHORIZATION ${ident(config.role)}`,
    );
    const migrationRoot = join(root, "apps", service, "prisma", "migrations");
    const names = (await readdir(migrationRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const name of names) {
      const sql = await readFile(
        join(migrationRoot, name, "migration.sql"),
        "utf8",
      );
      await client.query(sql);
    }
    await client.query(`CREATE TABLE ${ident(service)}._prisma_migrations (
      id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz,
      migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz,
      started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0
    )`);
  } finally {
    await client.end();
  }
}

async function applyAcl(service, connectionString, config) {
  const acl = JSON.parse(
    await readFile(
      join(root, "apps", service, "prisma", "database-access.json"),
      "utf8",
    ),
  );
  assert.equal(acl.service, service);
  const client = new Client({
    connectionString,
    application_name: "risk-controls-pg-acl",
  });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='30s'");
    await client.query(
      `REVOKE ALL ON ALL TABLES IN SCHEMA ${ident(service)} FROM PUBLIC, ${ident(config.runtime)}, ${ident(config.backup)}`,
    );
    await client.query(
      `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${ident(service)} FROM PUBLIC, ${ident(config.runtime)}, ${ident(config.backup)}`,
    );
    await client.query(
      `REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${ident(service)} FROM PUBLIC, ${ident(config.runtime)}, ${ident(config.backup)}`,
    );
    await client.query(
      `GRANT USAGE ON SCHEMA ${ident(service)} TO ${ident(config.runtime)}, ${ident(config.backup)}`,
    );
    for (const table of Object.keys(acl.tables)) {
      const result = await client.query(
        "SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS granted",
        [config.runtime, `${service}.${table}`],
      );
      assert.equal(
        result.rows[0].granted,
        false,
        `${service}.${table}: runtime had privilege before ACL grants`,
      );
      const backupResult = await client.query(
        "SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS granted",
        [config.backup, `${service}.${table}`],
      );
      assert.equal(
        backupResult.rows[0].granted,
        false,
        `${service}.${table}: backup had privilege before ACL grants`,
      );
    }
    for (const sequence of Object.keys(acl.sequences)) {
      for (const role of [config.runtime, config.backup]) {
        const result = await client.query(
          "SELECT has_sequence_privilege($1,$2,'USAGE,SELECT,UPDATE') AS granted",
          [role, `${service}.${sequence}`],
        );
        assert.equal(
          result.rows[0].granted,
          false,
          `${service}.${sequence}: ${role} had privilege before ACL grants`,
        );
      }
    }
    for (const [table, privileges] of Object.entries(acl.tables)) {
      if (privileges.length)
        await client.query(
          `GRANT ${privileges.join(", ")} ON TABLE ${ident(service)}.${ident(table)} TO ${ident(config.runtime)}`,
        );
      await client.query(
        `GRANT SELECT ON TABLE ${ident(service)}.${ident(table)} TO ${ident(config.backup)}`,
      );
    }
    for (const [sequence, privileges] of Object.entries(acl.sequences)) {
      if (privileges.length)
        await client.query(
          `GRANT ${privileges.join(", ")} ON SEQUENCE ${ident(service)}.${ident(sequence)} TO ${ident(config.runtime)}`,
        );
      await client.query(
        `GRANT SELECT ON SEQUENCE ${ident(service)}.${ident(sequence)} TO ${ident(config.backup)}`,
      );
    }
    for (const type of acl.types) {
      await client.query(
        `GRANT USAGE ON TYPE ${ident(service)}.${ident(type)} TO ${ident(config.runtime)}, ${ident(config.backup)}`,
      );
    }
    for (const signature of acl.routineExecute ?? []) {
      await client.query(
        `GRANT EXECUTE ON FUNCTION ${ident(service)}.${signature} TO ${ident(config.runtime)}`,
      );
    }
    for (const [table, privileges] of Object.entries(acl.tables)) {
      for (const privilege of [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
      ]) {
        const result = await client.query(
          "SELECT has_table_privilege($1,$2,$3) AS granted",
          [config.runtime, `${service}.${table}`, privilege],
        );
        assert.equal(
          result.rows[0].granted,
          privileges.includes(privilege),
          `${service}.${table}: runtime ${privilege} ACL mismatch`,
        );
        const backupResult = await client.query(
          "SELECT has_table_privilege($1,$2,$3) AS granted",
          [config.backup, `${service}.${table}`, privilege],
        );
        assert.equal(
          backupResult.rows[0].granted,
          privilege === "SELECT",
          `${service}.${table}: backup ${privilege} ACL mismatch`,
        );
      }
    }
    for (const [sequence, privileges] of Object.entries(acl.sequences)) {
      for (const privilege of ["USAGE", "SELECT", "UPDATE"]) {
        const result = await client.query(
          "SELECT has_sequence_privilege($1,$2,$3) AS granted",
          [config.runtime, `${service}.${sequence}`, privilege],
        );
        assert.equal(
          result.rows[0].granted,
          privileges.includes(privilege),
          `${service}.${sequence}: runtime ${privilege} ACL mismatch`,
        );
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

function localAdminUrl(value) {
  assert.ok(value, "RISK_CONTROLS_PG_ADMIN_URL is required");
  const parsed = new URL(value);
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname),
    "Admin URL must target local PostgreSQL",
  );
  assert.equal(
    decodeURIComponent(parsed.pathname.slice(1)),
    "postgres",
    "Admin URL must connect to the postgres maintenance database",
  );
  return parsed.toString();
}

function testSuffix(value = "") {
  assert.match(
    value,
    /^(?:_[a-z0-9_]+)?$/,
    "Test suffix must be empty or a safe lowercase identifier suffix",
  );
  return value;
}

function databaseUrl(base, database, username, password) {
  const parsed = new URL(base);
  parsed.pathname = `/${database}`;
  parsed.username = username;
  parsed.password = password;
  parsed.search = "";
  return parsed.toString();
}

function ident(value) {
  assert.match(value, /^[A-Za-z_][A-Za-z0-9_]*$/);
  return `"${value}"`;
}

function literal(value) {
  return value.replaceAll("'", "''");
}
