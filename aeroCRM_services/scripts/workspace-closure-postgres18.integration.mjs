import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const allow = 'WORKSPACE_CLOSURE_INTEGRATION_ALLOW_MUTATION';
assert.equal(process.env[allow], 'true', `Explicit ${allow}=true is required`);

const services = [
	{ prefix: 'CRM_ACCESS', schema: 'crm_access', routine: 'assert_workspace_open', inventory: ['crm_workspace_access', 'crm_workspace_branding', 'crm_workspace_members', 'crm_custom_roles', 'crm_employee_profiles', 'crm_teams', 'crm_member_teams', 'crm_invitation_intents', 'crm_admissions'], guards: ['workspace_closure_business_guard', 'workspace_closure_invitation_intent_guard', 'workspace_closure_admission_intent_guard'], table: 'crm_workspace_branding' },
	{ prefix: 'IDENTITY', schema: 'identity', routine: 'assert_workspace_open', inventory: ['workspace_members', 'workspace_invitations', 'workspaces'], guards: ['workspace_closure_member_guard', 'workspace_closure_invitation_guard', 'workspace_closure_reactivation_guard'], table: 'workspaces' },
	{ prefix: 'BILLING', schema: 'billing', routine: 'assert_workspace_open', inventory: ['crm_orders', 'crm_admin_day_grants', 'crm_admin_seat_adjustments', 'crm_auto_renewals'], guards: ['workspace_closure_order_guard', 'workspace_closure_admin_grant_guard', 'workspace_closure_admin_seat_guard', 'workspace_closure_renewal_guard'], table: 'crm_admin_day_grants' },
	{ prefix: 'CRM_SALES', schema: 'crm_sales', routine: 'assert_workspace_open', inventory: ['pipelines', 'pipeline_stages', 'pipeline_template_installations', 'deals', 'tasks', 'commerce_catalog_items', 'commerce_deal_lines', 'commerce_quotes', 'commerce_payments', 'task_series', 'task_series_occurrences', 'reminder_rules', 'intake_operation_slots', 'task_notifications', 'commerce_import_previews'], guards: ['guard_workspace_closure'], table: 'pipelines' },
	{ prefix: 'CRM_INTAKE', schema: 'crm_intake', routine: 'assert_workspace_open', inventory: ['intake_sources', 'inbox_entries', 'csv_imports', 'csv_import_rows', 'sla_rules', 'sla_notifications', 'inbox_notifications', 'acceptances'], guards: ['guard_workspace_closure', 'guard_acceptance_admission', 'guard_acceptance_outbox'], table: 'intake_sources' },
	{ prefix: 'NOTIFICATION_DELIVERY', schema: 'notification_delivery', routine: 'assert_workspace_open', inventory: ['delivery_receipts'], guards: ['guard_crm_dispatch_scope'], table: 'delivery_receipts' },
	{ prefix: 'CRM_CUSTOMERS', schema: 'crm_customers', routine: 'assert_workspace_open', inventory: ['companies', 'contacts', 'intake_operation_slots'], guards: ['guard_workspace_closure'], table: 'companies' }
];

const testDatabase = service => {
	const runtime = parseUrl(`${service.prefix}_TEST_DATABASE_URL`, service);
	const migration = parseUrl(`${service.prefix}_TEST_MIGRATION_DATABASE_URL`, service);
	assert.equal(runtime.peer, migration.peer, `${service.prefix} runtime/migration must share local PG18`);
	assert.equal(runtime.database, migration.database, `${service.prefix} runtime/migration must share isolated test DB`);
	assert.notEqual(runtime.user, migration.user, `${service.prefix} must use separate runtime/migration roles`);
	return { runtime, migration };
};

function parseUrl(name, service) {
	const value = process.env[name]?.trim();
	assert.ok(value, `Missing ${name}`);
	const url = new URL(value);
	assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
	assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
	assert.match(url.pathname, /^\/aerocrm_[a-z_]+_test_closure_[a-z0-9_]+$/);
	assert.deepEqual(url.searchParams.getAll('schema'), [service.schema]);
	assert.equal(url.hash, '');
	assert.match(decodeURIComponent(url.username), /^[a-z][a-z0-9_]{0,62}$/);
	return { value, database: url.pathname, peer: `${url.hostname}:${url.port}`, user: decodeURIComponent(url.username) };
}

