import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readdir, realpath, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { maintenanceHash } from './database-maintenance.registry';

export interface DatabaseMaintenanceBinding {
	schemaVersion: 1;
	operationId: string;
	target: string;
	clusterSystemIdentifier: string;
	revision: string;
	actor: string;
	backupJobId: string;
	artifactSha256: string;
	provenanceSha256: string;
	migrationManifestSha256: string;
	aclSha256: string;
}
export type DatabaseMaintenancePhase =
	'PREPARED' | 'FENCING' | 'FENCED' | 'SAFETY_SAVED' | 'RESTORING' |
	'VERIFIED' | 'COMMITTING' | 'COMMITTED' | 'ROLLING_BACK' | 'ROLLBACK_VERIFIED' |
	'ROLLBACK_COMMITTING' | 'ROLLED_BACK';
export interface DatabaseMaintenanceState {
	revision: number;
	phase: DatabaseMaintenancePhase;
	safetySha256?: string;
	safetySize?: number;
	identity?: string | null;
	verificationSha256?: string;
}
interface Receipt {
	schemaVersion: 1;
	actor: string;
	bindingSha256: string;
	previousSha256: string | null;
	createdAt: string;
	state: DatabaseMaintenanceState;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export async function readPrivateJson(path: string, maxBytes = 262144, maxLinks = 1): Promise<unknown> {
	if (!isAbsolute(path) || await realpath(path) !== path)
		throw new Error('Maintenance file must be an absolute path without symbolic links');
	const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const info = await file.stat();
		if (!info.isFile() || info.nlink > maxLinks || info.size > maxBytes || (info.mode & 0o077) !== 0)
			throw new Error('Maintenance file must be private, bounded, and unlinked');
		return JSON.parse(await file.readFile('utf8')) as unknown;
	} finally { await file.close(); }
}
export async function syncDirectory(path: string): Promise<void> {
	const directory = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try { await directory.sync(); } finally { await directory.close(); }
}
async function writeImmutable(path: string, value: unknown): Promise<void> {
	const temporary = join(dirname(path), `.pending-${randomUUID()}`);
	const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
	try {
		await file.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
		await file.sync();
	} finally { await file.close(); }
	try {
		// link is atomic and refuses to replace an existing immutable receipt.
		await link(temporary, path);
		await syncDirectory(dirname(path));
	} finally {
		await unlink(temporary);
		await syncDirectory(dirname(path));
	}
}
async function cleanupPending(directory: string): Promise<void> {
	for (const name of await readdir(directory)) {
		if (!/^\.pending-[0-9a-f-]{36}$/.test(name)) continue;
		const path = join(directory, name);
		const info = await lstat(path);
		if (!info.isFile() || info.isSymbolicLink() || info.nlink > 2 || (info.mode & 0o077) !== 0)
			throw new Error('Maintenance pending file is unsafe');
		await unlink(path);
	}
	await syncDirectory(directory);
}
async function privateDirectory(path: string): Promise<void> {
	await mkdir(path, { mode: 0o700 }).catch(error => {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
	});
	const info = await lstat(path);
	if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || await realpath(path) !== path)
		throw new Error('Maintenance ledger directory is not private');
}

