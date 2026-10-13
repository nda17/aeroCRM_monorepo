import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATABASE_BACKUP_PROVENANCE_TARGETS } from './database-backup.contract';
import {
	DatabaseBackupMigrationManifestService,
	parseDatabaseBackupMigrationManifests
} from './database-backup-migration-manifest.service';

function databaseRows() {
	const service = new DatabaseBackupMigrationManifestService();
	return service.get('identity').migrations.map(migration => ({
		migrationName: migration.name,
		checksum: migration.checksum,
		finished: true,
		rolledBack: false,
		appliedStepsCount: 1
	}));
}

function dumpLedger(rows: ReturnType<typeof databaseRows>, schema = 'identity') {
	const columns = [
		'id',
		'checksum',
		'finished_at',
		'migration_name',
		'logs',
		'rolled_back_at',
		'started_at',
		'applied_steps_count'
	];
	const body = rows.map((row, index) => [
		`migration-${index + 1}`,
		row.checksum,
		row.finished ? '2026-10-13 10:00:00+00' : '\\N',
		row.migrationName,
		'\\N',
		row.rolledBack ? '2026-10-13 10:01:00+00' : '\\N',
		'2026-10-13 09:59:00+00',
		String(row.appliedStepsCount)
	].join('\t'));
	return [
		`COPY "${schema}"."_prisma_migrations" (${columns.map(column => `"${column}"`).join(', ')}) FROM stdin;`,
		...body,
		'\\.'
	].join('\n');
}

function sourceManifest() {
	return JSON.parse(
		readFileSync(
			join(
				process.cwd(),
				'backup-manifests',
				'database-backup-migrations.json'
			),
			'utf8'
		)
	) as {
		schemaVersion: number;
		targets: Record<
			string,
			{
				manifestSha256: string;
				migrations: Array<{ name: string; checksum: string }>;
			}
		>;
	};
}

describe('DatabaseBackupMigrationManifestService', () => {
	it('loads the canonical migration inventory for every backup target', () => {
		const service = new DatabaseBackupMigrationManifestService();
		const manifests = parseDatabaseBackupMigrationManifests(sourceManifest());

		expect(Object.keys(manifests).sort()).toEqual(
			[...DATABASE_BACKUP_PROVENANCE_TARGETS].sort()
		);
		expect(manifests.identity.migrations.length).toBeGreaterThan(0);
		expect(service.get('identity')).toEqual(manifests.identity);
		expect(Object.isFrozen(manifests.identity.migrations)).toBe(true);
	});

	it.each([
		[
			'duplicate migration names',
			(manifest: ReturnType<typeof sourceManifest>) => {
				const migrations = manifest.targets.identity.migrations;
				migrations.push({ ...migrations[0] });
			}
		],
		[
			'unsorted migration names',
			(manifest: ReturnType<typeof sourceManifest>) => {
				manifest.targets.identity.migrations.reverse();
			}
		],
		[
			'invalid migration checksum',
			(manifest: ReturnType<typeof sourceManifest>) => {
				manifest.targets.identity.migrations[0].checksum = 'bad';
			}
		],
		[
			'invalid manifest digest',
			(manifest: ReturnType<typeof sourceManifest>) => {
				manifest.targets.identity.manifestSha256 = '0'.repeat(64);
			}
		]
	])('rejects %s in the trusted inventory', (_label, mutate) => {
		const manifest = sourceManifest();
		mutate(manifest);
		expect(() => parseDatabaseBackupMigrationManifests(manifest)).toThrow();
	});

	it('checks the checked-in migration inventory against each service migration directory', () => {
		const generator = join(
			__dirname,
			'..',
			'..',
			'scripts',
			'database-backup-migration-manifests.mjs'
		);
		const result = spawnSync(process.execPath, [generator, '--check'], {
			cwd: process.cwd(),
			encoding: 'utf8'
		});

		expect(result.status).toBe(0);
		expect(result.stderr).toBe('');
	});

	it('accepts exact successful DB and dump migration ledgers', () => {
		const service = new DatabaseBackupMigrationManifestService();
		const rows = databaseRows();

		expect(() => service.assertDatabaseLedger('identity', JSON.stringify(rows))).not.toThrow();
		expect(() => service.assertDumpLedger('identity', 'identity', dumpLedger(rows))).not.toThrow();
	});

	it.each([
		['missing migration', (rows: ReturnType<typeof databaseRows>) => rows.pop()],
		['duplicate successful migration', (rows: ReturnType<typeof databaseRows>) => rows.push({ ...rows[0] })],
		['unfinished migration', (rows: ReturnType<typeof databaseRows>) => { rows[0].finished = false; }],
		['rolled-back migration', (rows: ReturnType<typeof databaseRows>) => { rows[0].rolledBack = true; }],
		['checksum drift', (rows: ReturnType<typeof databaseRows>) => { rows[0].checksum = '0'.repeat(64); }]
	])('rejects %s in DB and dump ledgers', (_label, mutate) => {
		const service = new DatabaseBackupMigrationManifestService();
		const rows = databaseRows();
		mutate(rows);
		const json = JSON.stringify(rows);
		const dump = dumpLedger(rows);

		expect(() => service.assertDatabaseLedger('identity', json)).toThrow();
		expect(() => service.assertDumpLedger('identity', 'identity', dump)).toThrow();
	});

	it.each([
		['missing COPY block', (dump: string) => dump.replace(/^COPY .*\n/m, '')],
		['duplicate COPY block', (dump: string) => `${dump}\n${dump}`],
		['unfinished COPY block', (dump: string) => dump.replace(/\\\.$/, '')]
	])('rejects %s in a source dump', (_label, mutate) => {
		const service = new DatabaseBackupMigrationManifestService();
		const dump = mutate(dumpLedger(databaseRows()));
		expect(() => service.assertDumpLedger('identity', 'identity', dump)).toThrow();
	});
});
