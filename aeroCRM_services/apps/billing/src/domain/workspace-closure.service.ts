import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/billing-client';
import { BillingPrismaService } from '../prisma/billing-prisma.service';

export interface BillingClosureEnvelope {
	schemaVersion: 1;
	closureId: string;
	workspaceId: string;
	generation: '1';
	ownerSubject: string;
	requestedAt: string;
}

@Injectable()
export class BillingWorkspaceClosureService {
	constructor(private readonly prisma: BillingPrismaService) {}

	async fence(input: BillingClosureEnvelope) {
		for (let attempt = 0; ; attempt++) {
			try {
				return await this.prisma.$transaction(async tx => {
					await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
					await tx.$executeRaw`SET LOCAL statement_timeout = '20s'`;
					await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`billing-crm-entitlement:${input.workspaceId}`}, 0))`;
					const existing = await tx.workspaceClosureFence.findUnique({ where: { workspaceId: input.workspaceId } });
					if (existing?.fencedAt) {
						if (existing.closureId !== input.closureId || existing.generation !== 1n ||
							existing.ownerSubject !== input.ownerSubject || existing.requestedAt?.toISOString() !== input.requestedAt)
							throw new ConflictException('Workspace has another closure binding');
						return this.ack(input, existing.fencedAt, existing.financialPendingCount);
					}
					await tx.$executeRaw`SELECT billing.assert_workspace_open(${input.workspaceId}::uuid)`;
					const account = await tx.crmCommerceAccount.findUnique({ where: { workspaceId: input.workspaceId } });
					if (account && account.ownerSubject !== input.ownerSubject)
						throw new ForbiddenException('Billing owner binding changed');
					const renewal = await tx.crmAutoRenewal.findUnique({ where: { workspaceId: input.workspaceId } });
					if (renewal && renewal.status !== 'REVOKED') {
						await tx.crmAutoRenewal.update({ where: { workspaceId: input.workspaceId }, data: {
							status: 'REVOKED', disabledAt: new Date(input.requestedAt), dispatchPending: false,
							nextRetryAt: null, retryStartedAt: null, lastErrorCode: 'WORKSPACE_CLOSED',
							version: { increment: 1 }
						} });
						await tx.crmAutoRenewalConsent.create({ data: {
							workspaceId: input.workspaceId, actorSubject: input.ownerSubject, eventType: 'REVOKED',
							commandId: input.closureId, renewalVersion: renewal.version + 1,
							evidence: { reason: 'WORKSPACE_CLOSED', closureId: input.closureId, previousVersion: renewal.version }
						} });
					}
					const orders = await tx.crmOrder.findMany({ where: { workspaceId: input.workspaceId,
						status: { in: ['PENDING','UNKNOWN'] } }, orderBy: { id: 'asc' } });
					for (const order of orders) {
						if (order.ownerSubject !== input.ownerSubject) throw new ForbiddenException('Billing order owner binding changed');
						const operation = await tx.crmProviderOperation.findFirst({ where: { orderId: order.id, kind: 'CREATE' }, orderBy: { createdAt: 'desc' } });
						const sent = order.status === 'UNKNOWN' || Boolean(order.providerPaymentId || operation?.providerPaymentId ||
							operation?.firstDispatchAt || (operation?.dispatchAttempt ?? 0) > 0 ||
							['PROCESSING','UNKNOWN'].includes(operation?.status || ''));
						await tx.crmOrder.update({ where: { id: order.id }, data: sent
							? { status: 'UNKNOWN', autoRenew: false, confirmationUrl: null, version: { increment: 1 } }
							: { status: 'CANCELLED', autoRenew: false, confirmationUrl: null,
								cancellationReason: 'WORKSPACE_CLOSED', version: { increment: 1 } } });
						if (operation && operation.status === 'PENDING') {
							await tx.crmProviderOperation.update({ where: { id: operation.id }, data: sent
								? { status: 'UNKNOWN', leaseToken: null, leaseUntil: null,
									lastErrorCode: 'WORKSPACE_CLOSED_RECONCILIATION_REQUIRED', version: { increment: 1 } }
								: { status: 'FAILED', leaseToken: null, leaseUntil: null,
									lastErrorCode: 'WORKSPACE_CLOSED', version: { increment: 1 } } });
						}
						if (!sent) await tx.crmCommerceCommand.updateMany({ where: { orderId: order.id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
					}
					await tx.crmEntitlement.updateMany({ where: { workspaceId: input.workspaceId,
						status: { notIn: ['SUSPENDED','CANCELLED'] } }, data: { status: 'SUSPENDED' } });
					if (account && (renewal || orders.length)) await tx.crmCommerceAccount.update({ where: { workspaceId: input.workspaceId }, data: { version: { increment: 1 } } });
					const financialPendingCount = await tx.crmOrder.count({ where: { workspaceId: input.workspaceId,
						status: { in: ['PENDING','UNKNOWN'] } } });
					const fencedAt = new Date();
					await tx.workspaceClosureFence.update({ where: { workspaceId: input.workspaceId }, data: {
						closureId: input.closureId, generation: 1n, ownerSubject: input.ownerSubject,
						requestedAt: new Date(input.requestedAt), fencedAt, financialPendingCount,
						revision: { increment: 1 }
					} });
					return this.ack(input, fencedAt, financialPendingCount);
				}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 25000 });
			} catch (error) {
				if (attempt >= 2 || !((error as { code?: string }).code === 'P2034' ||
					((error as { code?: string }).code === 'P2010' &&
						['40001', '40P01'].includes(String(
							(error as { meta?: { code?: unknown } }).meta?.code))))) throw error;
			}
		}
	}

	private ack(input: BillingClosureEnvelope, fencedAt: Date, financialPendingCount: number) {
		return { schemaVersion: 1 as const, service: 'billing' as const, closureId: input.closureId,
			workspaceId: input.workspaceId, generation: input.generation, state: 'FENCED' as const,
			fencedAt: fencedAt.toISOString(), financialPendingCount, priorDispatchCount: 0 };
	}
}
