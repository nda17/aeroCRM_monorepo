import {
	Injectable,
	Logger,
	OnApplicationShutdown,
	OnModuleInit
} from '@nestjs/common';
import {
	DeliveryFailureStatus,
	DeliveryReceiptStatus,
	Prisma,
} from '@prisma/billing-client';
import type { ConsumeMessage } from 'amqplib';
import { randomUUID } from 'node:crypto';
import { InternalCommandsService } from '../domain/internal-commands.service';
import { IdentityInternalClient } from '../internal/identity-internal.client';
import { BillingPrismaService } from '../prisma/billing-prisma.service';
import { BillingProjectionService } from '../projections/billing-projection.service';
import { BillingRuntimeService } from '../runtime/billing-runtime.service';
import {
	BillingConsumerKind,
	BILLING_DEAD_LETTER_EXCHANGE,
	BILLING_EVENT_TYPES,
	BILLING_RETRY_DELAYS_MS,
	BILLING_RETRY_EXCHANGE,
	billingDeadLetterRoutingKey,
	billingRetryRoutingKey
} from './billing-messaging.constants';
import { BillingRabbitMqService } from './billing-rabbitmq.service';

const SOURCE_KINDS: readonly BillingConsumerKind[] = [
	'identity',
	'offer',
	'notification-routing',
	'lifecycle-repair'
];
const RECEIPT_LEASE_MS = 60_000;

