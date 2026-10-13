import { Prisma } from '@prisma/billing-client';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { RevokeEntitlementsCommandDto } from '../http/billing.dto';
import type { BillingAdminOverviewDto, BillingAdminPaymentStatus } from '../http/billing-admin-overview.dto';
import { BillingPrismaService } from '../prisma/billing-prisma.service';
import {
	assertBillingCommandReceipt,
	billingCommandRequestHash,
	lockBillingCommand
} from './billing-command-idempotency';
import { enqueueBillingAdminAudit } from './billing-admin-audit';
import { projectAdminEntitlement } from './crm-admin-subscription.service';

function adminPaymentStatus(value: string): BillingAdminPaymentStatus {
	if (value === 'PENDING' || value === 'SUCCEEDED' || value === 'CANCELLED' || value === 'EXPIRED' || value === 'UNKNOWN') return value;
	throw new ServiceUnavailableException('Unsupported payment status in admin overview');
}

@Injectable()
export class InternalCommandsService {
	constructor(private readonly prisma: BillingPrismaService) {}

	async revokeBeforeDeactivate(dto: RevokeEntitlementsCommandDto) {
		return this.executeCommand(
			dto.commandId,
			'REVOKE_BEFORE_DEACTIVATE',
			{
				schemaVersion: dto.schemaVersion,
				commandId: dto.commandId,
				userId: dto.userId,
				reason: dto.reason,
				actorId: dto.actorId,
				actorRole: dto.actorRole,
				occurredAt: new Date(dto.occurredAt).toISOString()
			},
			async transaction => {
				const crm = await this.revokeCrmOwner(transaction, dto);
				return { revoked: true, userId: dto.userId, crm };
			}
		);
	}

