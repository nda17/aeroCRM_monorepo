import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { chmod, copyFile, lstat, mkdtemp, open, rm, stat, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseRestoreArtifactValidatorService } from '../restore/database-restore-artifact-validator.service';
import { DatabaseRestoreProcessService } from '../restore/database-restore-process.service';
import type { DatabaseRestoreConnection } from '../restore/database-restore-target-registry.service';
import { DatabaseBackupMigrationManifestService } from './database-backup-migration-manifest.service';
import { DatabaseBackupProvenanceService } from './database-backup-provenance.service';
import { DatabaseBackupS3Service } from './database-backup-s3.service';
import { DatabaseBackupService } from './database-backup.service';
import {
	DatabaseMaintenanceLedger, readPrivateJson, syncDirectory,
	type DatabaseMaintenanceBinding, type DatabaseMaintenanceState
} from './database-maintenance.ledger';
import {
	DatabaseMaintenanceRegistry, databaseMaintenanceAclSql, maintenanceHash,
	sqlIdentifier as ident, sqlLiteral as literal, type DatabaseMaintenanceTarget
} from './database-maintenance.registry';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const CLUSTER = /^\d{10,30}$/;
const ACTIONS = ['inventory', 'backup', 'inspect', 'restore', 'rollback', 'status'] as const;
export interface DatabaseMaintenanceRequest {
	schemaVersion: 1;
	action: typeof ACTIONS[number];
	expectedRevision: string;
	operationId?: string;
	target?: string;
	expectedClusterSystemIdentifier?: string;
	backupJobId?: string;
	expectedArtifactSha256?: string;
	expectedStateRevision?: number;
	confirmation?: string;
}
export function parseDatabaseMaintenanceRequest(input: unknown): DatabaseMaintenanceRequest {
	if (!input || typeof input !== 'object' || Array.isArray(input))
		throw new Error('Invalid maintenance request');
	const value = input as Record<string, unknown>;
	const action = value.action as DatabaseMaintenanceRequest['action'];
	if (value.schemaVersion !== 1 || !ACTIONS.includes(action) || typeof value.expectedRevision !== 'string' || !SHA.test(value.expectedRevision))
		throw new Error('Invalid maintenance action or revision');
	const keys = ['schemaVersion', 'action', 'expectedRevision'];
	if (action !== 'inventory') {
		keys.push('operationId', 'target');
		if (typeof value.operationId !== 'string' || !UUID.test(value.operationId) || typeof value.target !== 'string')
			throw new Error('Invalid maintenance operation or target');
	}
	if (['backup','restore','rollback','status'].includes(action)) {
		keys.push('expectedClusterSystemIdentifier');
		if (typeof value.expectedClusterSystemIdentifier !== 'string' || !CLUSTER.test(value.expectedClusterSystemIdentifier))
			throw new Error('An exact cluster system identifier is required');
	}
	if (['inspect','restore'].includes(action)) {
		keys.push('backupJobId');
		if (typeof value.backupJobId !== 'string' || !UUID.test(value.backupJobId))
			throw new Error('An exact backup job id is required');
	}
	if (action === 'restore') {
		keys.push('expectedArtifactSha256');
		if (typeof value.expectedArtifactSha256 !== 'string' || !SHA256.test(value.expectedArtifactSha256))
			throw new Error('The inspected backup SHA-256 is required');
	}
	if (['restore','rollback'].includes(action)) {
		keys.push('expectedStateRevision','confirmation');
		if (!Number.isSafeInteger(value.expectedStateRevision) || Number(value.expectedStateRevision) < 0 ||
			value.confirmation !== `${action.toUpperCase()} ${String(value.target)}`)
			throw new Error('Maintenance confirmation or state revision is invalid');
	}
	if (Object.keys(value).sort().join() !== keys.sort().join())
		throw new Error('Unexpected maintenance request fields');
	return value as unknown as DatabaseMaintenanceRequest;
}

interface InspectedBackup {
	backupJobId: string;
	artifactSha256: string;
	provenanceSha256: string;
	fileSize: number;
	migrationManifestSha256: string;
	sourceRevision: string;
	source: string;
}

