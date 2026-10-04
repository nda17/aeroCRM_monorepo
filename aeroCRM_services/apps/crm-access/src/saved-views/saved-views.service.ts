import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	NotFoundException
} from '@nestjs/common';
import { Prisma, type CrmSavedView } from '@prisma/crm-access-client';
import { CrmAuthorizationService } from '../authorization/crm-authorization.service';
import { CrmAccessPrismaService } from '../prisma/crm-access-prisma.service';
import { command, json, type TeamAuthority } from '../team/team.util';
import type {
	CreateSavedViewDto,
	DeleteSavedViewDto,
	ImportSavedViewsDto,
	RenameSavedViewDto,
	SavedViewScope,
	SavedViewsQueryDto
} from './saved-views.dto';

const uuid =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const subject = /^[^\s\x00-\x1f\x7f]{1,256}$/;
const dealRequired = [
	'search',
	'pipelineId',
	'status',
	'withoutNextAction',
	'layout',
	'sort'
] as const;
const dealOptional = [
	'stageId',
	'assignedToSubject',
	'overdue',
	'createdFrom',
	'createdTo'
] as const;
const taskRequired = ['layout', 'period', 'timeZone', 'scope'] as const;
const taskOptional = [
	'status',
	'search',
	'teamId',
	'assigneeSubject',
	'from',
	'to'
] as const;

const inSet = (value: unknown, values: readonly string[]) =>
	typeof value === 'string' && values.includes(value);
const isInstant = (value: unknown) =>
	typeof value === 'string' &&
	Number.isFinite(Date.parse(value)) &&
	new Date(value).toISOString() === value;
const isDate = (value: unknown) =>
	typeof value === 'string' &&
	/^\d{4}-\d{2}-\d{2}$/.test(value) &&
	Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) &&
	new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
const isTimeZone = (value: unknown) => {
	if (
		typeof value !== 'string' ||
		!value ||
		value.length > 100 ||
		/^[+-]/.test(value)
	)
		return false;
	try {
		new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
		return true;
	} catch {
		return false;
	}
};

export function validateSavedParameters(scope: SavedViewScope, value: unknown) {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new BadRequestException('Invalid saved view parameters');
	const parameters = value as Record<string, unknown>;
	const required = scope === 'DEALS' ? dealRequired : taskRequired;
	const allowed: readonly string[] =
		scope === 'DEALS'
			? [...dealRequired, ...dealOptional]
			: [...taskRequired, ...taskOptional];
	if (
		required.some(key => !Object.hasOwn(parameters, key)) ||
		Object.keys(parameters).some(key => !allowed.includes(key))
	)
		throw new BadRequestException('Unsupported saved view parameters');
	const p = parameters;
	if (scope === 'DEALS') {
		if (
			typeof p.search !== 'string' ||
			p.search.length > 200 ||
			!(
				p.pipelineId === '' ||
				(typeof p.pipelineId === 'string' && uuid.test(p.pipelineId))
			) ||
			!inSet(p.status, ['', 'OPEN', 'WON', 'LOST']) ||
			typeof p.withoutNextAction !== 'boolean' ||
			!inSet(p.layout, ['list', 'board']) ||
			!inSet(p.sort, [
				'created_desc',
				'updated_desc',
				'amount_desc',
				'next_action_asc'
			]) ||
			(p.stageId !== undefined &&
				(typeof p.stageId !== 'string' || !uuid.test(p.stageId))) ||
			(p.assignedToSubject !== undefined &&
				(typeof p.assignedToSubject !== 'string' ||
					!subject.test(p.assignedToSubject))) ||
			(p.overdue !== undefined && typeof p.overdue !== 'boolean') ||
			(p.createdFrom !== undefined && !isInstant(p.createdFrom)) ||
			(p.createdTo !== undefined && !isInstant(p.createdTo)) ||
			(p.createdFrom === undefined) !== (p.createdTo === undefined) ||
			(typeof p.createdFrom === 'string' &&
				typeof p.createdTo === 'string' &&
				p.createdFrom >= p.createdTo)
		)
			throw new BadRequestException('Invalid deal view parameters');
	} else {
		if (
			!inSet(p.layout, ['list', 'board']) ||
			!inSet(p.period, [
				'ALL',
				'OVERDUE',
				'TODAY',
				'TOMORROW',
				'WEEK',
				'DAY',
				'RANGE'
			]) ||
			!isTimeZone(p.timeZone) ||
			!inSet(p.scope, ['MINE', 'TEAM', 'ALL']) ||
			(p.status !== undefined &&
				!inSet(p.status, [
					'OPEN',
					'IN_PROGRESS',
					'COMPLETED',
					'CANCELLED',
					'ACTIVE'
				])) ||
			(p.layout === 'board' && p.status !== undefined) ||
			(p.search !== undefined &&
				(typeof p.search !== 'string' || p.search.length > 200)) ||
			(p.teamId !== undefined &&
				(typeof p.teamId !== 'string' || !uuid.test(p.teamId))) ||
			(p.assigneeSubject !== undefined &&
				(typeof p.assigneeSubject !== 'string' ||
					!subject.test(p.assigneeSubject))) ||
			(p.period === 'DAY' && (!isDate(p.from) || p.to !== undefined)) ||
			(p.period === 'RANGE' &&
				(!isDate(p.from) || !isDate(p.to) || String(p.from) > String(p.to))) ||
			(!['DAY', 'RANGE'].includes(String(p.period)) &&
				(p.from !== undefined || p.to !== undefined))
		)
			throw new BadRequestException('Invalid task view parameters');
	}
	return json(p);
}

