import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
// This self-contained file is copied into crm-customers for isolated Docker builds.
// Keep both copies identical and run the parser parity fixtures when changing it.
function string(value: unknown, label: string, max: number): string {
	if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > max || /[\x00-\x1f\x7f]/.test(value))
		throw new BadRequestException(`Некорректное поле ${label}`);
	return value.trim();
}

export type Sheet = {
	name: string;
	headers: string[];
	rows: Array<Record<string, string>>;
	rowNumbers: number[];
	formulaRows: number[];
	numericColumnsByRow: Record<number, string[]>;
};
export const MAX_COMPRESSED = 1_000_000,
	MAX_UNCOMPRESSED = 4_000_000,
	MAX_ROWS = 500;
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
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
	let value = index;
	for (let bit = 0; bit < 8; bit++)
		value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
	return value >>> 0;
});
function crc32(bytes: Buffer): number {
	let value = 0xffffffff;
	for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
	return (value ^ 0xffffffff) >>> 0;
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
	const localOffsets = new Set<number>();
	for (let i = 0; i < count; i++) {
		if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50)
			throw new BadRequestException('Некорректный XLSX');
		const flags = bytes.readUInt16LE(cursor + 8),
			method = bytes.readUInt16LE(cursor + 10),
			checksum = bytes.readUInt32LE(cursor + 16),
			compressed = bytes.readUInt32LE(cursor + 20),
			uncompressed = bytes.readUInt32LE(cursor + 24),
			nameLength = bytes.readUInt16LE(cursor + 28),
			extra = bytes.readUInt16LE(cursor + 30),
			comment = bytes.readUInt16LE(cursor + 32),
			local = bytes.readUInt32LE(cursor + 42);
		if (cursor + 46 + nameLength + extra + comment > bytes.length || localOffsets.has(local))
			throw new BadRequestException('Некорректный XLSX');
		localOffsets.add(local);
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
		const localName = bytes.subarray(local + 30, local + 30 + bytes.readUInt16LE(local + 26)).toString('utf8');
		if (bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method || localName !== name)
			throw new BadRequestException('Несогласованные записи XLSX');
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
		if (crc32(inflated) !== checksum) throw new BadRequestException('Неверная контрольная сумма XLSX');
		if (/\.(xml|rels)$/.test(name)) {
			try { new TextDecoder('utf-8', { fatal: true }).decode(inflated); }
			catch { throw new BadRequestException('XML внутри XLSX должен быть в UTF-8'); }
		}
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
	if (new Set(ordered.map(sheet => sheet.name)).size !== ordered.length)
		throw new BadRequestException('Неоднозначные имена листов XLSX');
	return ordered.map(({ file, name }, index) => {
		const buffer = files.get(file)!;
		const xml = buffer.toString('utf8');
		if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new BadRequestException('Некорректный лист XLSX');
		const rawRows = xmlElements(xml, 'row');
		if (rawRows.length > MAX_ROWS + 1) throw new BadRequestException('Не более 500 строк данных');
		const matrix: Array<Record<string, { value: string; type: string; formula: boolean }>> = [];
		const physicalRows: number[] = [];
		for (const row of rawRows) {
			const explicitRow = attribute(row.attributes, 'r');
			physicalRows.push(explicitRow === undefined ? physicalRows.length + 1 : Number(explicitRow));
			const cells: Record<string, { value: string; type: string; formula: boolean }> = {};
			for (const cell of row.content.matchAll(
				/<((?:[A-Za-z_][\w.-]*:)?c)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g
			)) {
				const reference = attribute(cell[2], 'r')?.match(/^([A-Z]{1,3})([1-9][0-9]*)$/);
				if (!reference || Number(reference[2]) !== physicalRows.at(-1) || Object.prototype.hasOwnProperty.call(cells, reference[1]))
					throw new BadRequestException('Повторяющаяся или некорректная ссылка на ячейку XLSX');
				const col = reference[1];
				const type = attribute(cell[2], 't') || 'n',
					body = cell[3] || '';
				const formula = xmlStartTags(body, 'f').length > 0;
				const raw = xmlElements(body, 'v')[0]?.content || xmlElements(body, 'is')[0]?.content || '';
				if (type === 's' && (!/^(0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) >= shared.length))
					throw new BadRequestException('Некорректная ссылка на строковое значение XLSX');
				const value =
					type === 's' ? (shared[Number(raw)] ?? '') : xmlText(raw.replace(/<[^>]+>/g, ''));
				cells[col] = { value, type, formula };
			}
		matrix.push(cells);
		}
		if (physicalRows.some((row, position) => !Number.isSafeInteger(row) || row < 1 ||
			(position > 0 && row <= physicalRows[position - 1])))
			throw new BadRequestException('Неоднозначные номера строк XLSX');
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
		if (matrix.some(cells => Object.entries(cells).some(([col, cell]) => !columns.includes(col) && (cell.value !== '' || cell.formula))))
			throw new BadRequestException('В XLSX есть данные в столбце без заголовка');
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
export function parseImportFile(
	input: Record<string, unknown>,
	strict = false
): {
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
	if (strict) {
		let expandedBytes = 0;
		for (const sheet of sheets) {
			if (sheet.headers.some(header => header.length > 200))
				throw new BadRequestException('Заголовок столбца не должен превышать 200 символов');
			for (const header of sheet.headers) expandedBytes += Buffer.byteLength(header, 'utf8');
			for (const row of sheet.rows) for (const value of Object.values(row)) {
				expandedBytes += Buffer.byteLength(value, 'utf8');
				if (expandedBytes > MAX_UNCOMPRESSED) throw new BadRequestException('Объём значений ячеек превышает 4 МБ');
			}
		}
		if (sheets.reduce((count, sheet) => count + sheet.rows.length, 0) > MAX_ROWS)
			throw new BadRequestException('Не более 500 строк в файле');
		if (sheets.some(sheet => sheet.formulaRows.length))
			throw new BadRequestException('Формулы в XLSX запрещены');
	}
	return {
		filename,
		sheets,
		digest: createHash('sha256').update(bytes).digest('hex')
	};
}
