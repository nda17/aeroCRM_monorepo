import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/operations-client';
import { ConfigService } from '@nestjs/config';
import type { ConsumeMessage } from 'amqplib';
import { randomUUID } from 'node:crypto';
import { OPERATIONS_SCHEDULED_JOB_EVENT_TYPE } from '../messaging/operations-messaging.constants';
import {
	OperationsConsumeDecision,
	OperationsRabbitMqService
} from '../messaging/operations-rabbitmq.service';
import { OperationalAlertService } from '../monitoring/operational-alert.service';
import { OperationsPrismaService } from '../prisma/operations-prisma.service';
import { OperationsRuntimeService } from '../runtime/operations-runtime.service';
import {
	DATABASE_BACKUP_TARGETS,
	DATABASE_BACKUP_REPORT_JOB_TYPE,
	DatabaseBackupTarget,
	databaseBackupJobType
} from '../scheduled-jobs/scheduled-jobs.types';
import {
	BackupJobClaim,
	ScheduledJobsService
} from '../scheduled-jobs/scheduled-jobs.service';
import { DatabaseBackupService } from './database-backup.service';

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEASE_MS = 60_000;

@Injectable()
export class MaintenanceWorkerService implements OnModuleInit {
	private readonly logger = new Logger(MaintenanceWorkerService.name);
	private ready = false;
	private readonly instanceId = `operations-worker-${randomUUID()}`;

	constructor(
		private readonly runtime: OperationsRuntimeService,
		private readonly rabbit: OperationsRabbitMqService,
		private readonly jobs: ScheduledJobsService,
		private readonly backup: DatabaseBackupService,
		private readonly prisma: OperationsPrismaService,
		private readonly alerts: OperationalAlertService
		,private readonly config: ConfigService
	) {}

	async onModuleInit(): Promise<void> {
		if (!this.runtime.workerEnabled) return;
		await this.rabbit.consumeScheduledJobs(message =>
			this.handleScheduledJob(message)
		);
		this.ready = true;
	}

	isReady(): boolean {
		return !this.runtime.workerEnabled || this.ready;
	}

	async handleScheduledJob(
		message: ConsumeMessage
	): Promise<OperationsConsumeDecision> {
		let event: { eventId: string; jobId: string; jobType: string };
		try {
			event = this.parseEvent(message);
		} catch {
			return 'reject';
		}
		let claim: BackupJobClaim;
		try {
			claim = await this.jobs.claimBackup(
				event,
				this.instanceId,
				LEASE_MS
			);
		} catch {
			return 'requeue';
		}
		if (claim.status === 'REJECT') return 'reject';
		if (claim.status === 'REQUEUE') return 'requeue';
		if (claim.status !== 'CLAIMED') return 'ack';
		if (claim.job.jobType === DATABASE_BACKUP_REPORT_JOB_TYPE) {
			return this.handleBackupReport(claim);
		}
		const input = this.parseBackupInput(
			claim.job.input,
			claim.job.jobType
		);
		if (!input) {
			try {
				const failed = await this.jobs.fail(
					claim.job.id,
					claim.leaseToken,
					new Error('Unsupported Operations scheduled job'),
					60_000
				);
				return failed ? 'ack' : 'requeue';
			} catch {
				return 'requeue';
			}
		}
		const controller = new AbortController();
		const renew = setInterval(() => {
			void this.jobs
				.renewLease(claim.job.id, claim.leaseToken, LEASE_MS)
				.then(ok => {
					if (!ok) controller.abort(new Error('Backup lease was lost'));
				})
				.catch(() =>
					controller.abort(new Error('Backup lease renewal failed'))
				);
		}, LEASE_MS / 3);
		renew.unref();
		try {
			const result = await this.backup.createAndStore(
				claim.job.id,
				input.target,
				{ ...input, backupJobCreatedAt: claim.job.createdAt },
				controller.signal
			);
			const completed = await this.jobs.complete(
				claim.job.id,
				claim.leaseToken,
				{
					...result,
					backupProvenance: result.backupProvenance
						? (JSON.parse(
								JSON.stringify(result.backupProvenance)
							) as Prisma.InputJsonValue)
						: null,
				}
			);
			if (!completed) return 'requeue';
			await this.alerts
				.resolve(`database-backup:${input.target}`)
				.catch(() =>
					this.logger.warn(
						`Could not resolve backup alert target=${input.target}`
					)
				);
			return 'ack';
		} catch (error) {
			try {
				const failed = await this.jobs.fail(
					claim.job.id,
					claim.leaseToken,
					error,
					30_000 * 2 ** Math.min(claim.job.attempts, 6)
				);
				if (!failed) return 'requeue';
			} catch {
				return 'requeue';
			}
			this.logger.warn(`Database backup failed jobId=${claim.job.id}`);
			return 'ack';
		} finally {
			clearInterval(renew);
		}
	}

