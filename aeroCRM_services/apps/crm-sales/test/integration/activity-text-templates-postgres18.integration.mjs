import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const required = (name) => {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} is required`);
  return value;
};
const assertLocalTestDatabase = (value, name) => {
  const url = new URL(value);
  const database = decodeURIComponent(
    url.pathname.replace(/^\//, ""),
  ).toLowerCase();
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname));
  assert.match(database, /^aerocrm_crm_sales_test[a-z0-9_]*$/);
  assert.equal(url.searchParams.get("schema"), "crm_sales");
  return `${url.host}/${database}`;
};

assert.equal(process.env.CRM_SALES_INTEGRATION_ALLOW_MUTATION, "true");
const runtimeUrl = required("CRM_SALES_TEST_DATABASE_URL");
const migrationUrl = required("CRM_SALES_TEST_MIGRATION_DATABASE_URL");
const expectedRole = required("CRM_SALES_TEST_RUNTIME_ROLE");
assert.equal(
  assertLocalTestDatabase(runtimeUrl, "CRM_SALES_TEST_DATABASE_URL"),
  assertLocalTestDatabase(
    migrationUrl,
    "CRM_SALES_TEST_MIGRATION_DATABASE_URL",
  ),
);
assert.notEqual(new URL(runtimeUrl).username, new URL(migrationUrl).username);
assert.equal(decodeURIComponent(new URL(runtimeUrl).username), expectedRole);

const appRoot = new URL("../../", import.meta.url);
const migration = spawnSync("pnpm", ["run", "prisma:migrate:deploy"], {
  cwd: appRoot,
  env: { ...process.env, CRM_SALES_DATABASE_URL: migrationUrl },
  encoding: "utf8",
  timeout: 120_000,
});
if (migration.status !== 0)
  throw new Error(
    `CRM Sales migration failed:\n${migration.stdout}\n${migration.stderr}`,
  );

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/crm-sales-client");
const {
  ActivityTextTemplatesService,
} = require("../../dist/src/activity-text-templates/activity-text-templates.service.js");
const {
  WorkspaceClosureService,
} = require("../../dist/src/workspace-closure/workspace-closure.controller.js");
let runtime;
let migrationClient;
try {
  runtime = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
  await runtime.$connect();
  migrationClient = new PrismaClient({
    datasources: { db: { url: migrationUrl } },
  });
  await migrationClient.$connect();
} catch (error) {
  await Promise.allSettled(
    [runtime, migrationClient]
      .filter(Boolean)
      .map((client) => client.$disconnect()),
  );
  throw error;
}

const workspaceId = randomUUID();
const actor = {
  schemaVersion: 1,
  workspaceId,
  subject: "activity-template-integration-owner",
  role: "OWNER",
  state: "ACTIVE",
  dataScope: "ALL",
  teamIds: [],
  permissions: ["sales:read", "sales:write"],
};
let currentAccess = actor;
const service = new ActivityTextTemplatesService(runtime, {
  authorize: async () => currentAccess,
});
const token = "Bearer activity-template-postgres-test";
const template = {
  id: randomUUID(),
  title: "  Follow up  ",
  body: "  First line\r\nSecond line  ",
  archived: false,
};
const command = (patch = {}) => ({
  schemaVersion: 1,
  workspaceId,
  commandId: randomUUID(),
  expectedVersion: 0,
  templates: [template],
  ...patch,
});
const http = (status) => (error) => error?.getStatus?.() === status;
const expectSqlGuard = (text) => (error) => String(error).includes(text);

try {
  const [identity] =
    await runtime.$queryRaw`SELECT current_user AS role, current_setting('server_version_num')::integer AS version`;
  assert.equal(identity.role, expectedRole);
  assert.ok(identity.version >= 180000 && identity.version < 190000);
  const privileges = await runtime.$queryRaw`
		SELECT has_table_privilege(current_user, 'crm_sales.activity_text_template_settings', 'SELECT') AS can_read,
		       has_table_privilege(current_user, 'crm_sales.activity_text_template_settings', 'INSERT') AS can_insert,
		       has_table_privilege(current_user, 'crm_sales.activity_text_template_settings', 'UPDATE') AS can_update,
		       has_table_privilege(current_user, 'crm_sales.activity_text_template_settings', 'TRUNCATE') AS can_truncate,
		       has_table_privilege(current_user, 'crm_sales.activity_text_template_commands', 'UPDATE') AS can_update_receipts,
	       has_table_privilege(current_user, 'crm_sales.activity_text_template_commands', 'DELETE') AS can_delete_receipts,
	       has_table_privilege(current_user, 'crm_sales.activity_text_template_commands', 'TRUNCATE') AS can_truncate_receipts`;
  assert.deepEqual(privileges, [
    {
      can_read: true,
      can_insert: true,
      can_update: true,
      can_truncate: false,
      can_update_receipts: false,
      can_delete_receipts: false,
      can_truncate_receipts: false,
    },
  ]);
  const objects = await runtime.$queryRaw`
		SELECT to_regclass('crm_sales.activity_text_template_settings') IS NOT NULL AS settings_exists,
		       to_regclass('crm_sales.activity_text_template_commands') IS NOT NULL AS commands_exists,
		       EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'crm_sales.activity_text_template_settings'::regclass AND NOT tgisinternal AND tgname = 'guard_workspace_closure') AS settings_fenced,
		       EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'crm_sales.activity_text_template_commands'::regclass AND NOT tgisinternal AND tgname = 'activity_text_template_commands_append_only') AS receipts_append_only`;
  assert.deepEqual(objects, [
    {
      settings_exists: true,
      commands_exists: true,
      settings_fenced: true,
      receipts_append_only: true,
    },
  ]);

  const initial = await service.settings(actor, workspaceId);
  assert.deepEqual(initial, {
    schemaVersion: 1,
    workspaceId,
    version: 0,
    templates: [],
  });
  assert.equal(
    await runtime.activityTextTemplateSettings.count({
      where: { workspaceId },
    }),
    0,
    "GET does not initialize a row",
  );
  const firstCommand = command();
  const [first, repeatedFirst] = await Promise.all([
    service.save(actor, firstCommand, token),
    service.save(actor, firstCommand, token),
  ]);
  assert.equal(first.version, 1);
  assert.deepEqual(first.templates[0], {
    id: template.id,
    title: "Follow up",
    body: "First line\nSecond line",
    archived: false,
  });
  assert.deepEqual(
    repeatedFirst,
    first,
    "concurrent replay returns one saved receipt",
  );
  assert.deepEqual(
    await service.save(actor, firstCommand, token),
    first,
    "later replay returns the saved receipt",
  );
  assert.equal(
    await runtime.activityTextTemplateCommand.count({ where: { workspaceId } }),
    1,
  );
  await assert.rejects(
    service.save(
      actor,
      command({
        commandId: firstCommand.commandId,
        templates: [{ ...template, title: "Changed" }],
      }),
      token,
    ),
    http(409),
  );
  currentAccess = { ...actor, subject: "activity-template-intruder" };
  await assert.rejects(
    service.save(currentAccess, firstCommand, token),
    http(409),
    "receipt replay by another actor is rejected",
  );
  currentAccess = actor;
  await assert.rejects(
    service.save(actor, command({ expectedVersion: 0 }), token),
    http(409),
    "stale version uses CAS",
  );
  await assert.rejects(
    service.save(actor, command({ expectedVersion: 1, templates: [] }), token),
    http(409),
    "persisted ids cannot be deleted",
  );

  const archiveCommand = command({
    expectedVersion: 1,
    templates: [{ ...template, archived: true }],
  });
  const archived = await service.save(actor, archiveCommand, token);
  assert.equal(archived.version, 2);
  assert.equal(archived.templates[0].archived, true);
  assert.equal(
    (await service.settings(actor, workspaceId)).templates.length,
    1,
  );
  const receipt = await runtime.activityTextTemplateCommand.findUniqueOrThrow({
    where: { commandId: archiveCommand.commandId },
  });
  await assert.rejects(
    runtime.activityTextTemplateCommand.update({
      where: { commandId: receipt.commandId },
      data: { result: {} },
    }),
    (error) =>
      String(error).includes(
        "permission denied for table activity_text_template_commands",
      ),
  );

  const concurrentWorkspaceId = randomUUID();
  const concurrentActor = { ...actor, workspaceId: concurrentWorkspaceId };
  currentAccess = concurrentActor;
  const concurrentFirstWrites = [
    command({ workspaceId: concurrentWorkspaceId }),
    command({ workspaceId: concurrentWorkspaceId }),
  ];
  const firstWriteRace = await Promise.allSettled(
    concurrentFirstWrites.map((value) =>
      service.save(concurrentActor, value, token),
    ),
  );
  assert.equal(
    firstWriteRace.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    firstWriteRace.filter(
      (result) =>
        result.status === "rejected" && result.reason?.getStatus?.() === 409,
    ).length,
    1,
  );
  assert.equal(
    await runtime.activityTextTemplateSettings.count({
      where: { workspaceId: concurrentWorkspaceId },
    }),
    1,
    "concurrent first write creates one settings row",
  );
  assert.equal(
    await runtime.activityTextTemplateCommand.count({
      where: { workspaceId: concurrentWorkspaceId },
    }),
    1,
    "only the winning first-write command is receipted",
  );
  currentAccess = actor;

  for (const denied of [
    { ...actor, role: "ANALYST" },
    { ...actor, state: "READ_ONLY" },
  ]) {
    await assert.rejects(
      service.save(denied, command({ expectedVersion: 2 }), token),
      http(403),
    );
  }
  currentAccess = { ...actor, role: "MANAGER" };
  await assert.rejects(
    service.save(actor, command({ expectedVersion: 2 }), token),
    http(403),
    "fresh authorization revokes writer role",
  );
  currentAccess = actor;

  const closedWorkspace = randomUUID();
  const closedActor = { ...actor, workspaceId: closedWorkspace };
  currentAccess = closedActor;
  await new WorkspaceClosureService(runtime).fence({
    schemaVersion: 1,
    closureId: randomUUID(),
    workspaceId: closedWorkspace,
    generation: "1",
    ownerSubject: actor.subject,
    requestedAt: new Date().toISOString(),
  });
  await assert.rejects(
    service.save(closedActor, command({ workspaceId: closedWorkspace }), token),
    expectSqlGuard("crm_workspace_closed"),
  );
  console.log(
    "Activity text templates PostgreSQL 18: migration, runtime ACL, read-only GET, normalization, CAS, archive, no deletion, receipt replay, fresh ACL, and closure fence passed",
  );
} finally {
  await Promise.all([runtime.$disconnect(), migrationClient.$disconnect()]);
}
