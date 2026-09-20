import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MIGRATION_NAME_PATTERN = /^[0-9]{14}_[a-z0-9_]+$/;
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const OPERATIONS_DIRECTORY = dirname(SCRIPT_DIRECTORY);
const APPS_DIRECTORY = dirname(OPERATIONS_DIRECTORY);

const sha256 = value => createHash('sha256').update(value).digest('hex');

export const collectTarget = async target => {
	if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(target)) {
		throw new Error('Migration manifest target is invalid');
	}
	const migrationsDirectory = join(
		APPS_DIRECTORY,
		target,
		'prisma',
		'migrations'
	);
	const directoryMetadata = await lstat(migrationsDirectory);
	if (
		!directoryMetadata.isDirectory() ||
		directoryMetadata.isSymbolicLink()
	) {
		throw new Error(
			`${target} migrations path is not a trusted directory`
		);
	}
	const entries = await readdir(migrationsDirectory, {
		withFileTypes: true
	});
	const migrationNames = entries
		.filter(entry => entry.isDirectory())
		.map(entry => entry.name)
		.sort();
	if (migrationNames.length === 0) {
		throw new Error(`${target} has no Prisma migrations`);
	}
	for (const entry of entries) {
		if (entry.isSymbolicLink()) {
			throw new Error(`${target} migrations contain a symbolic link`);
		}
		if (
			!entry.isDirectory() &&
			!(entry.isFile() && entry.name === 'migration_lock.toml')
		) {
			throw new Error(
				`${target} migrations contain an unexpected non-directory entry`
			);
		}
	}
	const migrations = [];
	for (const name of migrationNames) {
		if (!MIGRATION_NAME_PATTERN.test(name)) {
			throw new Error(`${target} has an unsafe migration name: ${name}`);
		}
		const path = join(migrationsDirectory, name, 'migration.sql');
		const metadata = await lstat(path);
		if (!metadata.isFile() || metadata.isSymbolicLink()) {
			throw new Error(
				`${target}/${name}/migration.sql is not a trusted file`
			);
		}
		migrations.push({
			name,
			checksum: sha256(await readFile(path))
		});
	}
	const canonical = {
		schemaVersion: 1,
		target,
		migrations
	};
	return {
		manifestSha256: sha256(JSON.stringify(canonical)),
		migrations
	};
};

export const generate = async () => {
	throw new Error('Database restore migration manifests are unsupported');
};

const run = async () => {
	await generate();
};

if (
	process.argv[1] &&
	pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
	await run();
}