	private async handleBackupReport(claim: Extract<BackupJobClaim, { status: 'CLAIMED' }>): Promise<OperationsConsumeDecision> {
		try {
			const input = claim.job.input as Record<string, unknown>;
			if (input.schemaVersion !== 1 || typeof input.chatId !== 'string' ||
				!input.chatId.trim() || !Number.isInteger(input.messageThreadId) ||
				Number(input.messageThreadId) < 1 || !claim.job.periodStart) {
				throw new Error('Invalid backup report job input');
			}
			const periodStart = new Date(claim.job.periodStart);
			const jobs = await this.prisma.scheduledJobRun.findMany({
				where: { periodStart, jobType: { in: [...DATABASE_BACKUP_TARGETS.map(databaseBackupJobType)] } }
			});
			if (jobs.length !== DATABASE_BACKUP_TARGETS.length || jobs.some(job =>
				job.status !== 'SUCCEEDED' && job.status !== 'FAILED' && job.status !== 'CANCELLED')) {
				throw new Error('Daily backups are not all terminal');
			}
			const succeeded = jobs.filter(job => job.status === 'SUCCEEDED');
			const failed = jobs.filter(job => job.status !== 'SUCCEEDED');
			const totalBytes = succeeded.reduce((sum, job) => {
				const result = job.result as Record<string, unknown> | null;
				return sum + (typeof result?.fileSize === 'number' ? result.fileSize : 0);
			}, 0);
			const consoleUrl = this.config.get<string>('CRM_BACKUP_BUCKET_CONSOLE_URL')?.trim();
			if (!consoleUrl || new URL(consoleUrl).protocol !== 'https:') throw new Error('Private S3 console URL is not configured');
			const text = ['<b>aeroCRM: резервное копирование баз</b>',
				`Период: ${new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow' }).format(periodStart)}`,
				`Успешно: ${succeeded.length}/${DATABASE_BACKUP_TARGETS.length}`,
				`Объём: ${(totalBytes / 1024 / 1024).toFixed(1)} МиБ`,
				...DATABASE_BACKUP_TARGETS.map(target => {
					const job = jobs.find(item => item.jobType === databaseBackupJobType(target));
					return `${job?.status === 'SUCCEEDED' ? '✅' : '❌'} ${target}`;
				})].join('\n');
			const complete = await this.jobs.completeBackupReport({
				id: claim.job.id, leaseToken: claim.leaseToken, periodStart,
				chatId: input.chatId, messageThreadId: Number(input.messageThreadId),
				text, consoleUrl,
				result: { succeeded: succeeded.length, failed: failed.length, totalBytes }
			});
			return complete ? 'ack' : 'requeue';
		} catch (error) {
			try {
				const failed = await this.jobs.fail(claim.job.id, claim.leaseToken, error, 300_000);
				return failed ? 'ack' : 'requeue';
			} catch {
				return 'requeue';
			}
		}
	}

	private parseEvent(message: ConsumeMessage) {
		if (
			message.properties.type !== OPERATIONS_SCHEDULED_JOB_EVENT_TYPE ||
			message.content.length > 64 * 1024
		) {
			throw new Error('Scheduled job message properties are invalid');
		}
		const value = JSON.parse(message.content.toString('utf8')) as unknown;
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			throw new Error('Scheduled job event is invalid');
		}
		const record = value as Record<string, unknown>;
		if (
			Object.keys(record).sort().join(',') !==
				'eventId,jobId,jobType,schemaVersion' ||
			record.schemaVersion !== 1 ||
			typeof record.eventId !== 'string' ||
			!UUID_PATTERN.test(record.eventId) ||
			typeof record.jobId !== 'string' ||
			!UUID_PATTERN.test(record.jobId) ||
			typeof record.jobType !== 'string' ||
			message.properties.messageId !== record.eventId
		) {
			throw new Error('Scheduled job event contract is invalid');
		}
		return {
			eventId: record.eventId,
			jobId: record.jobId,
			jobType: record.jobType
		};
	}

	private parseBackupInput(value: unknown, jobType: string) {
		if (!value || typeof value !== 'object' || Array.isArray(value))
			return null;
		const record = value as Record<string, unknown>;
		if (
			record.schemaVersion !== 1 ||
			typeof record.target !== 'string' ||
			!DATABASE_BACKUP_TARGETS.includes(
				record.target as DatabaseBackupTarget
			) ||
			jobType !==
				databaseBackupJobType(record.target as DatabaseBackupTarget) ||
			typeof record.chatId !== 'string' ||
			!record.chatId.trim() ||
			!Number.isInteger(record.messageThreadId) ||
			Number(record.messageThreadId) < 1 ||
			(record.trigger !== 'MANUAL' && record.trigger !== 'SCHEDULED')
		) {
			return null;
		}
		return {
			target: record.target as DatabaseBackupTarget,
			chatId: record.chatId,
			messageThreadId: record.messageThreadId as number,
			trigger: record.trigger as 'MANUAL' | 'SCHEDULED'
		};
	}
}
