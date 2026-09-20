import { Prisma } from '@prisma/billing-client';
import { Injectable } from '@nestjs/common';
import type { RevokeEntitlementsCommandDto } from '../http/billing.dto';
import { BillingPrismaService } from '../prisma/billing-prisma.service';
import {
	assertBillingCommandReceipt,
	billingCommandRequestHash,
	lockBillingCommand
} from './billing-command-idempotency';
import { enqueueBillingAdminAudit } from './billing-admin-audit';

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

	async getAdminUserOverview(userId: string) {
		const accounts = await this.prisma.crmCommerceAccount.findMany({
			where: { ownerSubject: userId },
			orderBy: { workspaceId: 'asc' },
			select: { workspaceId: true }
		});
		const workspaceIds = accounts.map(account => account.workspaceId);
		const [entitlements, counts, latest] = await Promise.all([
			this.prisma.crmEntitlement.findMany({ where: { workspaceId: { in: workspaceIds } }, orderBy: { workspaceId: 'asc' } }),
			this.prisma.crmOrder.groupBy({ by: ['status'], where: { ownerSubject: userId }, _count: { _all: true } }),
			this.prisma.crmOrder.findMany({ where: { ownerSubject: userId }, orderBy: { createdAt: 'desc' }, take: 5,
				select: { id: true, providerPaymentId: true, status: true, amountMinor: true, kind: true, cycle: true, createdAt: true, updatedAt: true } })
		]);
		const paymentCounts = { PENDING: 0, SUCCEEDED: 0, CANCELLED: 0, EXPIRED: 0, UNKNOWN: 0 };
		for (const row of counts) {
			if (row.status in paymentCounts) paymentCounts[row.status as keyof typeof paymentCounts] = row._count._all;
		}
		return {
			subscription: entitlements[0] ?? null,
			crmEntitlements: entitlements,
			paymentCounts,
			latestPayments: latest.map(order => ({ ...order, amountMinor: order.amountMinor.toString() }))
		};
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
