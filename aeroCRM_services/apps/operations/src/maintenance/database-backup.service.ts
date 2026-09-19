import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
	chmod,
	mkdtemp,
	readdir,
	rm,
	stat,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { DatabaseBackupTarget } from '../scheduled-jobs/scheduled-jobs.types';
import { DatabaseBackupMigrationManifestService } from './database-backup-migration-manifest.service';
import {
	isDatabaseBackupProvenanceTarget
} from './database-backup.contract';
import { DatabaseBackupS3Service } from './database-backup-s3.service';
import {
	DatabaseBackupProvenanceService,
	SignedDatabaseBackupProvenance
} from './database-backup-provenance.service';

const URL_KEYS: Record<DatabaseBackupTarget, string> = {
	'notification-delivery': 'NOTIFICATION_DELIVERY_BACKUP_URL',
	campaigns: 'CAMPAIGNS_BACKUP_URL',
	reporting: 'REPORTING_BACKUP_URL',
	billing: 'BILLING_BACKUP_URL',
	identity: 'IDENTITY_BACKUP_URL',
	platform: 'PLATFORM_BACKUP_URL',
	support: 'SUPPORT_BACKUP_URL',
	operations: 'OPERATIONS_BACKUP_URL',
	'crm-access': 'CRM_ACCESS_BACKUP_URL',
	'crm-intake': 'CRM_INTAKE_BACKUP_URL',
	'crm-customers': 'CRM_CUSTOMERS_BACKUP_URL',
	'crm-sales': 'CRM_SALES_BACKUP_URL'
};
const DATABASE_TARGETS: Record<
	DatabaseBackupTarget,
	{ database: string; schema: string }
> = {
	'notification-delivery': {
		database: 'aerocrm_notification_delivery',
		schema: 'notification_delivery'
	},
	campaigns: { database: 'aerocrm_campaigns', schema: 'campaigns' },
	reporting: { database: 'aerocrm_reporting', schema: 'reporting' },
	billing: { database: 'aerocrm_billing', schema: 'billing' },
	identity: { database: 'aerocrm_identity', schema: 'identity' },
	platform: { database: 'aerocrm_platform', schema: 'platform' },
	support: { database: 'aerocrm_support', schema: 'support' },
	operations: { database: 'aerocrm_operations', schema: 'operations' },
	'crm-access': { database: 'aerocrm_crm_access', schema: 'crm_access' },
	'crm-intake': { database: 'aerocrm_crm_intake', schema: 'crm_intake' },
	'crm-customers': {
		database: 'aerocrm_crm_customers',
		schema: 'crm_customers'
	},
	'crm-sales': { database: 'aerocrm_crm_sales', schema: 'crm_sales' }
};

export interface DatabaseBackupResult {
	target: DatabaseBackupTarget;
	databaseName: string;
	schema: string;
	fileName: string;
	fileSize: number;
	fileSha256: string;
	createdAt: string;
	storage: 'S3';
	objectKey: string;
	provenanceObjectKey: string;
	manifestObjectKey: string;
	backupProvenance: SignedDatabaseBackupProvenance;
}

@Injectable()
export class DatabaseBackupService implements OnModuleInit {
	private readonly tempPrefix = 'aerocrm-operations-backup-';

	constructor(
		private readonly config: ConfigService,
		private readonly s3: DatabaseBackupS3Service,
		private readonly provenance: DatabaseBackupProvenanceService,
		private readonly manifests: DatabaseBackupMigrationManifestService
	) {}

	async onModuleInit(): Promise<void> {
		const staleBefore = Date.now() - 24 * 60 * 60_000;
		const entries = await readdir(tmpdir(), { withFileTypes: true }).catch(
			() => []
		);
		await Promise.all(
			entries
				.filter(
					entry =>
						entry.isDirectory() && entry.name.startsWith(this.tempPrefix)
				)
				.map(async entry => {
					const path = join(tmpdir(), entry.name);
					const info = await stat(path).catch(() => null);
					if (info && info.mtimeMs < staleBefore) {
						await rm(path, { recursive: true, force: true });
					}
				})
		);
		if (process.env.OPERATIONS_PROCESS_ROLE === 'worker') {
			await this.provenance.assertSigningKey(
				this.requiredConfig('DATABASE_BACKUP_PROVENANCE_KEY_ID'),
				this.requiredConfig('DATABASE_BACKUP_PROVENANCE_PRIVATE_KEY_FILE')
			);
		}
	}

