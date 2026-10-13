import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	databaseMaintenanceAclSql,
	DatabaseMaintenanceRegistry,
	sqlIdentifier
} from './database-maintenance.registry';

describe('DatabaseMaintenanceRegistry', () => {
	it('loads all owned targets and verifies their canonical ACL digests', () => {
		const registry = new DatabaseMaintenanceRegistry();

		expect(registry.targets).toHaveLength(12);
		for (const target of registry.targets) {
			const serviceName = target.target.replaceAll('-', '_');
			expect(target.database).toBe(`aerocrm_${serviceName}`);
			expect(target.schema).toBe(serviceName);
			expect(target.migrationRole).toBe(`${target.database}_migration`);
			expect(target.runtimeRole).toBe(`${target.database}_runtime`);
			expect(target.backupRole).toBe(`${target.database}_backup`);
			expect(target.acl.service).toBe(target.target);
			expect(target.acl.version).toBe(1);
		}
		expect(registry.get('notification-delivery')).toMatchObject({
			database: 'aerocrm_notification_delivery',
			schema: 'notification_delivery',
			acl: { service: 'notification-delivery', version: 1 }
		});
		expect(registry.get('notification-delivery').acl.tables).not.toHaveProperty(
			'service_identity'
		);
		expect(() => registry.get('unknown-service')).toThrow(
			'Unknown maintenance target'
		);
	});

	it('rejects an ACL digest mismatch and incomplete target inventories', async () => {
		const path = join(
			await mkdtemp(join(tmpdir(), 'maintenance-registry-')),
			'registry.json'
		);
		const manifestPath = join(
			process.cwd(),
			'backup-manifests',
			'database-maintenance-registry.json'
		);
		const original = JSON.parse(await readFile(manifestPath, 'utf8')) as {
			schemaVersion: number;
			targets: Record<string, { aclSha256: string; acl: unknown }>;
		};
		const source = JSON.parse(JSON.stringify(original)) as typeof original;
		source.targets.identity.aclSha256 = '0'.repeat(64);
		await writeFile(path, JSON.stringify(source), { mode: 0o600 });
		try {
			expect(() => new DatabaseMaintenanceRegistry(path)).toThrow(
				'Maintenance registry identity or ACL hash mismatch'
			);
			const incomplete = JSON.parse(
				JSON.stringify(original)
			) as typeof original;
			delete incomplete.targets.identity;
			await writeFile(path, JSON.stringify(incomplete), { mode: 0o600 });
			expect(() => new DatabaseMaintenanceRegistry(path)).toThrow(
				'Maintenance registry must contain exactly twelve service-owned targets'
			);
		} finally {
			await rm(join(path, '..'), { recursive: true, force: true });
		}
	});

	it('quotes only safe identifiers and generates explicit grants without blanket runtime access', () => {
		const target = new DatabaseMaintenanceRegistry().get('identity');
		const sql = databaseMaintenanceAclSql(target);

		expect(sql).toContain(
			'GRANT SELECT ON TABLE "identity"."users" TO "aerocrm_identity_backup"'
		);
		expect(sql).toContain(
			'FROM PUBLIC, "aerocrm_identity_runtime", "aerocrm_identity_backup"'
		);
		expect(sql).not.toContain('GRANT ALL ON ALL TABLES');
		expect(() => sqlIdentifier('users; DROP SCHEMA identity')).toThrow(
			'Unsafe maintenance SQL identifier'
		);
	});
});
