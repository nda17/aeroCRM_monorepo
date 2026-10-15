import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const required = name => {
	const value = process.env[name];
	assert.ok(value, `${name} is required`);
	return value;
};
const runtimeUrl = required('CRM_CUSTOMERS_TEST_DATABASE_URL');
const migrationUrl = required('CRM_CUSTOMERS_TEST_MIGRATION_DATABASE_URL');
const runtimeRole = required('CRM_CUSTOMERS_TEST_RUNTIME_ROLE');
assert.equal(process.env.CRM_CUSTOMERS_INTEGRATION_ALLOW_MUTATION, 'true');
const local = value => {
	const url = new URL(value);
	assert.ok(['localhost', '127.0.0.1', '::1'].includes(url.hostname), 'Fixture database must be local');
	return `${url.hostname}:${url.port}${url.pathname}`;
};
assert.equal(local(runtimeUrl), local(migrationUrl));
assert.match(runtimeRole, /^[a-z][a-z0-9_]{0,62}$/);

const { PrismaClient } = await import('@prisma/crm-customers-client');
const { Test } = await import('@nestjs/testing');
const { ValidationPipe } = await import('@nestjs/common');
const { json } = await import('express');
const { MailTemplatesService } = await import('../../dist/src/mail/mail-templates.service.js');
const { MailTemplatesController } = await import('../../dist/src/mail/mail-templates.controller.js');
const { MailAuthorizationClient } = await import('../../dist/src/mail/mail-authorization.client.js');
// Connect sequentially because Prisma 5.22 native TLS startup reads process.env.
const runtime = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
await runtime.$connect();
const migrator = new PrismaClient({ datasources: { db: { url: migrationUrl } } });
await migrator.$connect();

const workspaceId = randomUUID();
const closedWorkspaceId = randomUUID();
const membershipId = randomUUID();
const commandId = randomUUID();
const templateId = randomUUID();
const subject = 'mail-templates-pg18-fixture';
const authority = (membership = membershipId, state = 'ACTIVE') => ({
	schemaVersion: 1,
	customer: {
		schemaVersion: 1,
		workspaceId,
		subject,
		role: 'CRM_ADMIN',
		state,
		dataScope: 'ALL',
		teamIds: [],
		permissions: []
	},
	membershipId: membership,
	mailPermissions: ['mail:read', 'mail:manage']
});
let freshAuthority = authority();
const authorization = { authorize: async () => freshAuthority };
const service = new MailTemplatesService(runtime, authorization);
let httpApp;
const input = {
	schemaVersion: 1,
	workspaceId,
	commandId,
	expectedVersion: 0,
	templates: [{
		id: templateId,
		title: ' Follow up ',
		subject: ' Next steps ',
		body: 'Hello\r\n\r\nThanks',
		archived: false
	}]
};

