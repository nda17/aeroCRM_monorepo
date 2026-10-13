import {
	Injectable,
	Logger,
	OnModuleDestroy,
	OnModuleInit
} from '@nestjs/common';
import { CrmAccessPrismaService } from '../prisma/crm-access-prisma.service';
import { CrmAccessRuntimeService } from '../runtime/crm-access-runtime.service';

type RetentionCounts = {
	inboxPurged: number;
	sessionsPurged: number;
	deliveriesSettled: number;
};

@Injectable()
export class TelegramRetentionService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(TelegramRetentionService.name);
	private timer?: ReturnType<typeof setInterval>;
	private running = false;
	private stopping = false;
	private lastAttemptAt: string | null = null;
	private lastSuccessAt: string | null = null;
	private lastErrorCode: string | null = null;
	private consecutiveFailures = 0;
	private passes = 0;
	private lastResult: RetentionCounts | null = null;

	constructor(
		private readonly prisma: CrmAccessPrismaService,
		private readonly runtime: CrmAccessRuntimeService
	) {}

	private get enabled() {
		return this.runtime.retentionEnabled && this.runtime.telegramWorkerEnabled;
	}

	onModuleInit() {
		if (!this.enabled) return;
		this.timer = setInterval(() => void this.tick(), 300_000);
		this.timer.unref();
		void this.tick();
	}

	onModuleDestroy() {
		this.stopping = true;
		if (this.timer) clearInterval(this.timer);
	}

	progress() {
		return {
			enabled: this.enabled,
			running: this.running,
			lastAttemptAt: this.lastAttemptAt,
			lastSuccessAt: this.lastSuccessAt,
			lastErrorCode: this.lastErrorCode,
			consecutiveFailures: this.consecutiveFailures,
			passes: this.passes,
			lastResult: this.lastResult && { ...this.lastResult }
		};
	}

	async tick() {
		if (!this.enabled || this.running || this.stopping) return;
		this.running = true;
		this.lastAttemptAt = new Date().toISOString();
		try {
			const [row] = await this.prisma.$queryRaw<{ result: RetentionCounts }[]>`
				SELECT crm_access.retire_telegram_technical_data() AS result`;
			if (
				!row ||
				!['inboxPurged', 'sessionsPurged', 'deliveriesSettled'].every(key => {
					const value = row.result[key as keyof RetentionCounts];
					return Number.isInteger(value) && value >= 0 && value <= 100;
				})
			)
				throw new Error('Invalid retention result');
			this.lastResult = { ...row.result };
			this.passes++;
			this.lastSuccessAt = new Date().toISOString();
			this.lastErrorCode = null;
			this.consecutiveFailures = 0;
		} catch {
			this.lastErrorCode = 'CRM_TELEGRAM_RETENTION_FAILED';
			this.consecutiveFailures++;
			this.logger.warn(this.lastErrorCode);
		} finally {
			this.running = false;
		}
	}
}
