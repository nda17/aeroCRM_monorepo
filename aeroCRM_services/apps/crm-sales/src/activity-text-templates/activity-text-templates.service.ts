import {
	ConflictException,
	ForbiddenException,
	Injectable
} from '@nestjs/common';
import { Prisma } from '@prisma/crm-sales-client';
import { createHash } from 'node:crypto';
import { CrmSalesPrismaService } from '../prisma/crm-sales-prisma.service';
import { SalesAccessClient, type SalesAccess } from '../sales/sales-access';
import type { SaveActivityTextTemplatesDto } from './activity-text-templates.dto';
import {
	activityTextTemplatesConflict,
	readActivityTextTemplateReceipt,
	readActivityTextTemplates,
	validateActivityTextTemplates
} from './activity-text-templates';
import { retryablePlannerTransaction } from '../planner/planner-settings';

export const ACTIVITY_TEXT_TEMPLATES_CAPABILITY = 'activity-text-templates-v1';

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
export class ActivityTextTemplatesService {
	constructor(
		private readonly prisma: CrmSalesPrismaService,
		private readonly accessClient: SalesAccessClient
	) {}

	async settings(access: SalesAccess, workspaceId: string) {
		permission(access, false);
		if (workspaceId !== access.workspaceId) throw new ForbiddenException();
		return this.prisma.$transaction(
			tx => readActivityTextTemplates(tx, workspaceId),
			{ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
		);
	}

	async save(initial: SalesAccess, dto: SaveActivityTextTemplatesDto, token: string) {
		permission(initial, true);
		if (initial.workspaceId !== dto.workspaceId) throw new ForbiddenException();
		validateActivityTextTemplates(dto.templates);
		const templates = dto.templates.map(item => ({
			id: item.id.toLowerCase(),
			title: item.title.trim(),
			body: item.body.replace(/\r\n?/g, '\n').trim(),
			archived: item.archived
		}));
		const requestHash = createHash('sha256')
			.update(canonical({ dto, subject: initial.subject }))
			.digest('hex');
		for (let attempt = 0; attempt < 3; attempt++) {
			const access = await this.accessClient.authorize(token, dto.workspaceId);
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
							Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`crm-activity-text-template-command:${dto.commandId}`}, 0))`
						);
						await tx.$executeRaw(
							Prisma.sql`SELECT crm_sales.assert_workspace_open(${dto.workspaceId}::uuid)`
						);
						const prior = await tx.activityTextTemplateCommand.findUnique({
							where: { commandId: dto.commandId }
						});
						if (prior) {
							if (
								prior.workspaceId !== access.workspaceId ||
								prior.actorSubject !== access.subject ||
								prior.requestHash !== requestHash
							)
								throw new ConflictException({
									code: 'crm_activity_text_template_command_conflict',
									message: 'Команда шаблонов уже использована'
								});
							return readActivityTextTemplateReceipt(
								prior.result, dto.workspaceId, dto.expectedVersion
							);
						}
						const previous = await readActivityTextTemplates(tx, dto.workspaceId);
						if (previous.version !== dto.expectedVersion)
							activityTextTemplatesConflict();
						for (const item of previous.templates) {
							if (!templates.some(next => next.id === item.id.toLowerCase()))
								activityTextTemplatesConflict();
						}
						if (previous.version === 0) {
							await tx.activityTextTemplateSettings.create({
								data: { workspaceId: dto.workspaceId, version: 1, templates }
							});
						} else {
							const updated = await tx.activityTextTemplateSettings.updateMany({
								where: { workspaceId: dto.workspaceId, version: dto.expectedVersion },
								data: { version: { increment: 1 }, templates }
							});
							if (updated.count !== 1) activityTextTemplatesConflict();
						}
						const result = await readActivityTextTemplates(tx, dto.workspaceId);
						await tx.activityTextTemplateCommand.create({
							data: {
								commandId: dto.commandId,
								workspaceId: dto.workspaceId,
								actorSubject: access.subject,
								requestHash,
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
					error && typeof error === 'object' && 'code' in error &&
					error.code === 'P2002'
				)
					activityTextTemplatesConflict();
				if (attempt === 2 || !retryablePlannerTransaction(error)) throw error;
			}
		}
		activityTextTemplatesConflict();
	}
}
