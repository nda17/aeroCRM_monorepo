import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException
} from '@nestjs/common';
import { Prisma } from '@prisma/crm-sales-client';
import { CrmSalesPrismaService } from '../prisma/crm-sales-prisma.service';
import type { SalesAccess } from '../sales/sales-access';
import { conflict, hash, lock, minor, object, serializable, string, uuid } from './commerce-core';
import { parseImportFile } from '../imports/import-parser';

type ImportRow = {
	row: number;
	code: string;
	kind: string;
	name: string;
	unit: string;
	basePriceMinor: number | null;
	action: 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'ERROR';
	errors: string[];
	expectedVersion: number | null;
};
const MAX_ROWS = 500;
const options = {
	isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
	timeout: 20000,
	maxWait: 5000
} as const;

@Injectable()
export class CommerceImportService {
	constructor(private readonly db: CrmSalesPrismaService) {}
	private snapshot(item: {
		id: string;
		code: string;
		kind: string;
		name: string;
		unit: string;
		basePriceMinor: number | null;
		version: number;
		archivedAt: Date | null;
	}) {
		return {
			id: item.id,
			code: item.code,
			kind: item.kind,
			name: item.name,
			unit: item.unit,
			basePriceMinor: item.basePriceMinor,
			version: item.version,
			archivedAt: item.archivedAt?.toISOString() || null
		};
	}
	private require(access: SalesAccess, write: boolean) {
		if (
			!access.permissions.includes(write ? 'sales:write' : 'sales:read') ||
			(write && access.state === 'READ_ONLY')
		)
			throw new ForbiddenException();
	}
	inspect(access: SalesAccess, input: unknown) {
		this.require(access, false);
		const { filename, sheets, digest } = parseImportFile(object(input));
		return {
			schemaVersion: 1,
			filename,
			digest,
			sheets: sheets.map(s => ({
				name: s.name,
				headers: s.headers,
				rowCount: s.rows.length,
				sample: s.rows.slice(0, 5)
			}))
		};
	}
	async preview(access: SalesAccess, input: unknown) {
		this.require(access, true);
		const body = object(input),
			decoded = parseImportFile(body);
		const sheetName =
			body.sheet === undefined ? decoded.sheets[0]?.name : string(body.sheet, 'sheet', 200);
		const sheet = decoded.sheets.find(s => s.name === sheetName);
		if (!sheet) throw new BadRequestException('Лист не найден');
		if (sheet.rows.length > MAX_ROWS) throw new BadRequestException('Не более 500 строк каталога');
		const mapping = object(body.mapping);
		const columns = ['code', 'kind', 'name', 'unit', 'basePriceMinor'] as const;
		for (const key of columns)
			if (key !== 'basePriceMinor' && typeof mapping[key] !== 'string')
				throw new BadRequestException(`Сопоставьте поле ${key}`);
		if (Object.values(mapping).some(v => typeof v !== 'string' || !sheet.headers.includes(v)))
			throw new BadRequestException('Сопоставление содержит отсутствующий столбец');
		if (new Set(Object.values(mapping)).size !== Object.values(mapping).length)
			throw new BadRequestException('Каждому полю нужен отдельный столбец');
		const codes = sheet.rows.map(row => row[mapping.code as string]?.trim() || '').filter(Boolean);
		const existing = await this.db.commerceCatalogItem.findMany({
			where: { workspaceId: access.workspaceId, code: { in: codes } }
		});
		const byCode = new Map(existing.map(i => [i.code, i]));
		const seen = new Set<string>();
		const rows: ImportRow[] = [];
		for (const [index, row] of sheet.rows.entries()) {
			const line = sheet.rowNumbers[index],
				errors: string[] = [];
			const code = row[mapping.code as string]?.trim() || '',
				kind = (row[mapping.kind as string] || '').trim().toUpperCase(),
				name = (row[mapping.name as string] || '').trim(),
				unit = (row[mapping.unit as string] || '').trim();
			const priceText = mapping.basePriceMinor
				? (row[mapping.basePriceMinor as string] || '').trim()
				: '';
			let basePriceMinor: number | null = null;
			if (priceText) {
				const match = priceText.replace(',', '.').match(/^(\d{1,8})(?:\.(\d{1,2}))?$/);
				if (!match) errors.push('Некорректная цена');
				else {
					const value = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
					try {
						basePriceMinor = minor(value, 'Цена');
					} catch {
						errors.push('Цена превышает предел');
					}
				}
			}
			if (!code || code.length > 100) errors.push('Код обязателен, не более 100 символов');
			if (/[\x00-\x1f\x7f]/.test(code)) errors.push('Код содержит управляющие символы');
			if (seen.has(code)) errors.push('Повтор кода в файле');
			seen.add(code);
			if (kind !== 'PRODUCT' && kind !== 'SERVICE' && kind !== 'ТОВАР' && kind !== 'УСЛУГА')
				errors.push('Тип: PRODUCT/SERVICE или Товар/Услуга');
			if (!name || name.length > 200) errors.push('Название обязательно, не более 200 символов');
			if (/[\x00-\x1f\x7f]/.test(name)) errors.push('Название содержит управляющие символы');
			if (!unit || unit.length > 32) errors.push('Единица обязательна, не более 32 символов');
			if (/[\x00-\x1f\x7f]/.test(unit)) errors.push('Единица содержит управляющие символы');
			if (sheet.formulaRows.includes(line))
				errors.push('Формулы в импортируемых строках запрещены');
			if (
				decoded.filename.toLowerCase().endsWith('.xlsx') &&
				sheet.numericColumnsByRow[line]?.includes(mapping.code as string)
			)
				errors.push('Код XLSX должен быть текстом, чтобы сохранить ведущие нули');
			const old = byCode.get(code);
			if (old?.archivedAt) errors.push('Архивная позиция не восстанавливается импортом');
			const normalizedKind = kind === 'ТОВАР' ? 'PRODUCT' : kind === 'УСЛУГА' ? 'SERVICE' : kind;
			const same =
				old &&
				old.kind === normalizedKind &&
				old.name === name &&
				old.unit === unit &&
				(basePriceMinor === null || old.basePriceMinor === basePriceMinor);
			rows.push({
				row: line,
				code,
				kind: normalizedKind,
				name,
				unit,
				basePriceMinor,
				action: errors.length ? 'ERROR' : !old ? 'CREATE' : same ? 'UNCHANGED' : 'UPDATE',
				errors,
				expectedVersion: old?.version ?? null
			});
		}
		const expiresAt = new Date(Date.now() + 30 * 60_000);
		const preview = await this.db.commerceImportPreview.create({
			data: {
				workspaceId: access.workspaceId,
				actorSubject: access.subject,
				digest: hash({ file: decoded.digest, sheet: sheet.name, mapping }),
				rows: rows as unknown as Prisma.InputJsonValue,
				expectedVersions: Object.fromEntries(rows.map(r => [r.code, r.expectedVersion])),
				expiresAt
			}
		});
		return {
			schemaVersion: 1,
			previewId: preview.id,
			expiresAt: expiresAt.toISOString(),
			rows,
			summary: {
				created: rows.filter(r => r.action === 'CREATE').length,
				updated: rows.filter(r => r.action === 'UPDATE').length,
				unchanged: rows.filter(r => r.action === 'UNCHANGED').length,
				errors: rows.filter(r => r.action === 'ERROR').length
			}
		};
	}
	async apply(access: SalesAccess, input: unknown) {
		this.require(access, true);
		const body = object(input),
			previewId = uuid(body.previewId, 'previewId'),
			commandId = uuid(body.commandId, 'commandId'),
			requestHash = hash({ previewId });
		return serializable(() =>
			this.db.$transaction(async tx => {
				await lock(tx, `commerce:command:${commandId}`);
				const oldCommand = await tx.commerceCommand.findUnique({
					where: { commandId }
				});
				if (oldCommand) {
					if (
						oldCommand.workspaceId !== access.workspaceId ||
						oldCommand.actorSubject !== access.subject ||
						oldCommand.kind !== 'IMPORT_APPLY' ||
						oldCommand.requestHash !== requestHash
					)
						conflict('Команда уже использована');
					return oldCommand.result;
				}
				await lock(tx, `commerce:catalog:${access.workspaceId}`);
				const preview = await tx.commerceImportPreview.findFirst({
					where: {
						id: previewId,
						workspaceId: access.workspaceId,
						actorSubject: access.subject
					}
				});
				if (!preview) throw new NotFoundException('Предпросмотр не найден');
				if (preview.result) conflict('Импорт уже применён');
				if (preview.expiresAt.getTime() < Date.now()) conflict('Срок предпросмотра истёк');
				const rows = preview.rows as unknown as ImportRow[];
				if (!Array.isArray(rows) || rows.length > MAX_ROWS)
					throw new BadRequestException('Предпросмотр превышает 500 строк');
				if (rows.some(r => r.errors.length))
					throw new BadRequestException('Исправьте ошибки предпросмотра');
				const current = await tx.commerceCatalogItem.findMany({
					where: {
						workspaceId: access.workspaceId,
						code: { in: rows.map(r => r.code) }
					}
				});
				const byCode = new Map(current.map(i => [i.code, i]));
				for (const row of rows) {
					const item = byCode.get(row.code);
					if ((item?.version ?? null) !== row.expectedVersion || item?.archivedAt)
						conflict('Каталог изменился после предпросмотра. Создайте новый предпросмотр');
				}
				let created = 0,
					updated = 0,
					unchanged = 0;
				for (const row of rows) {
					const item = byCode.get(row.code);
					if (row.action === 'CREATE') {
						const createdItem = await tx.commerceCatalogItem.create({
							data: {
								workspaceId: access.workspaceId,
								code: row.code,
								kind: row.kind,
								name: row.name,
								unit: row.unit,
								basePriceMinor: row.basePriceMinor
							}
						});
						await tx.commerceEvent.create({
							data: {
								workspaceId: access.workspaceId,
								actorSubject: access.subject,
								kind: 'CATALOG_CREATED',
								details: {
									source: 'IMPORT',
									previewId,
									after: this.snapshot(createdItem)
								}
							}
						});
						created++;
					} else if (row.action === 'UPDATE' && item) {
						const updatedItem = await tx.commerceCatalogItem.update({
							where: { id: item.id },
							data: {
								kind: row.kind,
								name: row.name,
								unit: row.unit,
								...(row.basePriceMinor === null ? {} : { basePriceMinor: row.basePriceMinor }),
								version: { increment: 1 }
							}
						});
						await tx.commerceEvent.create({
							data: {
								workspaceId: access.workspaceId,
								actorSubject: access.subject,
								kind: 'CATALOG_UPDATED',
								details: {
									source: 'IMPORT',
									previewId,
									before: this.snapshot(item),
									after: this.snapshot(updatedItem)
								}
							}
						});
						updated++;
					} else unchanged++;
				}
				const result = {
					schemaVersion: 1,
					previewId,
					created,
					updated,
					unchanged
				};
				await tx.commerceImportPreview.update({
					where: { id: previewId },
					data: { result }
				});
				await tx.commerceEvent.create({
					data: {
						workspaceId: access.workspaceId,
						actorSubject: access.subject,
						kind: 'CATALOG_IMPORTED',
						details: { previewId, created, updated, unchanged }
					}
				});
				await tx.commerceCommand.create({
					data: {
						commandId,
						workspaceId: access.workspaceId,
						actorSubject: access.subject,
						kind: 'IMPORT_APPLY',
						requestHash,
						result
					}
				});
				return result;
			}, options)
		);
	}
}
