import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	NotFoundException,
	ServiceUnavailableException
} from '@nestjs/common';
import { Prisma } from '@prisma/crm-sales-client';
import { createHash } from 'node:crypto';
import { CrmSalesPrismaService } from '../prisma/crm-sales-prisma.service';
import { ReminderActorClient } from '../reminders/reminder-actor.client';
import {
	SalesAccessClient,
	UUID,
	type SalesAccess
} from '../sales/sales-access';
import { salesScope } from '../sales/sales.service';
import type {
	BulkAssignmentApplyDto,
	BulkAssignmentPreviewDto
} from '../sales/sales-productivity.dto';
import {
	SalesAssigneeClient,
	type SalesAssignee
} from '../workday/sales-assignee.client';

type DealSnapshot = {
	id: string;
	workspaceId: string;
	title: string;
	version: number;
	teamId: string | null;
	stageId: string;
	assignedToSubject: string;
};
type TaskSnapshot = {
	id: string;
	dealId: string | null;
	version: number;
	status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
	assignedToSubject: string;
	assignedToMembershipId: string | null;
};
type Snapshot = { deals: DealSnapshot[]; tasks: TaskSnapshot[] };
type Binding = { subject: string; membershipId: string | null };
const activeStatuses = ['OPEN', 'IN_PROGRESS'] as const;

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
function sha256(value: unknown) {
	return createHash('sha256').update(canonical(value)).digest('hex');
}
function conflict(code = 'crm_bulk_assignment_conflict'): never {
	throw new ConflictException({
		code,
		message: 'Сделки или задачи изменились. Повторите предпросмотр'
	});
}
function notFound(): never {
	throw new NotFoundException({
		code: 'crm_sales_record_not_found',
		message: 'Запись недоступна'
	});
}
function permission(access: SalesAccess) {
	if (
		access.role === 'ANALYST' ||
		!access.permissions.includes('sales:write') ||
		access.state === 'READ_ONLY'
	)
		throw new ForbiddenException();
}
function receipt(
	value: unknown,
	dto: BulkAssignmentApplyDto,
	items: Array<{ id: string; expectedVersion: number }>
) {
	try {
		if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
		const result = value as Record<string, unknown>;
		if (
			Object.keys(result).sort().join(',') !==
				'assignee,commandId,deals,schemaVersion,transferredTaskCount,workspaceId' ||
			result.schemaVersion !== 1 ||
			result.workspaceId !== dto.workspaceId ||
			result.commandId !== dto.commandId ||
			!result.assignee || typeof result.assignee !== 'object' ||
			Array.isArray(result.assignee) ||
			(result.assignee as Record<string, unknown>).subject !== dto.assignee.subject ||
			(result.assignee as Record<string, unknown>).membershipId !== dto.assignee.membershipId ||
			!Array.isArray(result.deals) || result.deals.length !== items.length
		) throw new Error();
		let transferred = 0;
		for (let index = 0; index < items.length; index++) {
			const deal = result.deals[index];
			if (!deal || typeof deal !== 'object' || Array.isArray(deal) ||
				Object.keys(deal).sort().join(',') !== 'id,transferredTaskCount,version' ||
				deal.id !== items[index].id ||
				deal.version !== items[index].expectedVersion + 1 ||
				!Number.isSafeInteger(deal.transferredTaskCount) ||
				deal.transferredTaskCount < 0)
				throw new Error();
			transferred += deal.transferredTaskCount;
		}
		if (!Number.isSafeInteger(transferred) ||
			transferred !== result.transferredTaskCount)
			throw new Error();
		return value;
	} catch {
		throw new ServiceUnavailableException('CRM bulk assignment receipt is unavailable');
	}
}

@Injectable()
export class BulkAssignmentService {
	constructor(
		private readonly prisma: CrmSalesPrismaService,
		private readonly authority: SalesAccessClient,
		private readonly actors: ReminderActorClient,
		private readonly assignees: SalesAssigneeClient
	) {}

	private input(access: SalesAccess, dto: BulkAssignmentPreviewDto) {
		permission(access);
		if (dto.workspaceId !== access.workspaceId)
			throw new ForbiddenException();
		if (
			!Array.isArray(dto.deals) ||
			dto.deals.length < 1 ||
			dto.deals.length > 25 ||
			dto.deals.some(
				item => !UUID.test(item.id) ||
					!Number.isSafeInteger(item.expectedVersion) ||
					item.expectedVersion < 1
			) ||
			new Set(dto.deals.map(item => item.id.toLowerCase())).size !== dto.deals.length
		)
			throw new BadRequestException('Выберите от 1 до 25 разных сделок');
		return dto.deals
			.map(item => ({ id: item.id.toLowerCase(), expectedVersion: item.expectedVersion }))
			.sort((a, b) => a.id.localeCompare(b.id));
	}

