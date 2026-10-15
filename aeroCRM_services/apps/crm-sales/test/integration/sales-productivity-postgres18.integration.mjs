import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/crm-sales-client');
const { SalesService } = require('../../dist/src/sales/sales.service.js');
const { LossReasonsService, DEFAULT_LOSS_REASONS } = require('../../dist/src/loss-reasons/loss-reasons.service.js');
const { BulkAssignmentService } = require('../../dist/src/bulk-assignment/bulk-assignment.service.js');
const { PipelineTemplateCatalogService } = require('../../dist/src/templates/pipeline-template-catalog.service.js');
const { PipelineTemplateInstallationService } = require('../../dist/src/pipelines/pipeline-template-installation.service.js');

assert.equal(process.env.CRM_SALES_INTEGRATION_ALLOW_MUTATION, 'true');
const databaseUrl = process.env.CRM_SALES_TEST_DATABASE_URL;
const runtimeRole = process.env.CRM_SALES_TEST_RUNTIME_ROLE;
assert.ok(databaseUrl && runtimeRole, 'Isolated Sales test database is required');
const location = new URL(databaseUrl);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname));
assert.match(location.pathname, /^\/aerocrm_crm_sales_test(?:_[a-z0-9]+)*$/);
assert.equal(location.searchParams.get('schema'), 'crm_sales');
assert.equal(decodeURIComponent(location.username), runtimeRole);

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const workspaceId = randomUUID();
const contactId = randomUUID();
const ownerMembershipId = randomUUID();
const targetMembershipId = randomUUID();
const targetSubject = 'productivity-manager';
const access = {
  schemaVersion: 1, workspaceId, subject: 'productivity-owner', role: 'OWNER', state: 'ACTIVE',
  dataScope: 'ALL', teamIds: [], permissions: ['sales:read', 'sales:write', 'sales:analytics']
};
let targetEnabled = true;
let membershipEnabled = true;
const authority = { authorize: async () => access };
const actors = { verify: async (_token, actor, membershipId) => {
  assert.equal(actor.subject, access.subject);
  if (membershipId !== null || !membershipEnabled) throw new Error('actor membership revoked');
  return { subject: actor.subject, membershipId: ownerMembershipId };
} };
const assignees = {
  resolve: async (_token, actor, subject) => ({ subject, membershipId: ownerMembershipId,
    role: actor.role, dataScope: actor.dataScope, teamIds: actor.teamIds }),
  authorize: async (_token, actor, target) => {
    if (!targetEnabled || target.subject !== targetSubject || target.membershipId !== targetMembershipId)
      throw new Error('target binding revoked');
    return { ...target, role: 'MANAGER', dataScope: 'ALL', teamIds: actor.teamIds };
  },
  readers: async (_token, _actor, bindings) => {
    assert.deepEqual(bindings, []);
    return [];
  }
};
const sales = new SalesService(prisma, {
  requireContact: async () => ({ id: contactId, name: 'Synthetic contact' })
}, assignees, { preview: async () => [] }, authority, actors);
const settings = new LossReasonsService(prisma, authority, actors);
const bulk = new BulkAssignmentService(prisma, authority, actors, assignees);
const token = 'Bearer isolated-integration-test';

