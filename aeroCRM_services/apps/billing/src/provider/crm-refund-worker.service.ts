import {
	Injectable,
	Logger,
	OnApplicationShutdown,
	OnModuleInit
} from '@nestjs/common';
import { CrmRefundService } from '../domain/crm-refund.service';
import { BillingRuntimeService } from '../runtime/billing-runtime.service';

@Injectable()
export class CrmRefundWorkerService
	implements OnModuleInit, OnApplicationShutdown
{
	private readonly logger = new Logger(CrmRefundWorkerService.name);
	private timer: NodeJS.Timeout | null = null;
	private running = false;
	private stopping = false;
	constructor(
		private readonly runtime: BillingRuntimeService,
		private readonly refunds: CrmRefundService
	) {}
	onModuleInit() {
		if (!this.runtime.workerEnabled) return;
		// A single bounded item per tick: no new Rabbit topology and no provider
		// POST calls. Durable leases recover a crashed verification worker.
		this.timer = setInterval(() => void this.tick(), 5000);
		this.timer.unref();
		void this.tick();
	}
	onApplicationShutdown() {
		this.stopping = true;
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}
	isReady() {
		return (
			!this.runtime.workerEnabled ||
			(!this.stopping && this.timer !== null)
		);
	}
	async tick() {
		if (this.running || this.stopping) return;
		this.running = true;
		try {
			await this.refunds.processOne();
		} catch {
			this.logger.error(
				'Refund verification tick failed; private details suppressed'
			);
		} finally {
			this.running = false;
		}
	}
}