const viewDto = (view: CrmSavedView) => ({
	id: view.id,
	workspaceId: view.workspaceId,
	subject: view.subject,
	scope: view.scope,
	name: view.name,
	parameters: view.parameters,
	version: view.version,
	legacyKey: view.legacyKey,
	archivedAt: view.archivedAt?.toISOString() ?? null,
	createdAt: view.createdAt.toISOString(),
	updatedAt: view.updatedAt.toISOString()
});

@Injectable()
export class SavedViewsService {
	constructor(
		private readonly prisma: CrmAccessPrismaService,
		private readonly authorization: CrmAuthorizationService
	) {}

	private async actor(
		token: string | undefined,
		workspaceId: string,
		write: boolean,
		tx?: Prisma.TransactionClient
	): Promise<TeamAuthority> {
		const actor = await this.authorization.authorize(
			token,
			workspaceId,
			undefined,
			tx
		);
		if (
			!actor.permissions.includes('sales:read') ||
			(write && !['ACTIVE', 'GRACE'].includes(actor.state))
		)
			throw new ForbiddenException('Saved views are not available');
		return actor;
	}

	private name(value: string) {
		const name = value.trim();
		if (!name || name.length > 60 || /[\x00-\x1f\x7f]/.test(name))
			throw new BadRequestException(
				'Saved view name must have 1-60 characters'
			);
		return name;
	}

	async list(token: string | undefined, query: SavedViewsQueryDto) {
		const actor = await this.actor(token, query.workspaceId, false);
		const rows = await this.prisma.crmSavedView.findMany({
			where: {
				workspaceId: query.workspaceId,
				subject: actor.subject,
				scope: query.scope,
				archivedAt: null
			},
			orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
		});
		return {
			schemaVersion: 1 as const,
			workspaceId: query.workspaceId,
			subject: actor.subject,
			scope: query.scope,
			items: rows.map(viewDto)
		};
	}

	async create(token: string | undefined, dto: CreateSavedViewDto) {
		const actor = await this.actor(token, dto.workspaceId, true);
		const name = this.name(dto.name);
		const parameters = validateSavedParameters(dto.scope, dto.parameters);
		return command(
			this.prisma,
			actor,
			dto.commandId,
			'CREATE_SAVED_VIEW',
			dto,
			async tx => {
				await this.capacity(tx, actor, dto.scope, 1);
				const row = await tx.crmSavedView.create({
					data: {
						workspaceId: dto.workspaceId,
						subject: actor.subject,
						scope: dto.scope,
						name,
						parameters
					}
				});
				return { schemaVersion: 1 as const, view: viewDto(row) };
			},
			tx => this.actor(token, dto.workspaceId, true, tx).then(() => undefined)
		);
	}

