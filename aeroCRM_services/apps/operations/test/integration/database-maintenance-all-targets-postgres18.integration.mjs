import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

// Runs in the reviewed Operations image. It never starts Nest, queues, workers,
// or a public API. The same bootstrap is used for synthetic CI and real S3
// rehearsal, always in a fresh, disposable PostgreSQL 18 cluster.
const require = createRequire(join(process.cwd(), 'package.json'));
require('reflect-metadata');
const compiled = resolve(process.env.DATABASE_MAINTENANCE_TEST_DIST_DIR || 'dist/src');
const { DatabaseMaintenanceService, parseDatabaseMaintenanceRequest } = require(join(compiled, 'maintenance/database-maintenance.service.js'));
const { DatabaseMaintenanceRegistry, databaseMaintenanceAclSql, databaseMaintenanceSchemaBoundarySql, sqlIdentifier: identifier, sqlLiteral: literal } = require(join(compiled, 'maintenance/database-maintenance.registry.js'));
const { DatabaseBackupProvenanceService, DATABASE_BACKUP_PROVENANCE_DOMAIN } = require(join(compiled, 'maintenance/database-backup-provenance.service.js'));
const { readPrivateJson } = require(join(compiled, 'maintenance/database-maintenance.ledger.js'));
const { DatabaseRestoreProcessService } = require(join(compiled, 'restore/database-restore-process.service.js'));
const registry = new DatabaseMaintenanceRegistry();
const revision = process.env.APP_REVISION;
assert.match(revision || '', /^[0-9a-f]{40}$/, 'An exact image APP_REVISION is required');
const source = process.env.DATABASE_MAINTENANCE_TEST_SOURCE || 'synthetic';
assert.ok(['synthetic', 'real-s3'].includes(source), 'Unknown rehearsal source');
const apps = resolve(process.env.DATABASE_MAINTENANCE_TEST_APPS_DIR || '/source/aeroCRM_services/apps');
let adminUrl;
try { adminUrl = new URL(process.env.DATABASE_MAINTENANCE_TEST_ADMIN_URL || ''); }
catch { throw new Error('Invalid isolated rehearsal admin connection'); }
assert.equal(adminUrl.hostname, '127.0.0.1');
assert.equal(adminUrl.username, 'aerocrm_cluster_admin');
assert.equal(adminUrl.pathname, '/postgres');
assert.ok(adminUrl.password);
const connection = {
	host: '127.0.0.1', port: Number(adminUrl.port || 5432), database: 'postgres',
	user: 'aerocrm_cluster_admin', password: decodeURIComponent(adminUrl.password)
};
const pg = new DatabaseRestoreProcessService();
const temporary = await mkdtemp(join(tmpdir(), 'aerocrm-maintenance-rehearsal-'));
await chmod(temporary, 0o700);
const ledgerRoot = source === 'real-s3'
	? process.env.DATABASE_MAINTENANCE_TEST_LEDGER_DIR
	: join(temporary, 'ledger');
assert.ok(ledgerRoot, 'Real S3 rehearsal requires an external ledger directory');
await mkdir(ledgerRoot, { recursive: true, mode: 0o700 });
process.env.DATABASE_MAINTENANCE_ADMIN_URL = adminUrl.toString();
process.env.DATABASE_MAINTENANCE_LEDGER_DIR = ledgerRoot;
process.env.DATABASE_MAINTENANCE_ACTOR ||= 'test:database-maintenance-all-targets';
const common = { schemaVersion: 1, expectedRevision: revision };
const fixturePassword = 'isolated-rehearsal-role-password';
let fixtureProvenance;
let fixtureStore;
let rehearsalStep = 'admission';

