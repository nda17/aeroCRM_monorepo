import {
	DatabaseMaintenanceService,
	type DatabaseMaintenanceRequest
} from './database-maintenance.service';
import { DatabaseMaintenanceRegistry } from './database-maintenance.registry';

const revision = 'a'.repeat(40);
const operationId = '123e4567-e89b-42d3-a456-426614174000';
const backupJobId = '223e4567-e89b-42d3-a456-426614174000';
const cluster = '12345678901234567890';
const artifactSha256 = 'b'.repeat(64);

function restoreRequest(overrides: Partial<DatabaseMaintenanceRequest> = {}): DatabaseMaintenanceRequest {
	return {
		schemaVersion: 1,
		action: 'restore',
		expectedRevision: revision,
		operationId,
		target: 'identity',
		expectedClusterSystemIdentifier: cluster,
		backupJobId,
		expectedArtifactSha256: artifactSha256,
		expectedStateRevision: 4,
		confirmation: 'RESTORE identity',
		...overrides
	} as DatabaseMaintenanceRequest;
}

function binding(artifact = artifactSha256) {
	const target = new DatabaseMaintenanceRegistry().get('identity');
	return {
		schemaVersion: 1,
		operationId,
		target: 'identity',
		clusterSystemIdentifier: cluster,
		revision,
		actor: 'release-operator',
		backupJobId,
		artifactSha256: artifact,
		provenanceSha256: 'c'.repeat(64),
		migrationManifestSha256: 'd'.repeat(64),
		aclSha256: target.aclSha256
	};
}

describe('DatabaseMaintenanceService mutation admission', () => {
	const previousEnvironment = new Map<string, string | undefined>();

	beforeEach(() => {
		for (const [key, value] of Object.entries({
			APP_REVISION: revision,
			DATABASE_MAINTENANCE_ADMIN_URL: 'postgresql://aerocrm_cluster_admin:secret@127.0.0.1/postgres',
			DATABASE_MAINTENANCE_ACTOR: 'release-operator'
		})) {
			previousEnvironment.set(key, process.env[key]);
			process.env[key] = value;
		}
	});

	afterEach(() => {
		for (const [key, value] of previousEnvironment) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		previousEnvironment.clear();
		jest.restoreAllMocks();
	});

	function service() {
		const value = new DatabaseMaintenanceService();
		(value as any).process = {
			query: jest.fn().mockResolvedValue(JSON.stringify({ id: cluster, version: 180000, admin: true }))
		};
		return value;
	}

	it('rejects a wrong cluster before acquiring the mutation fence', async () => {
		const value = service();
		const lock = jest.spyOn(value as any, 'lock').mockResolvedValue(jest.fn());
		const request = restoreRequest({ expectedClusterSystemIdentifier: '98765432109876543210' });

		await expect(value.run(request)).rejects.toThrow('Maintenance target cluster does not match the reviewed request');
		expect(lock).not.toHaveBeenCalled();
	});

	it('rejects source drift on a bound operation before any writer fencing', async () => {
		const value = service();
		const ledger = {
			initialize: jest.fn().mockResolvedValue(undefined),
			readBinding: jest.fn().mockResolvedValue(binding('c'.repeat(64)))
		};
		jest.spyOn(value as any, 'lock').mockResolvedValue(jest.fn());
		jest.spyOn(value as any, 'ledger').mockReturnValue(ledger);
		const inspect = jest.spyOn(value as any, 'inspect');
		const fence = jest.spyOn(value as any, 'fence');

		await expect(value.run(restoreRequest())).rejects.toThrow(
			'Maintenance operation id is bound to another source, target, cluster, or revision'
		);
		expect(inspect).not.toHaveBeenCalled();
		expect(fence).not.toHaveBeenCalled();
	});

	it('requires explicit rollback after a durable RESTORING phase', async () => {
		const value = service();
		const currentBinding = binding();
		const ledger = {
			initialize: jest.fn().mockResolvedValue(undefined),
			readBinding: jest.fn().mockResolvedValue(currentBinding),
			bind: jest.fn().mockResolvedValue(undefined),
			read: jest.fn().mockResolvedValue({ state: { revision: 4, phase: 'RESTORING' }, receiptSha256: 'e'.repeat(64) })
		};
		jest.spyOn(value as any, 'lock').mockResolvedValue(jest.fn());
		jest.spyOn(value as any, 'ledger').mockReturnValue(ledger);
		jest.spyOn(value as any, 'inspect').mockResolvedValue({
			backupJobId,
			artifactSha256,
			provenanceSha256: currentBinding.provenanceSha256,
			fileSize: 10,
			migrationManifestSha256: currentBinding.migrationManifestSha256,
			sourceRevision: revision,
			source: '/tmp/source.dump'
		});
		const fence = jest.spyOn(value as any, 'fence');

		await expect(value.run(restoreRequest())).rejects.toThrow(
			'Interrupted destructive restore requires the explicit rollback action'
		);
		expect(fence).not.toHaveBeenCalled();
	});

	it('refuses rollback after durable COMMITTING intent', async () => {
		const value = service();
		const ledger = {
			readBinding: jest.fn().mockResolvedValue(binding()),
			read: jest.fn().mockResolvedValue({ state: { revision: 6, phase: 'COMMITTING' }, receiptSha256: 'f'.repeat(64) })
		};
		jest.spyOn(value as any, 'ledger').mockReturnValue(ledger);
		const fence = jest.spyOn(value as any, 'fence');
		const releaseFence = jest.spyOn(value as any, 'releaseFence');
		const request = restoreRequest({
			action: 'rollback',
			expectedStateRevision: 6,
			confirmation: 'ROLLBACK identity'
		});

		await expect((value as any).rollback(request, new DatabaseMaintenanceRegistry().get('identity'), ledger)).rejects.toThrow(
			'Rollback requires the current incomplete operation revision'
		);
		expect(fence).not.toHaveBeenCalled();
		expect(releaseFence).not.toHaveBeenCalled();
	});

	it('releases writers only after observing durable COMMITTING and records completion afterward', async () => {
		const value = service();
		const events: string[] = [];
		let currentState = { revision: 5, phase: 'COMMITTING' };
		const ledger = {
			initialize: jest.fn().mockResolvedValue(undefined),
			readBinding: jest.fn().mockResolvedValue(binding()),
			read: jest.fn().mockImplementation(async () => {
				events.push(`read:${currentState.phase}`);
				return { state: currentState, receiptSha256: 'f'.repeat(64) };
			}),
			append: jest.fn().mockImplementation(async (expectedRevision: number, state: { phase: string }) => {
				events.push(`append:${state.phase}`);
				currentState = { ...state, revision: expectedRevision + 1 };
				return currentState;
			})
		};
		jest.spyOn(value as any, 'ledger').mockReturnValue(ledger);
		jest.spyOn(value as any, 'releaseFence').mockImplementation(async () => {
			events.push('release-writers');
		});
		jest.spyOn(value as any, 'completeGeneration').mockImplementation(async () => {
			events.push('complete-generation');
		});
		const request = restoreRequest({ expectedStateRevision: 5 });

		await (value as any).mutate(request, new DatabaseMaintenanceRegistry().get('identity'), cluster);

		expect(events).toEqual([
			'read:COMMITTING',
			'release-writers',
			'append:COMMITTED',
			'complete-generation',
			'read:COMMITTED'
		]);
	});
});
