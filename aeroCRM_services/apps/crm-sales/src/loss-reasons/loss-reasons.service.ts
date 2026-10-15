import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	ServiceUnavailableException
} from '@nestjs/common';
import { Prisma } from '@prisma/crm-sales-client';
import { createHash } from 'node:crypto';
import { retryablePlannerTransaction } from '../planner/planner-settings';
import { CrmSalesPrismaService } from '../prisma/crm-sales-prisma.service';
import { ReminderActorClient } from '../reminders/reminder-actor.client';
import { SalesAccessClient, UUID, type SalesAccess } from '../sales/sales-access';
import type { SaveLossReasonsDto } from '../sales/sales-productivity.dto';

export interface LossReason {
	id: string;
	title: string;
	archived: boolean;
}
export interface LossReasonSettingsSnapshot {
	schemaVersion: 1;
	workspaceId: string;
	version: number;
	reasons: LossReason[];
}
const DEFAULT_TITLES = [
	'Дорого',
	'Выбрали конкурента',
	'Отложили',
	'Нет потребности',
	'Другое'
] as const;
export const DEFAULT_LOSS_REASONS: readonly LossReason[] = Object.freeze(
	DEFAULT_TITLES.map((title, index) =>
		Object.freeze({
			id: `11000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
			title,
			archived: false
		})
	)
);

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object')
		return `{${Object.entries(value)
			.filter(([, entry]) => entry !== undefined)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
			.join(',')}}`;
	return JSON.stringify(value);
}

export function validateLossReasons(value: unknown): asserts value is LossReason[] {
	if (
		!Array.isArray(value) ||
		value.length > 50 ||
		value.some(item =>
			!item ||
			typeof item !== 'object' ||
			Array.isArray(item) ||
			Object.keys(item).sort().join(',') !== 'archived,id,title' ||
			!UUID.test(item.id) ||
			typeof item.title !== 'string' ||
			item.title.length < 1 ||
			item.title.length > 200 ||
			!item.title.trim() ||
			/[\x00-\x1f\x7f]/.test(item.title) ||
			typeof item.archived !== 'boolean'
		) ||
		new Set(value.map(item => item.id.toLowerCase())).size !== value.length ||
		new Set(value.map(item => item.title.trim().toLowerCase())).size !== value.length
	)
		throw new BadRequestException({
			code: 'crm_loss_reasons_invalid',
			message: 'Проверьте причины проигрыша'
		});
}

export async function readLossReasons(
	client: Pick<Prisma.TransactionClient, 'lossReasonSettings'>,
	workspaceId: string
): Promise<LossReasonSettingsSnapshot> {
	const row = await client.lossReasonSettings.findUnique({ where: { workspaceId } });
	if (!row)
		return {
			schemaVersion: 1,
			workspaceId,
			version: 0,
			reasons: DEFAULT_LOSS_REASONS.map(item => ({ ...item }))
		};
	try {
		if (!Number.isInteger(row.version) || row.version < 1) throw new Error();
		validateLossReasons(row.reasons);
		return {
			schemaVersion: 1,
			workspaceId,
			version: row.version,
			reasons: row.reasons
		};
	} catch {
		throw new ServiceUnavailableException('CRM loss reasons are unavailable');
	}
}

function permission(access: SalesAccess, write: boolean) {
	if (
		access.role === 'ANALYST' ||
		!access.permissions.includes('sales:read') ||
		(write &&
			(!['OWNER', 'CRM_ADMIN'].includes(access.role) ||
				!access.permissions.includes('sales:write') ||
				access.state === 'READ_ONLY'))
	)
		throw new ForbiddenException();
}

function conflict(): never {
	throw new ConflictException({
		code: 'crm_loss_reasons_conflict',
		message: 'Причины проигрыша изменились. Обновите данные'
	});
}

function receipt(
	value: unknown,
	workspaceId: string,
	expectedVersion: number
): LossReasonSettingsSnapshot {
	try {
		if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
		const result = value as Record<string, unknown>;
		if (
			Object.keys(result).sort().join(',') !== 'reasons,schemaVersion,version,workspaceId' ||
			result.schemaVersion !== 1 ||
			result.workspaceId !== workspaceId ||
			result.version !== expectedVersion + 1
		) throw new Error();
		validateLossReasons(result.reasons);
		return result as unknown as LossReasonSettingsSnapshot;
	} catch {
		throw new ServiceUnavailableException('CRM loss reason receipt is unavailable');
	}
}

@Injectable()
export class LossReasonsService {
	constructor(
		private readonly prisma: CrmSalesPrismaService,
		private readonly accessClient: SalesAccessClient,
		private readonly actors: ReminderActorClient
	) {}

	async settings(access: SalesAccess, workspaceId: string) {
		permission(access, false);
		if (workspaceId !== access.workspaceId) throw new ForbiddenException();
		return this.prisma.$transaction(
			tx => readLossReasons(tx, workspaceId),
			{ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
		);
	}

	async save(initial: SalesAccess, dto: SaveLossReasonsDto, token: string) {
		permission(initial, true);
		if (initial.workspaceId !== dto.workspaceId) throw new ForbiddenException();
		validateLossReasons(dto.reasons);
		const reasons = dto.reasons.map(item => ({
			id: item.id.toLowerCase(),
			title: item.title.trim(),
			archived: item.archived
		}));
		const requestHash = createHash('sha256')
			.update(canonical({ dto, subject: initial.subject }))
			.digest('hex');
		for (let attempt = 0; attempt < 3; attempt++) {
			let priorObserved = false;
			try {
				return await this.prisma.$transaction(
					async tx => {
						await tx.$executeRaw(
							Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`crm-loss-reason-command:${dto.commandId}`}, 0))`
						);
						const signal = AbortSignal.timeout(5000);
						const current = await this.accessClient.authorize(token, dto.workspaceId, signal);
						permission(current, true);
						if (
							current.subject !== initial.subject ||
							current.workspaceId !== initial.workspaceId
						)
							throw new ForbiddenException();
						await this.actors.verify(token, current, dto.actorMembershipId, signal);
						const prior = await tx.lossReasonCommand.findUnique({
							where: { commandId: dto.commandId }
						});
						priorObserved = !!prior;
						if (prior) {
							if (
								prior.workspaceId !== current.workspaceId ||
								prior.actorSubject !== current.subject ||
								prior.actorMembershipId !== dto.actorMembershipId ||
								prior.requestHash !== requestHash
							)
								conflict();
							return receipt(prior.result, dto.workspaceId, dto.expectedVersion);
						}
						await tx.$executeRaw(
							Prisma.sql`SELECT crm_sales.assert_workspace_open(${dto.workspaceId}::uuid)`
						);
						const previous = await readLossReasons(tx, dto.workspaceId);
						if (previous.version !== dto.expectedVersion) conflict();
						for (const item of previous.reasons) {
							if (!reasons.some(next => next.id === item.id.toLowerCase()))
								conflict();
						}
						if (previous.version === 0) {
							await tx.lossReasonSettings.create({
								data: { workspaceId: dto.workspaceId, version: 1, reasons }
							});
						} else {
							const updated = await tx.lossReasonSettings.updateMany({
								where: { workspaceId: dto.workspaceId, version: dto.expectedVersion },
								data: { version: { increment: 1 }, reasons }
							});
							if (updated.count !== 1) conflict();
						}
						const result = await readLossReasons(tx, dto.workspaceId);
						await tx.lossReasonCommand.create({
							data: {
								commandId: dto.commandId,
								workspaceId: dto.workspaceId,
								actorSubject: current.subject,
								actorMembershipId: dto.actorMembershipId,
								requestHash,
								result: result as unknown as Prisma.InputJsonValue
							}
						});
						return result;
					},
					{
					isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
					maxWait: 5000,
					timeout: 15000
					}
				);
			} catch (error) {
				if (String(error).includes('crm_workspace_closed'))
					throw new ForbiddenException({
						code: 'crm_workspace_closed',
						message: 'Workspace is closed'
					});
				if (attempt < 2 && !priorObserved &&
					await this.prisma.lossReasonCommand.findUnique({
						where: { commandId: dto.commandId }
					})) continue;
				if (
					error && typeof error === 'object' && 'code' in error &&
					error.code === 'P2002'
				)
					conflict();
				if (attempt === 2 || !retryablePlannerTransaction(error)) throw error;
			}
		}
		conflict();
	}
}
