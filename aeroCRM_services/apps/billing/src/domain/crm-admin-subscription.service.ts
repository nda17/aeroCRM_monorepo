import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	NotFoundException,
	Optional,
	ServiceUnavailableException
} from '@nestjs/common';
import {
	Prisma,
	type CrmAdminDayGrant,
	type CrmAdminSeatAdjustment,
	type CrmEntitlement,
	type CrmCommerceAccount,
	type CrmPaidPeriod,
	type CrmAutoRenewal
} from '@prisma/billing-client';
import type { BillingActor } from '../auth/billing-request';
import { BillingPrismaService } from '../prisma/billing-prisma.service';
import type {
	CrmAdminSubscriptionListDto,
	CrmAdminSubscriptionPageDto,
	CancelCrmSubscriptionGrantDto,
	ExtendCrmSubscriptionDaysDto,
	SetCrmSubscriptionSeatsDto
} from '../http/crm-admin-subscription.dto';
import type { CrmAdminSeatOperationDto } from '../http/billing-crm-commerce.dto';
import {
	CrmAccessAdminSeatsClient,
	type AdminSeatFence
} from '../internal/crm-access-admin-seats.client';
import { IdentityInternalClient } from '../internal/identity-internal.client';
import { enqueueBillingAdminAudit } from './billing-admin-audit';
import {
	assertBillingCommandReceipt,
	billingCommandRequestHash,
	lockBillingCommand
} from './billing-command-idempotency';
import { enqueueCrmEntitlementChanged } from './crm-entitlement-outbox';
import { readCrmPriceSnapshot } from './crm-commerce.helpers';

const COMMAND_TYPE = 'ADMIN_EXTEND_AEROCRM_DAYS';
const CANCEL_COMMAND_TYPE = 'CANCEL_ADMIN_EXTEND_AEROCRM_DAYS';
const SEAT_COMMAND_TYPE = 'ADMIN_SET_AEROCRM_SEATS';
const CANCEL_SEAT_COMMAND_TYPE = 'CANCEL_ADMIN_SET_AEROCRM_SEATS';
const DAY_MS = 86_400_000;
type Tx = Prisma.TransactionClient;
type Context = {
	actor: BillingActor;
	authorization?: string;
	ip?: string | null;
	userAgent?: string | null;
};
type SubscriptionProjection = {
	workspaceId: string;
	now: Date;
	entitlement: CrmEntitlement;
	account: CrmCommerceAccount | null;
	period: CrmPaidPeriod | null;
	currentPeriod: CrmPaidPeriod | null;
	renewal: CrmAutoRenewal | null;
	pendingOrders: number;
	pendingCommands: number;
};

@Injectable()
export class CrmAdminSubscriptionService {
	constructor(
		private readonly prisma: BillingPrismaService,
		@Optional()
		private readonly accessSeats?: CrmAccessAdminSeatsClient,
		@Optional()
		private readonly identity?: IdentityInternalClient
	) {}
	private access() {
		if (!this.accessSeats)
			throw new ServiceUnavailableException(
				'CRM Access seat coordination is unavailable'
			);
		return this.accessSeats;
	}
	private async freshAdmin(context: Context, expectedRole: 'ADMIN' | 'DEV') {
		if (!this.identity || !context.authorization)
			throw new ForbiddenException(
				'Не удалось повторно подтвердить сессию администратора'
			);
		const actor = await this.identity.introspect(context.authorization);
		const role = this.role(actor);
		if (
			actor.subject !== context.actor.subject ||
			!actor.active ||
			role !== expectedRole
		)
			throw new ForbiddenException(
				'Сессия администратора изменилась. Повторите операцию.'
			);
	}

	private role(actor: BillingActor): 'ADMIN' | 'DEV' {
		if (actor.roles.includes('DEV')) return 'DEV';
		if (actor.roles.includes('ADMIN')) return 'ADMIN';
		throw new ForbiddenException(
			'Подписками aeroCRM управляют ADMIN и DEV сервиса'
		);
	}

	async list(query: CrmAdminSubscriptionListDto, actor: BillingActor) {
		this.role(actor);
		return this.prisma.$transaction(
			async tx => {
				const now = new Date();
				const where = Prisma.sql`WHERE (${query.workspaceId ?? null}::uuid IS NULL OR e.workspace_id = ${query.workspaceId ?? null}::uuid)
				AND (${query.ownerSubject ?? null}::text IS NULL OR COALESCE(a.owner_subject, e.activated_by_user_id) = ${query.ownerSubject ?? null})`;
				const [count] = await tx.$queryRaw<{ total: bigint }[]>(
					Prisma.sql`SELECT count(*) AS total FROM billing.crm_entitlements e LEFT JOIN billing.crm_commerce_accounts a USING (workspace_id) ${where}`
				);
				const rows = await tx.$queryRaw<{ workspace_id: string }[]>(
					Prisma.sql`SELECT e.workspace_id FROM billing.crm_entitlements e LEFT JOIN billing.crm_commerce_accounts a USING (workspace_id) ${where} ORDER BY e.updated_at DESC, e.workspace_id LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`
				);
				const items = await this.readPage(
					tx,
					rows.map(row => row.workspace_id),
					now
				);
				return {
					schemaVersion: 1,
					page: query.page,
					pageSize: query.pageSize,
					total: Number(count.total),
					items
				};
			},
			{
				isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
				maxWait: 5000,
				timeout: 25000
			}
		);
	}