	async rename(token: string | undefined, id: string, dto: RenameSavedViewDto) {
		const actor = await this.actor(token, dto.workspaceId, true);
		const name = this.name(dto.name);
		return command(
			this.prisma,
			actor,
			dto.commandId,
			'RENAME_SAVED_VIEW',
			{ id, dto },
			async tx => {
				const target = await this.target(tx, actor, id, dto.expectedVersion);
				const row = await tx.crmSavedView.update({
					where: { id: target.id },
					data: { name, version: { increment: 1 } }
				});
				return { schemaVersion: 1 as const, view: viewDto(row) };
			},
			tx => this.actor(token, dto.workspaceId, true, tx).then(() => undefined)
		);
	}

	async delete(token: string | undefined, id: string, dto: DeleteSavedViewDto) {
		const actor = await this.actor(token, dto.workspaceId, true);
		return command(
			this.prisma,
			actor,
			dto.commandId,
			'DELETE_SAVED_VIEW',
			{ id, dto },
			async tx => {
				const target = await this.target(tx, actor, id, dto.expectedVersion);
				const row = await tx.crmSavedView.update({
					where: { id: target.id },
					data: { archivedAt: new Date(), version: { increment: 1 } }
				});
				return { schemaVersion: 1 as const, view: viewDto(row) };
			},
			tx => this.actor(token, dto.workspaceId, true, tx).then(() => undefined)
		);
	}

	async import(token: string | undefined, dto: ImportSavedViewsDto) {
		if (dto.scope !== 'DEALS')
			throw new BadRequestException('Legacy import supports deal views only');
		const actor = await this.actor(token, dto.workspaceId, true);
		const views = dto.views.map(item => ({
			legacyKey: item.legacyKey,
			name: this.name(item.name),
			parameters: validateSavedParameters(dto.scope, item.parameters)
		}));
		return command(
			this.prisma,
			actor,
			dto.commandId,
			'IMPORT_SAVED_VIEWS',
			dto,
			async tx => {
				const existing = await tx.crmSavedView.findMany({
					where: {
						workspaceId: dto.workspaceId,
						subject: actor.subject,
						scope: dto.scope,
						legacyKey: { in: views.map(view => view.legacyKey) }
					}
				});
				const existingKeys = new Set(existing.map(view => view.legacyKey));
				const fresh = views.filter(view => !existingKeys.has(view.legacyKey));
				await this.capacity(tx, actor, dto.scope, fresh.length);
				for (const view of fresh)
					await tx.crmSavedView.create({
						data: {
							workspaceId: dto.workspaceId,
							subject: actor.subject,
							scope: dto.scope,
							...view
						}
					});
				const active = await tx.crmSavedView.findMany({
					where: {
						workspaceId: dto.workspaceId,
						subject: actor.subject,
						scope: dto.scope,
						archivedAt: null
					},
					orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
				});
				return {
					schemaVersion: 1 as const,
					workspaceId: dto.workspaceId,
					subject: actor.subject,
					scope: dto.scope,
					items: active.map(viewDto),
					createdCount: fresh.length,
					skippedCount: views.length - fresh.length
				};
			},
			tx => this.actor(token, dto.workspaceId, true, tx).then(() => undefined)
		);
	}

	private async target(
		tx: Prisma.TransactionClient,
		actor: TeamAuthority,
		id: string,
		version: number
	) {
		const row = await tx.crmSavedView.findFirst({
			where: {
				id,
				workspaceId: actor.workspaceId,
				subject: actor.subject,
				archivedAt: null
			}
		});
		if (!row) throw new NotFoundException('Saved view not found');
		if (row.version !== version)
			throw new ConflictException('Saved view version conflict');
		return row;
	}

	private async capacity(
		tx: Prisma.TransactionClient,
		actor: TeamAuthority,
		scope: SavedViewScope,
		count: number
	) {
		if (
			(await tx.crmSavedView.count({
				where: {
					workspaceId: actor.workspaceId,
					subject: actor.subject,
					scope,
					archivedAt: null
				}
			})) +
				count >
			20
		)
			throw new ConflictException('Saved view limit reached');
	}
}
