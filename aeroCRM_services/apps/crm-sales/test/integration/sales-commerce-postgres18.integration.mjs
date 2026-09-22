import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/crm-sales-client");
const { SalesService } = require("../../dist/src/sales/sales.service.js");
const {
  PipelineTemplateCatalogService,
} = require("../../dist/src/templates/pipeline-template-catalog.service.js");
const {
  PipelineTemplateInstallationService,
} = require("../../dist/src/pipelines/pipeline-template-installation.service.js");
const {
  CommerceService,
} = require("../../dist/src/commerce/commerce.service.js");
const {
  CommerceFinanceService,
} = require("../../dist/src/commerce/commerce-finance.service.js");
const {
  CommerceImportService,
} = require("../../dist/src/commerce/commerce-import.service.js");

assert.equal(process.env.CRM_SALES_INTEGRATION_ALLOW_MUTATION, "true");
const runtimeUrl = requiredEnv("CRM_SALES_TEST_DATABASE_URL");
const migrationUrl = requiredEnv("CRM_SALES_TEST_MIGRATION_URL");
const runtimeRole = requiredEnv("CRM_SALES_TEST_RUNTIME_ROLE");
const runtime = validateDatabase(runtimeUrl, runtimeRole);
const migration = validateDatabase(migrationUrl);
assert.equal(runtime.database, "aerocrm_crm_sales_test");
assert.equal(runtime.database, migration.database);
assert.equal(
  process.env.CRM_SALES_DATABASE_URL,
  runtimeUrl,
  "CRM_SALES_DATABASE_URL must use the restricted runtime role",
);

const prisma = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
const migrationPrisma = new PrismaClient({
  datasources: { db: { url: migrationUrl } },
});
const workspaceId = randomUUID();
const otherWorkspaceId = randomUUID();
const subject = `commerce-test-${randomUUID()}`;
const access = {
  schemaVersion: 1,
  workspaceId,
  subject,
  role: "OWNER",
  state: "ACTIVE",
  dataScope: "ALL",
  teamIds: [],
  permissions: [
    "sales:read",
    "sales:write",
    "sales:manage-pipelines",
    "sales:analytics",
    "sales:export",
  ],
};
const catalog = new PipelineTemplateCatalogService();
const installer = new PipelineTemplateInstallationService(prisma, catalog);
const commerce = new CommerceService(prisma, catalog);
const finance = new CommerceFinanceService(prisma);
const imports = new CommerceImportService(prisma);
const sales = new SalesService(prisma, {
  requireContact: async (_authorization, requestedWorkspace, id) => {
    assert.equal(requestedWorkspace, workspaceId);
    return { id, name: "Integration contact" };
  },
});