@Injectable()
export class BillingWorkerService
	implements OnModuleInit, OnApplicationShutdown
{
	private readonly logger = new Logger(BillingWorkerService.name);
	private readonly attached = new Set<BillingConsumerKind>();
	private ready = false;

	constructor(
		private readonly prisma: BillingPrismaService,
		private readonly runtime: BillingRuntimeService,
		private readonly rabbit: BillingRabbitMqService,
		private readonly projections: BillingProjectionService,
		private readonly commands: InternalCommandsService,
		private readonly identity: IdentityInternalClient
	) {}

	async onModuleInit(): Promise<void> {
		if (!this.runtime.workerEnabled) return;
		for (const kind of SOURCE_KINDS) {
			await this.attach(kind);
		}
		this.ready = true;
	}

	isReady(): boolean {
		return (
			!this.runtime.workerEnabled ||
			(this.ready &&
				SOURCE_KINDS.every(kind =>
					this.attached.has(kind)
				))
		);
	}

	onApplicationShutdown(): void {
		this.ready = false;
	}

	private async attach(kind: BillingConsumerKind): Promise<void> {
		if (this.attached.has(kind)) return;
		await this.rabbit.consume(
			kind,
			message => this.handle(kind, message),
			this.runtime.prefetch
		);
		this.attached.add(kind);
	}

	private async handle(
		kind: BillingConsumerKind,
		message: ConsumeMessage
	): Promise<void> {
		let payload: unknown;
		try {
			payload = JSON.parse(message.content.toString('utf8'));
		} catch {
			await this.finalFailure(
				kind,
				message,
				{},
				'INVALID_JSON',
				'Message is not valid JSON'
			);
			return;
		}
		try {
			this.preflightMessage(kind, payload, message);
		} catch (error) {
			await this.finalFailure(
				kind,
				message,
				payload,
				'MESSAGE_CONTRACT_INVALID',
				this.safeError(error)
			);
			return;
		}
		const eventId = this.eventId(payload, message);
		if (!eventId) {
			await this.finalFailure(
				kind,
				message,
				payload,
				'EVENT_ID_MISSING',
				'Message event ID is missing'
			);
			return;
		}
		const claim = await this.claimReceipt(eventId, kind);
		if (!claim) {
			this.rabbit.ack(message);
			return;
		}
		try {
			await this.deliver(kind, payload);
			await this.prisma.integrationDeliveryReceipt.updateMany({
				where: {
					eventId,
					consumer: kind,
					claimToken: claim
				},
				data: {
					status: DeliveryReceiptStatus.DELIVERED,
					deliveredAt: new Date(),
					leaseUntil: new Date(),
					lastError: null
				}
			});
			await this.prisma.integrationDeliveryFailure.updateMany({
				where: { eventId, consumer: kind },
				data: {
					status: DeliveryFailureStatus.RESOLVED,
					resolution: 'DELIVERED',
					resolvedAt: new Date(),
					retryingAt: null,
					activeRetryToken: null
				}
			});
			this.rabbit.ack(message);
		} catch (error) {
			await this.retryOrDeadLetter(
				kind,
				message,
				payload,
				eventId,
				claim,
				error
			);
		}
	}

	private async deliver(
		kind: BillingConsumerKind,
		payload: unknown
	): Promise<void> {
		if (kind === 'identity') {
			const event = this.projections.parse(
				payload,
				BILLING_EVENT_TYPES.identityChanged
			);
			await this.projections.applyIdentity(event);
			return;
		}
		if (kind === 'offer') {
			const event = this.projections.parse(
				payload,
				BILLING_EVENT_TYPES.offerChanged
			);
			await this.projections.applyOffer(event);
			return;
		}
		if (kind === 'notification-routing') {
			const event = this.projections.parse(
				payload,
				BILLING_EVENT_TYPES.notificationRoutingChanged
			);
			await this.projections.applyNotificationRouting(event);
			return;
		}
		if (kind === 'lifecycle-repair') {
			const event = this.projections.parse(
				payload,
				BILLING_EVENT_TYPES.lifecycleRepairRequested
			);
			const state = event.state;
			if (
				event.tombstone ||
				!state ||
				!this.exactKeys(state, [
					'commandId',
					'userId',
					'operation',
					'actorId',
					'actorRole',
					'requestedAt'
				]) ||
				typeof state.commandId !== 'string' ||
				state.userId !== event.aggregateId ||
				!['DEACTIVATE', 'DELETE'].includes(String(state.operation)) ||
				typeof state.actorId !== 'string' ||
				!['ADMIN', 'DEV'].includes(String(state.actorRole)) ||
				typeof state.requestedAt !== 'string' ||
				!Number.isFinite(Date.parse(state.requestedAt))
			) {
				throw new Error('Lifecycle repair state is invalid');
			}
			await this.commands.revokeBeforeDeactivate({
				schemaVersion: 1,
				commandId: state.commandId,
				userId: event.aggregateId,
				reason:
					state.operation === 'DELETE'
						? 'USER_SOFT_DELETE'
						: 'USER_DEACTIVATION',
				actorId: state.actorId,
				actorRole: state.actorRole as 'ADMIN' | 'DEV',
				occurredAt: state.requestedAt
			});
			await this.identity.completeLifecycle({
				schemaVersion: 1,
				commandId: state.commandId,
				userId: event.aggregateId,
				operation: state.operation as 'DEACTIVATE' | 'DELETE',
				actorId: state.actorId,
				actorRole: state.actorRole as 'ADMIN' | 'DEV',
				requestedAt: state.requestedAt
			});
			return;
		}
		throw new Error(`Unsupported Billing consumer kind ${kind}`);
	}

	private async claimReceipt(
		eventId: string,
		consumer: string
	): Promise<string | null> {
		const now = new Date();
		const current =
			await this.prisma.integrationDeliveryReceipt.findUnique({
				where: { eventId_consumer: { eventId, consumer } }
			});
		if (
			current &&
			(
				[
					DeliveryReceiptStatus.DELIVERED,
					DeliveryReceiptStatus.DEAD_LETTERED,
					DeliveryReceiptStatus.CLOSED_NO_RETRY
				] as DeliveryReceiptStatus[]
			).includes(current.status)
		)
			return null;
		if (
			current?.status === DeliveryReceiptStatus.PROCESSING &&
			current.leaseUntil &&
			current.leaseUntil > now
		)
			return null;
		if (
			current?.status === DeliveryReceiptStatus.RETRY_SCHEDULED &&
			current.retryAvailableAt &&
			current.retryAvailableAt > now
		)
			return null;
		const token = randomUUID();
		if (current) {
			const changed =
				await this.prisma.integrationDeliveryReceipt.updateMany({
					where: {
						eventId,
						consumer,
						OR: [
							{ status: DeliveryReceiptStatus.FAILED },
							{
								status: DeliveryReceiptStatus.RETRY_SCHEDULED,
								OR: [
									{ retryAvailableAt: null },
									{ retryAvailableAt: { lte: now } }
								]
							},
							{
								status: DeliveryReceiptStatus.PROCESSING,
								leaseUntil: { lte: now }
							}
						]
					},
					data: {
						status: DeliveryReceiptStatus.PROCESSING,
						claimToken: token,
						lockedAt: now,
						leaseUntil: new Date(now.getTime() + RECEIPT_LEASE_MS),
						retryToken: null,
						attempt: { increment: 1 }
					}
				});
			return changed.count === 1 ? token : null;
		}
		try {
			await this.prisma.integrationDeliveryReceipt.create({
				data: {
					eventId,
					consumer,
					lockedAt: now,
					claimToken: token,
					leaseUntil: new Date(now.getTime() + RECEIPT_LEASE_MS),
					attempt: 1
				}
			});
			return token;
		} catch (error) {
			if ((error as { code?: string }).code === 'P2002') {
				return this.claimReceipt(eventId, consumer);
			}
			throw error;
		}
	}

	private async retryOrDeadLetter(
		kind: BillingConsumerKind,
		message: ConsumeMessage,
		payload: unknown,
		eventId: string,
		claimToken: string,
		error: unknown
	): Promise<void> {
		const currentAttempt = Number(
			message.properties.headers?.['x-retry-attempt'] || 0
		);
		const nextAttempt = currentAttempt + 1;
		const retry = nextAttempt <= BILLING_RETRY_DELAYS_MS.length;
		const safe = this.safeError(error);
		const now = new Date();
		const retryToken = retry ? randomUUID() : null;
		const payloadRecord = this.record(payload);
		const originalEventType =
			typeof payloadRecord.eventType === 'string' &&
			payloadRecord.eventType
				? payloadRecord.eventType
				: message.properties.type || 'billing.delivery.unknown.v1';
		await this.prisma.$transaction(async transaction => {
			await transaction.integrationDeliveryReceipt.updateMany({
				where: { eventId, consumer: kind, claimToken },
				data: {
					status: retry
						? DeliveryReceiptStatus.RETRY_SCHEDULED
						: DeliveryReceiptStatus.DEAD_LETTERED,
					lockedAt: now,
					leaseUntil: null,
					claimToken: null,
					retryToken,
					retryAvailableAt: retry
						? new Date(
								now.getTime() + BILLING_RETRY_DELAYS_MS[nextAttempt - 1]
							)
						: null,
					lastError: safe
				}
			});
			const outboxId = randomUUID();
			await transaction.outboxEvent.create({
				data: {
					eventId: outboxId,
					messageId: eventId,
					eventType: originalEventType,
					aggregateType: 'billing.delivery',
					aggregateId: eventId,
					exchange: retry
						? BILLING_RETRY_EXCHANGE
						: BILLING_DEAD_LETTER_EXCHANGE,
					routingKey: retry
						? billingRetryRoutingKey(kind, nextAttempt)
						: billingDeadLetterRoutingKey(kind),
					payload: payload as Prisma.InputJsonValue,
					deliveryAttempt: nextAttempt
				}
			});
			await transaction.integrationDeliveryFailure.upsert({
				where: { eventId_consumer: { eventId, consumer: kind } },
				create: {
					eventId,
					consumer: kind,
					routingKey: message.fields.routingKey,
					payload: payload as Prisma.InputJsonValue,
					errorCode: 'DELIVERY_FAILED',
					errorSafe: safe,
					attempt: nextAttempt,
					status: retry
						? DeliveryFailureStatus.RETRY_PENDING
						: DeliveryFailureStatus.OPEN,
					retryOutboxId: outboxId,
					retryingAt: retry ? now : null,
					activeRetryToken: retryToken,
					lastError: safe,
					normalizedCode: 'DELIVERY_FAILED',
					safeReason: safe,
					firstFailedAt: now,
					failedAt: now
				},
				update: {
					errorSafe: safe,
					attempt: nextAttempt,
					status: retry
						? DeliveryFailureStatus.RETRY_PENDING
						: DeliveryFailureStatus.OPEN,
					retryOutboxId: outboxId,
					retryingAt: retry ? now : null,
					activeRetryToken: retryToken,
					lastError: safe,
					normalizedCode: 'DELIVERY_FAILED',
					safeReason: safe,
					failedAt: now,
					resolvedAt: null,
					resolution: null,
					resolutionComment: null,
					resolvedById: null
				}
			});
		});
		this.rabbit.ack(message);
	}

	private async finalFailure(
		kind: BillingConsumerKind,
		message: ConsumeMessage,
		payload: unknown,
		code: string,
		safe: string
	): Promise<void> {
		const eventId = this.uuid(message.properties.messageId)
			? message.properties.messageId
			: this.eventId(payload, message) || randomUUID();
		const outboxId = randomUUID();
		const failedAt = new Date();
		const payloadRecord = this.record(payload);
		const originalEventType =
			typeof payloadRecord.eventType === 'string' &&
			payloadRecord.eventType
				? payloadRecord.eventType
				: message.properties.type || 'billing.delivery.invalid.v1';
		await this.prisma.$transaction(async transaction => {
			await transaction.integrationDeliveryFailure.upsert({
				where: { eventId_consumer: { eventId, consumer: kind } },
				create: {
					eventId,
					consumer: kind,
					routingKey: message.fields.routingKey,
					payload: payloadRecord as Prisma.InputJsonValue,
					errorCode: code,
					errorSafe: safe,
					lastError: safe,
					normalizedCode: code,
					safeReason: safe,
					firstFailedAt: failedAt,
					failedAt,
					status: DeliveryFailureStatus.OPEN
				},
				update: {
					errorCode: code,
					errorSafe: safe,
					lastError: safe,
					normalizedCode: code,
					safeReason: safe,
					failedAt,
					retryingAt: null,
					activeRetryToken: null
				}
			});
			await transaction.outboxEvent.upsert({
				where: { deduplicationKey: `dead-letter:${kind}:${eventId}` },
				create: {
					eventId: outboxId,
					messageId: eventId,
					deduplicationKey: `dead-letter:${kind}:${eventId}`,
					eventType: originalEventType,
					aggregateType: 'billing.delivery',
					aggregateId: eventId,
					exchange: BILLING_DEAD_LETTER_EXCHANGE,
					routingKey: billingDeadLetterRoutingKey(kind),
					payload: payloadRecord as Prisma.InputJsonValue,
					deliveryAttempt: Number(
						message.properties.headers?.['x-retry-attempt'] || 0
					)
				},
				update: {}
			});
		});
		this.rabbit.ack(message);
	}

	private eventId(
		payload: unknown,
		message: ConsumeMessage
	): string | null {
		const value = this.record(payload);
		const id = value.eventId || message.properties.messageId;
		return this.uuid(id) ? id : null;
	}

	private preflightMessage(
		kind: BillingConsumerKind,
		payload: unknown,
		message: ConsumeMessage
	): 'owned' {
		const messageId = message.properties.messageId;
		if (!this.uuid(messageId)) {
			throw new Error('AMQP messageId must be a UUID');
		}
		const value = this.record(payload);
		if (
			value.eventId !== undefined &&
			(!this.uuid(value.eventId) || value.eventId !== messageId)
		) {
			throw new Error('Payload eventId must match AMQP messageId');
		}
		const sourceType: Partial<Record<BillingConsumerKind, string>> = {
			identity: BILLING_EVENT_TYPES.identityChanged,
			offer: BILLING_EVENT_TYPES.offerChanged,
			'notification-routing':
				BILLING_EVENT_TYPES.notificationRoutingChanged,
			'lifecycle-repair': BILLING_EVENT_TYPES.lifecycleRepairRequested
		};
		if (sourceType[kind]) {
			this.projections.parse(payload, sourceType[kind]!);
		}
		return 'owned';
	}

	private exactKeys(
		value: Record<string, unknown>,
		expected: readonly string[]
	): boolean {
		const actual = Object.keys(value).sort();
		const sorted = [...expected].sort();
		return (
			actual.length === sorted.length &&
			actual.every((key, index) => key === sorted[index])
		);
	}

	private uuid(value: unknown): value is string {
		return (
			typeof value === 'string' &&
			/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
				value
			)
		);
	}

	private record(value: unknown): Record<string, any> {
		return value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, any>)
			: {};
	}

	private safeError(error: unknown): string {
		return error instanceof Error
			? error.message.slice(0, 2_000)
			: 'Unknown delivery failure';
	}
}
