import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	NotFoundException,
	ServiceUnavailableException
} from '@nestjs/common';
import { Prisma, type CrmRefundReview } from '@prisma/billing-client';
import { randomUUID } from 'node:crypto';
import type { BillingActor } from '../auth/billing-request';
import { IdentityInternalClient } from '../internal/identity-internal.client';
import { BillingPrismaService } from '../prisma/billing-prisma.service';
import {
	YooKassaService,
	ProviderRequestError
} from '../provider/yookassa.service';
import { isYooKassaWebhookSource } from '../provider/yookassa-webhook-source';
import {
	billingCommandRequestHash,
	lockBillingCommand
} from './billing-command-idempotency';
import { enqueueBillingAdminAudit } from './billing-admin-audit';
import {
	commerceRecord,
	commerceUuid,
	crmDecimal
} from './crm-commerce.helpers';

export const CRM_REFUND_REVIEW_CAPABILITY = 'crm-refund-manual-review-v1';

const PROVIDER_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ATTEMPTS = 10;
const LEASE_MS = 90_000;
type Tx = Prisma.TransactionClient;
type Context = {
	actor: BillingActor;
	authorization?: string;
	ip?: string | null;
	userAgent?: string | null;
};
type RefundCommand = {
	schemaVersion: 1;
	commandId: string;
	expectedVersion: number;
	comment?: string;
};