try {
  const [role] = await prisma.$queryRaw`
		SELECT current_user AS name,
			current_setting('server_version_num')::integer AS version,
			NOT rol.rolsuper AND NOT rol.rolcreatedb AND NOT rol.rolcreaterole
				AND NOT rol.rolinherit AND NOT rol.rolreplication AND NOT rol.rolbypassrls
			AND rol.rolcanlogin AS restricted,
			pg_get_userbyid(ns.nspowner) <> current_user AS not_owner,
			NOT has_database_privilege(current_user, current_database(), 'CREATE') AS database_create_denied,
			NOT has_schema_privilege(current_user, 'foreign_service_guard', 'USAGE') AS foreign_schema_denied
		FROM pg_roles rol JOIN pg_namespace ns ON ns.nspname = 'crm_sales'
		WHERE rol.rolname = current_user
	`;
  assert.equal(role.name, runtimeRole);
  assert.equal(role.restricted, true);
  assert.equal(role.not_owner, true);
  assert.equal(role.database_create_denied, true);
  assert.equal(role.foreign_schema_denied, true);
  assert.ok(role.version >= 180000 && role.version < 190000);
  await assert.rejects(
    prisma.$queryRawUnsafe(
      "SELECT id FROM foreign_service_guard.sentinel LIMIT 1",
    ),
    (error) => error?.meta?.code === "42501",
  );

  const installed = await installer.install({
    schemaVersion: 1,
    commandId: randomUUID(),
    workspaceId,
    templateKey: "universal-sales",
    templateVersion: 1,
    installedBySubject: subject,
  });
  const installedPipeline = (await commerce.pipelines(access)).items.find(
    (pipeline) => pipeline.id === installed.installation.pipelineId,
  );
  assert.ok(installedPipeline);
  const stages = installedPipeline.stages;
  assert.ok(stages.length >= 3);
  const openStage = stages.find((stage) => stage.state === "OPEN");
  assert.ok(openStage);

  const manualDeal = await sales.create(
    access,
    {
      schemaVersion: 1,
      commandId: randomUUID(),
      workspaceId,
      title: "Ручная сделка без строк",
      currency: "RUB",
      amountMinor: 0,
      pipelineId: installed.installation.pipelineId,
      stageId: openStage.id,
      contactId: randomUUID(),
      nextTask: {
        title: "Первый звонок",
        dueAt: new Date(Date.now() + 86400000).toISOString(),
      },
    },
    "Bearer integration",
  );
  const dealId = manualDeal.deal.id;
  assert.equal((await commerce.lines(access, dealId)).items.length, 0);
  assert.equal((await commerce.lines(access, dealId)).amountMinor, 0);

  const extraPipeline = await commerce.createPipeline(access, {
    schemaVersion: 1,
    workspaceId,
    commandId: randomUUID(),
    name: "Дополнительная воронка",
  });
  const extraPipelineId = extraPipeline.pipeline.id;
  const beforeStageChange = extraPipeline.pipeline.version;
  const added = await commerce.addStage(access, extraPipelineId, {
    schemaVersion: 1,
    workspaceId,
    commandId: randomUUID(),
    expectedVersion: beforeStageChange,
    name: "Согласование",
    state: "OPEN",
  });
  await assert.rejects(
    commerce.renamePipeline(access, extraPipelineId, {
      schemaVersion: 1,
      workspaceId,
      commandId: randomUUID(),
      expectedVersion: beforeStageChange,
      name: "Устаревшее обновление",
    }),
    isConflict,
  );
  const reordered = [...added.pipeline.stages]
    .reverse()
    .map((stage) => stage.id);
  const reorderedPipeline = await commerce.reorderStages(
    access,
    extraPipelineId,
    {
      schemaVersion: 1,
      workspaceId,
      commandId: randomUUID(),
      expectedVersion: added.pipeline.version,
      stageIds: reordered,
    },
  );
  assert.deepEqual(
    reorderedPipeline.pipeline.stages.map((stage) => stage.id),
    reordered,
  );

  const noPriceCommand = {
    schemaVersion: 1,
    workspaceId,
    commandId: randomUUID(),
    kind: "SERVICE",
    name: "Консультация",
    unit: "час",
    code: "CONSULT-001",
    basePriceMinor: null,
  };
  const noPrice = await commerce.createCatalog(access, noPriceCommand);
  assert.deepEqual(
    await commerce.createCatalog(access, noPriceCommand),
    noPrice,
  );
  await assert.rejects(
    commerce.createCatalog(
      { ...access, subject: `impostor-${randomUUID()}` },
      noPriceCommand,
    ),
    isConflict,
  );
  await assert.rejects(
    commerce.createCatalog(
      { ...access, workspaceId: otherWorkspaceId },
      noPriceCommand,
    ),
    isConflict,
  );
  await assert.rejects(
    commerce.createCatalog(access, {
      ...noPriceCommand,
      name: "Переиспользованный ключ",
    }),
    isConflict,
  );
  await assert.rejects(
    commerce.createCatalog(
      { ...access, permissions: ["sales:read"] },
      {
        ...noPriceCommand,
        commandId: randomUUID(),
        code: "DENIED",
      },
    ),
    isForbidden,
  );
  const serviceItem = await commerce.createCatalog(access, {
    schemaVersion: 1,
    workspaceId,
    commandId: randomUUID(),
    kind: "SERVICE",
    name: "Настройка",
    unit: "час",
    code: "SERVICE-001",
    basePriceMinor: 500,
  });
  const productItem = await commerce.createCatalog(access, {
    schemaVersion: 1,
    workspaceId,
    commandId: randomUUID(),
    kind: "PRODUCT",
    name: "Кабель",
    unit: "шт.",
    code: "PRODUCT-001",
    basePriceMinor: 101,
  });
  assert.equal(noPrice.item.basePriceMinor, null);
  const positiveManual = await commerce.replaceLines(access, dealId, {
    schemaVersion: 1,
    workspaceId,
    commandId: randomUUID(),
    expectedVersion: manualDeal.deal.version,
    lines: [],
    manualAmountMinor: 1234,
  });
  assert.deepEqual(
    { mode: positiveManual.mode, amountMinor: positiveManual.amountMinor, items: positiveManual.items },
    { mode: "MANUAL", amountMinor: 1234, items: [] },
  );
  const serviceOnly = await commerce.replaceLines(access, dealId, {
    schemaVersion: 1,
    workspaceId,
    commandId: randomUUID(),
    expectedVersion: positiveManual.dealVersion,
    lines: [
      {
        catalogItemId: null,
        kind: "SERVICE",
        name: "Разовая настройка",
        unit: "час",
        quantity: "1.000",
        unitPriceMinor: 500,
        discountMinor: 0,
      },
    ],
  });
  assert.equal(serviceOnly.mode, "LINES");
  assert.equal(serviceOnly.items.length, 1);
  assert.equal(serviceOnly.amountMinor, 500);
  const serviceLineId = serviceOnly.items[0].id;
  const saveCommandId = randomUUID();
  const savedLine = await commerce.saveLine(access, dealId, serviceLineId, {
    schemaVersion: 1,
    workspaceId,
    commandId: saveCommandId,
    expectedVersion: serviceOnly.dealVersion,
    code: "SERVICE-SAVED-001",
  });
  assert.equal(savedLine.item.basePriceMinor, 500);
  assert.equal(savedLine.lineId, serviceLineId);
  assert.deepEqual(
    await commerce.saveLine(access, dealId, serviceLineId, {
      schemaVersion: 1,
      workspaceId,
      commandId: saveCommandId,
      expectedVersion: serviceOnly.dealVersion,
      code: "SERVICE-SAVED-001",
    }),
    savedLine,
  );
  const savedLineReplay = await commerce.saveLine(
    access,
    dealId,
    serviceLineId,
    {
      schemaVersion: 1,
      workspaceId,
      commandId: randomUUID(),
      expectedVersion: serviceOnly.dealVersion + 1,
      code: "SERVICE-SAVED-OTHER",
    },
  );
  assert.equal(savedLineReplay.item.id, savedLine.item.id);
  assert.equal(
    await prisma.commerceCatalogItem.count({ where: { workspaceId } }),
    4,
  );
  await commerce.updateCatalog(access, savedLine.item.id, {
    schemaVersion: 1,
    workspaceId,
    commandId: randomUUID(),
    expectedVersion: savedLine.item.version,
    kind: "SERVICE",
    name: "Разовая настройка",
    unit: "час",
    basePriceMinor: 999,
  });
  const afterCatalogPriceChange = await commerce.lines(access, dealId);
  assert.equal(afterCatalogPriceChange.items[0].unitPriceMinor, 500);
  assert.equal(afterCatalogPriceChange.items[0].totalMinor, 500);
  const linesResult = await commerce.replaceLines(access, dealId, {
    schemaVersion: 1,
    workspaceId,
    commandId: randomUUID(),
    expectedVersion: afterCatalogPriceChange.dealVersion,
    lines: [
      {
        catalogItemId: savedLine.item.id,
        kind: "SERVICE",
        name: "Разовая настройка",
        unit: "час",
        quantity: "1.005",
        unitPriceMinor: 500,
        discountMinor: 0,
      },
      {
        catalogItemId: productItem.item.id,
        kind: "PRODUCT",
        name: "Кабель",
        unit: "шт.",
        quantity: "2.500",
        unitPriceMinor: 101,
        discountMinor: 2,
      },
    ],
  });
  assert.equal(linesResult.amountMinor, 754);
  await assert.rejects(
    commerce.replaceLines(access, dealId, {
      schemaVersion: 1,
      workspaceId,
      commandId: randomUUID(),
      expectedVersion: afterCatalogPriceChange.dealVersion,
      lines: [],
    }),
    isConflict,
  );
  assert.equal((await commerce.lines(access, dealId)).items.length, 2);
  assert.equal(
    (await commerce.catalog(access, { page: 1, pageSize: 100 })).items.length,
    4,
  );
  const archived = await commerce.updateCatalog(
    access,
    noPrice.item.id,
    {
      schemaVersion: 1,
      workspaceId,
      commandId: randomUUID(),
      expectedVersion: noPrice.item.version,
    },
    true,
  );
  assert.ok(archived.item.archivedAt);

  const quote = await finance.createQuote(access, dealId, {
    schemaVersion: 1,
    workspaceId,
    commandId: randomUUID(),
    sellerName: "<script>alert(1)</script>",
    sellerDetails: "ИНН 123",
    customerDetails: "<img src=x>",
  });
  const quoteSnapshot = quote.quote.snapshot;
  const replaceAfterQuote = await commerce.replaceLines(access, dealId, {
    schemaVersion: 1,
    workspaceId,
    commandId: randomUUID(),
    expectedVersion: linesResult.dealVersion,
    lines: [
      {
        catalogItemId: productItem.item.id,
        kind: "PRODUCT",
        name: "Изменённая строка",
        unit: "шт.",
        quantity: "1",
        unitPriceMinor: 500,
        discountMinor: 0,
      },
    ],
  });
  assert.notDeepEqual(
    (await commerce.lines(access, dealId)).items,
    quoteSnapshot.lines,
  );
  assert.deepEqual(
    (await finance.quotes(access, dealId)).items[0].snapshot,
    quoteSnapshot,
  );
  const html = await finance.quoteHtml(access, dealId, quote.quote.id);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.equal(replaceAfterQuote.amountMinor, 500);

  const csv = [
    "code;kind;name;unit;basePriceMinor",
    '001;SERVICE;"Поддержка; расширенная";час;100',
    '002;PRODUCT;"Название без управляющих символов";шт.;',
    "PRODUCT-001;PRODUCT;Кабель;шт.;",
  ].join("\r\n");
  const file = {
    filename: "catalog.csv",
    contentBase64: Buffer.from(csv).toString("base64"),
  };
  const staleCsv =
    "code,kind,name,unit,basePriceMinor\r\nROLLBACK-001,SERVICE,Не должно появиться,час,100\r\nPRODUCT-001,PRODUCT,Кабель,шт.,";
  const staleFile = {
    filename: "stale.csv",
    contentBase64: Buffer.from(staleCsv).toString("base64"),
  };
  const staleMapping = {
    code: "code",
    kind: "kind",
    name: "name",
    unit: "unit",
    basePriceMinor: "basePriceMinor",
  };
  const stalePreview = await imports.preview(access, {
    workspaceId,
    ...staleFile,
    mapping: staleMapping,
  });
  await commerce.updateCatalog(access, productItem.item.id, {
    schemaVersion: 1,
    workspaceId,
    commandId: randomUUID(),
    expectedVersion: productItem.item.version,
    name: "Кабель обновлён",
    unit: "шт.",
  });
  await assert.rejects(
    imports.apply(access, {
      schemaVersion: 1,
      workspaceId,
      commandId: randomUUID(),
      previewId: stalePreview.previewId,
    }),
    isConflict,
  );
  assert.equal(
    await prisma.commerceCatalogItem.count({
      where: { workspaceId, code: "ROLLBACK-001" },
    }),
    0,
  );
  const expiredPreview = await imports.preview(access, {
    workspaceId,
    ...staleFile,
    mapping: staleMapping,
  });
  await migrationPrisma.commerceImportPreview.update({
    where: { id: expiredPreview.previewId },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await assert.rejects(
    imports.apply(access, {
      schemaVersion: 1,
      workspaceId,
      commandId: randomUUID(),
      previewId: expiredPreview.previewId,
    }),
    isConflict,
  );
  const inspected = imports.inspect(access, { workspaceId, ...file });
  assert.equal(inspected.sheets[0].rowCount, 3);
  const preview = await imports.preview(access, {
    workspaceId,
    ...file,
    mapping: {
      code: "code",
      kind: "kind",
      name: "name",
      unit: "unit",
      basePriceMinor: "basePriceMinor",
    },
  });
  assert.equal(preview.rows[0].code, "001");
  assert.equal(preview.rows[0].name, "Поддержка; расширенная");
  assert.equal(preview.rows[2].action, "UPDATE");
  assert.equal(preview.rows[2].basePriceMinor, null);
  const applyCommandId = randomUUID();
  const result = await imports.apply(access, {
    schemaVersion: 1,
    workspaceId,
    commandId: applyCommandId,
    previewId: preview.previewId,
  });
  assert.equal(result.created, 2);
  assert.equal(result.updated, 1);
  assert.equal(
    (
      await imports.apply(access, {
        schemaVersion: 1,
        workspaceId,
        commandId: applyCommandId,
        previewId: preview.previewId,
      })
    ).created,
    2,
  );
  assert.equal(
    (
      await prisma.commerceCatalogItem.findUnique({
        where: { id: productItem.item.id },
      })
    ).basePriceMinor,
    101,
  );
  const catalogCountBeforePriceImport = await prisma.commerceCatalogItem.count({
    where: { workspaceId },
  });
  const repeatPriceCsv =
    "code,kind,name,unit,basePriceMinor\r\nPRODUCT-001,PRODUCT,Кабель повторный импорт,шт.,250";
  const repeatPriceFile = {
    filename: "catalog-price.csv",
    contentBase64: Buffer.from(repeatPriceCsv).toString("base64"),
  };
  const repeatPriceMapping = {
    code: "code",
    kind: "kind",
    name: "name",
    unit: "unit",
    basePriceMinor: "basePriceMinor",
  };
  const pricePreview = await imports.preview(access, {
    workspaceId,
    ...repeatPriceFile,
    mapping: repeatPriceMapping,
  });
  assert.equal(pricePreview.rows[0].action, "UPDATE");
  assert.equal(pricePreview.rows[0].basePriceMinor, 25000);
  const priceApplyCommandId = randomUUID();
  const priceApplyCommand = {
    schemaVersion: 1,
    workspaceId,
    commandId: priceApplyCommandId,
    previewId: pricePreview.previewId,
  };
  const priceApply = await imports.apply(access, priceApplyCommand);
  assert.deepEqual(
    { created: priceApply.created, updated: priceApply.updated },
    { created: 0, updated: 1 },
  );
  assert.deepEqual(
    await imports.apply(access, priceApplyCommand),
    priceApply,
  );
  const identicalPricePreview = await imports.preview(access, {
    workspaceId,
    ...repeatPriceFile,
    mapping: repeatPriceMapping,
  });
  assert.equal(identicalPricePreview.rows[0].action, "UNCHANGED");
  assert.deepEqual(
    await imports.apply(access, {
      schemaVersion: 1,
      workspaceId,
      commandId: randomUUID(),
      previewId: identicalPricePreview.previewId,
    }),
    { schemaVersion: 1, previewId: identicalPricePreview.previewId, created: 0, updated: 0, unchanged: 1 },
  );
  assert.equal(
    await prisma.commerceCatalogItem.count({ where: { workspaceId } }),
    catalogCountBeforePriceImport,
  );
  assert.equal(
    (
      await prisma.commerceCatalogItem.findUnique({
        where: { id: productItem.item.id },
      })
    ).basePriceMinor,
    25000,
  );

  const payment1 = await finance.addPayment(access, dealId, {
    schemaVersion: 1,
    workspaceId,
    commandId: randomUUID(),
    kind: "RECEIPT",
    amountMinor: 100,
    occurredAt: "2026-01-02T00:00:00.000Z",
  });
  const payment2 = await finance.addPayment(access, dealId, {
    schemaVersion: 1,
    workspaceId,
    commandId: randomUUID(),
    kind: "REFUND",
    amountMinor: 50,
    occurredAt: "2026-01-03T00:00:00.000Z",
  });
  assert.equal(payment2.netPaidMinor, 50);
  assert.equal(payment2.balanceMinor, 450);
  await assert.rejects(
    finance.addPayment(access, dealId, {
      schemaVersion: 1,
      workspaceId,
      commandId: randomUUID(),
      kind: "REFUND",
      amountMinor: 51,
      occurredAt: "2026-01-04T00:00:00.000Z",
    }),
    isBadRequest,
  );
  await assert.rejects(
    finance.correctPayment(access, dealId, payment1.items[0].id, {
      schemaVersion: 1,
      workspaceId,
      commandId: randomUUID(),
      replacement: {
        kind: "RECEIPT",
        amountMinor: 30,
        occurredAt: "2026-01-02T00:00:00.000Z",
      },
    }),
    isBadRequest,
  );
  const corrected = await finance.correctPayment(
    access,
    dealId,
    payment1.items[0].id,
    {
      schemaVersion: 1,
      workspaceId,
      commandId: randomUUID(),
      replacement: {
        kind: "RECEIPT",
        amountMinor: 150,
        occurredAt: "2026-01-02T00:00:00.000Z",
      },
    },
  );
  assert.equal(corrected.netPaidMinor, 100);
  assert.equal(corrected.balanceMinor, 400);
  assert.equal((await finance.payments(access, dealId)).netPaidMinor, 100);
  const refund = payment2.items.find((payment) => payment.kind === "REFUND");
  assert.ok(refund);
  const correctedRefund = await finance.correctPayment(
    access,
    dealId,
    refund.id,
    {
      schemaVersion: 1,
      workspaceId,
      commandId: randomUUID(),
      replacement: {
        kind: "REFUND",
        amountMinor: 25,
        occurredAt: "2026-01-03T00:00:00.000Z",
      },
    },
  );
  assert.equal(correctedRefund.netPaidMinor, 125);
  assert.equal(correctedRefund.balanceMinor, 375);
  assert.equal(correctedRefund.overpaidMinor, 0);
  const overpaid = await finance.addPayment(access, dealId, {
    schemaVersion: 1,
    workspaceId,
    commandId: randomUUID(),
    kind: "RECEIPT",
    amountMinor: 500,
    occurredAt: "2026-01-04T00:00:00.000Z",
  });
  assert.equal(overpaid.overpaidMinor, 125);
  assert.equal(overpaid.balanceMinor, 0);

  const otherAccess = { ...access, workspaceId: otherWorkspaceId };
  await assert.rejects(commerce.lines(otherAccess, dealId), isNotFound);
  await assert.rejects(
    commerce.lines(
      { ...access, subject: `other-${randomUUID()}`, dataScope: "OWN" },
      dealId,
    ),
    isNotFound,
  );
  const teamId = randomUUID();
  const teamOwner = {
    ...access,
    subject: `team-owner-${randomUUID()}`,
    dataScope: "TEAM",
    teamIds: [teamId],
  };
  const teamDeal = await sales.create(
    teamOwner,
    {
      schemaVersion: 1,
      commandId: randomUUID(),
      workspaceId,
      title: "Командная сделка",
      currency: "RUB",
      amountMinor: 0,
      pipelineId: installed.installation.pipelineId,
      stageId: openStage.id,
      contactId: randomUUID(),
      teamId,
      nextTask: {
        title: "Первый звонок команды",
        dueAt: new Date(Date.now() + 86400000).toISOString(),
      },
    },
    "Bearer integration",
  );
  assert.equal(
    (
      await commerce.lines(
        { ...teamOwner, subject: `member-${randomUUID()}` },
        teamDeal.deal.id,
      )
    ).items.length,
    0,
  );
  await assert.rejects(
    commerce.lines(
      { ...teamOwner, subject: `outside-${randomUUID()}`, teamIds: [] },
      teamDeal.deal.id,
    ),
    isNotFound,
  );
  const history = await finance.history(access, { dealId });
  assert.ok(history.items.length > 0);
  const detail = await finance.exportDetail(access, "json");
  assert.ok(detail.body.includes(dealId));

  await assert.rejects(
    prisma.$executeRawUnsafe(
      `UPDATE "crm_sales"."commerce_events" SET kind = kind WHERE "workspace_id" = '${workspaceId}'`,
    ),
    isPermissionDenied,
  );
  await assert.rejects(
    prisma.$executeRawUnsafe(
      `DELETE FROM "crm_sales"."commerce_events" WHERE "workspace_id" = '${workspaceId}'`,
    ),
    isPermissionDenied,
  );
  await assert.rejects(
    prisma.$executeRawUnsafe('TRUNCATE TABLE "crm_sales"."commerce_events"'),
    isPermissionDenied,
  );

  console.log("CRM Sales PostgreSQL 18 commerce service integration passed");
} finally {
  // This database is an isolated disposable CI fixture. Append-only records are intentionally retained.
  await prisma.$disconnect();
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function validateDatabase(value, expectedRole) {
  const url = new URL(value);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.equal(url.pathname, "/aerocrm_crm_sales_test");
  assert.equal(url.searchParams.get("schema"), "crm_sales");
  if (expectedRole)
    assert.equal(decodeURIComponent(url.username), expectedRole);
  return { database: url.pathname.slice(1) };
}

function isConflict(error) {
  return error?.status === 409 || error?.statusCode === 409;
}
function isBadRequest(error) {
  return error?.status === 400 || error?.statusCode === 400;
}
function isNotFound(error) {
  return error?.status === 404 || error?.statusCode === 404;
}
function isForbidden(error) {
  return error?.status === 403 || error?.statusCode === 403;
}
function isPermissionDenied(error) {
  return error?.meta?.code === "42501";
}
