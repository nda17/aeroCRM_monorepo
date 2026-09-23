import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This targets only the explicitly named Colima test context/container. It
// refuses existing DBs/roles and never reads or prints application secrets.
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const envFile = resolve(root, '.deploy/workspace-closure-test.env');
const suffix = process.env.WORKSPACE_CLOSURE_TEST_SUFFIX?.trim() || 'final';
assert.match(suffix, /^[a-z0-9]{1,12}$/);
const context = 'colima-aerocrm-commerce-test';
const container = 'aerocrm-commerce-pg18';
const docker = (args, input) => {
	const result = spawnSync('docker', ['--context', context, ...args], { encoding: 'utf8', input, timeout: 20000 });
	if (result.status !== 0) throw new Error('The explicit local PostgreSQL 18 Docker context operation failed');
	return result.stdout.trim();
};
const psql = (database, sql) => docker(['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database], sql);
assert.equal(docker(['inspect', '--format', '{{.State.Running}}', container]), 'true');
assert.equal(docker(['inspect', '--format', '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}', container]), '55438');

const services = [
	['CRM_ACCESS', 'crm_access'],
	['IDENTITY', 'identity'],
	['BILLING', 'billing'],
	['CRM_CUSTOMERS', 'crm_customers'],
	['CRM_SALES', 'crm_sales'],
	['CRM_INTAKE', 'crm_intake'],
	['NOTIFICATION_DELIVERY', 'notification_delivery']
];
const ident = value => `"${value.replaceAll('"', '""')}"`;
const literal = value => `'${value.replaceAll("'", "''")}'`;
const rows = services.map(([prefix, schema]) => {
	const stem = `aerocrm_${schema}_closure_test_${suffix}`;
	return {
		prefix,
		schema,
		database: `aerocrm_${schema}_test_closure_${suffix}`,
		migrationRole: `${stem}_migration`,
		runtimeRole: `${stem}_runtime`,
		backupRole: `${stem}_backup`
	};
});

try {
	psql('postgres', `DO $fixture$ BEGIN
		IF EXISTS (SELECT 1 FROM pg_database WHERE datname IN (${rows.map(row => `'${row.database}'`).join(',')}))
		OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ANY(ARRAY[${rows.flatMap(row => [row.migrationRole, row.runtimeRole, row.backupRole]).map(role => `'${role}'`).join(',')}]::text[]))
		THEN RAISE EXCEPTION 'workspace closure fixture name already exists'; END IF;
	END $fixture$;`);
	const fileCheck = spawnSync('test', ['!', '-e', envFile], { encoding: 'utf8' });
	assert.equal(fileCheck.status, 0, 'Private fixture manifest already exists; preserve it and choose a fresh suffix');
	const manifest = ['WORKSPACE_CLOSURE_INTEGRATION_ALLOW_MUTATION=true'];
	for (const row of rows) {
		const passwords = [randomBytes(32).toString('hex'), randomBytes(32).toString('hex'), randomBytes(32).toString('hex')];
		for (const [role, password] of [[row.migrationRole, passwords[0]], [row.runtimeRole, passwords[1]], [row.backupRole, passwords[2]]]) {
			psql('postgres', `CREATE ROLE ${ident(role)} LOGIN PASSWORD ${literal(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;`);
		}
		psql('postgres', `CREATE DATABASE ${ident(row.database)} OWNER ${ident(row.migrationRole)}; REVOKE ALL ON DATABASE ${ident(row.database)} FROM PUBLIC; GRANT CONNECT ON DATABASE ${ident(row.database)} TO ${ident(row.runtimeRole)}, ${ident(row.backupRole)};`);
		psql(row.database, `CREATE SCHEMA ${ident(row.schema)} AUTHORIZATION ${ident(row.migrationRole)}; REVOKE ALL ON SCHEMA ${ident(row.schema)} FROM PUBLIC; GRANT USAGE ON SCHEMA ${ident(row.schema)} TO ${ident(row.runtimeRole)}, ${ident(row.backupRole)}; CREATE SCHEMA foreign_service_guard AUTHORIZATION ${ident(row.migrationRole)}; CREATE TABLE foreign_service_guard.sentinel (id integer PRIMARY KEY); REVOKE ALL ON SCHEMA foreign_service_guard FROM PUBLIC, ${ident(row.runtimeRole)}, ${ident(row.backupRole)};`);
		const url = (role, password) => {
			const value = new URL(`postgresql://${encodeURIComponent(role)}:${encodeURIComponent(password)}@127.0.0.1:55438/${row.database}`);
			value.searchParams.set('schema', row.schema);
			return value.toString();
		};
		manifest.push(`${row.prefix}_TEST_DATABASE_URL=${url(row.runtimeRole, passwords[1])}`);
		manifest.push(`${row.prefix}_TEST_MIGRATION_DATABASE_URL=${url(row.migrationRole, passwords[0])}`);
		manifest.push(`${row.prefix}_TEST_RUNTIME_ROLE=${row.runtimeRole}`);
		manifest.push(`${row.prefix}_TEST_MIGRATION_ROLE=${row.migrationRole}`);
		manifest.push(`${row.prefix}_TEST_BACKUP_ROLE=${row.backupRole}`);
	}
	writeFileSync(envFile, `${manifest.join('\n')}\n`, { mode: 0o600, flag: 'wx' });
	chmodSync(envFile, 0o600);
	console.log(`Created seven isolated PostgreSQL 18 fixture databases. Connection values are stored in private manifest ${envFile}.`);
} catch (error) {
	console.error(`Fixture setup stopped: ${String(error?.message ?? error).replace(/postgres(?:ql)?:\/\/[^\s]*/gi, '[database-url]')}`);
	process.exitCode = 1;
}