function service() {
	const value = new DatabaseMaintenanceService();
	if (fixtureStore) value.s3 = fixtureStore;
	if (fixtureProvenance) value.provenance = fixtureProvenance;
	return value;
}
async function invoke(request, instance = service()) {
	return instance.run(parseDatabaseMaintenanceRequest({ ...common, ...request }));
}
async function query(database, sql) { return pg.query({ ...connection, database }, sql); }
async function execute(database, sql) { return pg.executeSql({ ...connection, database }, sql); }
async function snapshot(target) {
	const tables = Object.keys(target.acl.tables).map(table => `SELECT ${literal(table)} AS name,
		json_build_object('rows',count(*)::text,'content',md5(coalesce(string_agg(md5(row_to_json(row)::text),'' ORDER BY md5(row_to_json(row)::text)),''))) AS value
		FROM ${identifier(target.schema)}.${identifier(table)} row`);
	return JSON.parse(await query(target.database, `SELECT json_object_agg(name,value)::text FROM (${tables.join(' UNION ALL ')}) snapshots;`));
}
async function seedMeaningfulRows() {
	await execute('aerocrm_identity', `INSERT INTO identity.users (id,name,password,updated_at)
		VALUES ('maintenance-fixture-user','Synthetic restore customer','unused-fixture-password-hash',now());`);
	await execute('aerocrm_notification_delivery', `INSERT INTO notification_delivery.delivery_receipts
		(id,event_id,consumer,status,delivered_at,updated_at) VALUES
		(${literal(randomUUID())},${literal(randomUUID())},'campaign-email','DELIVERED',now(),now());`);
	await execute('aerocrm_operations', `INSERT INTO operations.admin_event_logs (id,section,action,description,metadata)
		VALUES ('maintenance-fixture-audit','maintenance','rehearsal','Synthetic audit restore row','{"fixture":true}');`);
}
async function schemaBoundaryChecks() {
	const target = registry.get('identity');
	const guard = databaseMaintenanceSchemaBoundarySql(target);
	await execute(target.database, 'CREATE VIEW public.maintenance_boundary_fixture AS SELECT id FROM identity.users;');
	try { await assert.rejects(execute(target.database, guard), /only its owned schema and empty public schema/); }
	finally { await execute(target.database, 'DROP VIEW public.maintenance_boundary_fixture;'); }
	await execute(target.database, 'CREATE SCHEMA maintenance_foreign_fixture;');
	try { await assert.rejects(execute(target.database, guard), /only its owned schema and empty public schema/); }
	finally { await execute(target.database, 'DROP SCHEMA maintenance_foreign_fixture;'); }
	await execute(target.database, guard);
}
async function heldSession(target, user = connection.user, password = connection.password) {
	const child = spawn('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '--no-password',
		'-h', connection.host, '-p', String(connection.port), '-U', user, '-d', target.database], {
		env: { ...process.env, PGPASSWORD: password }, stdio: ['pipe', 'pipe', 'pipe']
	});
	const closed = new Promise(resolve => child.once('close', resolve));
	child.stderr.resume();
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Fixture session did not become ready')); }, 5000);
		child.stdout.on('data', chunk => { if (String(chunk).includes('fixture-session-ready')) { clearTimeout(timer); resolve(); } });
		child.once('error', error => { clearTimeout(timer); reject(error); });
		child.once('close', () => { clearTimeout(timer); reject(new Error('Fixture session closed too early')); });
		child.stdin.write("SELECT 'fixture-session-ready';\n");
	});
	return async () => { child.stdin.end(); await closed; };
}
async function quiescenceChecks() {
	const target = registry.get('identity');
	let close = await heldSession(target);
	try {
		let finished = false;
		const waiting = service().assertQuiescent(target, randomUUID()).then(() => { finished = true; });
		await delay(200);
		assert.equal(finished, false, 'A live foreign admin client must block admission');
		await close();
		await waiting;
	} finally { await close(); }
	close = await heldSession(target);
	try {
		await assert.rejects(service().assertQuiescent(target, randomUUID()), error => {
			assert.match(error.message, /did not quiesce within 5 seconds/);
			assert.match(error.message, /"backendType":"client backend"/);
			assert.match(error.message, /"count":1/);
			assert.ok(!error.message.includes('fixture-session-ready') && !error.message.includes(connection.user));
			return true;
		});
	} finally { await close(); }
	close = await heldSession(target, target.runtimeRole, fixturePassword);
	try {
		await service().assertQuiescent(target, null); // normal writers are allowed before fencing
		let finished = false;
		const waiting = service().assertQuiescent(target, randomUUID()).then(() => { finished = true; });
		await delay(200);
		assert.equal(finished, false, 'A live runtime client must block fenced admission');
		await close();
		await waiting;
	} finally { await close(); }
	// Deterministically observe a real autovacuum worker, rather than mocking a
	// pg_stat_activity row. Cancellation is restricted to this fixture table;
	// production maintenance never terminates a background/foreign backend.
	await execute('postgres', "ALTER SYSTEM SET autovacuum_naptime='1s';");
	await query('postgres', 'SELECT pg_reload_conf();');
	try {
		await execute(target.database, `SET ROLE ${identifier(target.migrationRole)};
		CREATE TABLE identity.maintenance_quiescence_fixture (id integer, payload text)
		WITH (autovacuum_vacuum_threshold=0,autovacuum_vacuum_scale_factor=0,
		autovacuum_vacuum_cost_delay=20,autovacuum_vacuum_cost_limit=1,
		autovacuum_analyze_threshold=1000000000);
		INSERT INTO identity.maintenance_quiescence_fixture SELECT n,repeat('x',1000) FROM generate_series(1,5000) n;
		DELETE FROM identity.maintenance_quiescence_fixture WHERE id%2=0;`);
		const matching = "datname=current_database() AND backend_type='autovacuum worker' AND query LIKE 'autovacuum:%maintenance_quiescence_fixture%'";
		let pid = null;
		for (let attempt = 0; attempt < 200 && !pid; attempt++) {
			pid = await query(target.database, `SELECT pid::text FROM pg_stat_activity WHERE ${matching} LIMIT 1;`);
			if (!pid) await delay(100);
		}
		assert.match(pid || '', /^\d+$/, 'Expected a real fixture autovacuum worker');
		let finished = false;
		const waiting = service().assertQuiescent(target, randomUUID()).then(() => { finished = true; });
		await delay(200);
		assert.equal(finished, false, 'Background worker must drain before destructive admission');
		assert.equal(await query(target.database, `SELECT pg_cancel_backend(pid)::text FROM pg_stat_activity WHERE ${matching} AND pid=${pid};`), 'true');
		await waiting;
	} finally {
		await execute(target.database, 'DROP TABLE IF EXISTS identity.maintenance_quiescence_fixture;');
		await execute('postgres', 'ALTER SYSTEM RESET autovacuum_naptime;');
		await query('postgres', 'SELECT pg_reload_conf();');
	}
}
function base(target, operationId, cluster) {
	return { target, operationId, expectedClusterSystemIdentifier: cluster };
}
function restoreRequest(target, operationId, cluster, backup, stateRevision = 0) {
	return { ...base(target, operationId, cluster), action: 'restore', backupJobId: backup.backupJobId,
		expectedArtifactSha256: backup.artifactSha256, expectedStateRevision: stateRevision,
		confirmation: `RESTORE ${target}` };
}
async function assertLogin(target, expected) {
	const roles = [target.migrationRole, target.runtimeRole, target.backupRole].map(literal).join(',');
	const value = await query('postgres', `SELECT bool_and(rolcanlogin=${expected})::text FROM pg_roles WHERE rolname IN (${roles});`);
	assert.equal(value, 'true', `Unexpected writer fence for ${target.target}`);
}