	private async snapshot(
		tx: Prisma.TransactionClient,
		access: SalesAccess,
		items: Array<{ id: string; expectedVersion: number }>,
		lock: boolean
	): Promise<Snapshot> {
		const ids = items.map(item => item.id);
		if (lock) {
			const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
				SELECT id FROM crm_sales.deals
				WHERE workspace_id=${access.workspaceId}::uuid
				  AND id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})
				ORDER BY id FOR UPDATE
			`);
			if (locked.length !== ids.length) notFound();
		}
		const deals = await tx.deal.findMany({
			where: { AND: [salesScope(access), { id: { in: ids }, archivedAt: null }] },
			select: {
				id: true,
				workspaceId: true,
				title: true,
				version: true,
				teamId: true,
				stageId: true,
				assignedToSubject: true
			},
			orderBy: { id: 'asc' }
		});
		if (deals.length !== ids.length) notFound();
		for (let index = 0; index < deals.length; index++)
			if (deals[index].id !== ids[index] ||
				deals[index].version !== items[index].expectedVersion)
				conflict();
		if (lock) {
			await tx.$queryRaw(Prisma.sql`
				SELECT id FROM crm_sales.tasks
				WHERE workspace_id=${access.workspaceId}::uuid
				  AND deal_id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})
				  AND status IN ('OPEN', 'IN_PROGRESS')
				ORDER BY deal_id, id FOR UPDATE
			`);
		}
		const tasks = await tx.salesTask.findMany({
			where: {
				workspaceId: access.workspaceId,
				dealId: { in: ids },
				status: { in: [...activeStatuses] }
			},
			select: {
				id: true,
				dealId: true,
				version: true,
				status: true,
				assignedToSubject: true,
				assignedToMembershipId: true
			},
			orderBy: [{ dealId: 'asc' }, { id: 'asc' }]
		});
		if (tasks.length > 500) conflict('crm_bulk_assignment_task_limit');
		return { deals, tasks };
	}

	private bindings(snapshot: Snapshot): Binding[] {
		const owners = new Map(snapshot.deals.map(deal => [deal.id, deal.assignedToSubject]));
		const bindings = [
			...new Map(snapshot.tasks
				.filter(task => task.assignedToSubject !== owners.get(task.dealId!))
				.map(task => {
					const binding = {
						subject: task.assignedToSubject,
						membershipId: task.assignedToMembershipId
					};
					return [canonical(binding), binding] as const;
				})).values()
		];
		if (bindings.length > 100) conflict('crm_bulk_assignment_reader_limit');
		return bindings;
	}

	private fingerprint(
		access: SalesAccess,
		dto: BulkAssignmentPreviewDto,
		snapshot: Snapshot
	) {
		return sha256({
			workspaceId: access.workspaceId,
			actorSubject: access.subject,
			actorMembershipId: dto.actorMembershipId,
			assignee: {
				subject: dto.assignee.subject,
				membershipId: dto.assignee.membershipId
			},
			deals: snapshot.deals,
			tasks: snapshot.tasks
		});
	}

	private async fresh(
		token: string,
		initial: SalesAccess,
		dto: BulkAssignmentPreviewDto,
		snapshot: Snapshot,
		signal: AbortSignal
	) {
		const access = await this.authority.authorize(token, dto.workspaceId, signal);
		if (access.subject !== initial.subject || access.workspaceId !== initial.workspaceId)
			throw new ForbiddenException();
		permission(access);
		await this.actors.verify(token, access, dto.actorMembershipId, signal);
		for (const deal of snapshot.deals) {
			if (access.dataScope === 'OWN' && deal.assignedToSubject !== access.subject)
				notFound();
			if (access.dataScope === 'TEAM' && deal.assignedToSubject !== access.subject &&
				(!deal.teamId || !access.teamIds.includes(deal.teamId)))
				notFound();
		}
		const teams = [...new Set(snapshot.deals.map(deal => deal.teamId))];
		const bindings = this.bindings(snapshot);
		const [targets, readers] = await Promise.all([
			Promise.all(teams.map(teamId =>
				this.assignees.authorize(
					token, access, dto.assignee, teamId ?? undefined, signal
				)
			)),
			this.assignees.readers(token, access, bindings, signal)
		]);
		const targetByTeam = new Map<string | null, SalesAssignee>();
		teams.forEach((teamId, index) => targetByTeam.set(teamId, targets[index]));
		const readerByBinding = new Map(bindings.map((binding, index) =>
			[canonical(binding), readers[index]] as const));
		for (const deal of snapshot.deals) {
			const target = targetByTeam.get(deal.teamId);
			if (!target || target.subject !== dto.assignee.subject ||
				target.membershipId !== dto.assignee.membershipId)
				conflict('crm_bulk_assignment_target_conflict');
			if (access.dataScope === 'OWN' && target.subject !== access.subject)
				throw new ForbiddenException('Передача лишит доступа к сделке');
			if (access.dataScope === 'TEAM' && target.subject !== access.subject &&
				(!deal.teamId || !access.teamIds.includes(deal.teamId)))
				throw new ForbiddenException('Передача лишит доступа к сделке');
			for (const task of snapshot.tasks) {
				if (task.dealId !== deal.id || task.assignedToSubject === deal.assignedToSubject)
					continue;
				const reader = readerByBinding.get(canonical({
					subject: task.assignedToSubject,
					membershipId: task.assignedToMembershipId
				}));
				if (!reader || (reader.subject !== target.subject &&
					reader.dataScope !== 'ALL' &&
					!(reader.dataScope === 'TEAM' && deal.teamId &&
						reader.teamIds.includes(deal.teamId))))
					conflict('crm_sales_assignment_task_access_conflict');
			}
		}
		return access;
	}

	async preview(initial: SalesAccess, dto: BulkAssignmentPreviewDto, token: string) {
		const items = this.input(initial, dto);
		const snapshot = await this.prisma.$transaction(
			async tx => {
				await tx.$executeRaw(Prisma.sql`
					SELECT crm_sales.assert_workspace_open(${dto.workspaceId}::uuid)
				`);
				return this.snapshot(tx, initial, items, false);
			},
			{ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
		);
		await this.fresh(token, initial, dto, snapshot, AbortSignal.timeout(5000));
		let transferredTaskCount = 0;
		let retainedTaskCount = 0;
		const deals = snapshot.deals.map(deal => {
			const active = snapshot.tasks.filter(task => task.dealId === deal.id);
			const transferred = active.filter(
				task => task.assignedToSubject === deal.assignedToSubject
			).length;
			const retained = active.length - transferred;
			transferredTaskCount += transferred;
			retainedTaskCount += retained;
			return {
				id: deal.id,
				expectedVersion: deal.version,
				title: deal.title,
				fromSubject: deal.assignedToSubject,
				transferredTaskCount: transferred,
				retainedTaskCount: retained
			};
		});
		return {
			schemaVersion: 1 as const,
			workspaceId: initial.workspaceId,
			actorSubject: initial.subject,
			actorMembershipId: dto.actorMembershipId,
			assignee: {
				subject: dto.assignee.subject,
				membershipId: dto.assignee.membershipId
			},
			previewHash: this.fingerprint(initial, dto, snapshot),
			deals,
			transferredTaskCount,
			retainedTaskCount
		};
	}

	async apply(initial: SalesAccess, dto: BulkAssignmentApplyDto, token: string) {
		const items = this.input(initial, dto);
		if (!/^[a-f0-9]{64}$/.test(dto.previewHash))
			throw new BadRequestException('Некорректный предпросмотр');
		const requestHash = sha256({ dto, actorSubject: initial.subject });
		for (let attempt = 0; attempt < 3; attempt++) {
			let priorObserved = false;
			try {
				return await this.prisma.$transaction(async tx => {
					await tx.$executeRaw(Prisma.sql`
						SELECT pg_advisory_xact_lock(hashtextextended(${`crm-bulk-assignment-command:${dto.commandId}`}, 0))
					`);
					const prior = await tx.bulkAssignmentCommand.findUnique({
						where: { commandId: dto.commandId }
					});
					priorObserved = !!prior;
					const signal = AbortSignal.timeout(5000);
					const current = await this.authority.authorize(token, dto.workspaceId, signal);
					if (current.subject !== initial.subject ||
						current.workspaceId !== initial.workspaceId)
						throw new ForbiddenException();
					permission(current);
					await this.actors.verify(token, current, dto.actorMembershipId, signal);
					if (prior) {
						if (prior.workspaceId !== current.workspaceId ||
							prior.actorSubject !== current.subject ||
							prior.actorMembershipId !== dto.actorMembershipId ||
							prior.requestHash !== requestHash)
							conflict('crm_bulk_assignment_command_conflict');
						const visible = await tx.deal.count({
							where: { AND: [salesScope(current), { id: { in: items.map(item => item.id) } }] }
						});
						if (visible !== items.length) notFound();
						return receipt(prior.result, dto, items);
					}
					await tx.$executeRaw(Prisma.sql`
						SELECT crm_sales.assert_workspace_open(${dto.workspaceId}::uuid)
					`);
					const snapshot = await this.snapshot(tx, current, items, true);
					if (this.fingerprint(current, dto, snapshot) !== dto.previewHash)
						conflict('crm_bulk_assignment_preview_stale');
					const authorized = await this.fresh(token, current, dto, snapshot, signal);
					let transferredTaskCount = 0;
					const deals = [];
					for (const deal of snapshot.deals) {
						const updated = await tx.deal.updateMany({
							where: {
								AND: [salesScope(authorized), {
									id: deal.id, version: deal.version, archivedAt: null
								}]
							},
							data: {
								assignedToSubject: dto.assignee.subject,
								version: { increment: 1 }
							}
						});
						if (updated.count !== 1) conflict();
						const moved = await tx.salesTask.updateMany({
							where: {
								workspaceId: authorized.workspaceId,
								dealId: deal.id,
								status: { in: [...activeStatuses] },
								assignedToSubject: deal.assignedToSubject
							},
							data: {
								assignedToSubject: dto.assignee.subject,
								assignedToMembershipId: dto.assignee.membershipId,
								version: { increment: 1 }
							}
						});
						const expected = snapshot.tasks.filter(task =>
							task.dealId === deal.id &&
							task.assignedToSubject === deal.assignedToSubject).length;
						if (moved.count !== expected) conflict();
						await tx.dealTimeline.create({
							data: {
								workspaceId: authorized.workspaceId,
								dealId: deal.id,
								kind: 'ASSIGNEE_CHANGED',
								actorSubject: authorized.subject,
								outcome: 'Изменён ответственный',
								fromStageId: deal.stageId,
								toStageId: deal.stageId,
								details: {
									beforeSubject: deal.assignedToSubject,
									afterSubject: dto.assignee.subject,
									afterMembershipId: dto.assignee.membershipId,
									transferredTaskCount: moved.count
								}
							}
						});
						transferredTaskCount += moved.count;
						deals.push({
							id: deal.id,
							version: deal.version + 1,
							transferredTaskCount: moved.count
						});
					}
					const visible = await tx.deal.count({
						where: { AND: [salesScope(authorized), { id: { in: items.map(item => item.id) } }] }
					});
					if (visible !== items.length)
						throw new ForbiddenException('Передача лишит доступа к сделке');
					const result = {
						schemaVersion: 1 as const,
						workspaceId: authorized.workspaceId,
						commandId: dto.commandId,
						assignee: {
							subject: dto.assignee.subject,
							membershipId: dto.assignee.membershipId
						},
						deals,
						transferredTaskCount
					};
					await tx.bulkAssignmentCommand.create({
						data: {
							commandId: dto.commandId,
							workspaceId: authorized.workspaceId,
							actorSubject: authorized.subject,
							actorMembershipId: dto.actorMembershipId,
							requestHash,
							result
						}
					});
					await tx.$executeRaw(Prisma.sql`
						SET CONSTRAINTS
							crm_sales.deals_next_task_fkey,
							crm_sales.deals_next_action_integrity,
							crm_sales.tasks_next_action_integrity IMMEDIATE
					`);
					return result;
				}, {
					isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
					maxWait: 5000,
					timeout: 15000
				});
			} catch (error) {
				if (String(error).includes('crm_workspace_closed'))
					throw new ForbiddenException({
						code: 'crm_workspace_closed',
						message: 'Workspace is closed'
					});
				if (attempt < 2 && !priorObserved &&
					await this.prisma.bulkAssignmentCommand.findUnique({
						where: { commandId: dto.commandId }
					})) continue;
				if (attempt === 2 || !error || typeof error !== 'object' ||
					!('code' in error) ||
					!(error.code === 'P2034' ||
						(error.code === 'P2010' && 'meta' in error &&
							['40001', '40P01'].includes(String((error.meta as { code?: unknown })?.code)))))
					throw error;
			}
		}
		conflict();
	}
}
