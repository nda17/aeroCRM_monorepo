import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	NotFoundException,
	ServiceUnavailableException
} from '@nestjs/common';
import { Prisma, type CrmPipelineStageState } from '@prisma/crm-sales-client';
import { CrmSalesPrismaService } from '../prisma/crm-sales-prisma.service';
import { SalesAccessClient, type SalesAccess, UUID } from '../sales/sales-access';
import { SalesContactClient } from '../sales/sales-contact.client';
import { salesScope } from '../sales/sales.service';
import { hash, lock, serializable } from '../commerce/commerce-core';
import {
	parseImportApply,
	parseImportInspect,
	parseImportPreview
} from './import.dto';
import { parseImportFile, type Sheet } from './import-parser';

type InspectInput = ReturnType<typeof parseImportInspect>;
type PreviewInput = ReturnType<typeof parseImportPreview>;
type ApplyInput = ReturnType<typeof parseImportApply>;
type Action = 'CREATE' | 'LINK' | 'SKIP' | 'ERROR';
type ContactRef = { kind: 'contact'; externalId?: string; id?: string };
type PublicRow = {
	row: number;
	sourceId: string | null;
	action: Action;
	targetId: string | null;
	expectedVersion: number | null;
	values: Record<string, string | null>;
	errors: string[];
	warnings: string[];
	candidates: Array<{ id: string; name: string; version: number }>;
};
type InternalRow = {
	row: number;
	sourceId: string | null;
	payloadHash: string;
	title: string;
	amountMinor: number;
	currency: 'RUB';
	contactRef: ContactRef | null;
	contactId: string | null;
	contactVersion: number | null;
	pipelineId: string | null;
	stageId: string | null;
	status: CrmPipelineStageState | null;
	teamId: string | null;
	createdAt: string | null;
};
type ApplyResult = {
	schemaVersion: 1;
	previewId: string;
	commandId: string;
	entity: 'deals';
	status: 'APPLIED';
	created: number;
	linked: number;
	skipped: number;
	items: Array<{
		row: number;
		sourceId: string | null;
		entityId: string | null;
		action: 'CREATE' | 'LINK' | 'SKIP';
	}>;
};
const FIELDS = [
	'externalId', 'title', 'amount', 'currency', 'contactExternalId',
	'contactId', 'stageKey', 'stageName', 'stageId', 'createdAt'
] as const;
const OPTIONS = {
	isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
	timeout: 30000,
	maxWait: 5000
} as const;
const DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