async function bootstrap() {
	// Never adopt or overwrite an existing service database, even if an operator
	// supplied a wrong URL. Real mode additionally checks the source cluster ID.
	assert.equal(await query('postgres', "SELECT count(*)::text FROM pg_database WHERE datname LIKE 'aerocrm\\_%' ESCAPE '\\' AND datname<>'aerocrm_cluster_admin';"), '0', 'Rehearsal cluster must be fresh');
	assert.equal(await query('postgres', "SELECT count(*)::text FROM pg_roles WHERE rolname LIKE 'aerocrm\\_%' ESCAPE '\\' AND rolname<>'aerocrm_cluster_admin';"), '0', 'Rehearsal service roles must be fresh');
	for (const target of registry.targets) {
		rehearsalStep = `bootstrap:${target.target}`;
		const owner = `${target.database}_db_owner`;
		await execute('postgres', `CREATE ROLE ${identifier(owner)} NOLOGIN NOINHERIT;
		${[target.migrationRole, target.runtimeRole, target.backupRole].map(role => `CREATE ROLE ${identifier(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD ${literal(fixturePassword)};`).join('\n')}`);
		await execute('postgres', `CREATE DATABASE ${identifier(target.database)} OWNER ${identifier(owner)};`);
		await execute(target.database, `REVOKE ALL ON DATABASE ${identifier(target.database)} FROM PUBLIC;
		GRANT CONNECT ON DATABASE ${identifier(target.database)} TO ${[target.migrationRole, target.runtimeRole, target.backupRole].map(identifier).join(',')};
		REVOKE ALL ON SCHEMA public FROM PUBLIC;
		CREATE SCHEMA ${identifier(target.schema)} AUTHORIZATION ${identifier(target.migrationRole)};`);
		const schemaPath = join(apps, target.target, 'prisma/schema.prisma');
		const prismaSchema = await readFile(schemaPath, 'utf8');
		const variable = /url\s*=\s*env\("([A-Z_]+)"\)/.exec(prismaSchema)?.[1];
		assert.ok(variable, `Datasource env missing for ${target.target}`);
		const url = new URL(adminUrl);
		url.username = target.migrationRole;
		url.password = fixturePassword;
		url.pathname = `/${target.database}`;
		url.search = `?schema=${target.schema}`;
		// Historical release migrations use temp tables for exact constraint
		// validation. Match their bounded migration-only capability window.
		await execute(target.database, `GRANT TEMPORARY ON DATABASE ${identifier(target.database)} TO ${identifier(target.migrationRole)};`);
		try {
			execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', schemaPath], {
				cwd: dirname(schemaPath), env: { ...process.env, [variable]: url.toString() }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000
			});
		} catch (error) {
			throw new Error(`Rehearsal migration failed for ${target.target}: ${String(error.stderr || error.message).slice(0, 1500)}`);
		} finally {
			await execute(target.database, `REVOKE TEMPORARY ON DATABASE ${identifier(target.database)} FROM ${identifier(target.migrationRole)};`);
		}
		await execute(target.database, databaseMaintenanceAclSql(target));
		url.username = target.backupRole;
		process.env[`${target.target.toUpperCase().replaceAll('-', '_')}_BACKUP_URL`] = url.toString();
	}
}