const requirePg = createRequire(new URL('../apps/crm-customers/test/closure-pg-resolver.mjs', import.meta.url));
const { Client } = requirePg('pg');
const connect = async value => {
	const client = new Client({ connectionString: value, connectionTimeoutMillis: 5000, application_name: 'workspace-closure-pg18-test' });
	await client.connect();
	return client;
};
const safeText = error => String(error?.message ?? '').replace(/postgres(?:ql)?:\/\/[^\s]*/gi, '[database-url]');
const closedError = error => {
	const message = safeText(error);
	if (error?.code === 'P2010') {
		const meta = JSON.stringify(error?.meta ?? {});
		return /P0001/.test(meta) && /crm_workspace_closed|CRM_WORKSPACE_CLOSED/.test(meta);
	}
	if (error?.code === 'P2004' || error?.code === 'UNKNOWN')
		return /crm_workspace_closed|CRM_WORKSPACE_CLOSED/.test(message);
	if (error?.code === 'P0001') return /crm_workspace_closed|CRM_WORKSPACE_CLOSED/.test(message);
	return error?.code === '40001' || /CRM_WORKSPACE_CLOSED/.test(message);
};
const immutableFenceError = error =>
	error?.code === 'P0001' &&
	/(?:crm_workspace_closure_immutable|CRM_WORKSPACE_CLOSURE_IMMUTABLE|crm_workspace_closed|CRM_WORKSPACE_CLOSED)/.test(safeText(error));
const qid = value => `"${String(value).replaceAll('"', '""')}"`;
const schemaId = schema => qid(schema);

