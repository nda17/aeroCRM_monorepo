import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException
} from '@nestjs/common';
import { Prisma } from '@prisma/crm-sales-client';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { CrmSalesPrismaService } from '../prisma/crm-sales-prisma.service';
import type { SalesAccess } from '../sales/sales-access';
import { conflict, hash, lock, minor, object, serializable, string, uuid } from './commerce-core';

type Sheet = {
	name: string;
	headers: string[];
	rows: Array<Record<string, string>>;
	rowNumbers: number[];
	formulaRows: number[];
	numericColumnsByRow: Record<number, string[]>;
};
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
const MAX_COMPRESSED = 1_000_000,
	MAX_UNCOMPRESSED = 4_000_000,
	MAX_ROWS = 500;
const options = {
	isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
	timeout: 20000,
	maxWait: 5000
} as const;

function xmlText(value: string): string {
	return value.replace(
		/&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi,
		(_, num: string, named: string) => {
			if (!num) {
				const namedValue = (
					{ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>
				)[named];
				if (namedValue === undefined)
					throw new BadRequestException('Некорректная XML-сущность в XLSX');
				return namedValue;
			}
			const codePoint = num[0].toLowerCase() === 'x' ? parseInt(num.slice(1), 16) : Number(num);
			if (
				!Number.isInteger(codePoint) ||
				codePoint < 0x20 ||
				codePoint > 0x10ffff ||
				(codePoint >= 0xd800 && codePoint <= 0xdfff)
			)
				throw new BadRequestException('Некорректный символ в XLSX');
			return String.fromCodePoint(codePoint);
		}
	);
}
function attribute(text: string, name: string): string | undefined {
	const m = text.match(new RegExp(`\\b${name}="([^"]*)"`));
	return m ? xmlText(m[1]) : undefined;
}
// Match only element names. Rewriting namespace prefixes in the XML string
// would also rewrite user-entered cell text, so keep the original payload.
function xmlElements(xml: string, name: string) {
	const pattern = new RegExp(
		`<((?:[A-Za-z_][\\w.-]*:)?${name})\\b([^>]*)>([\\s\\S]*?)<\\/\\1>`,
		'g'
	);
	return [...xml.matchAll(pattern)].map(match => ({
		attributes: match[2],
		content: match[3]
	}));
}
function xmlStartTags(xml: string, name: string) {
	const pattern = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${name}\\b([^>]*)>`, 'g');
	return [...xml.matchAll(pattern)].map(match => match[1]);
}
function csvRows(text: string): string[][] {
	const first = text.split(/\r?\n/, 1)[0];
	const delimiter = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
	const rows: string[][] = [];
	let row: string[] = [],
		field = '',
		quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') {
				field += '"';
				i++;
			} else if (c === '"') quoted = false;
			else field += c;
		} else if (c === '"') {
			if (field) throw new BadRequestException('Некорректные кавычки CSV');
			quoted = true;
		} else if (c === delimiter) {
			row.push(field);
			field = '';
		} else if (c === '\n') {
			row.push(field.replace(/\r$/, ''));
			rows.push(row);
			row = [];
			field = '';
			if (rows.length > MAX_ROWS + 1) throw new BadRequestException('Не более 500 строк');
		} else field += c;
	}
	if (quoted) throw new BadRequestException('Незакрытая кавычка CSV');
	if (field || row.length) {
		row.push(field);
		rows.push(row);
		if (rows.length > MAX_ROWS + 1) throw new BadRequestException('Не более 500 строк');
	}
	return rows;
}
function zipFiles(bytes: Buffer): Map<string, Buffer> {
	const files = new Map<string, Buffer>();
	let end = -1;
	for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
		if (bytes.readUInt32LE(i) === 0x06054b50) {
			end = i;
			break;
		}
	}
	if (end < 0) throw new BadRequestException('Некорректный XLSX');
	const count = bytes.readUInt16LE(end + 10),
		offset = bytes.readUInt32LE(end + 16);
	if (count > 100 || offset >= bytes.length) throw new BadRequestException('Слишком большой XLSX');
	let cursor = offset,
		total = 0;
	for (let i = 0; i < count; i++) {
		if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50)
			throw new BadRequestException('Некорректный XLSX');
		const flags = bytes.readUInt16LE(cursor + 8),
			method = bytes.readUInt16LE(cursor + 10),
			compressed = bytes.readUInt32LE(cursor + 20),
			uncompressed = bytes.readUInt32LE(cursor + 24),
			nameLength = bytes.readUInt16LE(cursor + 28),
			extra = bytes.readUInt16LE(cursor + 30),
			comment = bytes.readUInt16LE(cursor + 32),
			local = bytes.readUInt32LE(cursor + 42);
		const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
		cursor += 46 + nameLength + extra + comment;
		if (
			flags & 1 ||
			![0, 8].includes(method) ||
			name.includes('..') ||
			name.startsWith('/') ||
			(!name.startsWith('xl/') &&
				!name.startsWith('docProps/') &&
				!['[Content_Types].xml', '_rels/.rels'].includes(name))
		)
			throw new BadRequestException('Неподдерживаемый XLSX');
		if (/(?:macro|vba|externalLinks|embeddings|oleObject)/i.test(name))
			throw new BadRequestException('Макросы и внешние ссылки в XLSX не поддерживаются');
		if (files.has(name)) throw new BadRequestException('Повтор файла внутри XLSX');
		total += uncompressed;
		if (total > MAX_UNCOMPRESSED || uncompressed > 2_000_000)
			throw new BadRequestException('Распакованный XLSX слишком велик');
		if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50)
			throw new BadRequestException('Некорректный XLSX');
		const dataStart = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
		if (dataStart + compressed > bytes.length) throw new BadRequestException('Некорректный XLSX');
		const data = bytes.subarray(dataStart, dataStart + compressed);
		let inflated: Buffer;
		try {
			inflated = method === 0 ? data : inflateRawSync(data, { maxOutputLength: uncompressed + 1 });
		} catch {
			throw new BadRequestException('Не удалось безопасно распаковать XLSX');
		}
		if (inflated.length !== uncompressed) throw new BadRequestException('Некорректный размер XLSX');
		if (
			name.endsWith('.rels') &&
			/TargetMode\s*=\s*["']External["']/i.test(inflated.toString('utf8'))
		)
			throw new BadRequestException('Внешние ссылки XLSX не поддерживаются');
		files.set(name, inflated);
	}
	return files;
}
function xlsxSheets(bytes: Buffer): Sheet[] {
	const files = zipFiles(bytes),
		workbook = files.get('xl/workbook.xml')?.toString('utf8') || '';
	if (!workbook || /<!DOCTYPE|<!ENTITY/i.test(workbook))
		throw new BadRequestException('Некорректный XLSX');
	const sharedXml = files.get('xl/sharedStrings.xml')?.toString('utf8') || '';
	const shared = xmlElements(sharedXml, 'si').map(element =>
		xmlText(
			xmlElements(element.content, 't')
				.map(text => text.content)
				.join('')
		)
	);
	const workbookSheets = xmlStartTags(workbook, 'sheet').map(attributes => ({
		name: attribute(attributes, 'name') || '',
		rid: attribute(attributes, 'r:id') || attribute(attributes, 'id') || ''
	}));
	const relationships = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8') || '';
	const targets = new Map(
		xmlStartTags(relationships, 'Relationship').map(attributes => [
			attribute(attributes, 'Id') || '',
			attribute(attributes, 'Target') || ''
		])
	);
	const sheetFiles = [...files.entries()]
		.filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
		.sort((a, b) => Number(a[0].match(/sheet(\d+)/)?.[1]) - Number(b[0].match(/sheet(\d+)/)?.[1]));
	if (sheetFiles.length < 1 || sheetFiles.length > 20)
		throw new BadRequestException('XLSX должен содержать от 1 до 20 листов');
	const ordered = workbookSheets.length
		? workbookSheets.map((sheet, index) => {
				const target = targets.get(sheet.rid) || `worksheets/sheet${index + 1}.xml`;
				const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
				return {
					name: sheet.name,
					file: path.startsWith('xl/') ? path : `xl/${path}`
				};
			})
		: sheetFiles.map(([file], index) => ({ name: `Лист ${index + 1}`, file }));
	if (ordered.length !== sheetFiles.length || ordered.some(s => !files.has(s.file)))
		throw new BadRequestException('Повреждены ссылки на листы XLSX');
	return ordered.map(({ file, name }, index) => {
		const buffer = files.get(file)!;
		const xml = buffer.toString('utf8');
		if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new BadRequestException('Некорректный лист XLSX');
		const rawRows = xmlElements(xml, 'row');
		if (rawRows.length > MAX_ROWS + 1) throw new BadRequestException('Не более 500 строк каталога');
		const matrix: Array<Record<string, { value: string; type: string; formula: boolean }>> = [];
		const physicalRows: number[] = [];
		for (const row of rawRows) {
			physicalRows.push(Number(attribute(row.attributes, 'r')) || physicalRows.length + 1);
			const cells: Record<string, { value: string; type: string; formula: boolean }> = {};
			for (const cell of row.content.matchAll(
				/<((?:[A-Za-z_][\w.-]*:)?c)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g
			)) {
				const col = attribute(cell[2], 'r')?.match(/^[A-Z]+/)?.[0];
				if (!col) continue;
				const type = attribute(cell[2], 't') || 'n',
					body = cell[3] || '';
				const formula = xmlStartTags(body, 'f').length > 0;
				const raw = xmlElements(body, 'v')[0]?.content || xmlElements(body, 'is')[0]?.content || '';
				const value =
					type === 's' ? (shared[Number(raw)] ?? '') : xmlText(raw.replace(/<[^>]+>/g, ''));
				cells[col] = { value, type, formula };
			}
			matrix.push(cells);
		}
		const headerCells = matrix.shift() || {};
		physicalRows.shift();
		if (Object.values(headerCells).some(cell => cell.formula))
			throw new BadRequestException('Формулы в заголовках XLSX запрещены');
		const headers = Object.keys(headerCells)
			.sort((a, b) => a.length - b.length || a.localeCompare(b))
			.map(k => headerCells[k].value);
		if (!headers.length)
			throw new BadRequestException(
				`На листе «${name || index + 1}» не найдена строка заголовков XLSX`
			);
		if (new Set(headers).size !== headers.length || headers.some(name => !name))
			throw new BadRequestException('Заголовки XLSX должны быть уникальными и непустыми');
		const columns = Object.keys(headerCells).sort(
			(a, b) => a.length - b.length || a.localeCompare(b)
		);
		const rows = matrix.map(cells =>
			Object.fromEntries(columns.map((col, i) => [headers[i], cells[col]?.value || '']))
		);
		const formulaRows: number[] = [],
			numericColumnsByRow: Record<number, string[]> = {};
		matrix.forEach((cells, i) => {
			if (Object.values(cells).some(c => c.formula)) formulaRows.push(physicalRows[i]);
			numericColumnsByRow[physicalRows[i]] = columns
				.filter(col => cells[col]?.type === 'n' && cells[col]?.value)
				.map(col => headers[columns.indexOf(col)]);
		});
		return {
			name: name || file.split('/').pop() || `Лист ${index + 1}`,
			headers,
			rows,
			rowNumbers: physicalRows,
			formulaRows,
			numericColumnsByRow
		};
	});
}
function decode(input: Record<string, unknown>): {
	filename: string;
	sheets: Sheet[];
	digest: string;
} {
	const filename = string(input.filename, 'filename', 200);
	if (
		typeof input.contentBase64 !== 'string' ||
		input.contentBase64.length > Math.ceil((MAX_COMPRESSED * 4) / 3) + 8 ||
		!/^[A-Za-z0-9+/]*={0,2}$/.test(input.contentBase64)
	)
		throw new BadRequestException('Файл слишком большой или повреждён');
	const bytes = Buffer.from(input.contentBase64, 'base64');
	if (bytes.length > MAX_COMPRESSED || bytes.length === 0)
		throw new BadRequestException('Файл должен быть не больше 1 МБ');
	let sheets: Sheet[];
	if (filename.toLowerCase().endsWith('.csv')) {
		let text: string;
		try {
			text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
		} catch {
			throw new BadRequestException('CSV должен быть в UTF-8');
		}
		const matrix = csvRows(text);
		if (matrix.length < 1) throw new BadRequestException('CSV пустой');
		const headers = matrix.shift()!;
		if (new Set(headers).size !== headers.length || headers.some(header => !header.trim()))
			throw new BadRequestException('Заголовки CSV должны быть уникальными и непустыми');
		if (matrix.some(row => row.length !== headers.length))
			throw new BadRequestException('Количество столбцов CSV не совпадает с заголовком');
		sheets = [
			{
				name: 'CSV',
				headers,
				rows: matrix.map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] || '']))),
				rowNumbers: matrix.map((_, i) => i + 2),
				formulaRows: [],
				numericColumnsByRow: {}
			}
		];
	} else if (filename.toLowerCase().endsWith('.xlsx')) sheets = xlsxSheets(bytes);
	else throw new BadRequestException('Допустимы CSV и XLSX');
	return {
		filename,
		sheets,
		digest: createHash('sha256').update(bytes).digest('hex')
	};
}

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
		const { filename, sheets, digest } = decode(object(input));
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
			decoded = decode(body);
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