async function syntheticStorage() {
	assert.equal(connection.port, 5432, 'Synthetic pg_dump uses the service backup loopback port 5432');
	const { privateKey, publicKey } = generateKeyPairSync('ed25519');
	const privatePath = join(temporary, 'fixture-private.pem');
	const publicPath = join(temporary, 'fixture-public.json');
	const keyId = 'isolated-maintenance-fixture';
	await writeFile(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
	await writeFile(publicPath, JSON.stringify({ schemaVersion: 1, domain: DATABASE_BACKUP_PROVENANCE_DOMAIN,
		keys: [{ keyId, publicKeySpkiDerBase64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }] }), { mode: 0o600, flag: 'wx' });
	fixtureProvenance = new DatabaseBackupProvenanceService(publicPath);
	process.env.DATABASE_BACKUP_PROVENANCE_KEY_ID = keyId;
	process.env.DATABASE_BACKUP_PROVENANCE_PRIVATE_KEY_FILE = privatePath;
	const original = service().s3;
	const store = join(temporary, 'objects');
	const objectPath = key => {
		assert.match(key, /^database-backups\/[a-z-]+\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/);
		return join(store, key);
	};
	fixtureStore = {
		key: original.key.bind(original),
		async assertJobAbsent(target, jobId) {
			const directory = dirname(objectPath(this.key(target, jobId, 'manifest.json')));
			const entries = await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
			assert.equal(entries.length, 0, 'Backup fixture job must not be overwritten');
		},
		async putFile(key, path) {
			const destination = objectPath(key);
			await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
			await copyFile(path, destination, constants.COPYFILE_EXCL);
			await chmod(destination, 0o600);
		},
		async downloadToFile(key, path, maximum = Number.MAX_SAFE_INTEGER) {
			const sourcePath = objectPath(key);
			assert.ok((await stat(sourcePath)).size <= maximum, 'Fixture S3 object exceeds size limit');
			await copyFile(sourcePath, path, constants.COPYFILE_EXCL);
			await chmod(path, 0o600);
		},
		async pruneAfterSuccess() {}
	};
}

async function interruptionChecks(target, backup, cluster, phase) {
	const originalData = await snapshot(target);
	const operationId = randomUUID();
	const instance = service();
	if (phase === 'RESTORING') {
		const recreate = instance.process.recreateSchema.bind(instance.process);
		instance.process.recreateSchema = async (...args) => {
			await recreate(...args);
			throw new Error('Synthetic interruption after real schema recreation');
		};
	} else {
		const ledger = instance.ledger.bind(instance);
		instance.ledger = (...args) => {
			const value = ledger(...args);
			const append = value.append.bind(value);
			value.append = async (expected, state) => {
				const written = await append(expected, state);
				if (state.phase === phase) throw new Error(`Synthetic interruption after ${phase}`);
				return written;
			};
			return value;
		};
	}
	const request = restoreRequest(target.target, operationId, cluster, backup);
	await assert.rejects(invoke(request, instance), /Synthetic interruption/);
	const status = await invoke({ ...base(target.target, operationId, cluster), action: 'status' });
	assert.equal(status.state.phase, phase);
	await assertLogin(target, false);
	await assert.rejects(invoke(request), /revision conflict/);
	const result = await invoke({ ...base(target.target, operationId, cluster), action: 'rollback',
		expectedStateRevision: status.state.revision, confirmation: `ROLLBACK ${target.target}` });
	assert.equal(result.state.phase, 'ROLLED_BACK');
	assert.deepEqual(await snapshot(target), originalData, `Rollback changed data for ${target.target}`);
	await assertLogin(target, true);
	const replay = await invoke({ ...base(target.target, operationId, cluster), action: 'rollback',
		expectedStateRevision: 0, confirmation: `ROLLBACK ${target.target}` });
	assert.equal(replay.receiptSha256, result.receiptSha256);
}

async function commitBoundaryCheck(target, backup, cluster) {
	const operationId = randomUUID();
	const instance = service();
	const release = instance.releaseFence.bind(instance);
	instance.releaseFence = async (...args) => { await release(...args); throw new Error('Synthetic interruption after LOGIN'); };
	const request = restoreRequest(target.target, operationId, cluster, backup);
	await assert.rejects(invoke(request, instance), /Synthetic interruption after LOGIN/);
	const status = await invoke({ ...base(target.target, operationId, cluster), action: 'status' });
	assert.equal(status.state.phase, 'COMMITTING');
	await assertLogin(target, true);
	const marker = `maintenance-after-login-${randomUUID()}`;
	await pg.executeSql({ ...connection, database: target.database, user: target.runtimeRole, password: fixturePassword },
		`INSERT INTO identity.users (id,name,password,updated_at) VALUES (${literal(marker)},'Post LOGIN write','unused-fixture-password-hash',now());`);
	await assert.rejects(invoke({ ...base(target.target, operationId, cluster), action: 'rollback',
		expectedStateRevision: status.state.revision, confirmation: `ROLLBACK ${target.target}` }), /current incomplete operation/);
	const resumed = await invoke({ ...request, expectedStateRevision: status.state.revision });
	assert.equal(resumed.state.phase, 'COMMITTED');
	assert.equal(await query(target.database, `SELECT count(*)::text FROM identity.users WHERE id=${literal(marker)};`), '1',
		'Commit resume must preserve writes accepted after LOGIN');
}

try {
	const inventory = await invoke({ action: 'inventory' });
	const cluster = inventory.clusterSystemIdentifier;
	let jobs;
	if (source === 'real-s3') {
		jobs = await readPrivateJson(process.env.DATABASE_MAINTENANCE_TEST_JOBS_FILE || '', 16384);
		assert.equal(jobs.schemaVersion, 1);
		assert.match(jobs.sourceClusterSystemIdentifier || '', /^\d{10,30}$/);
		assert.notEqual(jobs.sourceClusterSystemIdentifier, cluster, 'Rehearsal must never restore the source cluster');
		assert.deepEqual(Object.keys(jobs.targets).sort(), registry.targets.map(target => target.target).sort());
		for (const id of Object.values(jobs.targets)) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
	}
	process.env.DATABASE_MAINTENANCE_REHEARSAL_CLUSTER = cluster;
	await bootstrap();
	if (source === 'synthetic') {
		await syntheticStorage();
		await seedMeaningfulRows();
		await schemaBoundaryChecks();
		await quiescenceChecks();
	}
	const results = [];
	const backups = new Map();
	for (const target of registry.targets) {
		rehearsalStep = `restore:${target.target}`;
		const originalData = source === 'synthetic' ? await snapshot(target) : null;
		const jobId = source === 'synthetic' ? randomUUID() : jobs.targets[target.target];
		if (source === 'synthetic') {
			const created = await invoke({ ...base(target.target, jobId, cluster), action: 'backup' });
			await assert.rejects(invoke({ ...base(target.target, jobId, cluster), action: 'backup' }), /already admitted/);
			if (target.target === 'identity') {
				const signatureFile = join(temporary, 'invalid-signature.json');
				const changed = structuredClone(created.backupProvenance);
				changed.signatureEd25519Base64 = Buffer.alloc(64).toString('base64');
				await writeFile(signatureFile, JSON.stringify(changed), { mode: 0o600, flag: 'wx' });
				const malicious = service();
				malicious.s3 = { ...fixtureStore, async downloadToFile(key, path, maximum) {
					if (key === created.provenanceObjectKey) { await copyFile(signatureFile, path, constants.COPYFILE_EXCL); return; }
					return fixtureStore.downloadToFile(key, path, maximum);
				} };
				await assert.rejects(invoke({ action: 'inspect', target: target.target, operationId: randomUUID(), backupJobId: jobId }, malicious), /signature/);
				await assertLogin(target, true);
			}
		}
		const backup = await invoke({ action: 'inspect', target: target.target, operationId: randomUUID(), backupJobId: jobId });
		const otherTarget = registry.targets.find(entry => entry.target !== target.target);
		await assert.rejects(invoke({ action: 'inspect', target: otherTarget.target, operationId: randomUUID(), backupJobId: jobId }));
		backups.set(target.target, backup);
		const wrongHash = restoreRequest(target.target, randomUUID(), cluster, backup);
		wrongHash.expectedArtifactSha256 = backup.artifactSha256 === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
		await assert.rejects(invoke(wrongHash), /source changed/);
		await assertLogin(target, true);
		const request = restoreRequest(target.target, randomUUID(), cluster, backup);
		const result = await invoke(request);
		assert.equal(result.state.phase, 'COMMITTED');
		if (originalData) assert.deepEqual(await snapshot(target), originalData, `Restore changed fixture data for ${target.target}`);
		assert.match(result.state.verificationSha256, /^[0-9a-f]{64}$/);
		const replay = await invoke(request);
		assert.equal(replay.receiptSha256, result.receiptSha256);
		await assertLogin(target, true);
		results.push({ target: target.target, operationId: result.operationId, backupJobId: jobId,
			phase: result.state.phase, receiptSha256: result.receiptSha256, verificationSha256: result.state.verificationSha256 });
		process.stderr.write(`Rehearsed ${target.target}: COMMITTED\n`);
	}
	if (source === 'synthetic') {
		await interruptionChecks(registry.get('identity'), backups.get('identity'), cluster, 'FENCED');
		await interruptionChecks(registry.get('identity'), backups.get('identity'), cluster, 'SAFETY_SAVED');
		for (const name of ['notification-delivery', 'operations', 'crm-sales'])
			await interruptionChecks(registry.get(name), backups.get(name), cluster, 'RESTORING');
		await commitBoundaryCheck(registry.get('identity'), backups.get('identity'), cluster);
	}
	process.stdout.write(`${JSON.stringify({ schemaVersion: 1, source, revision, clusterSystemIdentifier: cluster,
		targets: results, interruptedRollbackChecks: source === 'synthetic' ? 5 : 0,
		commitBoundaryChecked: source === 'synthetic', schemaBoundaryChecked: source === 'synthetic',
		quiescenceChecked: source === 'synthetic' })}\n`);
} catch (error) {
	if (source !== 'real-s3') throw error;
	// Restore errors can include a rejected business row. Real-data rehearsal
	// exposes only the stage; its external receipt ledger remains authoritative.
	process.stderr.write(`${JSON.stringify({ error: 'Real S3 rehearsal failed; inspect its private ledger', stage: rehearsalStep })}\n`);
	process.exitCode = 1;
} finally {
	await rm(temporary, { recursive: true, force: true });
}