async function catalogCheck(service, runtime, migration, runtimeRole) {
	const version = await runtime.query(`SELECT current_setting('server_version_num')::integer AS v`);
	assert.ok(version.rows[0].v >= 180000 && version.rows[0].v < 190000, `${service.prefix} requires PostgreSQL 18`);
	const role = await runtime.query(`SELECT current_user AS name, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
	assert.equal(role.rows[0].name, runtimeRole);
	assert.equal(role.rows[0].rolsuper || role.rows[0].rolcreatedb || role.rows[0].rolcreaterole || role.rows[0].rolinherit || role.rows[0].rolreplication || role.rows[0].rolbypassrls, false, `${service.prefix} runtime role is overprivileged`);
	const relation = await runtime.query(`SELECT to_regclass($1) AS fence`, [`${service.schema}.workspace_closure_fences`]);
	assert.ok(relation.rows[0].fence, `${service.prefix} closure fence table is missing`);
	const foreignFixture = await migration.query(`SELECT to_regclass('foreign_service_guard.sentinel') AS sentinel`);
	assert.ok(foreignFixture.rows[0].sentinel, `${service.prefix} foreign-schema ACL fixture is missing`);
	await assert.rejects(runtime.query('SELECT id FROM foreign_service_guard.sentinel'), error => ['42501', '3F000'].includes(error?.code));
	const found = await runtime.query(
		`SELECT c.relname AS table_name, t.tgname AS trigger_name
		 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
		 WHERE n.nspname=$1 AND NOT t.tgisinternal`, [service.schema]);
	for (const table of service.inventory) {
		assert.ok(found.rows.some(row => row.table_name === table), `${service.prefix} inventory table missing: ${table}`);
		assert.ok(found.rows.some(row => row.table_name === table && service.guards.includes(row.trigger_name)), `${service.prefix}.${table} is missing its closure trigger`);
	}
	for (const trigger of service.guards)
		assert.ok(found.rows.some(row => row.trigger_name === trigger), `${service.prefix} closure trigger missing: ${trigger}`);
	const fn = `${service.schema}.${service.routine}(uuid)`;
	const routine = await migration.query(
		`SELECT has_function_privilege($1, $2, 'EXECUTE') AS runtime_exec,
		 EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
		         WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') AS public_exec
		 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
		 WHERE n.nspname=$3 AND p.proname=$4 AND pg_get_function_identity_arguments(p.oid) ~* 'uuid'`,
		[runtimeRole, fn, service.schema, service.routine]);
	assert.equal(routine.rowCount, 1, `${service.prefix}.${fn} must be uniquely installed`);
	assert.equal(routine.rows[0].runtime_exec, true, `${service.prefix} runtime cannot execute ${fn}`);
	assert.equal(routine.rows[0].public_exec, false, `${service.prefix}.${fn} has PUBLIC execute`);
	const inventoryTables = await migration.query(
		`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
		 JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname=$2 AND NOT a.attisdropped
		 WHERE n.nspname=$1 AND c.relkind='r' ORDER BY c.relname`,
		[service.schema, service.schema === 'notification_delivery' ? 'crm_workspace_id' : 'workspace_id']);
	const columnInventory = service.inventory.filter(table => !(service.schema === 'identity' && table === 'workspaces'));
	const missing = columnInventory.filter(table => !inventoryTables.rows.some(row => row.relname === table));
	assert.deepEqual(missing, [], `${service.prefix} inventory drift`);
}

const insertSql = (service, workspaceId) => {
	const schema = schemaId(service.schema);
	const table = qid(service.table);
	switch (service.prefix) {
		case 'CRM_ACCESS':
			return { text: `INSERT INTO ${schema}.${table}(workspace_id,display_name,updated_at) VALUES ($1,'Race',now()) ON CONFLICT (workspace_id) DO UPDATE SET display_name='Race',updated_at=now()`, values: [workspaceId] };
		case 'CRM_CUSTOMERS':
			return { text: `INSERT INTO ${schema}.${table}(id,workspace_id,name,created_by_subject,updated_at) VALUES ($1,$2,'Race','closure-test',now())`, values: [randomUUID(), workspaceId] };
		case 'CRM_INTAKE':
			return { text: `INSERT INTO ${schema}.${table}(id,workspace_id,name,token_hash,created_by_subject,updated_at) VALUES ($1,$2,'Race',$3,'closure-test',now())`, values: [randomUUID(), workspaceId, `${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`] };
		case 'CRM_SALES':
			return { text: `INSERT INTO ${schema}.${table}(id,workspace_id,name,template_key,template_version,template_fingerprint,installed_by_subject,updated_at) VALUES ($1,$2,'Race','closure-test',1,repeat('a',64),'closure-test',now())`, values: [randomUUID(), workspaceId] };
		case 'BILLING':
			return { text: `INSERT INTO ${schema}.${table}(command_id,workspace_id,actor_subject,actor_role,days,reason,target,old_expires_at,new_expires_at) VALUES ($1,$2,'closure-test','ADMIN',1,'fixture','ENTITLEMENT',now(),now()+interval '1 day')`, values: [randomUUID(), workspaceId] };
		case 'NOTIFICATION_DELIVERY':
			return { text: `INSERT INTO ${schema}.${table}(id,event_id,consumer,status,locked_at,locked_by,lock_token,lease_expires_at,crm_workspace_id,crm_dispatch_started_at,updated_at) VALUES ($1,$2,'crm-invitation-email','PROCESSING',now(),'closure-test',$3,now()+interval '5 minutes',$4,now(),now())`, values: [randomUUID(), randomUUID(), randomUUID(), workspaceId] };
		case 'IDENTITY':
			return { text: `UPDATE ${schema}.${table} SET status='ACTIVE' WHERE id=$1`, values: [workspaceId] };
		default:
			throw new Error(`No representative business fixture for ${service.prefix}`);
	}
};

async function seedWorkspace(service, migration, runtime, id) {
	if (service.prefix === 'IDENTITY') {
		await migration.query(`INSERT INTO identity.workspaces(id,type,status,updated_at) VALUES ($1,'ORGANIZATION','INACTIVE',now())`, [id]);
	} else if (service.prefix === 'CRM_ACCESS') {
		await migration.query(
			`INSERT INTO crm_access.crm_workspace_access(workspace_id,activated_by_subject,billing_entitlement_id,provisioning_command_id,provisioning_command_type,updated_at)
			 VALUES ($1,'closure-test',$2,$3,'CLOSURE_TEST',now())`, [id, randomUUID(), randomUUID()]);
	} else if (service.prefix === 'BILLING') {
		await migration.query(
			`INSERT INTO billing.crm_entitlements(id,workspace_id,plan_code,effective_from,effective_until,provisioning_command_id,provisioning_command_type,activated_by_user_id,source_sequence,updated_at)
			 VALUES ($1,$2,'MONTHLY',now(),now()+interval '30 days',$3,'CLOSURE_TEST','closure-test',1,now())`, [randomUUID(), id, randomUUID()]);
	}
	await runtime.query(`SELECT ${schemaId(service.schema)}.${qid(service.routine)}($1::uuid)`, [id]);
}

async function setFenced(service, migration, workspaceId) {
	const at = new Date().toISOString();
	const result = await migration.query(
		`UPDATE ${schemaId(service.schema)}.workspace_closure_fences
		 SET revision=revision+1, closure_id=$2, generation=1, owner_subject='closure-test', requested_at=$3, fenced_at=$3
		 WHERE workspace_id=$1 AND fenced_at IS NULL`, [workspaceId, randomUUID(), at]);
	assert.equal(result.rowCount, 1, `${service.prefix} fence was not installed`);
}

async function verifyFencedMutation(service, runtime, migration) {
	const closedId = randomUUID();
	const otherId = randomUUID();
	await seedWorkspace(service, migration, runtime, closedId);
	const existingContactId = service.prefix === 'CRM_CUSTOMERS' ? randomUUID() : null;
	if (existingContactId) {
		await migration.query(
			`INSERT INTO crm_customers.contacts(id,workspace_id,name,created_by_subject,updated_at) VALUES ($1,$2,'Existing contact','closure-test',now())`,
			[existingContactId, closedId]
		);
	}
	await setFenced(service, migration, closedId);
	const mutation = insertSql(service, closedId);
	await assert.rejects(runtime.query(mutation.text, mutation.values), error => closedError(error));
	if (existingContactId) {
		await assert.rejects(
			runtime.query(
			`INSERT INTO crm_customers.intake_operation_slots(operation_id,workspace_id,workflow_id,actor_subject,payload_hash,state,contact_id,result,committed_at)
				 VALUES ($1,$2,$3,'closure-test',$4,'COMMITTED',$5::uuid,jsonb_build_object('contactId',$5::uuid::text,'contactName','Existing contact','contactVersion',1),now())`,
				[ randomUUID(), closedId, randomUUID(), `${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`, existingContactId ]
			),
			error => closedError(error)
		);
	}
	if (service.prefix !== 'IDENTITY') {
		await seedWorkspace(service, migration, runtime, otherId);
		const otherMutation = insertSql(service, otherId);
		await runtime.query(otherMutation.text, otherMutation.values);
	} else {
		await seedWorkspace(service, migration, runtime, otherId);
		await runtime.query(`UPDATE identity.workspaces SET status='ACTIVE' WHERE id=$1`, [otherId]);
	}
	await assert.rejects(runtime.query(`SELECT ${schemaId(service.schema)}.${qid(service.routine)}($1::uuid)`, [closedId]), error => closedError(error));
	if (service.prefix === 'CRM_CUSTOMERS') await verifyPrismaCustomersFence(runtimeUrlFor(service), closedId, migration);
	for (const operation of [
		`UPDATE ${schemaId(service.schema)}.workspace_closure_fences SET fenced_at=NULL WHERE workspace_id=$1`,
		`UPDATE ${schemaId(service.schema)}.workspace_closure_fences SET closure_id=$2 WHERE workspace_id=$1`,
		`DELETE FROM ${schemaId(service.schema)}.workspace_closure_fences WHERE workspace_id=$1`
	]) {
		const values = operation.includes('$2') ? [closedId, randomUUID()] : [closedId];
		await assert.rejects(migration.query(operation, values), error => immutableFenceError(error));
	}
}

function runtimeUrlFor(service) {
	return testDatabase(service).runtime.value;
}

async function verifyPrismaCustomersFence(runtimeUrl, fencedWorkspaceId, migration) {
	const requireCustomers = createRequire(new URL('../apps/crm-customers/prisma/schema.prisma', import.meta.url));
	const { PrismaClient } = requireCustomers('@prisma/crm-customers-client');
	const prisma = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
	try {
		const openWorkspaceId = randomUUID();
		await prisma.$executeRaw`SELECT crm_customers.assert_workspace_open(${openWorkspaceId}::uuid)`;
		const openFence = await migration.query(
			`SELECT workspace_id, fenced_at FROM crm_customers.workspace_closure_fences WHERE workspace_id=$1`,
			[openWorkspaceId]
		);
		assert.equal(openFence.rowCount, 1, 'Prisma $executeRaw must admit an open CRM Customers workspace');
		assert.equal(openFence.rows[0].fenced_at, null);
		await assert.rejects(
			prisma.$executeRaw`SELECT crm_customers.assert_workspace_open(${fencedWorkspaceId}::uuid)`,
			error => error?.code === 'P2010' && closedError(error)
		);
	} finally {
		await prisma.$disconnect();
	}
}

async function raceFencing(service, runtimeUrl, migration, connections) {
	const rtA = await connect(runtimeUrl);
	const rtB = await connect(runtimeUrl);
	connections.push(rtA, rtB);
	const workspaceId = randomUUID();
	await seedWorkspace(service, migration, rtA, workspaceId);
	const snapshotReady = deferred();
	const resume = deferred();
	const staleWriter = (async () => {
		await rtA.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
		await rtA.query(`SELECT * FROM ${schemaId(service.schema)}.workspace_closure_fences WHERE workspace_id=$1`, [workspaceId]);
		snapshotReady.resolve();
		await resume.promise;
		const mutation = insertSql(service, workspaceId);
		await rtA.query(mutation.text, mutation.values);
		await rtA.query('COMMIT');
	})();
	await snapshotReady.promise;
	await setFenced(service, migration, workspaceId);
	resume.resolve();
	await assert.rejects(staleWriter, error => closedError(error));
	await rtA.query('ROLLBACK').catch(() => undefined);
	// A committed old business transaction must release the shared fence row
	// before the fence installer can acknowledge it.
	const writerId = randomUUID();
	await seedWorkspace(service, migration, rtB, writerId);
	await rtB.query('BEGIN');
	const beforeFenceWrite = insertSql(service, writerId);
	await rtB.query(beforeFenceWrite.text, beforeFenceWrite.values);
	const installer = setFenced(service, migration, writerId);
	let completed = false;
	installer.then(() => { completed = true; }, () => { completed = true; });
	await new Promise(resolve => setTimeout(resolve, 75));
	assert.equal(completed, false, `${service.prefix} fence ACK did not wait for an in-flight business writer`);
	await rtB.query('COMMIT');
	await installer;
	await rtA.end();
	await rtB.end();
}

function deferred() {
	let resolve;
	const promise = new Promise(done => { resolve = done; });
	return { promise, resolve };
}

async function main() {
	const connections = [];
	const failures = [];
	try {
		for (const service of services) {
			let runtime;
			let migration;
			try {
				const target = testDatabase(service);
				runtime = await connect(target.runtime.value);
				migration = await connect(target.migration.value);
				connections.push(runtime, migration);
				const roleName = process.env[`${service.prefix}_TEST_RUNTIME_ROLE`]?.trim();
				assert.ok(roleName, `Missing ${service.prefix}_TEST_RUNTIME_ROLE`);
				assert.equal(target.runtime.user, roleName);
				await catalogCheck(service, runtime, migration, roleName);
				await verifyFencedMutation(service, runtime, migration);
				await raceFencing(service, target.runtime.value, migration, connections);
				console.log(`PASS ${service.prefix} PostgreSQL 18 closure ACL, inventory, fence, and race checks`);
			} catch (error) {
				const message = `${service.prefix}: ${safeText(error)}`;
				failures.push(message);
				console.error(`FAIL ${message}`);
			} finally {
				await Promise.all([runtime, migration].filter(Boolean).map(client => client.end().catch(() => undefined)));
			}
		}
	} finally {
		await Promise.all(connections.map(client => client.end().catch(() => undefined)));
	}
	if (failures.length) process.exitCode = 1;
}

await main();