	private async readPage(tx: Tx, workspaceIds: string[], now: Date) {
		if (workspaceIds.length === 0) return [];
		const where = { workspaceId: { in: workspaceIds } };
		const [
			entitlements,
			accounts,
			renewals,
			orders,
			commands,
			references
		] = await Promise.all([
			tx.crmEntitlement.findMany({ where }),
			tx.crmCommerceAccount.findMany({ where }),
			tx.crmAutoRenewal.findMany({ where }),
			tx.crmOrder.groupBy({
				by: ['workspaceId'],
				where: { ...where, status: { in: ['PENDING', 'UNKNOWN'] } },
				_count: { _all: true }
			}),
			tx.crmCommerceCommand.groupBy({
				by: ['workspaceId'],
				where: { ...where, status: 'PENDING' },
				_count: { _all: true }
			}),
			// Two index-backed top-one lookups per page item; never fetch paid history.
			tx.$queryRaw<
				{
					workspace_id: string;
					period_id: string | null;
					current_period_id: string | null;
				}[]
			>(Prisma.sql`
				SELECT e.workspace_id, latest.id AS period_id, started.id AS current_period_id
				FROM billing.crm_entitlements e
				LEFT JOIN LATERAL (
					SELECT p.id FROM billing.crm_paid_periods p WHERE p.workspace_id = e.workspace_id
					ORDER BY p.starts_at DESC, p.id DESC LIMIT 1
				) latest ON true
				LEFT JOIN LATERAL (
					SELECT p.id FROM billing.crm_paid_periods p WHERE p.workspace_id = e.workspace_id AND p.starts_at <= ${now}
					ORDER BY p.starts_at DESC, p.id DESC LIMIT 1
				) started ON true
				WHERE e.workspace_id IN (${Prisma.join(workspaceIds.map(id => Prisma.sql`${id}::uuid`))})
			`)
		]);
		const periodIds = [
			...new Set(
				references
					.flatMap(row => [row.period_id, row.current_period_id])
					.filter((id): id is string => id !== null)
			)
		];
		const periods = periodIds.length
			? await tx.crmPaidPeriod.findMany({
					where: { ...where, id: { in: periodIds } }
				})
			: [];
		const entitlementByWorkspace = new Map(
			entitlements.map(item => [item.workspaceId, item])
		);
		const accountByWorkspace = new Map(
			accounts.map(item => [item.workspaceId, item])
		);
		const renewalByWorkspace = new Map(
			renewals.map(item => [item.workspaceId, item])
		);
		const orderCounts = new Map(
			orders.map(item => [item.workspaceId, item._count._all])
		);
		const commandCounts = new Map(
			commands.map(item => [item.workspaceId, item._count._all])
		);
		const referencesByWorkspace = new Map(
			references.map(item => [item.workspace_id, item])
		);
		const periodById = new Map(periods.map(item => [item.id, item]));
		return workspaceIds.map(workspaceId => {
			const entitlement = entitlementByWorkspace.get(workspaceId);
			const reference = referencesByWorkspace.get(workspaceId);
			if (!entitlement || !reference)
				throw new Error('aeroCRM subscription snapshot is incomplete');
			const resolvePeriod = (id: string | null) => {
				if (id === null) return null;
				const period = periodById.get(id);
				if (!period || period.workspaceId !== workspaceId)
					throw new Error('aeroCRM period snapshot binding is invalid');
				return period;
			};
			return this.project({
				workspaceId,
				now,
				entitlement,
				account: accountByWorkspace.get(workspaceId) ?? null,
				renewal: renewalByWorkspace.get(workspaceId) ?? null,
				period: resolvePeriod(reference.period_id),
				currentPeriod: resolvePeriod(reference.current_period_id),
				pendingOrders: orderCounts.get(workspaceId) ?? 0,
				pendingCommands: commandCounts.get(workspaceId) ?? 0
			});
		});
	}