function conflict(message: string): never {
	throw new ConflictException({ code: 'crm_file_import_conflict', message });
}
function scoped(access: SalesAccess, workspaceId: string, write: boolean) {
	if (access.workspaceId !== workspaceId ||
		!access.permissions.includes('sales:read') ||
		(write && (!access.permissions.includes('sales:write') || access.state === 'READ_ONLY')))
		throw new ForbiddenException();
}
function display(row: PublicRow): PublicRow {
	return row;
}
function summary(rows: PublicRow[]) {
	return {
		create: rows.filter(row => row.action === 'CREATE').length,
		link: rows.filter(row => row.action === 'LINK').length,
		skip: rows.filter(row => row.action === 'SKIP').length,
		error: rows.filter(row => row.action === 'ERROR').length
	};
}
function normalizedAmount(value: string, errors: string[]): number {
	if (!value) return 0;
	const match = /^(?:0|[1-9]\d{0,7})(?:[.,](\d{1,2}))?$/.exec(value);
	if (!match) {
		errors.push('Сумма должна быть неотрицательным числом с двумя знаками после запятой');
		return 0;
	}
	const [whole, fraction = ''] = value.replace(',', '.').split('.');
	const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
	if (!Number.isSafeInteger(amount) || amount > 2_147_483_647) {
		errors.push('Сумма превышает допустимый предел');
		return 0;
	}
	return amount;
}
function normalizedDate(value: string, errors: string[]): string | null {
	if (!value) return null;
	const parts = DATE.exec(value);
	const parsed = Date.parse(value);
	const year = Number(parts?.[1]), month = Number(parts?.[2]), day = Number(parts?.[3]);
	const hour = Number(parts?.[4]), minute = Number(parts?.[5]), second = Number(parts?.[6]);
	const daysInMonth = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
		31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
	if (!parts || !Number.isFinite(parsed) || year < 1 || month < 1 || month > 12 || day < 1 ||
		day > daysInMonth || hour > 23 || minute > 59 || second > 59 ||
		Number(parts[9] || 0) > 23 || Number(parts[10] || 0) > 59) {
		errors.push('Дата должна быть явной ISO/RFC3339 с часовым поясом');
		return null;
	}
	return new Date(parsed).toISOString();
}
function persistedRows(value: Prisma.JsonValue): PublicRow[] {
	if (!Array.isArray(value) || value.length > 500 ||
		value.some(row => !row || typeof row !== 'object' || Array.isArray(row) ||
			!Number.isInteger(row.row) ||
			!['CREATE', 'LINK', 'SKIP', 'ERROR'].includes(String(row.action)) ||
			!Array.isArray(row.errors) || !Array.isArray(row.warnings)))
		throw new ServiceUnavailableException('Import preview is unavailable');
	return value as unknown as PublicRow[];
}
function persistedRefs(value: Prisma.JsonValue, count: number): InternalRow[] {
	if (!Array.isArray(value) || value.length !== count ||
		value.some(row => !row || typeof row !== 'object' || Array.isArray(row) ||
			!Number.isInteger(row.row) || typeof row.payloadHash !== 'string'))
		throw new ServiceUnavailableException('Import preview is unavailable');
	return value as unknown as InternalRow[];
}