	async createAndStore(
		jobId: string,
		target: DatabaseBackupTarget,
		input: {
			chatId: string;
			messageThreadId: number;
			trigger: 'MANUAL' | 'SCHEDULED';
			backupJobCreatedAt: string;
		},
		signal: AbortSignal
	): Promise<DatabaseBackupResult> {
		const directory = await mkdtemp(join(tmpdir(), this.tempPrefix));
		await chmod(directory, 0o700);
		try {
			const database = this.database(target);
			const createdAt = new Date();
			const fileName = `aerocrm-${target}-db-${createdAt
				.toISOString()
				.replace(/[:.]/g, '-')}.dump`;
			const filePath = join(directory, fileName);
			await this.pgDump(
				database.url,
				database.password,
				database.schema,
				filePath,
				signal
			);
			await this.run('pg_restore', ['--list', filePath], null, signal);
			const file = await stat(filePath);
			const fileSha256 = await this.sha256(filePath);
			if (!isDatabaseBackupProvenanceTarget(target)) throw new Error('Unsupported backup target');
			const keyId = this.requiredConfig('DATABASE_BACKUP_PROVENANCE_KEY_ID');
			const privateKeyFile = this.requiredConfig('DATABASE_BACKUP_PROVENANCE_PRIVATE_KEY_FILE');
			const revision = this.requiredRevision();
			const [pgDumpVersion, pgRestoreVersion] = await Promise.all([
				this.version('pg_dump', signal), this.version('pg_restore', signal)
			]);
			const backupProvenance = await this.provenance.sign({
				backupJobId: jobId, target, databaseName: database.name,
				schema: database.schema, fileName, fileSize: file.size,
				artifactSha256: fileSha256, artifactCreatedAt: new Date().toISOString(),
				backupJobCreatedAt: input.backupJobCreatedAt,
				servicesSha: revision, migrationManifestSha: this.manifests.sha256(target),
				imageRevision: revision, pgDumpVersion, pgRestoreVersion
			}, keyId, privateKeyFile);
			const provenancePath = `${filePath}.provenance.json`;
			await writeFile(provenancePath, `${JSON.stringify(backupProvenance, null, 2)}\n`,
				{ encoding: 'utf8', flag: 'wx', mode: 0o600 });
			const objectKey = this.s3.key(target, jobId, fileName);
			const provenanceObjectKey = this.s3.key(target, jobId, `${fileName}.provenance.json`);
			const manifestObjectKey = this.s3.key(target, jobId, 'manifest.json');
			const manifestPath = join(directory, 'manifest.json');
			await writeFile(manifestPath, `${JSON.stringify({
				version: 1, target, jobId, createdAt: createdAt.toISOString(),
				objectKey, provenanceObjectKey, fileSha256, fileSize: file.size,
				provenanceEnvelopeSha256: backupProvenance.envelopeSha256
			}, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
			await this.s3.putFile(objectKey, filePath, 'application/octet-stream');
			await this.s3.putFile(provenanceObjectKey, provenancePath, 'application/json');
			// The manifest is written last: its presence denotes a complete backup pair.
			await this.s3.putFile(manifestObjectKey, manifestPath, 'application/json');
			await this.s3.pruneAfterSuccess(target, jobId);
			return {
				target, databaseName: database.name, schema: database.schema,
				fileName, fileSize: file.size, fileSha256,
				createdAt: createdAt.toISOString(), storage: 'S3',
				objectKey, provenanceObjectKey, manifestObjectKey, backupProvenance
			};
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}

	private requiredConfig(key: string): string {
		const value = this.config.get<string>(key)?.trim();
		if (!value || ['change_me', 'XYZXYZXYZ'].includes(value)) {
			throw new Error(`${key} is not configured`);
		}
		return value;
	}

	private requiredRevision(): string {
		const revision = this.requiredConfig('APP_REVISION');
		if (!/^[0-9a-f]{40}$/.test(revision)) {
			throw new Error('APP_REVISION must be an exact services SHA');
		}
		return revision;
	}

	private async version(
		command: 'pg_dump' | 'pg_restore',
		signal: AbortSignal
	): Promise<string> {
		const child = spawn(command, ['--version'], {
			env: this.pgEnvironment(null),
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let output = '';
		child.stdout?.on('data', chunk => {
			output = `${output}${Buffer.from(chunk).toString('utf8')}`.slice(
				-512
			);
		});
		await this.waitForChild(child, null, signal);
		const version = output.trim();
		if (!version) throw new Error(`${command} version is unavailable`);
		return version;
	}

	private database(target: DatabaseBackupTarget) {
		const key = URL_KEYS[target];
		const expected = DATABASE_TARGETS[target];
		const raw = this.config.get<string>(key)?.trim();
		if (!raw || ['change_me', 'XYZXYZXYZ'].includes(raw)) {
			throw new Error(`${key} is not configured`);
		}
		const url = new URL(raw);
		if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
			throw new Error(`${key} must be a PostgreSQL URL`);
		}
		const name = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
		const schema = url.searchParams.get('schema')?.trim() || 'public';
		const password = url.password
			? decodeURIComponent(url.password)
			: null;
		const allowedParameters = new Set([
				'schema',
				'sslmode',
				'connect_timeout',
				'application_name',
				'connection_limit',
				'pool_timeout',
				'pgbouncer',
				'statement_cache_size'
			]);
		const parameters = [...url.searchParams.keys()];
		if (
			decodeURIComponent(url.username) !== `${expected.database}_backup` ||
			url.hostname !== '127.0.0.1' ||
			url.port !== '5432' ||
			new Set(parameters).size !== parameters.length ||
			parameters.some(parameter => !allowedParameters.has(parameter))
		) {
			throw new Error(`${key} has an unexpected backup principal or target`);
		}
		if (!password || ['change_me', 'XYZXYZXYZ'].includes(password)) {
			throw new Error(`${key} is not configured securely`);
		}
		url.password = '';
		for (const parameter of [
			'schema',
			'connection_limit',
			'pool_timeout',
			'pgbouncer',
			'statement_cache_size'
		]) {
			url.searchParams.delete(parameter);
		}
		if (name !== expected.database || schema !== expected.schema) {
			throw new Error(`${key} has an unexpected database target`);
		}
		return { name, schema, password, url: url.toString() };
	}

	private async pgDump(
		url: string,
		password: string | null,
		schema: string,
		filePath: string,
		signal: AbortSignal
	): Promise<void> {
		const child = spawn(
			'pg_dump',
			[
				'--format=custom',
				'--no-owner',
				'--no-privileges',
				'--no-password',
				'--schema',
				schema,
				url
			],
			{
				env: this.pgEnvironment(password),
				stdio: ['ignore', 'pipe', 'pipe']
			}
		);
		if (!child.stdout) throw new Error('pg_dump stdout is unavailable');
		const output = pipeline(
			child.stdout,
			createWriteStream(filePath, { flags: 'wx', mode: 0o600 })
		);
		await this.waitForChild(child, password, signal, output);
	}

	private async run(
		command: 'pg_restore',
		args: string[],
		password: string | null,
		signal: AbortSignal
	): Promise<void> {
		const child = spawn(command, args, {
			env: this.pgEnvironment(password),
			stdio: ['ignore', 'ignore', 'pipe']
		});
		await this.waitForChild(child, password, signal);
	}

	private waitForChild(
		child: ReturnType<typeof spawn>,
		password: string | null,
		signal: AbortSignal,
		output?: Promise<void>
	): Promise<void> {
		return new Promise((resolve, reject) => {
			let stderr = '';
			let settled = false;
			const timeout = setTimeout(
				() => stop(new Error('PostgreSQL command timed out')),
				10 * 60_000
			);
			timeout.unref();
			const cleanup = () => {
				clearTimeout(timeout);
				signal.removeEventListener('abort', abort);
			};
			const finish = (error?: Error) => {
				if (settled) return;
				settled = true;
				cleanup();
				error ? reject(error) : resolve();
			};
			const stop = (error: Error) => {
				child.kill('SIGTERM');
				finish(error);
			};
			const abort = () => stop(new Error('Backup lease was lost'));
			signal.addEventListener('abort', abort, { once: true });
			child.stderr?.on('data', chunk => {
				stderr = `${stderr}${Buffer.from(chunk).toString('utf8')}`.slice(
					-2_000
				);
			});
			child.once('error', error => finish(error));
			child.once('close', async code => {
				try {
					if (output) await output;
					if (code !== 0) {
						throw new Error(
							`PostgreSQL command failed: ${this.redact(stderr, password)
								.trim()
								.slice(0, 1_000)}`
						);
					}
					finish();
				} catch (error) {
					finish(
						error instanceof Error ? error : new Error(String(error))
					);
				}
			});
		});
	}

	private pgEnvironment(password: string | null): NodeJS.ProcessEnv {
		const environment = { ...process.env };
		for (const key of Object.values(URL_KEYS)) delete environment[key];
		delete environment.PGPASSWORD;
		if (password) environment.PGPASSWORD = password;
		return environment;
	}

	private redact(value: string, secret: string | null): string {
		return secret ? value.split(secret).join('[REDACTED]') : value;
	}

	private async sha256(path: string): Promise<string> {
		const hash = createHash('sha256');
		for await (const chunk of createReadStream(path)) hash.update(chunk);
		return hash.digest('hex');
	}
}
