import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException
} from '@nestjs/common';
import { Prisma } from '@prisma/crm-sales-client';
import { randomUUID } from 'node:crypto';
import { CrmSalesPrismaService } from '../prisma/crm-sales-prisma.service';
import { PipelineTemplateCatalogService } from '../templates/pipeline-template-catalog.service';
import { salesScope } from '../sales/sales.service';
import type { SalesAccess } from '../sales/sales-access';
import {
	conflict,
	hash,
	lineTotal,
	lock,
	minor,
	object,
	quantityMilli,
	serializable,
	string,
	uuid,
	MAX_MINOR
} from './commerce-core';

const txOptions = {
	isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
	timeout: 15000,
	maxWait: 5000
} as const;
type Tx = Prisma.TransactionClient;

@Injectable()
export class CommerceService {
	constructor(
		private readonly db: CrmSalesPrismaService,
		private readonly templates: PipelineTemplateCatalogService
	) {}

	private check(access: SalesAccess, permission: string): void {
		if (
			!access.permissions.includes(permission) ||
			(access.state === 'READ_ONLY' &&
				!['sales:read', 'sales:analytics', 'sales:export'].includes(permission))
		)
			throw new ForbiddenException();
	}
	private manage(access: SalesAccess): void {
		this.check(access, 'sales:manage-pipelines');
		if (!['OWNER', 'CRM_ADMIN'].includes(access.role))
			throw new ForbiddenException();
	}
	private async deal(
		tx: Tx,
		access: SalesAccess,
		id: string,
		mutation = false
	) {
		const deal = await tx.deal.findFirst({
			where: {
				AND: [
					salesScope(access),
					{ id, ...(mutation ? { archivedAt: null } : {}) }
				]
			}
		});
		if (!deal) throw new NotFoundException('Сделка не найдена или недоступна');
		return deal;
	}
	private async command<T>(
		access: SalesAccess,
		body: Record<string, unknown>,
		kind: string,
		work: (tx: Tx) => Promise<T>,
		target?: string,
		dealTarget = false
	): Promise<T> {
		const commandId = uuid(body.commandId, 'commandId');
		const requestHash = hash({ kind, body, target });
		return serializable(() =>
			this.db.$transaction(async tx => {
				await lock(tx, `commerce:command:${commandId}`);
				const prior = await tx.commerceCommand.findUnique({
					where: { commandId }
				});
				if (prior) {
					if (
						prior.workspaceId !== access.workspaceId ||
						prior.actorSubject !== access.subject ||
						prior.kind !== kind ||
						prior.requestHash !== requestHash
					)
						conflict('Команда уже использована с другими данными');
					if (dealTarget && target)
						await this.deal(tx, access, target.split(':')[0]);
					return prior.result as T;
				}
				const result = await work(tx);
				await tx.commerceCommand.create({
					data: {
						commandId,
						workspaceId: access.workspaceId,
						actorSubject: access.subject,
						kind,
						requestHash,
						result: result as Prisma.InputJsonValue
					}
				});
				return result;
			}, txOptions)
		);
	}
	private event(
		tx: Tx,
		access: SalesAccess,
		kind: string,
		details: unknown,
		dealId?: string
	) {
		return tx.commerceEvent.create({
			data: {
				workspaceId: access.workspaceId,
				actorSubject: access.subject,
				kind,
				dealId,
				details: details as Prisma.InputJsonValue
			}
		});
	}
	private pipelineView(
		p: Prisma.PipelineGetPayload<{ include: { stages: true } }>
	) {
		return {
			id: p.id,
			workspaceId: p.workspaceId,
			name: p.name,
			version: p.version,
			templateKey: p.templateKey,
			templateVersion: p.templateVersion,
			stages: p.stages
				.sort((a, b) => a.position - b.position)
				.map(s => ({
					id: s.id,
					key: s.key,
					name: s.name,
					position: s.position,
					state: s.state
				}))
		};
	}
	private async pipeline(tx: Tx, access: SalesAccess, id: string) {
		const p = await tx.pipeline.findFirst({
			where: { id, workspaceId: access.workspaceId },
			include: { stages: true }
		});
		if (!p) throw new NotFoundException('Воронка не найдена');
		return p;
	}
	async pipelines(access: SalesAccess) {
		this.check(access, 'sales:read');
		return this.pipelineList(access);
	}
	async analyticsPipelines(access: SalesAccess) {
		this.check(access, 'sales:analytics');
		return this.pipelineList(access);
	}
	private async pipelineList(access: SalesAccess) {
		const items = await this.db.pipeline.findMany({
			where: { workspaceId: access.workspaceId },
			include: { stages: true },
			orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
		});
		return {
			schemaVersion: 1,
			workspaceId: access.workspaceId,
			items: items.map(p => this.pipelineView(p))
		};
	}
	async createPipeline(access: SalesAccess, input: unknown) {
		this.manage(access);
		const body = object(input);
		const name = string(body.name, 'name', 200);
		return this.command(access, body, 'PIPELINE_CREATE', async tx => {
			const templateKey =
				body.templateKey === undefined
					? 'custom'
					: string(body.templateKey, 'templateKey', 64);
			const version =
				body.templateVersion === undefined ? 1 : body.templateVersion;
			if (
				!Number.isInteger(version) ||
				Number(version) < 1 ||
				Number(version) > 32767 ||
				(templateKey === 'custom' && version !== 1)
			)
				throw new BadRequestException('Некорректная версия шаблона');
			const template =
				templateKey === 'custom'
					? null
					: this.templates.getTemplate(templateKey, Number(version));
			if (templateKey !== 'custom' && !template)
				throw new BadRequestException('Шаблон не найден');
			const stages = template
				? template.stages.map(s => ({
						key: s.key,
						name: s.name,
						position: s.order,
						state: s.state
					}))
				: [
						{
							key: 'new',
							name: 'Новая сделка',
							position: 1,
							state: 'OPEN' as const
						},
						{ key: 'won', name: 'Успешно', position: 2, state: 'WON' as const },
						{
							key: 'lost',
							name: 'Не реализовано',
							position: 3,
							state: 'LOST' as const
						}
					];
			const p = await tx.pipeline.create({
				data: {
					workspaceId: access.workspaceId,
					name,
					templateKey,
					templateVersion: Number(version),
					templateFingerprint: template
						? this.templates.getTemplateFingerprint(
								templateKey,
								Number(version)
							)!
						: hash('custom-v1'),
					installedBySubject: access.subject,
					stages: { create: stages }
				},
				include: { stages: true }
			});
			await this.event(tx, access, 'PIPELINE_CREATED', {
				pipelineId: p.id,
				name
			});
			return { schemaVersion: 1, pipeline: this.pipelineView(p) };
		});
	}
	async renamePipeline(access: SalesAccess, id: string, input: unknown) {
		this.manage(access);
		const body = object(input);
		const name = string(body.name, 'name', 200);
		return this.command(
			access,
			body,
			'PIPELINE_RENAME',
			async tx => {
				const p = await this.pipeline(tx, access, id);
				if (p.version !== body.expectedVersion) conflict();
				await tx.pipeline.update({
					where: { id },
					data: { name, version: { increment: 1 } }
				});
				await this.event(tx, access, 'PIPELINE_RENAMED', {
					pipelineId: id,
					before: p.name,
					after: name
				});
				return {
					schemaVersion: 1,
					pipeline: this.pipelineView(await this.pipeline(tx, access, id))
				};
			},
			id
		);
	}
	async addStage(access: SalesAccess, id: string, input: unknown) {
		this.manage(access);
		const body = object(input);
		const name = string(body.name, 'name', 200);
		const state = body.state;
		if (!['OPEN', 'WON', 'LOST'].includes(String(state)))
			throw new BadRequestException('Некорректный тип этапа');
		return this.command(
			access,
			body,
			'STAGE_ADD',
			async tx => {
				const p = await this.pipeline(tx, access, id);
				if (p.version !== body.expectedVersion) conflict();
				if (p.stages.length >= 100)
					throw new BadRequestException('Не более 100 этапов');
				await tx.pipelineStage.create({
					data: {
						pipelineId: id,
						workspaceId: access.workspaceId,
						key: `custom-${randomUUID()}`,
						name,
						position: Math.max(0, ...p.stages.map(s => s.position)) + 1,
						state: state as 'OPEN' | 'WON' | 'LOST'
					}
				});
				await tx.pipeline.update({
					where: { id },
					data: { version: { increment: 1 } }
				});
				await this.event(tx, access, 'STAGE_ADDED', {
					pipelineId: id,
					name,
					state
				});
				return {
					schemaVersion: 1,
					pipeline: this.pipelineView(await this.pipeline(tx, access, id))
				};
			},
			id
		);
	}
	async renameStage(
		access: SalesAccess,
		id: string,
		stageId: string,
		input: unknown
	) {
		this.manage(access);
		const body = object(input);
		const name = string(body.name, 'name', 200);
		return this.command(
			access,
			body,
			'STAGE_RENAME',
			async tx => {
				const p = await this.pipeline(tx, access, id);
				if (p.version !== body.expectedVersion) conflict();
				const stage = p.stages.find(s => s.id === stageId);
				if (!stage) throw new NotFoundException('Этап не найден');
				await tx.pipelineStage.update({
					where: { id: stageId },
					data: { name }
				});
				await tx.pipeline.update({
					where: { id },
					data: { version: { increment: 1 } }
				});
				await this.event(tx, access, 'STAGE_RENAMED', {
					pipelineId: id,
					stageId,
					before: stage.name,
					after: name
				});
				return {
					schemaVersion: 1,
					pipeline: this.pipelineView(await this.pipeline(tx, access, id))
				};
			},
			id + ':' + stageId
		);
	}
	async reorderStages(access: SalesAccess, id: string, input: unknown) {
		this.manage(access);
		const body = object(input);
		if (
			!Array.isArray(body.stageIds) ||
			body.stageIds.length < 3 ||
			body.stageIds.length > 100 ||
			body.stageIds.some(v => typeof v !== 'string')
		)
			throw new BadRequestException('Укажите порядок этапов');
		const ids = body.stageIds as string[];
		return this.command(
			access,
			body,
			'STAGE_REORDER',
			async tx => {
				const p = await this.pipeline(tx, access, id);
				if (p.version !== body.expectedVersion) conflict();
				if (
					new Set(ids).size !== p.stages.length ||
					p.stages.some(s => !ids.includes(s.id))
				)
					throw new BadRequestException(
						'Порядок должен содержать все этапы воронки'
					);
				for (const [index, stageId] of ids.entries())
					await tx.pipelineStage.update({
						where: { id: stageId },
						data: { position: 1000 + index }
					});
				for (const [index, stageId] of ids.entries())
					await tx.pipelineStage.update({
						where: { id: stageId },
						data: { position: index + 1 }
					});
				await tx.pipeline.update({
					where: { id },
					data: { version: { increment: 1 } }
				});
				await this.event(tx, access, 'STAGES_REORDERED', {
					pipelineId: id,
					stageIds: ids
				});
				return {
					schemaVersion: 1,
					pipeline: this.pipelineView(await this.pipeline(tx, access, id))
				};
			},
			id
		);
	}
	private catalogView(item: Prisma.CommerceCatalogItemGetPayload<object>) {
		return {
			...item,
			archivedAt: item.archivedAt?.toISOString() || null,
			createdAt: item.createdAt.toISOString(),
			updatedAt: item.updatedAt.toISOString()
		};
	}
	async catalog(access: SalesAccess, query: Record<string, unknown>) {
		this.check(access, 'sales:read');
		const page = Number(query.page || 1),
			pageSize = Number(query.pageSize || 50);
		if (
			!Number.isInteger(page) ||
			page < 1 ||
			!Number.isInteger(pageSize) ||
			pageSize < 1 ||
			pageSize > 100
		)
			throw new BadRequestException('Некорректная страница');
		const search =
			typeof query.search === 'string' ? query.search.trim().slice(0, 100) : '';
		const where: Prisma.CommerceCatalogItemWhereInput = {
			workspaceId: access.workspaceId,
			...(query.includeArchived === 'true' ? {} : { archivedAt: null }),
			...(search
				? {
						OR: [
							{ code: { contains: search, mode: 'insensitive' } },
							{ name: { contains: search, mode: 'insensitive' } }
						]
					}
				: {})
		};
		const [total, items] = await this.db.$transaction([
			this.db.commerceCatalogItem.count({ where }),
			this.db.commerceCatalogItem.findMany({
				where,
				skip: (page - 1) * pageSize,
				take: pageSize,
				orderBy: [{ name: 'asc' }, { id: 'asc' }]
			})
		]);
		return {
			schemaVersion: 1,
			workspaceId: access.workspaceId,
			total,
			page,
			pageSize,
			items: items.map(i => this.catalogView(i))
		};
	}
	async createCatalog(access: SalesAccess, input: unknown) {
		this.check(access, 'sales:write');
		const body = object(input);
		const name = string(body.name, 'name', 200),
			unit = string(body.unit, 'unit', 32);
		const kind = body.kind;
		if (kind !== 'PRODUCT' && kind !== 'SERVICE')
			throw new BadRequestException('Выберите товар или услугу');
		const price = minor(body.basePriceMinor, 'Цена', true);
		return this.command(access, body, 'CATALOG_CREATE', async tx => {
			await lock(tx, `commerce:catalog:${access.workspaceId}`);
			const code =
				body.code === undefined
					? `AUTO-${randomUUID().slice(0, 12).toUpperCase()}`
					: string(body.code, 'code', 100);
			if (
				await tx.commerceCatalogItem.findUnique({
					where: {
						workspaceId_code: { workspaceId: access.workspaceId, code }
					}
				})
			)
				conflict('Код уже используется в каталоге');
			const item = await tx.commerceCatalogItem.create({
				data: {
					workspaceId: access.workspaceId,
					code,
					kind,
					name,
					unit,
					basePriceMinor: price
				}
			});
			await this.event(tx, access, 'CATALOG_CREATED', {
				after: this.catalogView(item)
			});
			return { schemaVersion: 1, item: this.catalogView(item) };
		});
	}
	async updateCatalog(
		access: SalesAccess,
		id: string,
		input: unknown,
		archive = false
	) {
		this.check(access, 'sales:write');
		const body = object(input);
		if (
			!archive &&
			body.kind !== undefined &&
			body.kind !== 'PRODUCT' &&
			body.kind !== 'SERVICE'
		)
			throw new BadRequestException('Выберите товар или услугу');
		return this.command(
			access,
			body,
			archive ? 'CATALOG_ARCHIVE' : 'CATALOG_UPDATE',
			async tx => {
				await lock(tx, `commerce:catalog:${access.workspaceId}`);
				const old = await tx.commerceCatalogItem.findFirst({
					where: { id, workspaceId: access.workspaceId }
				});
				if (!old) throw new NotFoundException('Позиция каталога не найдена');
				if (old.version !== body.expectedVersion) conflict();
				if (old.archivedAt) conflict('Позиция уже в архиве');
				const data = archive
					? { archivedAt: new Date() }
					: {
							...(body.kind === undefined
								? {}
								: { kind: body.kind as 'PRODUCT' | 'SERVICE' }),
							name: string(body.name, 'name', 200),
							unit: string(body.unit, 'unit', 32),
							...(body.basePriceMinor === undefined
								? {}
								: { basePriceMinor: minor(body.basePriceMinor, 'Цена', true) })
						};
				const item = await tx.commerceCatalogItem.update({
					where: { id },
					data: { ...data, version: { increment: 1 } }
				});
				await this.event(
					tx,
					access,
					archive ? 'CATALOG_ARCHIVED' : 'CATALOG_UPDATED',
					{ before: this.catalogView(old), after: this.catalogView(item) }
				);
				return { schemaVersion: 1, item: this.catalogView(item) };
			},
			id
		);
	}
	private lineView(line: Prisma.CommerceDealLineGetPayload<object>) {
		return {
			id: line.id,
			catalogItemId: line.catalogItemId,
			kind: line.kind,
			name: line.name,
			unit: line.unit,
			quantity: line.quantity.toFixed(3),
			unitPriceMinor: line.unitPriceMinor,
			discountMinor: line.discountMinor,
			totalMinor: line.totalMinor
		};
	}
	private async linesView(tx: Tx, access: SalesAccess, id: string) {
		const deal = await this.deal(tx, access, id);
		const items = await tx.commerceDealLine.findMany({
			where: { dealId: id, workspaceId: access.workspaceId },
			orderBy: { position: 'asc' }
		});
		return {
			schemaVersion: 1,
			dealId: id,
			dealVersion: deal.version,
			mode: deal.amountMode,
			amountMinor: deal.amountMinor,
			items: items.map(i => this.lineView(i))
		};
	}
	async lines(access: SalesAccess, id: string) {
		this.check(access, 'sales:read');
		return this.db.$transaction(tx => this.linesView(tx, access, id), {
			isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead
		});
	}
	async replaceLines(access: SalesAccess, id: string, input: unknown) {
		this.check(access, 'sales:write');
		const body = object(input);
		if (!Array.isArray(body.lines) || body.lines.length > 100)
			throw new BadRequestException('Не более 100 строк');
		if (body.lines.length > 0 && body.manualAmountMinor !== undefined)
			throw new BadRequestException(
				'Ручная сумма недоступна при наличии позиций'
			);
		return this.command(
			access,
			body,
			'LINES_REPLACE',
			async tx => {
				await lock(tx, `commerce:deal:${id}`);
				const deal = await this.deal(tx, access, id, true);
				if (deal.version !== body.expectedVersion) conflict();
				const before = await this.linesView(tx, access, id);
				let amount = 0;
				const rows = [] as Prisma.CommerceDealLineCreateManyInput[];
				for (const [position, raw] of (body.lines as unknown[]).entries()) {
					const line = object(raw);
					const kind = line.kind;
					if (kind !== 'PRODUCT' && kind !== 'SERVICE')
						throw new BadRequestException('Выберите товар или услугу');
					const name = string(line.name, 'name', 200),
						unit = string(line.unit, 'unit', 32);
					const quantity = string(line.quantity, 'quantity', 32);
					quantityMilli(quantity);
					const price = minor(line.unitPriceMinor, 'Цена')!;
					const discount = minor(line.discountMinor ?? 0, 'Скидка')!;
					const total = lineTotal(quantity, price, discount);
					amount += total;
					if (amount > MAX_MINOR)
						throw new BadRequestException(
							'Сумма сделки превышает 21 474 836,47 ₽'
						);
					const catalogItemId =
						line.catalogItemId === undefined || line.catalogItemId === null
							? null
							: uuid(line.catalogItemId, 'catalogItemId');
					if (catalogItemId) {
						const catalog = await tx.commerceCatalogItem.findFirst({
							where: { id: catalogItemId, workspaceId: access.workspaceId }
						});
						if (!catalog)
							throw new BadRequestException('Позиция каталога не найдена');
						if (
							catalog.archivedAt &&
							!before.items.some(
								old => old.id === line.id && old.catalogItemId === catalogItemId
							)
						)
							throw new BadRequestException(
								'Архивную позицию нельзя добавить в сделку'
							);
					}
					rows.push({
						id: line.id ? uuid(line.id, 'lineId') : randomUUID(),
						workspaceId: access.workspaceId,
						dealId: id,
						catalogItemId,
						position: position + 1,
						kind,
						name,
						unit,
						quantity: new Prisma.Decimal(quantity),
						unitPriceMinor: price,
						discountMinor: discount,
						totalMinor: total
					});
				}
				if (rows.length === 0)
					amount = minor(body.manualAmountMinor ?? 0, 'Ручная сумма')!;
				if (new Set(rows.map(r => r.id)).size !== rows.length)
					throw new BadRequestException('Повтор идентификатора строки');
				const existingIds = rows
					.map(r => r.id)
					.filter((value): value is string => !!value);
				if (existingIds.length) {
					const occupied = await tx.commerceDealLine.findMany({
						where: { id: { in: existingIds }, dealId: { not: id } },
						select: { id: true }
					});
					if (occupied.length)
						throw new BadRequestException('Строка принадлежит другой сделке');
				}
				await tx.commerceDealLine.deleteMany({
					where: { dealId: id, workspaceId: access.workspaceId }
				});
				if (rows.length) await tx.commerceDealLine.createMany({ data: rows });
				const updated = await tx.deal.updateMany({
					where: { id, workspaceId: access.workspaceId, version: deal.version },
					data: {
						amountMinor: amount,
						amountMode: rows.length ? 'LINES' : 'MANUAL',
						version: { increment: 1 }
					}
				});
				if (updated.count !== 1) conflict();
				const after = await this.linesView(tx, access, id);
				await this.event(tx, access, 'LINES_REPLACED', { before, after }, id);
				return after;
			},
			id,
			true
		);
	}
	async saveLine(
		access: SalesAccess,
		id: string,
		lineId: string,
		input: unknown
	) {
		this.check(access, 'sales:write');
		const body = object(input);
		return this.command(
			access,
			body,
			'LINE_SAVE_CATALOG',
			async tx => {
				await lock(tx, `commerce:catalog:${access.workspaceId}`);
				await lock(tx, `commerce:deal:${id}`);
				const deal = await this.deal(tx, access, id, true);
				const line = await tx.commerceDealLine.findFirst({
					where: { id: lineId, dealId: id, workspaceId: access.workspaceId }
				});
				if (!line) throw new NotFoundException('Строка сделки не найдена');
				if (line.catalogItemId) {
					const item = await tx.commerceCatalogItem.findUnique({
						where: { id: line.catalogItemId }
					});
					return {
						schemaVersion: 1,
						item: item ? this.catalogView(item) : null,
						lineId
					};
				}
				if (deal.version !== body.expectedVersion) conflict();
				const code =
					body.code === undefined
						? `AUTO-${randomUUID().slice(0, 12).toUpperCase()}`
						: string(body.code, 'code', 100);
				if (
					await tx.commerceCatalogItem.findUnique({
						where: {
							workspaceId_code: { workspaceId: access.workspaceId, code }
						}
					})
				)
					conflict('Код уже используется в каталоге');
				const item = await tx.commerceCatalogItem.create({
					data: {
						workspaceId: access.workspaceId,
						code,
						kind: line.kind,
						name: line.name,
						unit: line.unit,
						basePriceMinor: line.unitPriceMinor
					}
				});
				await tx.commerceDealLine.update({
					where: { id: lineId },
					data: { catalogItemId: item.id }
				});
				await tx.deal.update({
					where: { id },
					data: { version: { increment: 1 } }
				});
				await this.event(
					tx,
					access,
					'LINE_SAVED_CATALOG',
					{ lineId, itemId: item.id },
					id
				);
				return { schemaVersion: 1, item: this.catalogView(item), lineId };
			},
			id + ':' + lineId,
			true
		);
	}
}