@Injectable()
export class SalesImportService {
	constructor(
		private readonly db: CrmSalesPrismaService,
		private readonly accessClient: SalesAccessClient,
		private readonly contacts: SalesContactClient
	) {}
	private async current(access: SalesAccess, authorization: string, write: boolean) {
		const fresh = await this.accessClient.authorize(authorization, access.workspaceId);
		scoped(fresh, access.workspaceId, write);
		if (fresh.subject !== access.subject ||
			fresh.dataScope !== access.dataScope ||
			fresh.role !== access.role ||
			fresh.teamIds.join(',') !== access.teamIds.join(','))
			throw new ForbiddenException('Доступ изменился');
		return fresh;
	}
	private async visibleResults(access: SalesAccess, rows: PublicRow[], result: ApplyResult | null) {
		const ids = new Set([
			...rows.map(row => row.targetId).filter((id): id is string => !!id),
			...(result?.items.map(item => item.entityId).filter((id): id is string => !!id) || [])
		]);
		if (!ids.size) return;
		const visible = await this.db.deal.findMany({
			where: { AND: [salesScope(access), { id: { in: [...ids] }, archivedAt: null }] },
			select: { id: true }
		});
		if (visible.length !== ids.size) throw new ForbiddenException('Часть сделок больше недоступна');
	}
	private async visibleContacts(
		access: SalesAccess, authorization: string, sourceKey: string,
		rows: PublicRow[], refs: InternalRow[]
	) {
		const contacts = rows.map((row, index) => ({ row, ref: refs[index] }))
			.filter(item => item.row.action === 'CREATE' && item.ref.contactRef && item.ref.contactId);
		if (!contacts.length) return;
		const resolved = await this.contacts.resolveImportContacts(
			authorization, access.workspaceId, sourceKey,
			contacts.map(item => item.ref.contactRef!)
		);
		if (contacts.some((item, index) => resolved[index]?.id !== item.ref.contactId))
			throw new ForbiddenException('Часть контактов больше недоступна');
	}
	inspect(access: SalesAccess, input: InspectInput) {
		scoped(access, input.workspaceId, false);
		const file = parseImportFile(input as unknown as Record<string, unknown>, true);
		return {
			schemaVersion: 1,
			entity: 'deals' as const,
			fileDigest: file.digest,
			sheets: file.sheets.map(sheet => ({
				name: sheet.name,
				headers: sheet.headers,
				rowCount: sheet.rows.length,
				sample: sheet.rows.slice(0, 5)
			}))
		};
	}
	private mapping(input: PreviewInput, sheet: Sheet) {
		const mapping = input.mapping;
		if (!mapping.externalId || !mapping.title)
			throw new BadRequestException('Сопоставьте внешний ID и название сделки');
		if (!!mapping.contactExternalId === !!mapping.contactId)
			throw new BadRequestException('Сопоставьте один идентификатор контакта');
		if (Object.keys(mapping).some(key => !FIELDS.includes(key as typeof FIELDS[number])) ||
			Object.values(mapping).some(header => !sheet.headers.includes(header)) ||
			new Set(Object.values(mapping)).size !== Object.values(mapping).length)
			throw new BadRequestException('Некорректное сопоставление столбцов');
		return mapping;
	}
	private stageId(
		input: PreviewInput,
		values: Record<string, string | null>,
		stages: Array<{ id: string; key: string; name: string; state: CrmPipelineStageState }>,
		errors: string[]
	) {
		const mapped = ['stageKey', 'stageName', 'stageId'].find(field => input.mapping[field]);
		const raw = mapped ? values[mapped] : null;
		const selected = raw
			? input.options?.stageMapping?.[raw] || (values.stageId && UUID.test(raw) ? raw : null)
			: mapped ? null : input.options?.stageId || null;
		const stage = stages.find(stage => stage.id === selected);
		if (!stage) errors.push('Выберите существующий этап выбранной воронки');
		return stage || null;
	}
	async preview(access: SalesAccess, input: PreviewInput, authorization: string) {
		scoped(access, input.workspaceId, true);
		const file = parseImportFile(input as unknown as Record<string, unknown>, true);
		const sheet = file.sheets.find(sheet => sheet.name === input.sheet);
		if (!sheet) throw new BadRequestException('Лист не найден');
		const mapping = this.mapping(input, sheet);
		if (['stageKey', 'stageName', 'stageId'].filter(field => mapping[field]).length > 1)
			throw new BadRequestException('Сопоставьте только один столбец этапа');
		const sourceKey = input.sourceKey;
		const teamId = input.options?.teamId || null;
		if (teamId && !access.teamIds.includes(teamId)) throw new ForbiddenException('Недоступная команда');
		const pipelineId = input.options?.pipelineId || null;
		const pipeline = pipelineId ? await this.db.pipeline.findFirst({
			where: { id: pipelineId, workspaceId: access.workspaceId },
			select: { id: true, name: true }
		}) : null;
		if (!pipeline) throw new BadRequestException('Выберите существующую воронку');
		const stages = await this.db.pipelineStage.findMany({
			where: { pipelineId: pipeline.id, workspaceId: access.workspaceId },
			select: { id: true, key: true, name: true, state: true }
		});
		const decisions = new Map((input.decisions || []).map(item => [item.row, item]));
		if (decisions.size !== (input.decisions || []).length)
			throw new BadRequestException('Повтор решения для строки');
		const seen = new Set<string>();
		const rows: PublicRow[] = [];
		const refs: InternalRow[] = [];
		const referenced: Array<{ index: number; ref: ContactRef }> = [];
		for (const [index, raw] of sheet.rows.entries()) {
			const line = sheet.rowNumbers[index];
			const errors: string[] = [];
			const warnings: string[] = ['Ответственный назначается текущим пользователем; исходное назначение не переносится'];
			const values: Record<string, string | null> = {};
			for (const field of FIELDS) {
				const value = mapping[field] ? (raw[mapping[field]] || '').trim() : '';
				if (value.length > (field === 'title' ? 200 : 200) || /[\x00-\x1f\x7f]/.test(value))
					errors.push(`Некорректное поле ${field}`);
				values[field] = value || null;
			}
			const sourceId = values.externalId;
			if (!sourceId) errors.push('Внешний ID сделки обязателен');
			else if (seen.has(sourceId)) errors.push('Повтор внешнего ID в файле');
			if (sourceId) seen.add(sourceId);
			if (!values.title) errors.push('Название сделки обязательно');
			if (sheet.numericColumnsByRow[line]?.some(header =>
				[ mapping.externalId, mapping.contactExternalId, mapping.contactId ].includes(header)))
				errors.push('Идентификаторы XLSX должны быть текстом');
			const currency = (values.currency || 'RUB').toUpperCase();
			if (currency !== 'RUB') errors.push('Поддерживается только RUB');
			const amountMinor = normalizedAmount(values.amount || '', errors);
			const createdAt = normalizedDate(values.createdAt || '', errors);
			const stage = this.stageId(input, values, stages, errors);
			const contactValue = values.contactExternalId || values.contactId;
			const contactRef: ContactRef | null = values.contactExternalId
				? { kind: 'contact', externalId: values.contactExternalId }
				: values.contactId && UUID.test(values.contactId)
					? { kind: 'contact', id: values.contactId }
					: null;
			if (!contactValue || !contactRef) errors.push('Доступный контакт обязателен');
			const unmapped = sheet.headers.filter(header => !Object.values(mapping).includes(header));
			if (unmapped.length) {
				warnings.push(`Не сопоставлено столбцов: ${unmapped.length}`);
				values.unmappedColumns = unmapped.join(', ');
			}
			values.responsible = access.subject;
			values.pipelineId = pipelineId;
			values.resolvedPipelineName = pipeline.name;
			values.resolvedStageId = stage?.id || null;
			values.resolvedStageName = stage?.name || null;
			values.resolvedContactName = null;
			const payloadHash = hash({
				sourceId, title: values.title, amountMinor, currency,
				contactRef, pipelineId, stageId: stage?.id || null, teamId, createdAt
			});
			let action: Action = 'CREATE';
			let targetId: string | null = null;
			let expectedVersion: number | null = null;
			const binding = sourceId ? await this.db.importBinding.findUnique({
				where: { workspaceId_sourceKey_entity_externalId: {
					workspaceId: access.workspaceId, sourceKey, entity: 'deals', externalId: sourceId
				} }
			}) : null;
			if (binding) {
				const target = await this.db.deal.findFirst({
					where: { AND: [salesScope(access), { id: binding.dealId, archivedAt: null }] },
					select: { id: true, version: true }
				});
				if (!target) errors.push('Привязка недоступна');
				else if (binding.payloadHash !== payloadHash)
					errors.push('Внешний ID уже связан с изменёнными данными; обновление импортом запрещено');
				else {
					action = 'SKIP';
					targetId = target.id;
					expectedVersion = target.version;
					warnings.push('Данные по привязке не изменились');
				}
			}
			const decision = decisions.get(line);
			if (decision?.action === 'SKIP') {
				action = 'SKIP';
				targetId = null;
				expectedVersion = null;
				warnings.push('Строка пропущена по решению пользователя');
			} else if (decision?.action === 'LINK') {
				if (!sourceId || binding) errors.push('Внешний ID уже занят или отсутствует');
				else {
					const target = await this.db.deal.findFirst({
						where: { AND: [salesScope(access), { id: decision.existingId, archivedAt: null }] },
						select: { id: true, title: true, version: true }
					});
					if (!target || target.version !== decision.expectedVersion)
						errors.push('Выбранная сделка недоступна или изменилась');
					else {
						action = 'LINK';
						targetId = target.id;
						expectedVersion = target.version;
					}
				}
			}
			if (decision?.action === 'SKIP') errors.length = 0;
			else if (errors.length) action = 'ERROR';
			const row: PublicRow = {
				row: line, sourceId, action, targetId, expectedVersion,
				values, errors, warnings, candidates: []
			};
			rows.push(row);
			refs.push({
				row: line, sourceId, payloadHash,
				title: values.title || '', amountMinor, currency: 'RUB',
				contactRef, contactId: null, contactVersion: null,
				pipelineId, stageId: stage?.id || null, status: stage?.state || null,
				teamId, createdAt
			});
			if (action === 'CREATE' && contactRef) referenced.push({ index, ref: contactRef });
		}
		if ((input.decisions || []).some(item => !rows.some(row => row.row === item.row)))
			throw new BadRequestException('Решение относится к отсутствующей строке');
		if (referenced.length) {
			const resolved = await this.contacts.resolveImportContacts(
				authorization, access.workspaceId, sourceKey, referenced.map(item => item.ref)
			);
			for (const [offset, item] of referenced.entries()) {
				const contact = resolved[offset];
				if (!contact) {
					rows[item.index].errors.push('Контакт недоступен');
					rows[item.index].action = 'ERROR';
				} else {
					refs[item.index].contactId = contact.id;
					refs[item.index].contactVersion = contact.version;
					rows[item.index].values.resolvedContactName = contact.name;
				}
			}
		}
		await this.current(access, authorization, true);
		const expiresAt = new Date(Date.now() + 24 * 60 * 60_000);
		const stored = await this.db.importPreview.create({ data: {
			workspaceId: access.workspaceId,
			actorSubject: access.subject,
			entity: 'deals',
			sourceKey,
			fileDigest: file.digest,
			rows: rows as unknown as Prisma.InputJsonValue,
			refs: refs as unknown as Prisma.InputJsonValue,
			expiresAt
		} });
		return {
			schemaVersion: 1, workspaceId: access.workspaceId, previewId: stored.id,
			entity: 'deals' as const, sourceKey, expiresAt: expiresAt.toISOString(),
			rows: rows.map(display), summary: summary(rows), result: null
		};
	}
	async get(access: SalesAccess, previewId: string, authorization: string) {
		scoped(access, access.workspaceId, false);
		const preview = await this.db.importPreview.findFirst({
			where: { id: previewId, workspaceId: access.workspaceId, actorSubject: access.subject }
		});
		await this.current(access, authorization, false);
		if (!preview) throw new NotFoundException('Предпросмотр не найден');
		const rows = persistedRows(preview.rows);
		await this.visibleResults(access, rows, preview.result as ApplyResult | null);
		await this.visibleContacts(access, authorization, preview.sourceKey,
			rows, persistedRefs(preview.refs, rows.length));
		return {
			schemaVersion: 1, workspaceId: access.workspaceId, previewId: preview.id,
			entity: 'deals' as const, sourceKey: preview.sourceKey,
			expiresAt: preview.expiresAt.toISOString(), rows,
			summary: summary(rows), result: preview.result as ApplyResult | null
		};
	}
	async apply(access: SalesAccess, input: ApplyInput, authorization: string) {
		scoped(access, input.workspaceId, true);
		const requestHash = hash({ workspaceId: input.workspaceId, previewId: input.previewId, actor: access.subject });
		let result: ApplyResult;
		try {
			result = await serializable(async () => {
			try {
				return await this.db.$transaction(async tx => {
					await lock(tx, `crm-sales-command:${input.commandId}`);
					const old = await tx.importPreview.findUnique({ where: { commitCommandId: input.commandId } });
					if (old && (old.id !== input.previewId || old.workspaceId !== access.workspaceId ||
						old.actorSubject !== access.subject || old.requestHash !== requestHash))
						conflict('Ключ команды уже использован');
					await this.current(access, authorization, true);
					if (old?.result) return old.result as ApplyResult;
					await lock(tx, `crm-sales:import:workspace:${access.workspaceId}`);
					await tx.$executeRaw`SELECT crm_sales.assert_workspace_open(${access.workspaceId}::uuid)`;
					const preview = await tx.importPreview.findFirst({
						where: { id: input.previewId, workspaceId: access.workspaceId, actorSubject: access.subject }
					});
					if (!preview) throw new NotFoundException('Предпросмотр не найден');
					if (preview.result || preview.commitCommandId) conflict('Предпросмотр уже применён');
					if (preview.expiresAt.getTime() < Date.now()) conflict('Срок предпросмотра истёк');
					const rows = persistedRows(preview.rows);
					const internal = persistedRefs(preview.refs, rows.length);
					if (rows.some(row => row.action === 'ERROR'))
						throw new BadRequestException('Ошибочные строки необходимо явно пропустить');
					const createRows = rows.map((row, index) => ({ row, ref: internal[index] }))
						.filter(item => item.row.action === 'CREATE');
					if (createRows.some(item => !item.ref.contactRef))
						throw new ServiceUnavailableException('Import preview is unavailable');
					const resolved = await this.contacts.resolveImportContacts(
						authorization, access.workspaceId, preview.sourceKey,
						createRows.map(item => item.ref.contactRef!)
					);
					for (const [index, item] of createRows.entries()) {
						const contact = resolved[index];
						if (!contact || contact.id !== item.ref.contactId || contact.version !== item.ref.contactVersion)
							conflict('Контакт изменился после предпросмотра');
					}
					const items: ApplyResult['items'] = [];
					let created = 0, linked = 0, skipped = 0;
					for (const [index, row] of rows.entries()) {
						const ref = internal[index];
						if (row.row !== ref.row || row.sourceId !== ref.sourceId)
							throw new ServiceUnavailableException('Import preview is unavailable');
						if (row.action === 'SKIP') {
							if (row.targetId) {
								const binding = await tx.importBinding.findUnique({ where: {
									workspaceId_sourceKey_entity_externalId: {
										workspaceId: access.workspaceId, sourceKey: preview.sourceKey,
										entity: 'deals', externalId: row.sourceId!
									}
								} });
								if (!binding || binding.dealId !== row.targetId || binding.payloadHash !== ref.payloadHash)
									conflict('Привязка изменилась');
								await this.visibleLocked(tx, access, row.targetId, row.expectedVersion!);
							}
							skipped++;
							items.push({ row: row.row, sourceId: row.sourceId, entityId: row.targetId, action: 'SKIP' });
							continue;
						}
						if (!row.sourceId) throw new ServiceUnavailableException('Import preview is unavailable');
						const binding = await tx.importBinding.findUnique({ where: {
							workspaceId_sourceKey_entity_externalId: {
								workspaceId: access.workspaceId, sourceKey: preview.sourceKey,
								entity: 'deals', externalId: row.sourceId
							}
						} });
						if (binding) conflict('Внешний ID уже связан');
						if (row.action === 'LINK') {
							if (!row.targetId || !row.expectedVersion) throw new ServiceUnavailableException('Import preview is unavailable');
							await this.visibleLocked(tx, access, row.targetId, row.expectedVersion);
							await tx.importBinding.create({ data: {
							workspaceId: access.workspaceId, sourceKey: preview.sourceKey, entity: 'deals',
							externalId: row.sourceId, dealId: row.targetId, payloadHash: ref.payloadHash
							} });
							linked++;
							items.push({ row: row.row, sourceId: row.sourceId, entityId: row.targetId, action: 'LINK' });
							continue;
						}
						if (row.action !== 'CREATE' || !ref.contactId || !ref.stageId || !ref.pipelineId || !ref.status)
							throw new ServiceUnavailableException('Import preview is unavailable');
						if (ref.teamId && !access.teamIds.includes(ref.teamId)) throw new ForbiddenException('Недоступная команда');
						const stage = await tx.pipelineStage.findFirst({ where: {
							id: ref.stageId, pipelineId: ref.pipelineId, workspaceId: access.workspaceId
						} });
						if (!stage || stage.state !== ref.status) conflict('Этап изменился после предпросмотра');
						const contact = resolved[createRows.findIndex(item => item.row.row === row.row)];
						if (!contact || contact.id !== ref.contactId) conflict('Контакт изменился после предпросмотра');
						const deal = await tx.deal.create({ data: {
							workspaceId: access.workspaceId, title: ref.title,
							currency: 'RUB', amountMinor: ref.amountMinor, amountMode: 'MANUAL',
							pipelineId: ref.pipelineId, stageId: ref.stageId, status: ref.status,
							contactId: contact.id, contactName: contact.name,
							assignedToSubject: access.subject, teamId: ref.teamId,
							nextTaskId: null,
							...(ref.createdAt ? { createdAt: new Date(ref.createdAt) } : {})
							} });
						await tx.dealTimeline.create({ data: {
							workspaceId: access.workspaceId, dealId: deal.id,
							kind: 'CREATED', actorSubject: access.subject,
							outcome: `Импортированная сделка · ${preview.sourceKey}`,
							fromStageId: null, toStageId: ref.stageId
						} });
						await tx.importBinding.create({ data: {
							workspaceId: access.workspaceId, sourceKey: preview.sourceKey,
							entity: 'deals', externalId: row.sourceId,
							dealId: deal.id, payloadHash: ref.payloadHash
						} });
						created++;
						items.push({ row: row.row, sourceId: row.sourceId, entityId: deal.id, action: 'CREATE' });
					}
					const result: ApplyResult = {
						schemaVersion: 1, previewId: input.previewId, commandId: input.commandId,
						entity: 'deals', status: 'APPLIED', created, linked, skipped, items
					};
					await tx.importPreview.update({ where: { id: preview.id }, data: {
						commitCommandId: input.commandId, requestHash, result: result as unknown as Prisma.InputJsonValue
					} });
					await tx.$executeRaw(Prisma.sql`
						SET CONSTRAINTS
							crm_sales.deals_next_task_fkey,
							crm_sales.deals_next_action_integrity,
							crm_sales.tasks_next_action_integrity IMMEDIATE
					`);
					return result;
				}, OPTIONS);
			} catch (error) {
				if (String(error).includes('crm_workspace_closed'))
					throw new ForbiddenException({ code: 'crm_workspace_closed', message: 'Workspace is closed' });
				throw error;
			}
			});
		} catch (error) {
			const prior = await this.db.importPreview.findUnique({ where: { commitCommandId: input.commandId } });
			if (!prior?.result || prior.id !== input.previewId || prior.workspaceId !== access.workspaceId ||
				prior.actorSubject !== access.subject || prior.requestHash !== requestHash) {
				if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002')
					conflict('Ключ команды уже использован или данные изменились');
				throw error;
			}
			result = prior.result as ApplyResult;
		}
		const before = await this.db.importPreview.findFirst({
			where: { id: input.previewId, workspaceId: access.workspaceId, actorSubject: access.subject }
		});
		if (!before) throw new NotFoundException('Предпросмотр не найден');
		const publicRows = persistedRows(before.rows);
		const refs = persistedRefs(before.refs, publicRows.length);
		await this.current(access, authorization, true);
		await this.visibleResults(access, publicRows, result);
		await this.visibleContacts(access, authorization, before.sourceKey, publicRows, refs);
		return result;
	}
	private async visibleLocked(
		tx: Prisma.TransactionClient,
		access: SalesAccess,
		dealId: string,
		version: number
	) {
		const deal = await tx.deal.findFirst({
			where: { AND: [salesScope(access), { id: dealId, version, archivedAt: null }] },
			select: { id: true }
		});
		if (!deal) conflict('Сделка недоступна или изменилась');
		const locked = await tx.$queryRaw<Array<{ version: number }>>(Prisma.sql`
			SELECT version FROM crm_sales.deals
			WHERE id = ${dealId}::uuid AND workspace_id = ${access.workspaceId}::uuid
			FOR UPDATE
		`);
		if (locked.length !== 1 || locked[0].version !== version)
			conflict('Сделка изменилась после предпросмотра');
	}
}