export class DatabaseMaintenanceService {
	private readonly config = new ConfigService(process.env);
	private readonly process = new DatabaseRestoreProcessService();
	private readonly artifacts = new DatabaseRestoreArtifactValidatorService();
	private readonly manifests = new DatabaseBackupMigrationManifestService();
	private readonly registry = new DatabaseMaintenanceRegistry();
	private readonly provenance = new DatabaseBackupProvenanceService();
	private readonly s3 = new DatabaseBackupS3Service(this.config);
	private readonly abort = new AbortController();
	private readonly admin: DatabaseRestoreConnection;
	private readonly revision: string;

	constructor() {
		this.revision = process.env.APP_REVISION ?? '';
		if (!SHA.test(this.revision)) throw new Error('APP_REVISION must be an exact service revision');
		let url: URL;
		try { url = new URL(process.env.DATABASE_MAINTENANCE_ADMIN_URL ?? ''); }
		catch { throw new Error('Maintenance admin connection is not configured'); }
		if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' ||
			url.pathname !== '/postgres' || decodeURIComponent(url.username) !== 'aerocrm_cluster_admin' ||
			!url.password || url.hash || [...url.searchParams.keys()].some(key => key !== 'connect_timeout'))
			throw new Error('Maintenance requires the private loopback cluster admin connection');
		const port = Number(url.port || '5432');
		if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid maintenance port');
		this.admin = { host: '127.0.0.1', port, user: 'aerocrm_cluster_admin', database: 'postgres', password: decodeURIComponent(url.password) };
	}

	async run(request: DatabaseMaintenanceRequest): Promise<Record<string, unknown>> {
		if (request.expectedRevision !== this.revision) throw new Error('Maintenance image revision mismatch');
		const cluster = await this.cluster();
		if (request.expectedClusterSystemIdentifier && request.expectedClusterSystemIdentifier !== cluster)
			throw new Error('Maintenance target cluster does not match the reviewed request');
		if (process.env.DATABASE_MAINTENANCE_REHEARSAL_CLUSTER && process.env.DATABASE_MAINTENANCE_REHEARSAL_CLUSTER !== cluster)
			throw new Error('Rehearsal is connected to an unexpected cluster');
		if (request.action === 'inventory') return {
			schemaVersion: 1, revision: this.revision, clusterSystemIdentifier: cluster,
			targets: this.registry.targets.map(target => ({
				target: target.target, database: target.database, schema: target.schema,
				migrationRole: target.migrationRole, runtimeRole: target.runtimeRole, backupRole: target.backupRole,
				aclSha256: target.aclSha256, migrationManifestSha256: this.manifests.sha256(target.target)
			}))
		};
		const target = this.registry.get(request.target!);
		if (request.action === 'inspect') {
			const directory = await mkdtemp(join(tmpdir(), 'aerocrm-maintenance-inspect-'));
			try {
				const backup = await this.inspect(target, request.backupJobId!, directory);
				return { schemaVersion: 1, target: target.target, revision: this.revision,
					backupJobId: backup.backupJobId, artifactSha256: backup.artifactSha256,
					provenanceSha256: backup.provenanceSha256, fileSize: backup.fileSize,
					migrationManifestSha256: backup.migrationManifestSha256, sourceRevision: backup.sourceRevision };
			} finally { await rm(directory, { recursive: true, force: true }); }
		}
		if (request.action === 'status') {
			const ledger = this.ledger(cluster, request.operationId!);
			const binding = await ledger.readBinding();
			if (binding.target !== target.target || binding.revision !== this.revision)
				throw new Error('Maintenance status binding mismatch');
			return { schemaVersion: 1, operationId: request.operationId, binding, ...await ledger.read() };
		}
		const release = await this.lock();
		try {
			this.assertActor();
			if (request.action === 'backup') {
				const ledger = this.ledger(cluster, request.operationId!);
				await ledger.initialize();
				// A durable, single-use claim survives a lost CLI response or a
				// partial S3 upload. Retrying never changes a reviewed source.
				await ledger.claimBackup(target.target, this.revision);
				await this.s3.assertJobAbsent(target.target, request.operationId!);
				const backup = new DatabaseBackupService(this.config, this.s3, this.provenance, this.manifests);
				const result = await backup.createAndStore(request.operationId!, target.target, {
					chatId: '', messageThreadId: 0, trigger: 'MANUAL', backupJobCreatedAt: new Date().toISOString()
				}, this.abort.signal);
				const response = { schemaVersion: 1, operationId: request.operationId, revision: this.revision, ...result };
				await ledger.recordBackup(response);
				return response;
			}
			return await this.mutate(request, target, cluster);
		} finally { await release(); }
	}

	private async cluster(): Promise<string> {
		const value = JSON.parse(await this.process.query(this.admin, `SELECT json_build_object(
			'id',(SELECT system_identifier::text FROM pg_control_system()),
			'version',current_setting('server_version_num')::int,
			'admin',current_user='aerocrm_cluster_admin' AND (SELECT rolsuper FROM pg_roles WHERE rolname=current_user))::text;`, this.abort.signal)) as { id: string; version: number; admin: boolean };
		if (!CLUSTER.test(value.id) || value.version < 180000 || value.version >= 190000 || value.admin !== true)
			throw new Error('Maintenance requires PostgreSQL 18 and the reviewed admin principal');
		return value.id;
	}
	private connection(target: DatabaseMaintenanceTarget): DatabaseRestoreConnection {
		return { ...this.admin, database: target.database };
	}
	private ledger(cluster: string, operationId: string): DatabaseMaintenanceLedger {
		return new DatabaseMaintenanceLedger(process.env.DATABASE_MAINTENANCE_LEDGER_DIR ?? '', cluster, operationId, process.env.DATABASE_MAINTENANCE_ACTOR ?? 'unattributed');
	}
	private assertActor(): string {
		const actor = process.env.DATABASE_MAINTENANCE_ACTOR ?? '';
		if (!/^[A-Za-z0-9_./:@-]{1,200}$/.test(actor)) throw new Error('Maintenance audit actor is required');
		return actor;
	}
	private async inspect(target: DatabaseMaintenanceTarget, backupJobId: string, directory: string): Promise<InspectedBackup> {
		const manifestPath = join(directory, 'manifest.json');
		await this.s3.downloadToFile(this.s3.key(target.target, backupJobId, 'manifest.json'), manifestPath, 65536);
		const manifest = await readPrivateJson(manifestPath) as Record<string, unknown>;
		if (manifest.version !== 1 || manifest.target !== target.target || manifest.jobId !== backupJobId ||
			typeof manifest.provenanceObjectKey !== 'string' || typeof manifest.objectKey !== 'string' ||
			typeof manifest.fileSha256 !== 'string' || !SHA256.test(manifest.fileSha256) ||
			typeof manifest.provenanceEnvelopeSha256 !== 'string' || !SHA256.test(manifest.provenanceEnvelopeSha256))
			throw new Error('S3 backup manifest binding is invalid');
		const prefix = `database-backups/${target.target}/${backupJobId}/`;
		const fileName = manifest.objectKey.slice(prefix.length);
		if (!manifest.objectKey.startsWith(prefix) || !/^aerocrm-[a-z0-9-]+-db-[A-Za-z0-9._-]+\.dump$/.test(fileName) ||
			manifest.provenanceObjectKey !== `${manifest.objectKey}.provenance.json`)
			throw new Error('S3 backup object must belong to the exact target and job');
		const provenancePath = join(directory, 'provenance.json');
		await this.s3.downloadToFile(manifest.provenanceObjectKey, provenancePath, 65536);
		const signed = await readPrivateJson(provenancePath);
		const envelope = await this.provenance.verify(signed);
		const evidence = envelope.evidence;
		if (evidence.target !== target.target || evidence.backupJobId !== backupJobId || evidence.fileName !== fileName ||
			evidence.databaseName !== target.database || evidence.schema !== target.schema || evidence.fileSize !== manifest.fileSize ||
			evidence.artifactSha256 !== manifest.fileSha256 ||
			(signed as { envelopeSha256: string }).envelopeSha256 !== manifest.provenanceEnvelopeSha256)
			throw new Error('S3 backup does not match its signed provenance');
		this.manifests.assertBinding(target.target, evidence.migrationManifestSha);
		const limit = Number(process.env.DATABASE_MAINTENANCE_MAX_DUMP_BYTES ?? 10 * 1024 ** 3);
		if (!Number.isSafeInteger(limit) || limit < 5 || evidence.fileSize > limit)
			throw new Error('Restore dump exceeds the configured limit');
		const source = join(directory, 'source.dump');
		await this.s3.downloadToFile(manifest.objectKey, source, evidence.fileSize);
		if ((await stat(source)).size !== evidence.fileSize || await this.artifacts.sha256(source) !== evidence.artifactSha256)
			throw new Error('S3 restore artifact checksum or size mismatch');
		await this.validateDump(source, target);
		return { backupJobId, artifactSha256: evidence.artifactSha256,
			provenanceSha256: manifest.provenanceEnvelopeSha256, fileSize: evidence.fileSize,
			migrationManifestSha256: evidence.migrationManifestSha, sourceRevision: evidence.servicesSha, source };
	}
	private async validateDump(path: string, target: DatabaseMaintenanceTarget): Promise<void> {
		this.artifacts.assertTableOfContents(await this.process.listDump(path, '', this.abort.signal), target);
		this.manifests.assertDumpLedger(target.target, target.schema,
			await this.process.extractMigrationLedger(path, target, this.abort.signal));
	}

	private async mutate(request: DatabaseMaintenanceRequest, target: DatabaseMaintenanceTarget, cluster: string): Promise<Record<string, unknown>> {
		const actor = this.assertActor();
		const ledger = this.ledger(cluster, request.operationId!);
		await ledger.initialize();
		const connection = this.connection(target);
		if (request.action === 'rollback') return this.rollback(request, target, ledger);
		const existing = await ledger.readBinding().catch(error => {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
			throw error;
		});
		if (existing) {
			if (existing.target !== target.target || existing.revision !== this.revision || existing.aclSha256 !== target.aclSha256 ||
				existing.backupJobId !== request.backupJobId || existing.artifactSha256 !== request.expectedArtifactSha256)
				throw new Error('Maintenance operation id is bound to another source, target, cluster, or revision');
			const { state } = await ledger.read();
			if (state?.phase === 'COMMITTED') {
				await this.completeGeneration(target, request.operationId!);
				return this.result(ledger, target);
			}
			if (state?.phase === 'COMMITTING') {
				if (state.revision !== request.expectedStateRevision) throw new Error('Maintenance state revision conflict');
				return this.finishCommit(ledger, target, state, 'COMMITTED');
			}
		}
		const directory = await mkdtemp(join(tmpdir(), 'aerocrm-maintenance-admit-'));
		try {
			const backup = await this.inspect(target, request.backupJobId!, directory);
			if (backup.artifactSha256 !== request.expectedArtifactSha256)
				throw new Error('Restore source changed since inspection');
			const binding: DatabaseMaintenanceBinding = { schemaVersion: 1, operationId: request.operationId!, target: target.target,
				clusterSystemIdentifier: cluster, revision: this.revision, actor, backupJobId: backup.backupJobId,
				artifactSha256: backup.artifactSha256, provenanceSha256: backup.provenanceSha256,
				migrationManifestSha256: backup.migrationManifestSha256, aclSha256: target.aclSha256 };
			await ledger.bind(binding);
			let { state } = await ledger.read();
			if (state?.phase === 'COMMITTED') {
				await this.completeGeneration(target, request.operationId!);
				return this.result(ledger, target);
			}
			if ((state?.revision ?? 0) !== request.expectedStateRevision)
				throw new Error('Maintenance state revision conflict');
			if (state && !['PREPARED','FENCING','FENCED','SAFETY_SAVED','VERIFIED'].includes(state.phase))
				throw new Error('Interrupted destructive restore requires the explicit rollback action');
			if (!state) {
				await this.assertBoundary(target, null);
				this.manifests.assertDatabaseLedger(target.target, await this.process.readMigrationLedger(connection, target, this.abort.signal));
				const identity = await this.identity(target);
				const capacity = await statfs(ledger.directory);
				const databaseSize = Number(await this.process.query(connection, 'SELECT pg_database_size(current_database())::text;', this.abort.signal));
				if (Number(capacity.bavail) * Number(capacity.bsize) < backup.fileSize + databaseSize * 2 + 64 * 1024 ** 2)
					throw new Error('Insufficient ledger disk space for restore and safety copy');
				const sourcePath = join(ledger.directory, 'source.dump');
				await copyFile(backup.source, sourcePath, constants.COPYFILE_EXCL).catch(error => {
					if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
				});
				await this.assertFile(sourcePath, backup.artifactSha256, backup.fileSize);
				await chmod(sourcePath, 0o600);
				await this.syncFile(sourcePath);
				state = await ledger.append(0, { phase: 'PREPARED', identity });
			}
			const sourcePath = join(ledger.directory, 'source.dump');
			await this.assertFile(sourcePath, backup.artifactSha256, backup.fileSize);
			if (state.phase === 'PREPARED') state = await ledger.append(state.revision, { ...state, phase: 'FENCING' });
			if (state.phase === 'FENCING') {
				await this.fence(target, request.operationId!);
				state = await ledger.append(state.revision, { ...state, phase: 'FENCED' });
			}
			if (state.phase === 'FENCED') {
				await this.assertBoundary(target, request.operationId!);
				const safety = join(ledger.directory, 'safety.dump');
				// An incomplete safety copy is never overwritten automatically.
				await this.process.createSafetyCopy(connection, target.schema, safety, this.abort.signal);
				await this.validateDump(safety, target);
				state = await ledger.append(state.revision, { ...state, phase: 'SAFETY_SAVED',
					safetySha256: await this.artifacts.sha256(safety), safetySize: (await stat(safety)).size });
			}
			if (state.phase === 'SAFETY_SAVED') {
				await this.assertBoundary(target, request.operationId!);
				state = await ledger.append(state.revision, { ...state, phase: 'RESTORING' });
				await this.process.recreateSchema(connection, target, this.abort.signal);
				await this.process.restoreSchema(connection, target, sourcePath, this.abort.signal, true);
				const verification = await this.verify(target, state.identity ?? null, cluster);
				state = await ledger.append(state.revision, { ...state, phase: 'VERIFIED', verificationSha256: maintenanceHash(JSON.stringify(verification)) });
			}
			if (state.phase === 'VERIFIED') {
				await this.verify(target, state.identity ?? null, cluster);
				// Commit intent must be durable before LOGIN: after a crash,
				// reopened writers may already have produced new business data.
				state = await ledger.append(state.revision, { ...state, phase: 'COMMITTING' });
				return this.finishCommit(ledger, target, state, 'COMMITTED');
			}
			return this.result(ledger, target);
		} finally { await rm(directory, { recursive: true, force: true }); }
	}

	private async rollback(request: DatabaseMaintenanceRequest, target: DatabaseMaintenanceTarget, ledger: DatabaseMaintenanceLedger): Promise<Record<string, unknown>> {
		const binding = await ledger.readBinding();
		if (binding.target !== target.target || binding.revision !== this.revision || binding.aclSha256 !== target.aclSha256)
			throw new Error('Rollback binding mismatch');
		let { state } = await ledger.read();
		if (state?.phase === 'ROLLED_BACK') {
			await this.completeGeneration(target, request.operationId!);
			return this.result(ledger, target);
		}
		if (!state || state.revision !== request.expectedStateRevision || ['COMMITTING','COMMITTED'].includes(state.phase))
			throw new Error('Rollback requires the current incomplete operation revision');
		if (state.phase === 'ROLLBACK_COMMITTING') return this.finishCommit(ledger, target, state, 'ROLLED_BACK');
		const destructive = ['RESTORING','VERIFIED','ROLLING_BACK','ROLLBACK_VERIFIED'].includes(state.phase);
		if (state.phase !== 'PREPARED') await this.fence(target, request.operationId!);
		if (destructive) {
			const safety = join(ledger.directory, 'safety.dump');
			if (!state.safetySha256 || !state.safetySize) throw new Error('Rollback safety evidence is unavailable');
			await this.assertFile(safety, state.safetySha256, state.safetySize);
			await this.validateDump(safety, target);
			state = await ledger.append(state.revision, { ...state, phase: 'ROLLING_BACK' });
			await this.process.recreateSchema(this.connection(target), target, this.abort.signal);
			await this.process.restoreSchema(this.connection(target), target, safety, this.abort.signal, true);
			const verified = await this.verify(target, state.identity ?? null, '');
			state = await ledger.append(state.revision, { ...state, phase: 'ROLLBACK_VERIFIED', verificationSha256: maintenanceHash(JSON.stringify(verified)) });
		} else {
			// Before RESTORING no schema mutation has been admitted; verify the
			// existing target before reopening even if a safety-copy write failed.
			await this.verify(target, state.identity ?? null, '');
		}
		if (state.phase !== 'PREPARED') {
			state = await ledger.append(state.revision, { ...state, phase: 'ROLLBACK_COMMITTING' });
			return this.finishCommit(ledger, target, state, 'ROLLED_BACK');
		}
		await ledger.append(state.revision, { ...state, phase: 'ROLLED_BACK' });
		await this.completeGeneration(target, request.operationId!);
		return this.result(ledger, target);
	}
	private async finishCommit(ledger: DatabaseMaintenanceLedger, target: DatabaseMaintenanceTarget,
		state: DatabaseMaintenanceState, phase: 'COMMITTED' | 'ROLLED_BACK'): Promise<Record<string, unknown>> {
		await this.releaseFence(target, ledger.operationId);
		await ledger.append(state.revision, { ...state, phase });
		await this.completeGeneration(target, ledger.operationId);
		return this.result(ledger, target);
	}
	private async result(ledger: DatabaseMaintenanceLedger, target: DatabaseMaintenanceTarget): Promise<Record<string, unknown>> {
		return { schemaVersion: 1, operationId: ledger.operationId, target: target.target,
			revision: this.revision, clusterSystemIdentifier: ledger.cluster, ...await ledger.read() };
	}
	private async identity(target: DatabaseMaintenanceTarget): Promise<string | null> {
		if (!('service_identity' in target.acl.tables)) return null;
		const value = JSON.parse(await this.process.query(this.connection(target),
			`SELECT coalesce(json_agg(json_build_object('id',id,'serviceName',service_name,'databaseId',database_id))::text,'[]') FROM ${ident(target.schema)}.service_identity;`, this.abort.signal)) as {id: string; serviceName: string; databaseId: string}[];
		if (value.length !== 1 || value[0].id !== 'singleton' || value[0].serviceName !== `${target.target}-service` || !UUID.test(value[0].databaseId))
			throw new Error('Service-owned database identity is invalid');
		return JSON.stringify(value[0]);
	}
	private async verify(target: DatabaseMaintenanceTarget, expectedIdentity: string | null, rehearsalCluster: string): Promise<Record<string, unknown>> {
		const connection = this.connection(target);
		this.manifests.assertDatabaseLedger(target.target, await this.process.readMigrationLedger(connection, target, this.abort.signal));
		await this.process.executeSql(connection, databaseMaintenanceAclSql(target), this.abort.signal);
		const identity = await this.identity(target);
		if (identity !== expectedIdentity && (!rehearsalCluster || process.env.DATABASE_MAINTENANCE_REHEARSAL_CLUSTER !== rehearsalCluster))
			throw new Error('Restored service identity differs from the original database');
		const counts = JSON.parse(await this.process.query(connection,
			`SELECT json_object_agg(name,rows)::text FROM (${Object.keys(target.acl.tables).map(table => `SELECT ${literal(table)} AS name,count(*)::text AS rows FROM ${ident(target.schema)}.${ident(table)}`).join(' UNION ALL ')}) counts;`, this.abort.signal));
		return { target: target.target, migrationManifestSha256: this.manifests.sha256(target.target), aclSha256: target.aclSha256, identity, counts };
	}
	private roleNames(target: DatabaseMaintenanceTarget): string[] { return [target.migrationRole, target.runtimeRole, target.backupRole]; }
	private generationCheck(target: DatabaseMaintenanceTarget, operationId: string): string {
		return `IF NOT EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_database d ON d.oid=s.setdatabase
		CROSS JOIN LATERAL unnest(s.setconfig) configured(value) WHERE d.datname=${literal(target.database)} AND s.setrole=0
		AND configured.value=${literal(`aerocrm.restore_generation=${operationId}`)}) THEN RAISE EXCEPTION 'Restore fencing generation mismatch'; END IF;`;
	}
	private async assertBoundary(target: DatabaseMaintenanceTarget, operationId: string | null, allowedGeneration?: string): Promise<void> {
		const roles = this.roleNames(target).map(literal).join(',');
		await this.process.executeSql(this.connection(target), `DO $boundary$ DECLARE item record; BEGIN
		IF current_database()<>${literal(target.database)} THEN RAISE EXCEPTION 'Unexpected restore database'; END IF;
		IF EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_database d ON d.oid=s.setdatabase
		CROSS JOIN LATERAL unnest(s.setconfig) configured(value) WHERE d.datname=${literal(target.database)} AND s.setrole=0
		AND configured.value='aerocrm.restore_status=ACTIVE') THEN
		${operationId || allowedGeneration ? this.generationCheck(target, (operationId || allowedGeneration)!) : "RAISE EXCEPTION 'A prior restore operation has not recorded its terminal result';"}
		END IF;
		IF (SELECT count(*) FROM pg_roles WHERE rolname IN (${roles}))<>3 THEN RAISE EXCEPTION 'Restore roles are missing'; END IF;
		FOR item IN SELECT * FROM pg_roles WHERE rolname IN (${roles}) LOOP
		IF item.rolsuper OR item.rolcreatedb OR item.rolcreaterole OR item.rolreplication OR item.rolbypassrls OR item.rolinherit
		OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member=item.oid OR roleid=item.oid)
		THEN RAISE EXCEPTION 'Restore service role boundary drift'; END IF;
		IF EXISTS (SELECT 1 FROM pg_database WHERE datname LIKE 'aerocrm\\_%' ESCAPE '\\' AND datname<>current_database() AND has_database_privilege(item.oid,oid,'CONNECT'))
		THEN RAISE EXCEPTION 'Cross-service restore role access'; END IF;
		IF item.rolcanlogin IS DISTINCT FROM ${operationId ? 'false' : 'true'} THEN RAISE EXCEPTION 'Restore role login boundary mismatch'; END IF;
		END LOOP;
		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolcanlogin AND rolname NOT IN (${roles},'aerocrm_cluster_admin') AND has_database_privilege(oid,current_database(),'CONNECT'))
		THEN RAISE EXCEPTION 'Unexpected database writer principal'; END IF;
		IF EXISTS (SELECT 1 FROM pg_prepared_xacts WHERE database=current_database()) THEN RAISE EXCEPTION 'Restore target has prepared transactions'; END IF;
		IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
		${operationId ? '' : `AND usename NOT IN (${roles})`}) THEN RAISE EXCEPTION 'Restore target has unexpected active sessions'; END IF;
		${operationId ? this.generationCheck(target, operationId) : ''}
		END $boundary$;`, this.abort.signal);
	}
	private async fence(target: DatabaseMaintenanceTarget, operationId: string): Promise<void> {
		const connection = this.connection(target);
		const roles = this.roleNames(target);
		// A crash between role fencing and the next receipt can only be resumed
		// by the operation whose database-scoped generation already owns it.
		const loginCount = Number(await this.process.query(connection,
			`SELECT count(*) FROM pg_roles WHERE rolname IN (${roles.map(literal).join(',')}) AND rolcanlogin;`, this.abort.signal));
		if (loginCount === 3) {
			await this.assertBoundary(target, null, operationId);
			await this.process.executeSql(connection, `BEGIN; SET LOCAL lock_timeout='5s';
			ALTER DATABASE ${ident(target.database)} SET "aerocrm.restore_generation" TO ${literal(operationId)};
			ALTER DATABASE ${ident(target.database)} SET "aerocrm.restore_status" TO 'ACTIVE';
			${roles.map(role => `ALTER ROLE ${ident(role)} NOLOGIN;`).join('\n')} COMMIT;`, this.abort.signal);
		} else if (loginCount === 0) {
			await this.process.executeSql(connection, `DO $generation$ BEGIN ${this.generationCheck(target, operationId)} END $generation$;`, this.abort.signal);
		} else throw new Error('Mixed restore writer boundary requires investigation');
		await this.process.executeSql(connection, `DO $terminate$ DECLARE item record; BEGIN
		FOR item IN SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND usename IN (${roles.map(literal).join(',')}) AND pid<>pg_backend_pid() LOOP
		IF NOT pg_terminate_backend(item.pid,5000) THEN RAISE EXCEPTION 'Restore writer could not be stopped'; END IF;
		END LOOP; END $terminate$;`, this.abort.signal);
		await this.assertBoundary(target, operationId);
	}
	private async releaseFence(target: DatabaseMaintenanceTarget, operationId: string): Promise<void> {
		const roles = this.roleNames(target);
		await this.process.executeSql(this.connection(target), `BEGIN;
		DO $generation$ BEGIN ${this.generationCheck(target, operationId)} END $generation$;
		${roles.map(role => `ALTER ROLE ${ident(role)} LOGIN;`).join('\n')} COMMIT;`, this.abort.signal);
		await this.assertBoundary(target, null, operationId);
	}
	private async completeGeneration(target: DatabaseMaintenanceTarget, operationId: string): Promise<void> {
		// A committed replay may occur after a newer operation. Never mutate the
		// newer generation; closing a stale terminal receipt is read-only.
		await this.process.executeSql(this.connection(target), `DO $complete$ BEGIN
		IF EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_database d ON d.oid=s.setdatabase
		CROSS JOIN LATERAL unnest(s.setconfig) configured(value) WHERE d.datname=${literal(target.database)} AND s.setrole=0
		AND configured.value=${literal(`aerocrm.restore_generation=${operationId}`)}) THEN
		ALTER DATABASE ${ident(target.database)} SET "aerocrm.restore_status" TO 'COMPLETE';
		END IF; END $complete$;`, this.abort.signal);
	}
	private async assertFile(path: string, sha256: string, size: number): Promise<void> {
		const info = await lstat(path);
		if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o077) !== 0 || info.size !== size || await this.artifacts.sha256(path) !== sha256)
			throw new Error('Maintenance retained artifact failed integrity verification');
	}
	private async syncFile(path: string): Promise<void> {
		const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		try { await file.sync(); } finally { await file.close(); }
		await syncDirectory(join(path, '..'));
	}
	private async lock(): Promise<() => Promise<void>> {
		const child = spawn('psql', ['-X','-qAt','-v','ON_ERROR_STOP=1','--no-password',
			'-h',this.admin.host,'-p',String(this.admin.port),'-U',this.admin.user,'-d','postgres'], {
			env: { ...process.env, PGPASSWORD: this.admin.password, PGCONNECT_TIMEOUT: '10' }, stdio: ['pipe','pipe','pipe']
		});
		let released = false;
		// psql diagnostics may contain connection details; drain without logging.
		child.stderr.resume();
		child.stdin.on('error', () => this.abort.abort(new Error('Maintenance control connection closed')));
		const closed = new Promise<void>(resolve => child.once('close', () => {
			if (!released) this.abort.abort(new Error('Maintenance control lock was lost'));
			resolve();
		}));
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Maintenance control lock timed out')); }, 15000);
			let output = '';
			child.stdout.on('data', chunk => {
				output = `${output}${String(chunk)}`.slice(-1000);
				if (output.includes('LOCKED')) { clearTimeout(timer); resolve(); }
				else if (output.includes('BUSY')) { clearTimeout(timer); child.stdin.end(); reject(new Error('Another database maintenance operation is active')); }
			});
			child.once('error', () => { clearTimeout(timer); reject(new Error('Maintenance control lock is unavailable')); });
			child.once('close', () => { clearTimeout(timer); reject(new Error('Maintenance control connection closed')); });
			child.stdin.write("SELECT CASE WHEN pg_try_advisory_lock(1867311201,13) THEN 'LOCKED' ELSE 'BUSY' END;\n");
		});
		return async () => {
			released = true;
			child.stdin.end('SELECT pg_advisory_unlock(1867311201,13);\n');
			await closed;
		};
	}
}
