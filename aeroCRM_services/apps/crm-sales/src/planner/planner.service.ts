import {
	ConflictException,
	ForbiddenException,
	Injectable
} from '@nestjs/common';
import { Prisma } from '@prisma/crm-sales-client';
import { createHash } from 'node:crypto';
import { CrmSalesPrismaService } from '../prisma/crm-sales-prisma.service';
import {
	SalesAccessClient,
	type SalesAccess
} from '../sales/sales-access';
import type { SavePlannerSettingsDto } from './planner.dto';
import {
	plannerConflict,
	readPlannerSettings,
	validatePlannerItems
} from './planner-settings';

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
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object')
		return `{${Object.entries(value)
			.filter(([, item]) => item !== undefined)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
			.join(',')}}`;
	return JSON.stringify(value);
}
@Injectable()
export class PlannerService {
	constructor(
		private readonly prisma: CrmSalesPrismaService,
		private readonly accessClient: SalesAccessClient
	) {}
	async settings(access: SalesAccess, workspaceId: string) {
		permission(access, false);
		if (workspaceId !== access.workspaceId) throw new ForbiddenException();
		return this.prisma.$transaction(
			tx => readPlannerSettings(tx, workspaceId),
			{ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
		);
	}
	async save(
		initial: SalesAccess,
		dto: SavePlannerSettingsDto,
		token: string
	) {
		permission(initial, true);
		if (initial.workspaceId !== dto.workspaceId)
			throw new ForbiddenException();
		validatePlannerItems(dto.templates, dto.columns);
		const hash = createHash('sha256')
			.update(canonical({ dto, subject: initial.subject }))
			.digest('hex');
		for (let attempt = 0; attempt < 3; attempt++) {
			const access = await this.accessClient.authorize(
				token,
				dto.workspaceId
			);
			permission(access, true);
			if (
				access.subject !== initial.subject ||
				access.workspaceId !== initial.workspaceId
			)
				throw new ForbiddenException();
			try {
				return await this.prisma.$transaction(
					async tx => {
						await tx.$executeRaw(
							Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`crm-planner-command:${dto.commandId}`}, 0))`
						);
						await tx.$executeRaw(
							Prisma.sql`SELECT crm_sales.assert_workspace_open(${dto.workspaceId}::uuid)`
						);
						const prior = await tx.plannerCommandReceipt.findUnique({
							where: { commandId: dto.commandId }
						});
						if (prior) {
							if (
								prior.workspaceId !== access.workspaceId ||
								prior.actorSubject !== access.subject ||
								prior.requestHash !== hash
							)
								throw new ConflictException({
									code: 'crm_planner_command_conflict',
									message: 'Команда настроек уже использована'
								});
							return prior.result;
						}
						const previous = await readPlannerSettings(
							tx,
							dto.workspaceId
						);
						if (previous.version !== dto.expectedVersion)
							plannerConflict();
						for (const item of previous.templates) {
							if (!dto.templates.some(next => next.id === item.id))
								plannerConflict();
						}
						for (const item of previous.columns) {
							const next = dto.columns.find(next => next.id === item.id);
							if (
								!next ||
								next.status !== item.status ||
								next.isDefault !== item.isDefault
							)
								plannerConflict();
						}
						const templates = dto.templates.map(item => ({
							id: item.id.toLowerCase(),
							title: item.title.trim(),
							archived: item.archived
						}));
						const defaults = dto.columns.flatMap((item, position) =>
							item.isDefault
								? [{ id: item.id, name: item.name.trim(), position }]
								: []
						);
						await tx.plannerSettings.upsert({
							where: { workspaceId: dto.workspaceId },
							create: {
								workspaceId: dto.workspaceId,
								version: 1,
								templates,
								defaultColumns: defaults
							},
							update: {
								version: { increment: 1 },
								templates,
								defaultColumns: defaults
							}
						});
						for (const [position, item] of dto.columns.entries()) {
							if (item.isDefault) continue;
							const id = item.id.toLowerCase();
							const found = await tx.plannerBoardColumn.findUnique({
								where: { id }
							});
							if (
								found &&
								(found.workspaceId !== dto.workspaceId ||
									found.status !== item.status)
							)
								plannerConflict();
							await tx.plannerBoardColumn.upsert({
								where: { id },
								create: {
									id,
									workspaceId: dto.workspaceId,
									status: item.status,
									name: item.name.trim(),
									position,
									archived: item.archived
								},
								update: {
									name: item.name.trim(),
									position,
									archived: item.archived
								}
							});
						}
						const result = await readPlannerSettings(tx, dto.workspaceId);
						await tx.plannerCommandReceipt.create({
							data: {
								commandId: dto.commandId,
								workspaceId: dto.workspaceId,
								actorSubject: access.subject,
								requestHash: hash,
								result: result as unknown as Prisma.InputJsonValue
							}
						});
						return result;
					},
					{
						isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
						timeout: 15000,
						maxWait: 5000
					}
				);
			} catch (error) {
				if (
					error &&
					typeof error === 'object' &&
					'code' in error &&
					error.code === 'P2002'
				)
					plannerConflict();
				if (
					attempt === 2 ||
					!error ||
					typeof error !== 'object' ||
					!('code' in error) ||
					error.code !== 'P2034'
				)
					throw error;
			}
		}
		plannerConflict();
	}
}