try {
  const [role] = await prisma.$queryRaw`
    SELECT current_user AS name, current_setting('server_version_num')::integer AS version,
      NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolinherit AND NOT rolreplication AND NOT rolbypassrls AS restricted
    FROM pg_roles WHERE rolname = current_user
  `;
  assert.equal(role.name, runtimeRole);
  assert.equal(role.restricted, true);
  assert.ok(role.version >= 180000 && role.version < 190000);
  const catalog = new PipelineTemplateCatalogService();
  const installed = await new PipelineTemplateInstallationService(prisma, catalog).install({
    schemaVersion: 1, commandId: randomUUID(), workspaceId,
    templateKey: 'universal-sales', templateVersion: 1, installedBySubject: access.subject
  });
  const stages = await prisma.pipelineStage.findMany({ where: { pipelineId: installed.installation.pipelineId } });
  const open = stages.find(stage => stage.state === 'OPEN');
  const lost = stages.find(stage => stage.state === 'LOST');
  assert.ok(open && lost);
  const reason = { id: randomUUID(), title: 'Отменили бюджет', archived: false };
  const base = await settings.settings(access, workspaceId);
  assert.equal(base.version, 0);
  assert.equal(base.reasons.length, DEFAULT_LOSS_REASONS.length);
  const save = { schemaVersion: 1, workspaceId, commandId: randomUUID(), actorMembershipId: null,
    expectedVersion: 0, reasons: [...base.reasons, reason] };
  const saved = await settings.save(access, save, token);
  assert.equal(saved.version, 1);
  assert.deepEqual(await settings.save(access, save, token), saved);
  await assert.rejects(settings.save(access, { ...save, commandId: randomUUID() }, token), error => error.status === 409);

  const newDeal = async title => (await sales.create(access, {
    schemaVersion: 1, workspaceId, commandId: randomUUID(), title, currency: 'RUB',
    amountMinor: 10000, pipelineId: installed.installation.pipelineId, stageId: open.id, contactId,
    nextTask: { title: 'Позвонить', dueAt: new Date(Date.now() + 86400000).toISOString() }
  }, token)).deal;
  const lostDeal = await newDeal('Причина проигрыша');
  const historicalDeal = await newDeal('Историческая дата неизвестна');
  const first = await newDeal('Массовое назначение A');
  const second = await newDeal('Массовое назначение B');
  const lossCommand = { schemaVersion: 1, workspaceId, commandId: randomUUID(), expectedVersion: lostDeal.version,
    targetStageId: lost.id, outcome: 'Отказ клиента', actorMembershipId: null,
    lossReason: { id: reason.id, settingsVersion: saved.version } };
  const closed = await sales.transitionV2(access, lostDeal.id, lossCommand, token);
  assert.equal(closed.deal.status, 'LOST');
  assert.deepEqual(await sales.transitionV2(access, lostDeal.id, lossCommand, token), closed);
  const loss = await sales.loss(access, lostDeal.id);
  assert.equal(loss.reason.title, reason.title);
  assert.ok(loss.lostAt);
  const v3 = await sales.timelineV3(access, lostDeal.id, { workspaceId, page: 1, pageSize: 20 });
  const v4 = await sales.timelineV4(access, lostDeal.id, { workspaceId, page: 1, pageSize: 20 });
  assert.equal(v3.items.find(row => row.kind === 'TRANSITIONED').details, null);
  assert.equal(v4.items.find(row => row.kind === 'TRANSITIONED').details.loss.reason.title, reason.title);
  await prisma.$transaction(async tx => {
    await tx.salesTask.updateMany({ where: { dealId: historicalDeal.id, status: 'OPEN' },
      data: { status: 'COMPLETED', completedAt: new Date(), version: { increment: 1 } } });
    await tx.deal.update({ where: { id: historicalDeal.id }, data: {
      stageId: lost.id, status: 'LOST', nextTaskId: null, version: { increment: 1 }
    } });
  });
  const historicalTransition = await sales.transitionV2(access, historicalDeal.id, {
    ...lossCommand, commandId: randomUUID(), expectedVersion: historicalDeal.version + 1
  }, token);
  assert.equal(historicalTransition.deal.status, 'LOST');
  assert.equal((await sales.loss(access, historicalDeal.id)).lostAt, null);
  const historicalTimeline = await sales.timelineV4(access, historicalDeal.id, { workspaceId, page: 1, pageSize: 20 });
  assert.deepEqual(historicalTimeline.items.find(row => row.kind === 'TRANSITIONED').details.loss,
    { lostAt: null, reason: { id: reason.id, title: reason.title } });
  const renamed = await settings.save(access, { ...save, commandId: randomUUID(), expectedVersion: 1,
    reasons: [...base.reasons, { ...reason, title: 'Бюджет закрыт', archived: true }] }, token);
  assert.equal(renamed.version, 2);
  assert.equal((await sales.loss(access, lostDeal.id)).reason.title, reason.title);
  const report = await sales.lossReport(access, { workspaceId });
  assert.equal(report.totals.count, 1);
  assert.deepEqual(report.reasons.map(row => [row.reasonId, row.title, row.amountMinor]), [[reason.id, 'Бюджет закрыт', 10000]]);
  assert.equal(report.unknownDate.count, 1);
  const emptyPeriod = await sales.lossReport(access, { workspaceId, lostFrom: '2020-01-01T00:00:00.000Z', lostTo: '2020-01-02T00:00:00.000Z' });
  assert.equal(emptyPeriod.totals.count, 0);

  const selection = { schemaVersion: 1, workspaceId, actorMembershipId: null,
    assignee: { subject: targetSubject, membershipId: targetMembershipId },
    deals: [first, second].map(deal => ({ id: deal.id, expectedVersion: deal.version })) };
  const preview = await bulk.preview(access, selection, token);
  assert.equal(preview.deals.length, 2);
  assert.equal(preview.transferredTaskCount, 2);
  const task = await prisma.salesTask.findFirstOrThrow({ where: { dealId: first.id, status: 'OPEN' } });
  await prisma.salesTask.update({ where: { id: task.id }, data: { version: { increment: 1 } } });
  const staleCommand = { ...selection, commandId: randomUUID(), previewHash: preview.previewHash };
  await assert.rejects(bulk.apply(access, staleCommand, token), error => error.status === 409);
  assert.equal((await prisma.deal.findUniqueOrThrow({ where: { id: first.id } })).version, first.version);
  assert.equal(await prisma.bulkAssignmentCommand.count({ where: { commandId: staleCommand.commandId } }), 0);
  const fresh = await bulk.preview(access, selection, token);
  const applyCommand = { ...selection, commandId: randomUUID(), previewHash: fresh.previewHash };
  const applied = await bulk.apply(access, applyCommand, token);
  assert.equal(applied.deals.length, 2);
  assert.equal(applied.transferredTaskCount, 2);
  assert.equal(await prisma.deal.count({ where: { id: { in: [first.id, second.id] }, assignedToSubject: targetSubject } }), 2);
  assert.equal(await prisma.salesTask.count({ where: { dealId: { in: [first.id, second.id] }, status: 'OPEN', assignedToSubject: targetSubject,
    assignedToMembershipId: targetMembershipId } }), 2);
  targetEnabled = false;
  assert.deepEqual(await bulk.apply(access, applyCommand, token), applied);
  membershipEnabled = false;
  await assert.rejects(bulk.apply(access, applyCommand, token));
  assert.equal(await prisma.bulkAssignmentCommand.count({ where: { commandId: applyCommand.commandId } }), 1);
  console.log('PASS Sales productivity PostgreSQL 18: settings CAS/replay, loss snapshot/report/timeline, bulk stale/atomic/replay/fresh actor');
} finally {
  await prisma.$disconnect();
}
