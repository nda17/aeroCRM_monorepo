import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { collectTarget } from './database-restore-migration-manifests.mjs';

// An independent signing registry, not the destructive restore allowlist.
export const TARGETS = [
	'notification-delivery',
	'campaigns',
	'reporting',
	'billing',
	'identity',
	'platform',
	'support',
	'operations',
	'crm-access',
	'crm-intake',
	'crm-customers',
	'crm-sales'
];
const OUTPUT_PATH = join(
	dirname(dirname(fileURLToPath(import.meta.url))),
	'backup-manifests',
	'database-backup-migrations.json'
);
const REGISTRY_PATH = join(dirname(OUTPUT_PATH), 'database-maintenance-registry.json');

export const generate = async () => {
	const targets = {};
	for (const target of TARGETS)
		targets[target] = await collectTarget(target);
	return `${JSON.stringify({ schemaVersion: 1, targets }, null, '\t')}\n`;
};

export const generateRegistry = async () => {
	const targets = {};
	for (const target of TARGETS) {
		const schema = target.replaceAll('-', '_');
		const database = `aerocrm_${schema}`;
		const acl = JSON.parse(await readFile(join(
			dirname(dirname(dirname(fileURLToPath(import.meta.url)))), target,
			'prisma', 'database-access.json'
		), 'utf8'));
		if (acl.version !== 1 || acl.service !== target)
			throw new Error(`Invalid service-owned access contract: ${target}`);
		targets[target] = {
			database, schema,
			migrationRole: `${database}_migration`, runtimeRole: `${database}_runtime`,
			backupRole: `${database}_backup`,
			aclSha256: createHash('sha256').update(JSON.stringify(acl)).digest('hex'), acl
		};
	}
	return `${JSON.stringify({ schemaVersion: 1, targets }, null, '\t')}\n`;
};

const run = async () => {
	const args = process.argv.slice(2);
	if (
		args.length > 1 ||
		(args[0] && !['--check', '--write'].includes(args[0]))
	) {
		throw new Error(
			'Usage: node database-backup-migration-manifests.mjs [--check|--write]'
		);
	}
	for (const [path, output] of [[OUTPUT_PATH, await generate()], [REGISTRY_PATH, await generateRegistry()]]) {
		if (args[0] === '--write') {
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, output, { encoding: 'utf8', mode: 0o644 });
			continue;
		}
		let current;
		try { current = await readFile(path, 'utf8'); }
		catch { throw new Error(`Backup/maintenance inventory missing; run ${process.argv[1]} --write`); }
		if (current !== output)
			throw new Error(`Backup/maintenance inventory drift detected; run ${process.argv[1]} --write and commit the result`);
	}
};

if (
	process.argv[1] &&
	pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
	await run();
}
