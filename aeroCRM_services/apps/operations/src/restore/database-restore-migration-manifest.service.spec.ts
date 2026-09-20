import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseRestoreMigrationManifestService } from './database-restore-migration-manifest.service';

const manifestPath = join(
	__dirname,
	'..',
	'..',
	'restore-manifests',
	'database-restore-migrations.json'
);
const generatorPath = join(
	__dirname,
	'..',
	'..',
	'scripts',
	'database-restore-migration-manifests.mjs'
);

describe('DatabaseRestoreMigrationManifestService', () => {
	it('does not load an obsolete restore manifest at startup', () => {
		const service = new DatabaseRestoreMigrationManifestService();

		expect(existsSync(manifestPath)).toBe(false);
		expect(() => service.get('reporting')).toThrow('unsupported');
		expect(() => service.sha256('reporting')).toThrow('unsupported');
	});

	it.each(['--check', '--write'])(
		'rejects restore manifest generation with %s',
		argument => {
			const result = spawnSync(process.execPath, [generatorPath, argument], {
				encoding: 'utf8'
			});

			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain(
				'Database restore migration manifests are unsupported'
			);
			expect(existsSync(manifestPath)).toBe(false);
		}
	);
});