	private async revokeCrmOwner(
		transaction: Prisma.TransactionClient,
		dto: RevokeEntitlementsCommandDto
	) {
		const accounts = await transaction.crmCommerceAccount.findMany({
			where: { ownerSubject: dto.userId },
			orderBy: { workspaceId: 'asc' },
			select: { workspaceId: true }
		});
		let revokedRenewals = 0;
		let cancelledOrders = 0;
		let unknownOrders = 0;
		for (const account of accounts) {
			const workspaceId = account.workspaceId;
			await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`billing-crm-entitlement:${workspaceId}`}, 0))`;
			const renewal = await transaction.crmAutoRenewal.findUnique({
				where: { workspaceId }
			});
			if (renewal && renewal.status !== 'REVOKED') {
				const updated = await transaction.crmAutoRenewal.update({
					where: { workspaceId },
					data: {
						status: 'REVOKED',
						disabledAt: new Date(dto.occurredAt),
						dispatchPending: false,
						nextRetryAt: null,
						lastErrorCode: dto.reason,
						version: { increment: 1 }
					}
				});
				await transaction.crmAutoRenewalConsent.create({
					data: {
						workspaceId,
						actorSubject: dto.actorId,
						eventType: 'REVOKED',
						commandId: dto.commandId,
						renewalVersion: updated.version,
						evidence: {
							reason: dto.reason,
							actorRole: dto.actorRole,
							previousVersion: renewal.version
						}
					}
				});
				revokedRenewals += 1;
			}
			const orders = await transaction.crmOrder.findMany({
				where: {
					workspaceId,
					ownerSubject: dto.userId,
					status: { in: ['PENDING', 'UNKNOWN'] }
				},
				orderBy: { id: 'asc' }
			});
			for (const order of orders) {
				if (order.status === 'UNKNOWN') {
					await transaction.crmOrder.update({
						where: { id: order.id },
						data: { autoRenew: false, confirmationUrl: null, version: { increment: 1 } }
					});
					continue;
				}
				const operation = await transaction.crmProviderOperation.findFirst({
					where: { orderId: order.id, kind: 'CREATE' },
					orderBy: { createdAt: 'desc' }
				});
				const sent = Boolean(
					order.providerPaymentId ||
					operation?.providerPaymentId ||
					operation?.firstDispatchAt ||
					(operation?.dispatchAttempt ?? 0) > 0 ||
					['PROCESSING', 'UNKNOWN'].includes(operation?.status || '')
				);
				if (sent) {
					await transaction.crmOrder.update({
						where: { id: order.id },
						data: { status: 'UNKNOWN', autoRenew: false, confirmationUrl: null, version: { increment: 1 } }
					});
					if (operation?.status === 'PENDING') {
						await transaction.crmProviderOperation.update({
							where: { id: operation.id },
							data: { status: 'UNKNOWN', lastErrorCode: 'IDENTITY_DEACTIVATION_RECONCILIATION_REQUIRED', version: { increment: 1 } }
						});
					}
					unknownOrders += 1;
				} else {
					await transaction.crmOrder.update({
						where: { id: order.id },
						data: { status: 'CANCELLED', autoRenew: false, confirmationUrl: null, cancellationReason: 'IDENTITY_DEACTIVATION', version: { increment: 1 } }
					});
					if (operation) {
						await transaction.crmProviderOperation.update({
							where: { id: operation.id },
							data: { status: 'FAILED', leaseToken: null, leaseUntil: null, lastErrorCode: 'IDENTITY_DEACTIVATION', version: { increment: 1 } }
						});
					}
					await transaction.crmCommerceCommand.updateMany({
						where: { orderId: order.id, status: 'PENDING' },
						data: { status: 'CANCELLED' }
					});
					cancelledOrders += 1;
				}
			}
			if (renewal || orders.length) {
				await transaction.crmCommerceAccount.update({
					where: { workspaceId },
					data: { version: { increment: 1 } }
				});
				await enqueueBillingAdminAudit(transaction, {
					actor: { id: dto.actorId, role: dto.actorRole },
					section: 'SUBSCRIPTIONS',
					action: 'AUTO_RENEWAL_REVOKE',
					description: 'CRM owner deactivation revoked renewal and fenced pending orders',
					entity: {
						type: 'crm_commerce_account',
						id: workspaceId,
						label: null,
						targetUserId: dto.userId
					},
					metadata: {
						commandId: dto.commandId,
						reason: dto.reason,
						ownerSubject: dto.userId
					}
				});
			}
		}
		return { workspaces: accounts.length, revokedRenewals, cancelledOrders, unknownOrders };
	}

	async getAdminUserOverview(userId: string): Promise<BillingAdminOverviewDto> {
		return this.prisma.$transaction(async tx => {
			const now = new Date();
			// Commerce ownership is authoritative; before commerce is provisioned,
			// the entitlement's activating owner also covers trial workspaces.
			const workspaces = await tx.$queryRaw<{ workspaceId: string; currentPeriodId: string | null }[]>`
				WITH owned AS (
					SELECT workspace_id FROM billing.crm_commerce_accounts WHERE owner_subject = ${userId}
					UNION
					SELECT e.workspace_id FROM billing.crm_entitlements e
					WHERE e.activated_by_user_id = ${userId}
						AND NOT EXISTS (SELECT 1 FROM billing.crm_commerce_accounts a WHERE a.workspace_id = e.workspace_id)
				)
				SELECT owned.workspace_id AS "workspaceId", started.id AS "currentPeriodId" FROM owned
				LEFT JOIN LATERAL (
					SELECT p.id FROM billing.crm_paid_periods p
					WHERE p.workspace_id = owned.workspace_id AND p.starts_at <= ${now}
					ORDER BY p.starts_at DESC, p.id DESC LIMIT 1
				) started ON true
				ORDER BY owned.workspace_id
			`;
			const workspaceIds = workspaces.map(workspace => workspace.workspaceId);
			const periodIds = workspaces.flatMap(workspace => workspace.currentPeriodId ? [workspace.currentPeriodId] : []);
			const [entitlements, counts, latest, periods] = await Promise.all([
				tx.crmEntitlement.findMany({ where: { workspaceId: { in: workspaceIds } }, orderBy: { workspaceId: 'asc' } }),
				tx.crmOrder.groupBy({ by: ['status'], where: { ownerSubject: userId }, _count: { _all: true } }),
				tx.crmOrder.findMany({ where: { ownerSubject: userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 5,
					select: { id: true, workspaceId: true, providerPaymentId: true, status: true, amountMinor: true, kind: true, cycle: true, createdAt: true, updatedAt: true } }),
				periodIds.length ? tx.crmPaidPeriod.findMany({ where: { id: { in: periodIds }, workspaceId: { in: workspaceIds } } }) : []
			]);
			const periodByWorkspace = new Map(periods.map(period => [period.workspaceId, period]));
			const byWorkspace = new Map(entitlements.map(entitlement => [entitlement.workspaceId, {
				workspaceId: entitlement.workspaceId,
				productCode: entitlement.productCode,
				...projectAdminEntitlement(entitlement, periodByWorkspace.get(entitlement.workspaceId) ?? null, now),
				trialStartedAt: entitlement.trialStartedAt?.toISOString() ?? null,
				aggregateVersion: entitlement.aggregateVersion.toString(),
				sourceSequence: entitlement.sourceSequence.toString()
			}]));
			const paymentCounts = { PENDING: 0, SUCCEEDED: 0, CANCELLED: 0, EXPIRED: 0, UNKNOWN: 0 };
			for (const row of counts) paymentCounts[adminPaymentStatus(row.status)] = row._count._all;
			return {
				schemaVersion: 1,
				ownerSubject: userId,
				workspaces: workspaceIds.map(workspaceId => ({ workspaceId, entitlement: byWorkspace.get(workspaceId) ?? null })),
				paymentCounts,
				latestPayments: latest.map(order => ({
					...order, status: adminPaymentStatus(order.status), amountMinor: order.amountMinor.toString(),
					createdAt: order.createdAt.toISOString(), updatedAt: order.updatedAt.toISOString()
				}))
			};
		}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 15000 });
	}

	async getSubscriptionUserIds() {
		const rows = await this.prisma.crmCommerceAccount.findMany({ orderBy: { ownerSubject: 'asc' }, select: { ownerSubject: true } });
		const userIds = [...new Set(rows.map(row => row.ownerSubject))];
		return { schemaVersion: 1 as const, userIds, count: userIds.length, sourceSequence: '0' };
	}

	private async executeCommand<T extends Record<string, unknown>>(
		commandId: string,
		commandType: string,
		payload: Record<string, unknown>,
		mutate: (transaction: Prisma.TransactionClient) => Promise<T>
	): Promise<T> {
		const requestHash = billingCommandRequestHash(commandType, payload);
		for (let attempt = 1; attempt <= 3; attempt += 1) {
			try {
				return await this.prisma.$transaction(
					async transaction => {
						await lockBillingCommand(transaction, commandId);
						const prior =
							await transaction.billingCommandReceipt.findUnique({
								where: { commandId }
							});
						if (prior) {
							return assertBillingCommandReceipt(
								prior,
								commandType,
								requestHash
							) as unknown as T;
						}
						const result = await mutate(transaction);
						await transaction.billingCommandReceipt.create({
							data: {
								commandId,
								commandType,
								requestHash,
								requestHashVersion: 1,
								result: result as Prisma.InputJsonValue
							}
						});
						return result;
					},
					{
						isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
						maxWait: 5_000,
						timeout: 30_000
					}
				);
			} catch (error) {
				if (attempt === 3 || !this.retryableTransactionError(error)) {
					throw error;
				}
			}
		}
		throw new Error('Billing command retry loop exhausted');
	}

	private retryableTransactionError(error: unknown): boolean {
		return (
			typeof error === 'object' &&
			error !== null &&
			'code' in error &&
			(error as { code?: unknown }).code === 'P2034'
		);
	}

}