	async detail(workspaceId: string, actor: BillingActor) {
		this.role(actor);
		return this.prisma.$transaction(
			async tx => ({
				schemaVersion: 1,
				subscription: await this.read(tx, workspaceId)
			}),
			{ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
		);
	}

	async history(
		workspaceId: string,
		query: CrmAdminSubscriptionPageDto,
		actor: BillingActor
	) {
		this.role(actor);
		return this.prisma.$transaction(
			async tx => {
				await this.requireEntitlement(tx, workspaceId);
				const where = { workspaceId };
				const total = await tx.crmAdminDayGrant.count({ where });
				const grants = await tx.crmAdminDayGrant.findMany({
					where,
					orderBy: [{ createdAt: 'desc' }, { commandId: 'desc' }],
					skip: (query.page - 1) * query.pageSize,
					take: query.pageSize
				});
				return {
					schemaVersion: 1,
					workspaceId,
					page: query.page,
					pageSize: query.pageSize,
					total,
					items: grants.map(grant => this.grantView(grant))
				};
			},
			{ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
		);
	}

	async command(
		workspaceId: string,
		commandId: string,
		actor: BillingActor
	) {
		this.role(actor);
		const receipt = await this.prisma.billingCommandReceipt.findUnique({
			where: { commandId }
		});
		const result = receipt?.result as Record<string, unknown> | undefined;
		if (
			!receipt ||
			![COMMAND_TYPE, CANCEL_COMMAND_TYPE].includes(receipt.commandType) ||
			result?.workspaceId !== workspaceId
		) {
			throw new NotFoundException({
				code: 'crm_admin_grant_not_found',
				message:
					'Подтверждённое начисление пока не найдено. Операция может ещё выполняться.'
			});
		}
		return this.commandProof(receipt, workspaceId, commandId);
	}

	async cancel(
		workspaceId: string,
		commandId: string,
		dto: CancelCrmSubscriptionGrantDto,
		context: Context
	) {
		const actorRole = this.role(context.actor);
		this.assertActor(dto.expectedActorSubject, context.actor);
		const requestHash = billingCommandRequestHash(CANCEL_COMMAND_TYPE, {
			...dto,
			workspaceId,
			commandId,
			actorSubject: context.actor.subject
		});
		for (let attempt = 0; ; attempt += 1) {
			try {
				return await this.prisma.$transaction(
					async tx => {
						await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
						await lockBillingCommand(tx, commandId);
						await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`billing-crm-entitlement:${workspaceId}`}, 0))`;
						const prior = await tx.billingCommandReceipt.findUnique({
							where: { commandId }
						});
						if (prior) {
							const proof = this.commandProof(
								prior,
								workspaceId,
								commandId
							);
							if (proof.actorSubject !== context.actor.subject)
								throw this.commandConflict();
							if (prior.commandType === CANCEL_COMMAND_TYPE)
								assertBillingCommandReceipt(
									prior,
									CANCEL_COMMAND_TYPE,
									requestHash
								);
							return proof;
						}
						await this.requireEntitlement(tx, workspaceId);
						const result = {
							schemaVersion: 1 as const,
							workspaceId,
							commandId,
							actorSubject: context.actor.subject,
							actorRole,
							outcome: 'CANCELLED' as const,
							cancelledAt: new Date().toISOString()
						};
						await tx.billingCommandReceipt.create({
							data: {
								commandId,
								commandType: CANCEL_COMMAND_TYPE,
								requestHash,
								requestHashVersion: 1,
								result
							}
						});
						await enqueueBillingAdminAudit(tx, {
							actor: {
								id: context.actor.subject,
								role: actorRole,
								ip: context.ip,
								userAgent: context.userAgent
							},
							section: 'SUBSCRIPTIONS',
							action: 'SUBSCRIPTION_EXTEND_DAYS',
							description: `aeroCRM: отменена неподтверждённая команда начисления дней ${commandId}; подписка не изменена`,
							entity: {
								type: 'crm_subscription_command',
								id: commandId,
								label: 'aeroCRM',
								targetUserId: null
							},
							metadata: {
								productCode: 'AEROCRM',
								operation: 'CANCEL_UNCONFIRMED_COMMAND',
								...result
							}
						});
						await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
						return result;
					},
					{
						isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
						maxWait: 5000,
						timeout: 25000
					}
				);
			} catch (error) {
				if (attempt >= 2 || !this.retryableCommandConflict(error))
					throw error;
			}
		}
	}

	private commandProof(
		receipt: { commandType: string; result: Prisma.JsonValue },
		workspaceId: string,
		commandId: string
	) {
		const result = receipt.result;
		if (
			!result ||
			typeof result !== 'object' ||
			Array.isArray(result) ||
			result.schemaVersion !== 1 ||
			result.workspaceId !== workspaceId ||
			result.commandId !== commandId
		)
			throw this.commandConflict();
		if (receipt.commandType === COMMAND_TYPE) {
			const grant = result.grant;
			if (
				!grant ||
				typeof grant !== 'object' ||
				Array.isArray(grant) ||
				typeof grant.actorSubject !== 'string'
			)
				throw this.commandConflict();
			return {
				schemaVersion: 1 as const,
				workspaceId,
				commandId,
				actorSubject: grant.actorSubject,
				outcome: 'COMMITTED' as const,
				result
			};
		}
		if (
			receipt.commandType !== CANCEL_COMMAND_TYPE ||
			result.outcome !== 'CANCELLED' ||
			typeof result.actorSubject !== 'string' ||
			!['ADMIN', 'DEV'].includes(String(result.actorRole)) ||
			typeof result.cancelledAt !== 'string' ||
			!Number.isFinite(Date.parse(result.cancelledAt))
		)
			throw this.commandConflict();
		return {
			schemaVersion: 1 as const,
			workspaceId,
			commandId,
			actorSubject: result.actorSubject,
			actorRole: result.actorRole as 'ADMIN' | 'DEV',
			outcome: 'CANCELLED' as const,
			cancelledAt: result.cancelledAt
		};
	}

	private commandConflict() {
		return new ConflictException({
			code: 'crm_admin_subscription_command_conflict',
			message:
				'Идентификатор команды связан с другой операцией, аккаунтом или пространством'
		});
	}

	private retryableCommandConflict(error: unknown) {
		const failure = error as {
			code?: string;
			meta?: { modelName?: string };
		} | null;
		// A Serializable snapshot may predate the advisory-lock winner's commit.
		// Its receipt insert can then fail as a unique violation, not P2034.
		// This model's only unique key is commandId; never retry other ledgers.
		return (
			failure?.code === 'P2034' ||
			(failure?.code === 'P2002' &&
				failure.meta?.modelName === 'BillingCommandReceipt')
		);
	}

	private assertActor(expectedActorSubject: string, actor: BillingActor) {
		if (expectedActorSubject !== actor.subject)
			throw new ConflictException({
				code: 'crm_admin_subscription_actor_changed',
				message:
					'Сессия администратора изменилась. Вернитесь в исходный аккаунт для проверки операции.'
			});
	}

	async extend(
		workspaceId: string,
		dto: ExtendCrmSubscriptionDaysDto,
		context: Context
	) {
		const actorRole = this.role(context.actor);
		this.assertActor(dto.expectedActorSubject, context.actor);
		if (
			(dto.expectedPeriodId === null) !==
			(dto.expectedPeriodVersion === null)
		) {
			throw new BadRequestException(
				'Ожидаемая версия периода должна соответствовать его ID'
			);
		}
		const requestHash = billingCommandRequestHash(COMMAND_TYPE, {
			...dto,
			workspaceId,
			actorSubject: context.actor.subject
		});
		for (let attempt = 0; ; attempt += 1) {
			try {
				return await this.prisma.$transaction(
					async tx => {
						await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
						await lockBillingCommand(tx, dto.commandId);
						const prior = await tx.billingCommandReceipt.findUnique({
							where: { commandId: dto.commandId }
						});
						if (prior?.commandType === CANCEL_COMMAND_TYPE) {
							const proof = this.commandProof(
								prior,
								workspaceId,
								dto.commandId
							);
							if (proof.actorSubject !== context.actor.subject)
								throw this.commandConflict();
							throw new ConflictException({
								code: 'crm_admin_grant_cancelled',
								message:
									'Команда начисления отменена. Дополнительные дни не начислялись.'
							});
						}
						if (prior)
							return assertBillingCommandReceipt(
								prior,
								COMMAND_TYPE,
								requestHash
							);
						await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`billing-crm-entitlement:${workspaceId}`}, 0))`;
						const before = await this.read(tx, workspaceId);
						if (
							before.entitlementVersion !==
								dto.expectedEntitlementVersion ||
							before.billingVersion !== dto.expectedBillingVersion ||
							(before.period?.id ?? null) !== dto.expectedPeriodId ||
							(before.period?.version ?? null) !==
								dto.expectedPeriodVersion
						) {
							throw new ConflictException({
								code: 'crm_admin_subscription_version_conflict',
								message:
									'Подписка изменилась. Обновите данные перед начислением дней.'
							});
						}
						if (before.blockedReason)
							throw new ConflictException({
								code: before.blockedReason,
								message:
									'Начисление сейчас недоступно. Проверьте состояние подписки и незавершённых операций.'
							});
						if (
							BigInt(before.entitlementVersion) >=
								9_223_372_036_854_775_806n ||
							BigInt(before.billingVersion) >=
								9_223_372_036_854_775_806n ||
							(before.period && before.period.version >= 2_147_483_646)
						)
							throw new ConflictException(
								'Достигнут предел версии подписки'
							);
						const now = new Date();
						const oldExpiresAt = new Date(
							before.period?.expiresAt ?? before.entitlement.effectiveUntil
						);
						const newExpiresAt = this.timestamp(
							Math.max(now.getTime(), oldExpiresAt.getTime()) +
								dto.days * DAY_MS
						);
						if (before.period) {
							const period = await tx.crmPaidPeriod.findUniqueOrThrow({
								where: { id: before.period.id }
							});
							const graceDays = readCrmPriceSnapshot(
								period.priceSnapshot
							).graceDays;
							await tx.crmPaidPeriod.update({
								where: { id: period.id, version: period.version },
								data: {
									expiresAt: newExpiresAt,
									graceUntil: this.timestamp(
										newExpiresAt.getTime() + graceDays * DAY_MS
									),
									version: { increment: 1 }
								}
							});
							await tx.crmEntitlement.update({
								where: { workspaceId },
								data: { status: 'ACTIVE' }
							});
						} else {
							const base = await this.requireEntitlement(tx, workspaceId);
							const graceDuration = base.graceUntil
								? base.graceUntil.getTime() - base.effectiveUntil.getTime()
								: null;
							if (graceDuration !== null && graceDuration <= 0)
								throw new ConflictException({
									code: 'crm_admin_subscription_policy_invalid',
									message: 'Период льготного доступа некорректен'
								});
							await tx.crmEntitlement.update({
								where: {
									workspaceId,
									aggregateVersion: BigInt(before.entitlementVersion)
								},
								data: {
									status: 'ACTIVE',
									effectiveUntil: newExpiresAt,
									graceUntil:
										graceDuration === null
											? null
											: this.timestamp(
													newExpiresAt.getTime() + graceDuration
												)
								}
							});
						}
						if (before.billingVersion !== '0')
							await tx.crmCommerceAccount.update({
								where: {
									workspaceId,
									version: BigInt(before.billingVersion)
								},
								data: { version: { increment: 1 } }
							});
						if (before.renewal) {
							await tx.crmAutoRenewal.update({
								where: { workspaceId },
								data: {
									nextChargeAt: newExpiresAt,
									nextRetryAt: null,
									retryStartedAt: null,
									retryAttempt: 0,
									version: { increment: 1 }
								}
							});
						}
						await enqueueCrmEntitlementChanged(tx, workspaceId);
						const grant = await tx.crmAdminDayGrant.create({
							data: {
								commandId: dto.commandId,
								workspaceId,
								actorSubject: context.actor.subject,
								actorRole,
								days: dto.days,
								reason: dto.reason,
								target: before.period ? 'PAID_PERIOD' : 'ENTITLEMENT',
								periodId: before.period?.id ?? null,
								oldExpiresAt,
								newExpiresAt,
								createdAt: now
							}
						});
						const result = {
							schemaVersion: 1,
							workspaceId,
							commandId: dto.commandId,
							grant: this.grantView(grant),
							subscription: await this.read(tx, workspaceId)
						};
						await enqueueBillingAdminAudit(tx, {
							actor: {
								id: context.actor.subject,
								role: actorRole,
								ip: context.ip,
								userAgent: context.userAgent
							},
							section: 'SUBSCRIPTIONS',
							action: 'SUBSCRIPTION_EXTEND_DAYS',
							description: `aeroCRM: бесплатно начислено ${dto.days} дней пространству ${workspaceId}`,
							entity: {
								type: 'crm_subscription',
								id: workspaceId,
								label: 'aeroCRM',
								targetUserId: before.ownerSubject
							},
							metadata: {
								productCode: 'AEROCRM',
								...this.grantView(grant),
								before,
								after: result.subscription
							}
						});
						await tx.billingCommandReceipt.create({
							data: {
								commandId: dto.commandId,
								commandType: COMMAND_TYPE,
								requestHash,
								requestHashVersion: 1,
								result: result as unknown as Prisma.InputJsonValue
							}
						});
						await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
						return result;
					},
					{
						isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
						maxWait: 5000,
						timeout: 25000
					}
				);
			} catch (error) {
				if (attempt >= 2 || !this.retryableCommandConflict(error))
					throw error;
			}
		}
	}

	async seatDetail(workspaceId: string, actor: BillingActor) {
		this.role(actor);
		const access = (await this.access().context(workspaceId)) as {
			usedSeats: number;
			pendingOperationId: string | null;
		};
		return this.prisma.$transaction(
			async tx => {
				const state = await this.seatState(tx, workspaceId, access);
				return {
					schemaVersion: 1 as const,
					subscription: state.subscription,
					capacity: {
						usedSeats: access.usedSeats,
						minimumSeats: state.minimumSeats,
						maximumSeats: 10_000 as const
					},
					canSetSeats: state.blockedReason === null,
					blockedReason: state.blockedReason
				};
			},
			{ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
		);
	}

	async seatHistory(
		workspaceId: string,
		query: CrmAdminSubscriptionPageDto,
		actor: BillingActor
	) {
		this.role(actor);
		return this.prisma.$transaction(
			async tx => {
				await this.requireEntitlement(tx, workspaceId);
				const where = { workspaceId };
				const [total, items] = await Promise.all([
					tx.crmAdminSeatAdjustment.count({ where }),
					tx.crmAdminSeatAdjustment.findMany({
						where,
						orderBy: [{ createdAt: 'desc' }, { commandId: 'desc' }],
						skip: (query.page - 1) * query.pageSize,
						take: query.pageSize
					})
				]);
				return {
					schemaVersion: 1 as const,
					page: query.page,
					pageSize: query.pageSize,
					total,
					items: items.map(item => this.adjustmentView(item))
				};
			},
			{ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
		);
	}

	async seatCommand(
		workspaceId: string,
		commandId: string,
		actor: BillingActor
	) {
		this.role(actor);
		const receipt = await this.prisma.billingCommandReceipt.findUnique({
			where: { commandId }
		});
		if (!receipt)
			throw new NotFoundException({
				code: 'crm_admin_seats_command_not_found',
				message:
					'Подтверждённое изменение мест пока не найдено. Операция может ещё выполняться.'
			});
		return this.seatCommandProof(receipt, workspaceId, commandId);
	}

	async setSeats(
		workspaceId: string,
		dto: SetCrmSubscriptionSeatsDto,
		context: Context
	) {
		const actorRole = this.role(context.actor);
		this.assertActor(dto.expectedActorSubject, context.actor);
		if (
			(dto.expectedPeriodId === null) !==
			(dto.expectedPeriodVersion === null)
		)
			throw new BadRequestException(
				'Ожидаемая версия периода должна соответствовать его ID'
			);
		const requestHash = billingCommandRequestHash(SEAT_COMMAND_TYPE, {
			...dto,
			workspaceId,
			actorSubject: context.actor.subject
		});
		const existing = await this.prisma.billingCommandReceipt.findUnique({
			where: { commandId: dto.commandId }
		});
		if (existing) {
			if (existing.commandType === CANCEL_SEAT_COMMAND_TYPE) {
				const proof = this.seatCommandProof(
					existing,
					workspaceId,
					dto.commandId
				);
				if (proof.actorSubject !== context.actor.subject)
					throw this.commandConflict();
				throw new ConflictException({
					code: 'crm_admin_seats_cancelled',
					message: 'Команда изменения мест отменена. Подписка не изменялась.'
				});
			}
			return assertBillingCommandReceipt(
				existing,
				SEAT_COMMAND_TYPE,
				requestHash
			);
		}
		const firstAccess = (await this.access().context(workspaceId)) as {
			usedSeats: number;
			pendingOperationId: string | null;
		};
		const first = await this.prisma.$transaction(
			tx => this.seatState(tx, workspaceId, firstAccess, dto.commandId),
			{ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
		);
		this.assertSeatCas(first.subscription, dto);
		this.assertSeatAllowed(first, dto.totalSeats);
		let prepared = false;
		const reservation = (await this.access().prepare({
			schemaVersion: 1,
			workspaceId,
			commandId: dto.commandId,
			actorSubject: context.actor.subject,
			actorRole,
			requestHash,
			targetSeats: dto.totalSeats,
			currentSeatLimit: first.currentTotalSeats
		})) as {
			capacityFence: AdminSeatFence;
			state: 'PENDING' | 'COMMITTED' | 'CANCELLED';
		};
		prepared = true;
		if (reservation.state !== 'PENDING') {
			const replay = await this.prisma.billingCommandReceipt.findUnique({
				where: { commandId: dto.commandId }
			});
			if (!replay)
				throw new ConflictException({
					code: 'crm_admin_subscription_operation_pending',
					message: 'Состояние операции изменения мест ещё уточняется'
				});
			const terminal = this.seatCommandProof(
				replay,
				workspaceId,
				dto.commandId
			);
			if (terminal.outcome === 'CANCELLED')
				throw new ConflictException({
					code: 'crm_admin_seats_cancelled',
					message: 'Команда изменения мест отменена. Подписка не изменялась.'
				});
			return terminal.result;
		}
		try {
			const access = (await this.access().context(workspaceId)) as {
				usedSeats: number;
				pendingOperationId: string | null;
			};
			await this.freshAdmin(context, actorRole);
			const result = await this.prisma.$transaction(
				async tx => {
					await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
					await lockBillingCommand(tx, dto.commandId);
					const prior = await tx.billingCommandReceipt.findUnique({
						where: { commandId: dto.commandId }
					});
					if (prior)
						return assertBillingCommandReceipt(
							prior,
							SEAT_COMMAND_TYPE,
							requestHash
						);
					await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`billing-crm-entitlement:${workspaceId}`}, 0))`;
					const state = await this.seatState(
						tx,
						workspaceId,
						access,
						dto.commandId
					);
					this.assertSeatCas(state.subscription, dto);
					this.assertSeatAllowed(state, dto.totalSeats);
					if (state.period) {
						await tx.crmPaidPeriod.update({
							where: {
								id: state.period.id,
								version: state.period.version
							},
							data: {
								totalSeats: dto.totalSeats,
								version: { increment: 1 }
							}
						});
					} else {
						await tx.crmEntitlement.update({
							where: {
								workspaceId,
								aggregateVersion: BigInt(dto.expectedEntitlementVersion)
							},
							data: { seatLimit: dto.totalSeats }
						});
					}
					if (state.subscription.billingVersion !== '0')
						await tx.crmCommerceAccount.update({
							where: {
								workspaceId,
								version: BigInt(dto.expectedBillingVersion)
							},
							data: { version: { increment: 1 } }
						});
					await enqueueCrmEntitlementChanged(tx, workspaceId);
					const adjustment = await tx.crmAdminSeatAdjustment.create({
						data: {
							commandId: dto.commandId,
							workspaceId,
							actorSubject: context.actor.subject,
							actorRole,
							reason: dto.reason,
							target: state.period ? 'PAID_PERIOD' : 'ENTITLEMENT',
							periodId: state.period?.id ?? null,
							oldTotalSeats: state.currentTotalSeats,
							newTotalSeats: dto.totalSeats,
							effectiveUntil: new Date(
								state.subscription.entitlement.effectiveUntil
							),
							requestHash,
							capacityFence: reservation.capacityFence
						}
					});
					const response = {
						schemaVersion: 1 as const,
						workspaceId,
						commandId: dto.commandId,
						adjustment: this.adjustmentView(adjustment),
						subscription: await this.read(tx, workspaceId)
					};
					await enqueueBillingAdminAudit(tx, {
						actor: {
							id: context.actor.subject,
							role: actorRole,
							ip: context.ip,
							userAgent: context.userAgent
						},
						section: 'SUBSCRIPTIONS',
						action: 'SUBSCRIPTION_SET_SEATS',
						description: `aeroCRM: установлено ${dto.totalSeats} мест пространству ${workspaceId}`,
						entity: {
							type: 'crm_subscription',
							id: workspaceId,
							label: 'aeroCRM',
							targetUserId: state.subscription.ownerSubject
						},
						metadata: {
							productCode: 'AEROCRM',
							...this.adjustmentView(adjustment)
						}
					});
					await tx.billingCommandReceipt.create({
						data: {
							commandId: dto.commandId,
							commandType: SEAT_COMMAND_TYPE,
							requestHash,
							requestHashVersion: 1,
							result: response as unknown as Prisma.InputJsonValue
						}
					});
					await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
					return response;
				},
				{
					isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
					maxWait: 5000,
					timeout: 25000
				}
			);
			await this.access().synchronize({
				schemaVersion: 1,
				workspaceId,
				commandId: dto.commandId,
				actorSubject: context.actor.subject,
				actorRole,
				requestHash,
				capacityFence: reservation.capacityFence
			});
			return result;
		} catch (error) {
			if (prepared) await this.closePreparedSeatCommand(
				workspaceId,
				dto.commandId,
				context.actor.subject,
				actorRole,
				requestHash,
				reservation.capacityFence
			).catch(() => undefined);
			throw error;
		}
	}

	async cancelSeats(
		workspaceId: string,
		commandId: string,
		dto: CancelCrmSubscriptionGrantDto,
		context: Context
	) {
		const actorRole = this.role(context.actor);
		this.assertActor(dto.expectedActorSubject, context.actor);
		const requestHash = billingCommandRequestHash(CANCEL_SEAT_COMMAND_TYPE, {
			...dto,
			workspaceId,
			commandId,
			actorSubject: context.actor.subject
		});
		return this.cancelSeatReceipt(
			workspaceId,
			commandId,
			context.actor.subject,
			actorRole,
			requestHash,
			context
		);
	}

	async adminSeatOperation(
		dto: CrmAdminSeatOperationDto,
		close: boolean
	) {
		let receipt = await this.prisma.billingCommandReceipt.findUnique({
			where: { commandId: dto.commandId }
		});
		if (!receipt && !close)
			throw new NotFoundException('CRM administrative seat operation not found');
		if (!receipt) {
			const cancelHash = billingCommandRequestHash(CANCEL_SEAT_COMMAND_TYPE, {
				schemaVersion: 1,
				expectedActorSubject: dto.actorSubject,
				workspaceId: dto.workspaceId,
				commandId: dto.commandId,
				actorSubject: dto.actorSubject
			});
			await this.cancelSeatReceipt(
				dto.workspaceId,
				dto.commandId,
				dto.actorSubject,
				dto.actorRole,
				cancelHash,
				{
					actor: {
						subject: dto.actorSubject,
						roles: [dto.actorRole],
						active: true,
						sessionId: 'internal-admin-seat-reconciliation'
					}
				}
			);
			receipt = await this.prisma.billingCommandReceipt.findUniqueOrThrow({
				where: { commandId: dto.commandId }
			});
		}
		if (
			![SEAT_COMMAND_TYPE, CANCEL_SEAT_COMMAND_TYPE].includes(
				receipt.commandType
			)
		)
			throw this.commandConflict();
		const proof = await this.internalSeatProof(receipt, dto);
		return proof;
	}

	private async closePreparedSeatCommand(
		workspaceId: string,
		commandId: string,
		actorSubject: string,
		actorRole: 'ADMIN' | 'DEV',
		requestHash: string,
		capacityFence: AdminSeatFence
	) {
		await this.adminSeatOperation(
			{
				schemaVersion: 1,
				workspaceId,
				commandId,
				actorSubject,
				actorRole,
				requestHash,
				capacityFence
			},
			true
		);
		await this.access().synchronize({
			schemaVersion: 1,
			workspaceId,
			commandId,
			actorSubject,
			actorRole,
			requestHash,
			capacityFence
		});
	}

	private async cancelSeatReceipt(
		workspaceId: string,
		commandId: string,
		actorSubject: string,
		actorRole: 'ADMIN' | 'DEV',
		requestHash: string,
		context: Context
	) {
		return this.prisma.$transaction(
			async tx => {
				await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
				await lockBillingCommand(tx, commandId);
				await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`billing-crm-entitlement:${workspaceId}`}, 0))`;
				const prior = await tx.billingCommandReceipt.findUnique({
					where: { commandId }
				});
				if (prior) {
					const proof = this.seatCommandProof(prior, workspaceId, commandId);
					if (proof.actorSubject !== actorSubject)
						throw this.commandConflict();
					if (prior.commandType === CANCEL_SEAT_COMMAND_TYPE)
						assertBillingCommandReceipt(
							prior,
							CANCEL_SEAT_COMMAND_TYPE,
							requestHash
						);
					return proof;
				}
				await this.requireEntitlement(tx, workspaceId);
				const result = {
					schemaVersion: 1 as const,
					workspaceId,
					commandId,
					actorSubject,
					actorRole,
					outcome: 'CANCELLED' as const,
					cancelledAt: new Date().toISOString()
				};
				await tx.billingCommandReceipt.create({
					data: {
						commandId,
						commandType: CANCEL_SEAT_COMMAND_TYPE,
						requestHash,
						requestHashVersion: 1,
						result
					}
				});
				await enqueueBillingAdminAudit(tx, {
					actor: {
						id: actorSubject,
						role: actorRole,
						ip: context.ip,
						userAgent: context.userAgent
					},
					section: 'SUBSCRIPTIONS',
					action: 'SUBSCRIPTION_SET_SEATS',
					description: `aeroCRM: отменена неподтверждённая команда изменения мест ${commandId}; подписка не изменена`,
					entity: {
						type: 'crm_subscription_command',
						id: commandId,
						label: 'aeroCRM',
						targetUserId: null
					},
					metadata: {
						productCode: 'AEROCRM',
						operation: 'CANCEL_UNCONFIRMED_ADMIN_SEAT_COMMAND',
						...result
					}
				});
				await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
				return result;
			},
			{
				isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
				maxWait: 5000,
				timeout: 25000
			}
		);
	}

	private async internalSeatProof(
		receipt: {
			commandType: string;
			requestHash: string;
			result: Prisma.JsonValue;
		},
		dto: CrmAdminSeatOperationDto
	) {
		const terminal = this.seatCommandProof(
			receipt,
			dto.workspaceId,
			dto.commandId
		);
		if (terminal.actorSubject !== dto.actorSubject)
			throw this.commandConflict();
		const subscription = await this.prisma.$transaction(tx =>
			this.read(tx, dto.workspaceId)
		);
		if (terminal.outcome === 'COMMITTED') {
			const result = terminal.result as Record<string, unknown>;
			const adjustment = result.adjustment as Record<string, unknown>;
			if (
				receipt.requestHash !== dto.requestHash ||
				adjustment.requestHash !== undefined ||
				!this.sameSeatFence(
					(await this.prisma.crmAdminSeatAdjustment.findUniqueOrThrow({
						where: { commandId: dto.commandId }
					})).capacityFence,
					dto.capacityFence
				)
			)
				throw this.commandConflict();
			return {
				schemaVersion: 1 as const,
				workspaceId: dto.workspaceId,
				commandId: dto.commandId,
				actorSubject: dto.actorSubject,
				requestHash: dto.requestHash,
				capacityFence: dto.capacityFence,
				status: 'COMMITTED' as const,
				releaseFence: true as const,
				billingVersion: subscription.billingVersion,
				entitlementVersion: subscription.entitlementVersion,
				totalSeats: dto.capacityFence.targetSeats
			};
		}
		return {
			schemaVersion: 1 as const,
			workspaceId: dto.workspaceId,
			commandId: dto.commandId,
			actorSubject: dto.actorSubject,
			requestHash: dto.requestHash,
			capacityFence: dto.capacityFence,
			status: 'CANCELLED' as const,
			releaseFence: true as const,
			billingVersion: subscription.billingVersion,
			entitlementVersion: subscription.entitlementVersion,
			totalSeats: null
		};
	}

	private seatCommandProof(
		receipt: { commandType: string; result: Prisma.JsonValue },
		workspaceId: string,
		commandId: string
	) {
		const result = receipt.result;
		if (
			!result ||
			typeof result !== 'object' ||
			Array.isArray(result) ||
			result.schemaVersion !== 1 ||
			result.workspaceId !== workspaceId ||
			result.commandId !== commandId
		)
			throw this.commandConflict();
		if (receipt.commandType === SEAT_COMMAND_TYPE) {
			const adjustment = result.adjustment;
			if (
				!adjustment ||
				typeof adjustment !== 'object' ||
				Array.isArray(adjustment) ||
				typeof adjustment.actorSubject !== 'string'
			)
				throw this.commandConflict();
			return {
				schemaVersion: 1 as const,
				workspaceId,
				commandId,
				actorSubject: adjustment.actorSubject,
				outcome: 'COMMITTED' as const,
				result
			};
		}
		if (
			receipt.commandType !== CANCEL_SEAT_COMMAND_TYPE ||
			result.outcome !== 'CANCELLED' ||
			typeof result.actorSubject !== 'string' ||
			!['ADMIN', 'DEV'].includes(String(result.actorRole)) ||
			typeof result.cancelledAt !== 'string' ||
			!Number.isFinite(Date.parse(result.cancelledAt))
		)
			throw this.commandConflict();
		return {
			schemaVersion: 1 as const,
			workspaceId,
			commandId,
			actorSubject: result.actorSubject,
			actorRole: result.actorRole as 'ADMIN' | 'DEV',
			outcome: 'CANCELLED' as const,
			cancelledAt: result.cancelledAt
		};
	}

	private async seatState(
		tx: Tx,
		workspaceId: string,
		access: { usedSeats: number; pendingOperationId: string | null },
		allowedPendingOperationId?: string
	) {
		const subscription = await this.read(tx, workspaceId);
		const now = new Date();
		const [entitlement, latestPeriod, currentPeriod, renewal] =
			await Promise.all([
				this.requireEntitlement(tx, workspaceId),
				tx.crmPaidPeriod.findFirst({
					where: { workspaceId },
					orderBy: [{ startsAt: 'desc' }, { id: 'desc' }]
				}),
				tx.crmPaidPeriod.findFirst({
					where: { workspaceId, startsAt: { lte: now } },
					orderBy: [{ startsAt: 'desc' }, { id: 'desc' }]
				}),
				tx.crmAutoRenewal.findUnique({ where: { workspaceId } })
			]);
		const futurePeriod =
			!!latestPeriod && latestPeriod.id !== currentPeriod?.id;
		const period = futurePeriod ? null : currentPeriod;
		let includedSeats: number;
		let currentTotalSeats: number;
		if (period) {
			includedSeats = readCrmPriceSnapshot(period.priceSnapshot).includedSeats;
			currentTotalSeats = period.totalSeats;
		} else {
			if (!entitlement.policyVersion)
				throw new ConflictException({
					code: 'crm_admin_subscription_policy_invalid',
					message: 'Тариф подписки не определён'
				});
			const policy = await tx.crmCommercialPolicy.findUniqueOrThrow({
				where: { version: entitlement.policyVersion }
			});
			includedSeats = policy.includedSeats;
			currentTotalSeats = entitlement.seatLimit ?? policy.trialSeatLimit;
		}
		const pendingAccess =
			access.pendingOperationId !== null &&
			access.pendingOperationId !== allowedPendingOperationId;
		const blockedReason = ['SUSPENDED', 'CANCELLED'].includes(
			entitlement.status
		)
			? 'crm_admin_subscription_suspended'
			: futurePeriod
				? 'crm_admin_seats_future_period'
				: renewal?.dispatchPending ||
					(renewal && !['USER_DISABLED', 'REVOKED'].includes(renewal.status))
					? 'crm_admin_seats_renewal_active'
					: subscription.blockedReason || pendingAccess
						? 'crm_admin_subscription_operation_pending'
						: null;
		return {
			subscription,
			period,
			minimumSeats: Math.max(includedSeats, access.usedSeats),
			currentTotalSeats,
			blockedReason
		};
	}

	private assertSeatCas(
		subscription: Awaited<ReturnType<CrmAdminSubscriptionService['read']>>,
		dto: SetCrmSubscriptionSeatsDto
	) {
		if (
			subscription.entitlementVersion !== dto.expectedEntitlementVersion ||
			subscription.billingVersion !== dto.expectedBillingVersion ||
			(subscription.period?.id ?? null) !== dto.expectedPeriodId ||
			(subscription.period?.version ?? null) !== dto.expectedPeriodVersion
		)
			throw new ConflictException({
				code: 'crm_admin_subscription_version_conflict',
				message: 'Подписка изменилась. Обновите данные перед изменением мест.'
			});
	}

	private assertSeatAllowed(
		state: {
			minimumSeats: number;
			currentTotalSeats: number;
			blockedReason: string | null;
		},
		totalSeats: number
	) {
		if (state.blockedReason)
			throw new ConflictException({
				code: state.blockedReason,
				message: 'Изменение мест сейчас недоступно'
			});
		if (totalSeats < state.minimumSeats)
			throw new ConflictException({
				code: 'crm_admin_seats_below_minimum',
				message: `Нельзя установить меньше ${state.minimumSeats} мест`
			});
		if (totalSeats === state.currentTotalSeats)
			throw new ConflictException({
				code: 'crm_admin_seats_unchanged',
				message: 'Число мест не изменилось'
			});
	}

	private adjustmentView(adjustment: CrmAdminSeatAdjustment) {
		return {
			commandId: adjustment.commandId,
			workspaceId: adjustment.workspaceId,
			actorSubject: adjustment.actorSubject,
			actorRole: adjustment.actorRole as 'ADMIN' | 'DEV',
			reason: adjustment.reason,
			target: adjustment.target as 'ENTITLEMENT' | 'PAID_PERIOD',
			periodId: adjustment.periodId,
			oldTotalSeats: adjustment.oldTotalSeats,
			newTotalSeats: adjustment.newTotalSeats,
			effectiveUntil: adjustment.effectiveUntil.toISOString(),
			createdAt: adjustment.createdAt.toISOString()
		};
	}

	private sameSeatFence(value: unknown, expected: AdminSeatFence) {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
		const fence = value as Record<string, unknown>;
		return (
			Object.keys(fence).length === 4 &&
			fence.operationId === expected.operationId &&
			fence.requestHash === expected.requestHash &&
			fence.fenceRevision === expected.fenceRevision &&
			fence.targetSeats === expected.targetSeats
		);
	}

	private async requireEntitlement(tx: Tx, workspaceId: string) {
		const entitlement = await tx.crmEntitlement.findUnique({
			where: { workspaceId }
		});
		if (!entitlement)
			throw new NotFoundException({
				code: 'crm_admin_subscription_not_provisioned',
				message:
					'CRM ещё не активирована в этом пространстве. Начисление дней не создаёт новое рабочее пространство.'
			});
		return entitlement;
	}

	private async read(tx: Tx, workspaceId: string) {
		const entitlement = await this.requireEntitlement(tx, workspaceId);
		const now = new Date();
		const [
			account,
			period,
			renewal,
			pendingOrders,
			pendingCommands,
			currentPeriod
		] = await Promise.all([
			tx.crmCommerceAccount.findUnique({ where: { workspaceId } }),
			tx.crmPaidPeriod.findFirst({
				where: { workspaceId },
				orderBy: [{ startsAt: 'desc' }, { id: 'desc' }]
			}),
			tx.crmAutoRenewal.findUnique({ where: { workspaceId } }),
			tx.crmOrder.count({
				where: { workspaceId, status: { in: ['PENDING', 'UNKNOWN'] } }
			}),
			tx.crmCommerceCommand.count({
				where: { workspaceId, status: 'PENDING' }
			}),
			tx.crmPaidPeriod.findFirst({
				where: { workspaceId, startsAt: { lte: now } },
				orderBy: [{ startsAt: 'desc' }, { id: 'desc' }]
			})
		]);
		return this.project({
			workspaceId,
			now,
			entitlement,
			account,
			period,
			currentPeriod,
			renewal,
			pendingOrders,
			pendingCommands
		});
	}

	private project({
		workspaceId,
		now,
		entitlement,
		account,
		period,
		currentPeriod,
		renewal,
		pendingOrders,
		pendingCommands
	}: SubscriptionProjection) {
		const activePeriod = ['SUSPENDED', 'CANCELLED'].includes(
			entitlement.status
		)
			? null
			: currentPeriod;
		const effectiveUntil =
			activePeriod?.expiresAt ?? entitlement.effectiveUntil;
		const graceUntil = activePeriod?.graceUntil ?? entitlement.graceUntil;
		const baseStatus =
			activePeriod &&
			!['SUSPENDED', 'CANCELLED'].includes(entitlement.status)
				? 'ACTIVE'
				: entitlement.status;
		const status =
			baseStatus !== 'ACTIVE'
				? baseStatus
				: effectiveUntil > now
					? 'ACTIVE'
					: graceUntil
						? graceUntil > now
							? 'GRACE'
							: 'READ_ONLY'
						: 'EXPIRED';
		return {
			workspaceId,
			ownerSubject: account?.ownerSubject ?? entitlement.activatedByUserId,
			entitlementVersion: entitlement.aggregateVersion.toString(),
			billingVersion: account?.version.toString() ?? '0',
			entitlement: {
				planCode: activePeriod ? 'PAID' : entitlement.planCode,
				status,
				seatLimit: activePeriod?.totalSeats ?? entitlement.seatLimit,
				effectiveFrom: (
					activePeriod?.startsAt ?? entitlement.effectiveFrom
				).toISOString(),
				effectiveUntil: effectiveUntil.toISOString(),
				graceUntil: graceUntil?.toISOString() ?? null
			},
			period: period
				? {
						id: period.id,
						version: period.version,
						startsAt: period.startsAt.toISOString(),
						expiresAt: period.expiresAt.toISOString(),
						graceUntil: period.graceUntil.toISOString(),
						totalSeats: period.totalSeats
					}
				: null,
			renewal: renewal
				? {
						status: renewal.status,
						nextChargeAt: renewal.nextChargeAt.toISOString()
					}
				: null,
			extensionTarget: period ? 'PAID_PERIOD' : 'ENTITLEMENT',
			blockedReason: ['SUSPENDED', 'CANCELLED'].includes(
				entitlement.status
			)
				? 'crm_admin_subscription_suspended'
				: pendingOrders || pendingCommands || renewal?.dispatchPending
					? 'crm_admin_subscription_operation_pending'
					: renewal && renewal.version >= 2_147_483_646
						? 'crm_admin_subscription_version_limit'
						: account?.capacityCommandId && !account.capacityFence
							? 'crm_admin_subscription_capacity_pending'
							: null
		};
	}

	private grantView(grant: CrmAdminDayGrant) {
		return {
			...grant,
			oldExpiresAt: grant.oldExpiresAt.toISOString(),
			newExpiresAt: grant.newExpiresAt.toISOString(),
			createdAt: grant.createdAt.toISOString()
		};
	}

	private timestamp(value: number) {
		const date = new Date(value);
		if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999)
			throw new BadRequestException({
				code: 'crm_admin_subscription_date_out_of_range',
				message: 'Срок подписки вне допустимого диапазона'
			});
		return date;
	}
}
