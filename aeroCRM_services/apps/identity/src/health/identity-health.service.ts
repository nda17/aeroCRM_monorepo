import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DestinationUnavailableWorkerService } from '../messaging/destination-worker.service';
import { IdentityOutboxPublisherService } from '../messaging/outbox-publisher.service';
import { IdentityRabbitMqService } from '../messaging/rabbitmq.service';
import { IdentityPrismaService } from '../prisma/identity-prisma.service';
import { IdentityHeartbeatService } from '../runtime/identity-heartbeat.service';
import { IdentityHousekeepingService } from '../runtime/identity-housekeeping.service';
import { IdentityRuntimeService } from '../runtime/identity-runtime.service';

@Injectable()
export class IdentityHealthService {
	constructor(
		private readonly prisma: IdentityPrismaService,
		private readonly runtime: IdentityRuntimeService,
		private readonly rabbit: IdentityRabbitMqService,
		private readonly worker: DestinationUnavailableWorkerService,
		private readonly publisher: IdentityOutboxPublisherService,
		private readonly heartbeat: IdentityHeartbeatService,
		private readonly housekeeping: IdentityHousekeepingService
	) {}

	liveness() {
		return this.status('ok');
	}

	revision() {
		return {
			service: 'identity',
			revision: process.env.APP_REVISION || 'unknown'
		};
	}

	async readiness() {
		try {
			await this.prisma.$queryRaw`SELECT 1`;
			await this.prisma
				.$queryRaw`SELECT c.browser_token_hash, c.identity_verified_at, r.count FROM identity.login_otp_challenges c FULL JOIN identity.login_otp_rate_limits r ON false LIMIT 0`;
			await this.prisma
				.$queryRaw`SELECT i.acceptance_id, i.email_verified_at, m.version, m.created_by_product, m.created_by_invitation_id FROM identity.workspace_invitations i FULL JOIN identity.workspace_members m ON false LIMIT 0`;
			const invariant = await this.prisma.$queryRaw<
				Array<{ ready: boolean }>
			>`
				SELECT (
				 EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
				  WHERE i.indrelid = 'identity.user_sessions'::regclass
				   AND c.relname = 'user_sessions_one_active_per_user' AND i.indisunique AND i.indisvalid
				   AND pg_get_expr(i.indpred, i.indrelid) = '(revoked_at IS NULL)'
				   AND pg_get_indexdef(i.indexrelid, 1, true) = 'user_id')
				 AND (SELECT count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
				  WHERE t.tgrelid = 'identity.user_sessions'::regclass AND NOT t.tgisinternal
				   AND t.tgenabled IN ('O', 'A') AND p.pronamespace = 'identity'::regnamespace
				   AND ((t.tgname = 'user_sessions_single_active' AND p.proname = 'enforce_single_active_session')
				    OR (t.tgname = 'user_sessions_revocation_signal' AND p.proname = 'notify_session_revoked'))) = 2
				) AS ready`;
			if (invariant[0]?.ready !== true) throw new Error();
			const identity = await this.prisma.serviceIdentity.findUnique({
				where: { id: 'singleton' },
				select: { serviceName: true, databaseId: true }
			});
			if (
				identity?.serviceName !== 'identity-service' ||
				!identity.databaseId
			) {
				throw new Error();
			}
		} catch {
			throw new ServiceUnavailableException(
				'Identity database is not ready'
			);
		}
		if (
			this.runtime.rabbitEnabled &&
			(!this.rabbit.isConnected() || !this.rabbit.isTopologyReady())
		) {
			throw new ServiceUnavailableException('RabbitMQ is not ready');
		}
		if (this.runtime.workerEnabled && !this.worker.isReady()) {
			throw new ServiceUnavailableException(
				'Identity worker is not ready'
			);
		}
		if (this.runtime.workerEnabled && !this.housekeeping.isReady()) {
			throw new ServiceUnavailableException(
				'Identity housekeeping is not ready'
			);
		}
		if (this.runtime.outboxPublisherEnabled && !this.publisher.isReady()) {
			throw new ServiceUnavailableException(
				'Identity Outbox publisher is not ready'
			);
		}
		if (!this.heartbeat.isReady()) {
			throw new ServiceUnavailableException(
				'Identity heartbeat is not ready'
			);
		}
		return this.status('ready');
	}

	private status(status: 'ok' | 'ready') {
		return {
			status,
			service: 'identity',
			role: this.runtime.role,
			revision: process.env.APP_REVISION || 'unknown'
		};
	}
}
