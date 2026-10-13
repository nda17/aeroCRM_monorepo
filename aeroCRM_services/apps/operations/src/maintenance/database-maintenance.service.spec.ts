import {
	parseDatabaseMaintenanceRequest,
	type DatabaseMaintenanceRequest
} from './database-maintenance.service';

const revision = 'a'.repeat(40);
const operationId = '123e4567-e89b-42d3-a456-426614174000';
const backupJobId = '223e4567-e89b-42d3-a456-426614174000';
const cluster = '12345678901234567890';
const artifactSha256 = 'b'.repeat(64);

describe('parseDatabaseMaintenanceRequest', () => {
	it.each([
		{ schemaVersion: 1, action: 'inventory', expectedRevision: revision },
		{
			schemaVersion: 1,
			action: 'backup',
			expectedRevision: revision,
			operationId,
			target: 'identity',
			expectedClusterSystemIdentifier: cluster
		},
		{
			schemaVersion: 1,
			action: 'inspect',
			expectedRevision: revision,
			operationId,
			target: 'identity',
			backupJobId
		},
		{
			schemaVersion: 1,
			action: 'restore',
			expectedRevision: revision,
			operationId,
			target: 'identity',
			expectedClusterSystemIdentifier: cluster,
			backupJobId,
			expectedArtifactSha256: artifactSha256,
			expectedStateRevision: 4,
			confirmation: 'RESTORE identity'
		},
		{
			schemaVersion: 1,
			action: 'rollback',
			expectedRevision: revision,
			operationId,
			target: 'identity',
			expectedClusterSystemIdentifier: cluster,
			expectedStateRevision: 4,
			confirmation: 'ROLLBACK identity'
		},
		{
			schemaVersion: 1,
			action: 'status',
			expectedRevision: revision,
			operationId,
			target: 'identity',
			expectedClusterSystemIdentifier: cluster
		}
	])('accepts an exact %s request contract', request => {
		expect(parseDatabaseMaintenanceRequest(request)).toEqual(request);
	});

	it.each([
		['unknown action', { schemaVersion: 1, action: 'drop', expectedRevision: revision }],
		['wrong schema version', { schemaVersion: 2, action: 'inventory', expectedRevision: revision }],
		['wrong revision format', { schemaVersion: 1, action: 'inventory', expectedRevision: 'f'.repeat(64) }],
		['extra request property', { schemaVersion: 1, action: 'inventory', expectedRevision: revision, target: 'identity' }],
		['missing operation UUID', { schemaVersion: 1, action: 'status', expectedRevision: revision, target: 'identity', expectedClusterSystemIdentifier: cluster }],
		['wrong operation UUID version', { schemaVersion: 1, action: 'status', expectedRevision: revision, operationId: '223e4567-e89b-12d3-a456-426614174000', target: 'identity', expectedClusterSystemIdentifier: cluster }],
		['invalid cluster id', { schemaVersion: 1, action: 'backup', expectedRevision: revision, operationId, target: 'identity', expectedClusterSystemIdentifier: '1234' }],
		['invalid backup UUID', { schemaVersion: 1, action: 'inspect', expectedRevision: revision, operationId, target: 'identity', backupJobId: 'backup' }],
		['invalid artifact SHA', { schemaVersion: 1, action: 'restore', expectedRevision: revision, operationId, target: 'identity', expectedClusterSystemIdentifier: cluster, backupJobId, expectedArtifactSha256: 'a'.repeat(40), expectedStateRevision: 0, confirmation: 'RESTORE identity' }],
		['unsafe state revision', { schemaVersion: 1, action: 'rollback', expectedRevision: revision, operationId, target: 'identity', expectedClusterSystemIdentifier: cluster, expectedStateRevision: Number.MAX_SAFE_INTEGER + 1, confirmation: 'ROLLBACK identity' }],
		['missing confirmation', { schemaVersion: 1, action: 'rollback', expectedRevision: revision, operationId, target: 'identity', expectedClusterSystemIdentifier: cluster, expectedStateRevision: 0 }],
		['target confirmation mismatch', { schemaVersion: 1, action: 'restore', expectedRevision: revision, operationId, target: 'identity', expectedClusterSystemIdentifier: cluster, backupJobId, expectedArtifactSha256: artifactSha256, expectedStateRevision: 0, confirmation: 'RESTORE campaigns' }]
	] as const)('rejects %s', (_label, request) => {
		expect(() => parseDatabaseMaintenanceRequest(request)).toThrow();
	});

	it('does not treat unknown structural input as a maintenance request', () => {
		for (const input of [null, [], 'inventory', 1, {}]) {
			expect(() => parseDatabaseMaintenanceRequest(input)).toThrow();
		}
	});

	it('retains its exact typed contract after parsing', () => {
		const request: DatabaseMaintenanceRequest = parseDatabaseMaintenanceRequest({
			schemaVersion: 1,
			action: 'restore',
			expectedRevision: revision,
			operationId,
			target: 'identity',
			expectedClusterSystemIdentifier: cluster,
			backupJobId,
			expectedArtifactSha256: artifactSha256,
			expectedStateRevision: 0,
			confirmation: 'RESTORE identity'
		});
		expect(request.action).toBe('restore');
	});
});
