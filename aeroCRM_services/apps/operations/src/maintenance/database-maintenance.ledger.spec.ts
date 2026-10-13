import { chmod, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	DatabaseMaintenanceLedger,
	type DatabaseMaintenanceBinding
} from './database-maintenance.ledger';

const OPERATION_ID = '123e4567-e89b-42d3-a456-426614174000';
const CLUSTER = '12345678901234567890';

function binding(): DatabaseMaintenanceBinding {
	return {
		schemaVersion: 1,
		operationId: OPERATION_ID,
		target: 'identity',
		clusterSystemIdentifier: CLUSTER,
		revision: 'a'.repeat(40),
		actor: 'admin-1',
		backupJobId: 'backup-job-1',
		artifactSha256: 'b'.repeat(64),
		provenanceSha256: 'c'.repeat(64),
		migrationManifestSha256: 'd'.repeat(64),
		aclSha256: 'e'.repeat(64)
	};
}

describe('DatabaseMaintenanceLedger', () => {
	let root: string;
	let ledger: DatabaseMaintenanceLedger;

	beforeEach(async () => {
		root = await realpath(await mkdtemp(join(tmpdir(), 'maintenance-ledger-')));
		await chmod(root, 0o700);
		ledger = new DatabaseMaintenanceLedger(
			root,
			CLUSTER,
			OPERATION_ID,
			'admin-1'
		);
		await ledger.initialize();
		await ledger.bind(binding());
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it('persists an immutable binding and a hash-linked revision sequence', async () => {
		await expect(ledger.read()).resolves.toEqual({
			state: null,
			receiptSha256: null
		});
		await expect(ledger.append(0, { phase: 'PREPARED' })).resolves.toEqual({
			revision: 1,
			phase: 'PREPARED'
		});
		const first = await ledger.read();
		expect(first.receiptSha256).toMatch(/^[0-9a-f]{64}$/);

		await expect(
			ledger.append(1, { phase: 'SAFETY_SAVED', safetySha256: 'f'.repeat(64) })
		).resolves.toMatchObject({ revision: 2, phase: 'SAFETY_SAVED' });
		await expect(ledger.read()).resolves.toMatchObject({
			state: { revision: 2, phase: 'SAFETY_SAVED' },
			receiptSha256: expect.not.stringMatching(first.receiptSha256!)
		});
		expect(await ledger.readBinding()).toEqual(binding());
	});

	it('admits backup operation ids once and excludes restore bindings', async () => {
		const backupOperation = new DatabaseMaintenanceLedger(
			root,
			CLUSTER,
			'223e4567-e89b-42d3-a456-426614174000',
			'backup-operator'
		);
		await backupOperation.initialize();
		await backupOperation.claimBackup('identity', 'a'.repeat(40));
		await expect(backupOperation.claimBackup('identity', 'a'.repeat(40))).rejects.toThrow(
			'Backup operation was already admitted; inspect its S3 job or use a new operation id'
		);
		await expect(backupOperation.bind({
			...binding(),
			operationId: backupOperation.operationId,
			actor: 'backup-operator'
		})).rejects.toThrow('Maintenance operation id is already used by another action');
	});

	it('rejects revision conflicts, binding reuse, and receipt tampering', async () => {
		await ledger.append(0, { phase: 'PREPARED' });
		await expect(ledger.append(0, { phase: 'RESTORING' })).rejects.toThrow(
			'Maintenance state revision conflict'
		);
		await expect(
			ledger.bind({ ...binding(), revision: '0'.repeat(40) })
		).rejects.toThrow(
			'Maintenance operation id is bound to another source, target, cluster, or revision'
		);
		await ledger.append(1, { phase: 'SAFETY_SAVED' });

		const receiptPath = join(ledger.receiptsDirectory, '00000001.json');
		const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as Record<
			string,
			unknown
		>;
		(receipt.state as Record<string, unknown>).phase = 'COMMITTED';
		await writeFile(receiptPath, JSON.stringify(receipt), { mode: 0o600 });
		await expect(ledger.read()).rejects.toThrow(
			'Maintenance receipt chain is invalid'
		);
	});

	it('detects receipt actor changes and replayed sequence entries', async () => {
		await ledger.append(0, { phase: 'PREPARED' });
		await ledger.append(1, { phase: 'SAFETY_SAVED' });
		const firstPath = join(ledger.receiptsDirectory, '00000001.json');
		const first = JSON.parse(await readFile(firstPath, 'utf8')) as Record<string, unknown>;
		const actorChanged = { ...first, actor: 'different-admin' };
		await writeFile(firstPath, JSON.stringify(actorChanged), { mode: 0o600 });
		await expect(ledger.read()).rejects.toThrow('Maintenance receipt chain is invalid');

		await writeFile(firstPath, JSON.stringify(first), { mode: 0o600 });
		await writeFile(join(ledger.receiptsDirectory, '00000005.json'), JSON.stringify(first), { mode: 0o600 });
		await expect(ledger.read()).rejects.toThrow('Maintenance receipt sequence has a gap');
	});

	it('rejects non-private ledger roots and invalid operation coordinates', async () => {
		const publicRoot = join(root, 'public');
		const { mkdir } = await import('node:fs/promises');
		await mkdir(publicRoot, { mode: 0o755 });
		await expect(
			new DatabaseMaintenanceLedger(
				publicRoot,
				CLUSTER,
				OPERATION_ID
			).initialize()
		).rejects.toThrow('Maintenance ledger directory is not private');
		expect(
			() => new DatabaseMaintenanceLedger(root, 'bad-cluster', OPERATION_ID)
		).toThrow('Invalid maintenance ledger location');
		const alias = join(root, 'ledger-alias');
		await symlink(root, alias);
		await expect(
			new DatabaseMaintenanceLedger(alias, CLUSTER, OPERATION_ID).initialize()
		).rejects.toThrow('Maintenance ledger directory is not private');
	});
});