// The append-only receipt chain is authoritative. There is no mutable DB row or
// state pointer that can be lost while restoring the Operations schema itself.
export class DatabaseMaintenanceLedger {
	readonly directory: string;
	readonly receiptsDirectory: string;
	private binding: DatabaseMaintenanceBinding | null = null;
	constructor(readonly root: string, readonly cluster: string, readonly operationId: string, readonly actor = 'unattributed') {
		if (!isAbsolute(root) || !/^\d{10,30}$/.test(cluster) || !uuid.test(operationId))
			throw new Error('Invalid maintenance ledger location');
		this.directory = join(root, cluster, operationId);
		this.receiptsDirectory = join(this.directory, 'receipts');
	}
	async initialize(): Promise<void> {
		await privateDirectory(this.root);
		await privateDirectory(join(this.root, this.cluster));
		await privateDirectory(this.directory);
		await privateDirectory(this.receiptsDirectory);
		await cleanupPending(this.directory);
		await cleanupPending(this.receiptsDirectory);
		await syncDirectory(this.directory);
	}
	async bind(binding: DatabaseMaintenanceBinding): Promise<void> {
		await this.assertUnusedBy('backup-claim.json');
		const path = join(this.directory, 'binding.json');
		try { await writeImmutable(path, binding); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
		const existing = await readPrivateJson(path, 262144, 2) as DatabaseMaintenanceBinding;
		if (JSON.stringify(existing) !== JSON.stringify({ ...binding, actor: existing.actor }))
			throw new Error('Maintenance operation id is bound to another source, target, cluster, or revision');
		this.binding = existing;
	}
	async claimBackup(target: string, revision: string): Promise<void> {
		await this.assertUnusedBy('binding.json');
		try {
			await writeImmutable(join(this.directory, 'backup-claim.json'), {
				schemaVersion: 1, operationId: this.operationId, clusterSystemIdentifier: this.cluster,
				target, revision, actor: this.actor, createdAt: new Date().toISOString()
			});
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'EEXIST')
				throw new Error('Backup operation was already admitted; inspect its S3 job or use a new operation id');
			throw error;
		}
	}
	async recordBackup(result: unknown): Promise<void> {
		await writeImmutable(join(this.directory, 'backup-result.json'), result);
	}
	private async assertUnusedBy(name: string): Promise<void> {
		const exists = await lstat(join(this.directory, name)).then(() => true, error => {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
			throw error;
		});
		if (exists) throw new Error('Maintenance operation id is already used by another action');
	}
	async readBinding(): Promise<DatabaseMaintenanceBinding> {
		const value = await readPrivateJson(join(this.directory, 'binding.json'), 262144, 2) as DatabaseMaintenanceBinding;
		if (value.schemaVersion !== 1 || value.operationId !== this.operationId || value.clusterSystemIdentifier !== this.cluster)
			throw new Error('Maintenance ledger binding is invalid');
		this.binding = value;
		return value;
	}
	async read(): Promise<{ state: DatabaseMaintenanceState | null; receiptSha256: string | null }> {
		if (!this.binding) await this.readBinding();
		const files = (await readdir(this.receiptsDirectory)).filter(name => !/^\.pending-[0-9a-f-]{36}$/.test(name)).sort();
		if (files.length > 100 || files.some(name => !/^\d{8}\.json$/.test(name)))
			throw new Error('Maintenance receipt inventory is invalid');
		let state: DatabaseMaintenanceState | null = null;
		let previous: string | null = null;
		for (const [index, name] of files.entries()) {
			if (name !== `${String(index + 1).padStart(8, '0')}.json`)
				throw new Error('Maintenance receipt sequence has a gap');
			const receipt = await readPrivateJson(join(this.receiptsDirectory, name), 262144, 2) as Receipt;
			if (receipt.schemaVersion !== 1 || typeof receipt.actor !== 'string' || receipt.bindingSha256 !== maintenanceHash(JSON.stringify(this.binding)) ||
				receipt.previousSha256 !== previous || receipt.state.revision !== index + 1 || !receipt.state.phase)
				throw new Error('Maintenance receipt chain is invalid');
			state = receipt.state;
			previous = maintenanceHash(JSON.stringify(receipt));
		}
		return { state, receiptSha256: previous };
	}
	async append(expectedRevision: number, state: Omit<DatabaseMaintenanceState, 'revision'>): Promise<DatabaseMaintenanceState> {
		const prior = await this.read();
		if ((prior.state?.revision ?? 0) !== expectedRevision)
			throw new Error('Maintenance state revision conflict');
		const next = { ...state, revision: expectedRevision + 1 };
		const receipt: Receipt = {
			schemaVersion: 1, actor: this.actor, bindingSha256: maintenanceHash(JSON.stringify(this.binding)),
			previousSha256: prior.receiptSha256, createdAt: new Date().toISOString(), state: next
		};
		await writeImmutable(join(this.receiptsDirectory, `${String(next.revision).padStart(8, '0')}.json`), receipt);
		return next;
	}
}