export function crmRefundView(row: CrmRefundReview) {
	return {
		schemaVersion: 1 as const,
		id: row.id,
		version: row.version,
		shopId: row.shopId,
		providerMode: row.providerMode,
		providerRefundId: row.providerRefundId,
		providerPaymentId: row.providerPaymentId,
		orderId: row.orderId,
		workspaceId: row.workspaceId,
		verificationStatus: row.verificationStatus,
		reviewStatus: row.reviewStatus,
		amountMinor: row.amountMinor?.toString() ?? null,
		currency: row.currency,
		providerCreatedAt: row.providerCreatedAt?.toISOString() ?? null,
		verifiedAt: row.verifiedAt?.toISOString() ?? null,
		attempts: row.attempts,
		lastErrorCode: row.lastErrorCode,
		reviewedAt: row.reviewedAt?.toISOString() ?? null,
		reviewedBy: row.reviewedBy,
		reviewComment: row.reviewComment,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}

class RefundVerificationError extends Error {
	constructor(
		readonly code: string,
		readonly retryable: boolean
	) {
		super(code);
	}
}

@Injectable()
export class CrmRefundService {
	constructor(
		private readonly prisma: BillingPrismaService,
		private readonly provider: YooKassaService,
		private readonly identity: IdentityInternalClient
	) {}

	async capture(value: unknown, sourceIp: unknown): Promise<boolean> {
		if (!commerceRecord(value) || value.event !== 'refund.succeeded')
			return false;
		if (!isYooKassaWebhookSource(sourceIp))
			throw new ForbiddenException(
				'Untrusted refund notification source'
			);
		if (
			value.type !== 'notification' ||
			!commerceRecord(value.object) ||
			!this.providerId(value.object.id) ||
			!this.providerId(value.object.payment_id) ||
			Buffer.byteLength(JSON.stringify(value), 'utf8') > 16_384
		)
			throw new BadRequestException('Invalid refund notification');
		let configuration: ReturnType<
			YooKassaService['refundVerificationConfiguration']
		>;
		try {
			configuration = this.provider.refundVerificationConfiguration();
		} catch {
			throw new ServiceUnavailableException(
				'Refund provider configuration is unavailable'
			);
		}
		if (
			!configuration.shopId ||
			configuration.shopId.length > 64 ||
			/\s|[\x00-\x1f\x7f]/.test(configuration.shopId)
		)
			throw new ServiceUnavailableException(
				'Refund provider configuration is unavailable'
			);
		// Only immutable identifiers are admitted. No webhook status, amount,
		// customer data or provider response is persisted as financial evidence.
		await this.prisma.crmRefundReview.createMany({
			data: [
				{
					shopId: configuration.shopId,
					providerMode:
						configuration.mode === 'test' ? 'TEST' : 'LIVE',
					providerRefundId: value.object.id.toLowerCase(),
					paymentIdHint: value.object.payment_id.toLowerCase()
				}
			],
			skipDuplicates: true
		});
		return true;
	}

	private role(actor: BillingActor): 'ADMIN' | 'DEV' {
		if (!actor.active) throw new ForbiddenException();
		if (actor.roles.includes('DEV')) return 'DEV';
		if (actor.roles.includes('ADMIN')) return 'ADMIN';
		throw new ForbiddenException();
	}
	async list(
		query: {
			page: number;
			limit: number;
			reviewStatus?: string;
			verificationStatus?: string;
		},
		actor: BillingActor
	) {
		this.role(actor);
		const where = {
			reviewStatus: query.reviewStatus,
			verificationStatus: query.verificationStatus
		};
		return this.prisma.$transaction(
			async tx => {
				const total = await tx.crmRefundReview.count({ where });
				const rows = await tx.crmRefundReview.findMany({
					where,
					skip: (query.page - 1) * query.limit,
					take: query.limit,
					orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
				});
				return {
					schemaVersion: 1 as const,
					page: query.page,
					limit: query.limit,
					total,
					items: rows.map(crmRefundView)
				};
			},
			{ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
		);
	}
	async detail(id: string, actor: BillingActor) {
		this.role(actor);
		const row = await this.prisma.crmRefundReview.findUnique({
			where: { id }
		});
		if (!row) throw new NotFoundException('Refund not found');
		return crmRefundView(row);
	}
	async command(
		id: string,
		kind: 'REVIEW' | 'RETRY',
		dto: RefundCommand,
		context: Context
	) {
		const role = this.role(context.actor);
		if (!context.authorization) throw new ForbiddenException();
		const fresh = await this.identity.introspect(context.authorization);
		if (
			fresh.subject !== context.actor.subject ||
			fresh.sessionId !== context.actor.sessionId ||
			this.role(fresh) !== role
		)
			throw new ForbiddenException('Administrator session changed');
		const comment = dto.comment?.trim();
		if (
			!commerceUuid(id) ||
			!commerceUuid(dto.commandId) ||
			dto.schemaVersion !== 1 ||
			!Number.isInteger(dto.expectedVersion) ||
			dto.expectedVersion < 1 ||
			dto.expectedVersion > 2147483645 ||
			(kind === 'REVIEW' &&
				(!comment ||
					comment.length > 2000 ||
					/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(comment)))
		)
			throw new BadRequestException('Invalid refund command');
		const requestHash = billingCommandRequestHash(`CRM_REFUND_${kind}`, {
			...dto,
			refundId: id,
			actorSubject: context.actor.subject
		});
		return this.transaction(async tx => {
			await lockBillingCommand(tx, dto.commandId);
			const previous = await tx.crmRefundCommandReceipt.findUnique({
				where: {
					actorSubject_commandId: {
						actorSubject: context.actor.subject,
						commandId: dto.commandId
					}
				}
			});
			if (previous) {
				if (
					previous.commandType !== kind ||
					previous.refundId !== id ||
					previous.requestHash !== requestHash
				)
					throw new ConflictException(
						'Refund command was used with another request'
					);
				return previous.result;
			}
			const current = await tx.crmRefundReview.findUnique({
				where: { id }
			});
			if (!current) throw new NotFoundException('Refund not found');
			if (
				current.version !== dto.expectedVersion ||
				(kind === 'REVIEW'
					? current.verificationStatus !== 'VERIFIED' ||
						current.reviewStatus !== 'PENDING'
					: !['FAILED', 'REJECTED'].includes(
							current.verificationStatus
						))
			)
				throw new ConflictException('Refund state changed');
			const changed = await tx.crmRefundReview.updateMany({
				where: { id, version: dto.expectedVersion },
				data: {
					...(kind === 'REVIEW'
						? {
								reviewStatus: 'REVIEWED',
								reviewedAt: new Date(),
								reviewedBy: context.actor.subject,
								reviewComment: comment!
							}
						: {
								verificationStatus: 'PENDING',
								attempts: 0,
								leaseToken: null,
								leaseUntil: null,
								availableAt: new Date(),
								lastErrorCode: null
							}),
					version: { increment: 1 }
				}
			});
			if (changed.count !== 1)
				throw new ConflictException('Refund state changed');
			const result = crmRefundView(
				await tx.crmRefundReview.findUniqueOrThrow({ where: { id } })
			);
			await tx.crmRefundCommandReceipt.create({
				data: {
					actorSubject: context.actor.subject,
					commandId: dto.commandId,
					commandType: kind,
					refundId: id,
					requestHash,
					result: result as Prisma.InputJsonValue
				}
			});
			await enqueueBillingAdminAudit(tx, {
				actor: {
					id: context.actor.subject,
					role,
					ip: context.ip,
					userAgent: context.userAgent
				},
				section: 'PAYMENTS',
				action:
					kind === 'REVIEW'
						? 'CRM_REFUND_REVIEWED'
						: 'CRM_REFUND_RETRY',
				description:
					kind === 'REVIEW'
						? 'Возврат CRM учтён вручную без изменения подписки'
						: 'Повторная проверка возврата CRM',
				entity: {
					type: 'crm.refund',
					id,
					label: current.providerRefundId,
					targetUserId: null
				},
				metadata: {
					commandId: dto.commandId,
					refundId: id,
					workspaceId: current.workspaceId,
					orderId: current.orderId,
					previousVersion: current.version,
					nextVersion: current.version + 1,
					subscriptionChanged: false
				}
			});
			return result;
		});
	}

	async processOne(): Promise<boolean> {
		const now = new Date();
		const claim = await this.transaction(async tx => {
			const row = await tx.crmRefundReview.findFirst({
				where: {
					verificationStatus: 'PENDING',
					availableAt: { lte: now },
					OR: [{ leaseToken: null }, { leaseUntil: { lte: now } }]
				},
				orderBy: [{ availableAt: 'asc' }, { id: 'asc' }]
			});
			if (!row) return null;
			if (row.attempts >= MAX_ATTEMPTS) {
				await tx.crmRefundReview.updateMany({
					where: { id: row.id, version: row.version },
					data: {
						verificationStatus: 'FAILED',
						leaseToken: null,
						leaseUntil: null,
						lastErrorCode: 'REFUND_ATTEMPTS_EXHAUSTED',
						version: { increment: 1 }
					}
				});
				return null;
			}
			const token = randomUUID();
			const changed = await tx.crmRefundReview.updateMany({
				where: { id: row.id, version: row.version },
				data: {
					leaseToken: token,
					leaseUntil: new Date(now.getTime() + LEASE_MS),
					attempts: { increment: 1 },
					version: { increment: 1 }
				}
			});
			return changed.count === 1
				? {
						...row,
						leaseToken: token,
						attempts: row.attempts + 1,
						version: row.version + 1
					}
				: null;
		});
		if (!claim) return false;
		try {
			this.configuration(claim);
			const refund = await this.provider.getRefund(
				claim.providerRefundId
			);
			if (
				!commerceRecord(refund) ||
				refund.id !== claim.providerRefundId ||
				refund.payment_id !== claim.paymentIdHint
			)
				throw new RefundVerificationError(
					'REFUND_BINDING_MISMATCH',
					false
				);
			if (refund.status !== 'succeeded')
				throw new RefundVerificationError('REFUND_NOT_SUCCEEDED', true);
			if (!this.providerId(refund.payment_id))
				throw new RefundVerificationError(
					'REFUND_BINDING_MISMATCH',
					false
				);
			this.configuration(claim);
			const payment = await this.provider.getPayment(
				refund.payment_id,
				'AEROCRM'
			);
			this.configuration(claim);
			await this.verify(claim, refund, payment);
		} catch (error) {
			const failure =
				error instanceof RefundVerificationError
					? error
					: error instanceof ProviderRequestError
						? new RefundVerificationError(
								error.status === 404
									? 'REFUND_PROVIDER_NOT_FOUND'
									: error.code,
								error.status !== 404 &&
									(error.retryable || error.ambiguous)
							)
						: new RefundVerificationError(
								'REFUND_DEPENDENCY_UNAVAILABLE',
								true
							);
			await this.fail(claim, failure);
		}
		return true;
	}
	private configuration(row: CrmRefundReview) {
		const config = this.provider.refundVerificationConfiguration();
		if (
			config.shopId !== row.shopId ||
			(config.mode === 'test' ? 'TEST' : 'LIVE') !== row.providerMode
		)
			throw new RefundVerificationError(
				'REFUND_CONFIGURATION_MISMATCH',
				false
			);
	}
	private providerId(value: unknown): value is string {
		return typeof value === 'string' && PROVIDER_ID.test(value);
	}
	private amount(value: unknown): bigint {
		if (
			typeof value !== 'string' ||
			!/^(0|[1-9][0-9]{0,10})\.[0-9]{2}$/.test(value)
		)
			throw new RefundVerificationError('REFUND_AMOUNT_INVALID', false);
		const amount = BigInt(value.replace('.', ''));
		if (amount < 1n || amount > 1_000_000_000_000n)
			throw new RefundVerificationError('REFUND_AMOUNT_INVALID', false);
		return amount;
	}
	private async verify(
		claim: CrmRefundReview,
		refund: Record<string, unknown>,
		payment: Record<string, unknown>
	) {
		if (
			!commerceRecord(payment.metadata) ||
			!commerceUuid(payment.metadata.paymentId) ||
			!commerceRecord(payment.recipient) ||
			payment.recipient.account_id !== claim.shopId ||
			payment.test !== (claim.providerMode === 'TEST') ||
			payment.id !== refund.payment_id ||
			payment.status !== 'succeeded' ||
			payment.paid !== true ||
			!commerceRecord(payment.amount) ||
			!commerceRecord(refund.amount) ||
			refund.amount.currency !== 'RUB' ||
			payment.amount.currency !== 'RUB'
		)
			throw new RefundVerificationError(
				'REFUND_PAYMENT_BINDING_MISMATCH',
				false
			);
		const amount = this.amount(refund.amount.value);
		const providerCreatedAt =
			typeof refund.created_at === 'string' &&
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(
				refund.created_at
			)
				? new Date(refund.created_at)
				: null;
		if (!providerCreatedAt || !Number.isFinite(providerCreatedAt.getTime()))
			throw new RefundVerificationError('REFUND_DATE_INVALID', false);
		const normalizedDate = (refund.created_at as string).replace(
			/(?:\.(\d+))?Z$/,
			(_match, fraction: string | undefined) =>
				`.${(fraction ?? '').slice(0, 3).padEnd(3, '0')}Z`
		);
		if (providerCreatedAt.toISOString() !== normalizedDate)
			throw new RefundVerificationError('REFUND_DATE_INVALID', false);
		const metadata = payment.metadata;
		const paymentAmount = payment.amount;
		if (metadata.productCode !== 'AEROCRM' || metadata.plan !== 'AEROCRM')
			throw new RefundVerificationError(
				'REFUND_PAYMENT_BINDING_MISMATCH',
				false
			);
		const orderId = metadata.paymentId as string;
		await this.transaction(async tx => {
			await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`billing-refund-order:${orderId}`}, 0))`;
			const order = await tx.crmOrder.findUnique({
				where: { id: orderId }
			});
			if (!order)
				throw new RefundVerificationError(
					'REFUND_ORDER_NOT_FOUND',
					true
				);
			if (
				metadata.billingPeriod !== order.cycle ||
				metadata.kind !== order.kind ||
				(order.providerPaymentId !== null &&
					order.providerPaymentId !== payment.id) ||
				paymentAmount.value !== crmDecimal(order.amountMinor) ||
				order.currency !== 'RUB' ||
				amount > order.amountMinor
			)
				throw new RefundVerificationError(
					'REFUND_PAYMENT_BINDING_MISMATCH',
					false
				);
			if (
				order.status !== 'SUCCEEDED' ||
				order.providerPaymentId === null
			)
				throw new RefundVerificationError(
					'REFUND_ORDER_NOT_SETTLED',
					true
				);
			const total = await tx.crmRefundReview.aggregate({
				where: {
					orderId,
					verificationStatus: 'VERIFIED',
					id: { not: claim.id }
				},
				_sum: { amountMinor: true }
			});
			if ((total._sum.amountMinor ?? 0n) + amount > order.amountMinor)
				throw new RefundVerificationError(
					'REFUND_TOTAL_EXCEEDS_PAYMENT',
					false
				);
			await tx.$queryRaw`SELECT billing.touch_workspace_fence(${order.workspaceId}::uuid)`;
			const changed = await tx.crmRefundReview.updateMany({
				where: this.lease(claim),
				data: {
					verificationStatus: 'VERIFIED',
					providerPaymentId: payment.id as string,
					orderId: order.id,
					workspaceId: order.workspaceId,
					amountMinor: amount,
					currency: 'RUB',
					providerCreatedAt,
					verifiedAt: new Date(),
					leaseToken: null,
					leaseUntil: null,
					lastErrorCode: null,
					version: { increment: 1 }
				}
			});
			if (changed.count !== 1) throw new Error('REFUND_LEASE_LOST');
		});
	}
	private lease(claim: CrmRefundReview): Prisma.CrmRefundReviewWhereInput {
		return {
			id: claim.id,
			version: claim.version,
			verificationStatus: 'PENDING',
			leaseToken: claim.leaseToken,
			leaseUntil: { gt: new Date() }
		};
	}
	private async fail(claim: CrmRefundReview, error: RefundVerificationError) {
		await this.prisma.crmRefundReview.updateMany({
			where: this.lease(claim),
			data: {
				verificationStatus: error.retryable
					? claim.attempts >= MAX_ATTEMPTS
						? 'FAILED'
						: 'PENDING'
					: 'REJECTED',
				leaseToken: null,
				leaseUntil: null,
				lastErrorCode: error.code,
				availableAt: new Date(
					Date.now() +
						Math.min(
							300_000,
							5000 * 2 ** Math.min(claim.attempts - 1, 6)
						)
				),
				version: { increment: 1 }
			}
		});
	}
	private async transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
		for (let attempt = 0; ; attempt++) {
			try {
				return await this.prisma.$transaction(work, {
					isolationLevel:
						Prisma.TransactionIsolationLevel.Serializable,
					maxWait: 5000,
					timeout: 15000
				});
			} catch (error) {
				if (
					attempt >= 2 ||
					(error as { code?: string }).code !== 'P2034'
				)
					throw error;
			}
		}
	}
}