try {
	const [{ version: serverVersion }] = await runtime.$queryRawUnsafe('SELECT current_setting(\'server_version_num\')::integer AS version');
	assert.equal(Math.floor(serverVersion / 10000), 18, 'PostgreSQL 18 is required');
	const [{ name, restricted }] = await runtime.$queryRawUnsafe('SELECT current_user AS name, NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls AS restricted FROM pg_roles WHERE rolname=current_user');
	assert.equal(name, runtimeRole);
	assert.equal(restricted, true);
	const grants = await runtime.$queryRaw`SELECT has_table_privilege(current_user, 'crm_customers.mail_template_settings', 'SELECT') AS can_read_settings, has_table_privilege(current_user, 'crm_customers.mail_template_settings', 'INSERT') AS can_create_settings, has_table_privilege(current_user, 'crm_customers.mail_template_commands', 'UPDATE') AS can_edit_receipts, has_table_privilege(current_user, 'crm_customers.mail_template_commands', 'DELETE') AS can_delete_receipts`;
	assert.deepEqual(grants, [{ can_read_settings: true, can_create_settings: true, can_edit_receipts: false, can_delete_receipts: false }]);

	await migrator.workspaceClosureFence.create({ data: { workspaceId } });
	await migrator.workspaceClosureFence.create({
		data: {
			workspaceId: closedWorkspaceId,
			closureId: randomUUID(),
			generation: 1n,
			ownerSubject: subject,
			requestedAt: new Date(),
			fencedAt: new Date()
		}
	});

	assert.deepEqual(await service.settings(authority(), workspaceId), {
		schemaVersion: 1,
		workspaceId,
		version: 0,
		templates: []
	});
	const saved = await service.save(authority(), input, 'Bearer pg18-fixture-token');
	assert.equal(saved.version, 1);
	assert.deepEqual(saved.templates, [{ id: templateId, title: 'Follow up', subject: 'Next steps', body: 'Hello\n\nThanks', archived: false }]);
	assert.deepEqual(await service.save(authority(), input, 'Bearer pg18-fixture-token'), saved, 'same command must replay its immutable receipt');

	await assert.rejects(
		service.save(authority(), { ...input, commandId: randomUUID() }, 'Bearer pg18-fixture-token'),
		error => error?.response?.code === 'crm_mail_templates_conflict'
	);
	freshAuthority = authority(randomUUID());
	await assert.rejects(
		service.save(freshAuthority, input, 'Bearer pg18-fixture-token'),
		error => error?.response?.code === 'crm_mail_template_command_conflict'
	);
	freshAuthority = authority();
	await assert.rejects(
		service.save(authority(membershipId, 'READ_ONLY'), { ...input, commandId: randomUUID() }, 'Bearer pg18-fixture-token'),
		error => error?.status === 403
	);

	freshAuthority = { ...authority(), customer: { ...authority().customer, workspaceId: closedWorkspaceId } };
	await assert.rejects(
		service.save(freshAuthority, { ...input, workspaceId: closedWorkspaceId, commandId: randomUUID() }, 'Bearer pg18-fixture-token'),
		error => String(error).includes('crm_workspace_closed') || String(error?.message).includes('crm_workspace_closed')
	);
	freshAuthority = authority();

	// Exercise the actual controller over HTTP. Five max-size Cyrillic bodies
	// exceed Express's default 32kb limit and require the scoped templates limit.
	const module = await Test.createTestingModule({
		controllers: [MailTemplatesController],
		providers: [
			{ provide: MailAuthorizationClient, useValue: authorization },
			{ provide: MailTemplatesService, useValue: service }
		]
	}).compile();
	httpApp = module.createNestApplication({ logger: false });
	httpApp.setGlobalPrefix('api/v1');
	httpApp.use('/api/v1/crm/customers/mail/templates', json({ limit: '2mb' }));
	httpApp.useBodyParser('json', { limit: '32kb' });
	httpApp.use('/api/v1/crm/customers/mail/transport-guard', (_request, response) => response.status(204).end());
	httpApp.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
	await httpApp.listen(0, '127.0.0.1');
	const httpOrigin = `http://127.0.0.1:${httpApp.getHttpServer().address().port}`;
	const largeCommand = {
		schemaVersion: 1,
		workspaceId,
		commandId: randomUUID(),
		expectedVersion: 1,
		templates: [input.templates[0], ...Array.from({ length: 5 }, (_, index) => ({
			id: randomUUID(),
			title: `Fixture ${index + 1}`,
			subject: 'Тестовая тема',
			body: 'Я'.repeat(4000),
			archived: false
		}))]
	};
	const largePayload = JSON.stringify(largeCommand);
	assert.ok(Buffer.byteLength(largePayload) > 32 * 1024);
	const accepted = await fetch(`${httpOrigin}/api/v1/crm/customers/mail/templates`, {
		method: 'POST',
		headers: { authorization: 'Bearer pg18-fixture-token', 'idempotency-key': largeCommand.commandId, 'content-type': 'application/json' },
		body: largePayload
	});
	const acceptedText = await accepted.text();
	assert.equal(accepted.status, 200, `template payload over 32kb was rejected: ${acceptedText}`);
	assert.equal(JSON.parse(acceptedText).version, 2);
	const oversizedNeighbor = await fetch(`${httpOrigin}/api/v1/crm/customers/mail/transport-guard`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ payload: 'Ж'.repeat(20000) })
	});
	assert.equal(oversizedNeighbor.status, 413);
	await oversizedNeighbor.body?.cancel();

	const [stored] = await migrator.$queryRaw`SELECT version, templates FROM crm_customers.mail_template_settings WHERE workspace_id=${workspaceId}::uuid`;
	assert.equal(stored.version, 2, 'only the direct and HTTP writes should change settings');
	assert.equal((await migrator.mailTemplateCommand.count({ where: { workspaceId } })), 2, 'failed commands must not create receipts');
	console.log('Mail templates PostgreSQL 18 integration passed: isolated runtime role, CAS, immutable replay, actor binding, READ_ONLY, closure fence, >32kb scoped HTTP acceptance and neighboring 32kb rejection.');
} finally {
	await Promise.all([httpApp?.close(), runtime.$disconnect(), migrator.$disconnect()]);
}
