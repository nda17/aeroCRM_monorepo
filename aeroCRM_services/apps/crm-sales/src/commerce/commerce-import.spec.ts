import { BadRequestException } from '@nestjs/common';
import { CommerceImportService } from './commerce-import.service';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const access = {
	workspaceId,
	subject: 'import-actor',
	state: 'ACTIVE',
	permissions: ['sales:read', 'sales:write']
} as any;
const mapping = {
	code: 'code',
	kind: 'kind',
	name: 'name',
	unit: 'unit',
	basePriceMinor: 'price'
};

function crc32(buffer: Buffer) {
	let crc = 0xffffffff;
	for (const byte of buffer) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++)
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries: Record<string, string>) {
	const local: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;
	for (const [name, content] of Object.entries(entries)) {
		const filename = Buffer.from(name);
		const data = Buffer.from(content);
		const crc = crc32(data);
		const localHeader = Buffer.alloc(30);
		localHeader.writeUInt32LE(0x04034b50, 0);
		localHeader.writeUInt16LE(20, 4);
		localHeader.writeUInt32LE(crc, 14);
		localHeader.writeUInt32LE(data.length, 18);
		localHeader.writeUInt32LE(data.length, 22);
		localHeader.writeUInt16LE(filename.length, 26);
		local.push(localHeader, filename, data);
		const directory = Buffer.alloc(46);
		directory.writeUInt32LE(0x02014b50, 0);
		directory.writeUInt16LE(20, 4);
		directory.writeUInt16LE(20, 6);
		directory.writeUInt32LE(crc, 16);
		directory.writeUInt32LE(data.length, 20);
		directory.writeUInt32LE(data.length, 24);
		directory.writeUInt16LE(filename.length, 28);
		directory.writeUInt32LE(offset, 42);
		central.push(directory, filename);
		offset += localHeader.length + filename.length + data.length;
	}
	const directoryData = Buffer.concat(central);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(Object.keys(entries).length, 8);
	eocd.writeUInt16LE(Object.keys(entries).length, 10);
	eocd.writeUInt32LE(directoryData.length, 12);
	eocd.writeUInt32LE(offset, 16);
	return Buffer.concat([...local, directoryData, eocd]);
}

function workbook(overrides: Record<string, string> = {}) {
	return zip({
		'[Content_Types].xml': '<Types/>',
		'_rels/.rels': '<Relationships/>',
		'docProps/core.xml': '<coreProperties/>',
		'xl/workbook.xml':
			'<workbook xmlns:r="r"><sheets><sheet name="Catalog" sheetId="1" r:id="rId1"/><sheet name="Extra" sheetId="2" r:id="rId2"/></sheets></workbook>',
		'xl/_rels/workbook.xml.rels':
			'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
		'xl/sharedStrings.xml':
			'<sst><si><t>code</t></si><si><t>kind</t></si><si><t>name</t></si><si><t>unit</t></si><si><t>price</t></si><si><t>001</t></si><si><t>SERVICE</t></si><si><t>Поддержка</t></si><si><t>час</t></si></sst>',
		'xl/worksheets/sheet1.xml':
			'<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row><row r="2"><c r="A2" t="s"><v>5</v></c><c r="B2" t="s"><v>6</v></c><c r="C2" t="s"><v>7</v></c><c r="D2" t="s"><v>8</v></c><c r="E2" t="n"><v>250</v></c></row></sheetData></worksheet>',
		'xl/worksheets/sheet2.xml':
			'<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>notes</t></is></c></row></sheetData></worksheet>',
		...overrides
	});
}

function createService() {
	const findMany = jest.fn().mockResolvedValue([]);
	const create = jest.fn(async ({ data }) => ({ id: 'preview-id', ...data }));
	return {
		findMany,
		create,
		service: new CommerceImportService({
			commerceCatalogItem: { findMany },
			commerceImportPreview: { create }
		} as never)
	};
}

describe('commerce XLSX import parsing', () => {
	it('reads a real ZIP XLSX with shared strings, metadata and multiple worksheets while preserving text codes', () => {
		const { service } = createService();
		const file = workbook();
		const inspected = service.inspect(access, {
			workspaceId: access.workspaceId,
			filename: 'catalog.xlsx',
			contentBase64: file.toString('base64')
		});
		expect(inspected.sheets.map((sheet) => sheet.name)).toEqual([
			'Catalog',
			'Extra'
		]);
		expect(inspected.sheets[0].sample[0]).toMatchObject({
			code: '001',
			kind: 'SERVICE',
			name: 'Поддержка'
		});
	});

	it('reads namespace-prefixed SpreadsheetML, text codes with leading zeroes, named sheets, and numeric prices', async () => {
		const { service } = createService();
		const file = workbook({
			'xl/workbook.xml':
				'<x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheets><x:sheet name="Каталог" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><x:sheet name="Дополнительный лист" sheetId="2" r:id="rId2" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></x:sheets></x:workbook>',
			'xl/_rels/workbook.xml.rels':
				'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="/xl/sharedStrings.xml"/></Relationships>',
			'xl/sharedStrings.xml':
				'<x:sst xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>',
			'xl/worksheets/sheet1.xml':
				'<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1"><x:c r="A1" t="str"><x:v>Код</x:v></x:c><x:c r="B1" t="str"><x:v>Тип</x:v></x:c><x:c r="C1" t="str"><x:v>Название</x:v></x:c><x:c r="D1" t="str"><x:v>Единица</x:v></x:c><x:c r="E1" t="str"><x:v>Базовая цена</x:v></x:c></x:row><x:row r="2"><x:c r="A2" t="str"><x:v>00125</x:v></x:c><x:c r="B2" t="str"><x:v>Товар</x:v></x:c><x:c r="C2" t="str"><x:v>ТЕСТ aeroCRM Кабель</x:v></x:c><x:c r="D2" t="str"><x:v>м</x:v></x:c><x:c r="E2" t="n"><x:v>199.99</x:v></x:c></x:row><x:row r="3"><x:c r="A3" t="str"><x:v>00007</x:v></x:c><x:c r="B3" t="str"><x:v>Услуга</x:v></x:c><x:c r="C3" t="str"><x:v>ТЕСТ aeroCRM Настройка</x:v></x:c><x:c r="D3" t="str"><x:v>час</x:v></x:c><x:c r="E3" t="n"><x:v>1500</x:v></x:c></x:row><x:row r="4"><x:c r="A4" t="str"><x:v>00008</x:v></x:c><x:c r="B4" t="str"><x:v>Услуга</x:v></x:c><x:c r="C4" t="str"><x:v>ТЕСТ aeroCRM Консультация</x:v></x:c><x:c r="D4" t="str"><x:v>час</x:v></x:c><x:c r="E4" t="n"/></x:row></x:sheetData></x:worksheet>',
			'xl/worksheets/sheet2.xml':
				'<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1"><x:c r="A1" t="str"><x:v>Код</x:v></x:c><x:c r="B1" t="str"><x:v>Тип</x:v></x:c><x:c r="C1" t="str"><x:v>Название</x:v></x:c><x:c r="D1" t="str"><x:v>Единица</x:v></x:c><x:c r="E1" t="str"><x:v>Базовая цена</x:v></x:c></x:row><x:row r="2"><x:c r="A2" t="str"><x:v>00009</x:v></x:c><x:c r="B2" t="str"><x:v>Товар</x:v></x:c><x:c r="C2" t="str"><x:v>ТЕСТ aeroCRM Образец</x:v></x:c><x:c r="D2" t="str"><x:v>шт.</x:v></x:c><x:c r="E2" t="n"><x:v>0</x:v></x:c></x:row></x:sheetData></x:worksheet>'
		});
		const input = {
			workspaceId: access.workspaceId,
			filename: 'catalog.xlsx',
			contentBase64: file.toString('base64')
		};
		const inspected = service.inspect(access, input);
		expect(inspected.sheets.map(sheet => sheet.name)).toEqual([
			'Каталог',
			'Дополнительный лист'
		]);
		expect(inspected.sheets.map(sheet => sheet.rowCount)).toEqual([3, 1]);
		const columns = {
			code: 'Код',
			kind: 'Тип',
			name: 'Название',
			unit: 'Единица',
			basePriceMinor: 'Базовая цена'
		};
		const preview = await service.preview(access, {
			...input,
			sheet: 'Каталог',
			mapping: columns
		});
		expect(preview.rows[0]).toMatchObject({
			code: '00125',
			kind: 'PRODUCT',
			name: 'ТЕСТ aeroCRM Кабель',
			basePriceMinor: 19999,
			action: 'CREATE'
		});
		expect(preview.rows[2]).toMatchObject({
			code: '00008',
			basePriceMinor: null
		});
		await expect(
			service.preview(access, {
				...input,
				sheet: 'Дополнительный лист',
				mapping: columns
			})
		).resolves.toMatchObject({ rows: [{ code: '00009', basePriceMinor: 0 }] });
		const noHeaderFile = workbook({
			'xl/workbook.xml':
				'<x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheets><x:sheet name="Без заголовков" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></x:sheets></x:workbook>',
			'xl/_rels/workbook.xml.rels':
				'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml"/></Relationships>',
			'xl/worksheets/sheet1.xml':
				'<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData/></x:worksheet>'
		});
		await expect(
			service.preview(access, {
				...input,
				contentBase64: noHeaderFile.toString('base64'),
				sheet: 'Без заголовков',
				mapping: columns
			})
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it.each([
		[
			'external relationship',
			{ 'xl/externalLinks/externalLink1.xml': '<link/>' }
		],
		[
			'external target mode',
			{
				'xl/worksheets/_rels/sheet1.xml.rels':
					'<Relationships><Relationship TargetMode="External" Target="https://example.test"/></Relationships>'
			}
		],
		['macro payload', { 'xl/vbaProject.bin': 'macro' }]
	])('rejects %s', (_name, additions) => {
		const { service } = createService();
		const contentBase64 = workbook(
			additions as Record<string, string>
		).toString('base64');
		expect(() =>
			service.inspect(access, {
				workspaceId: access.workspaceId,
				filename: 'catalog.xlsx',
				contentBase64
			})
		).toThrow(BadRequestException);
	});

	it('reports formula cells and duplicate text codes as preview errors', async () => {
		const { service, findMany } = createService();
		const file = workbook({
			'xl/worksheets/sheet1.xml':
				'<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row><row r="2"><c r="A2" t="s"><v>5</v></c><c r="B2" t="s"><v>6</v></c><c r="C2" t="s"><v>7</v></c><c r="D2" t="s"><v>8</v></c><c r="E2"><f>100+1</f><v>101</v></c></row><row r="3"><c r="A3" t="s"><v>5</v></c><c r="B3" t="s"><v>6</v></c><c r="C3" t="s"><v>7</v></c><c r="D3" t="s"><v>8</v></c><c r="E3" t="n"><v>100</v></c></row></sheetData></worksheet>'
		});
		const result = await service.preview(access, {
			workspaceId: access.workspaceId,
			filename: 'catalog.xlsx',
			contentBase64: file.toString('base64'),
			mapping
		});
		expect(result.rows[0].errors).toContain(
			'Формулы в импортируемых строках запрещены'
		);
		expect(result.rows[1].errors).toContain('Повтор кода в файле');
		expect(findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ code: { in: ['001', '001'] } })
			})
		);
	});

	it('rejects numeric XLSX codes because spreadsheets may have stripped leading zeroes', async () => {
		const { service } = createService();
		const file = workbook({
			'xl/worksheets/sheet1.xml':
				'<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row><row r="2"><c r="A2" t="n"><v>1</v></c><c r="B2" t="s"><v>6</v></c><c r="C2" t="s"><v>7</v></c><c r="D2" t="s"><v>8</v></c><c r="E2" t="n"><v>100</v></c></row></sheetData></worksheet>'
		});
		const result = await service.preview(access, {
			workspaceId: access.workspaceId,
			filename: 'catalog.xlsx',
			contentBase64: file.toString('base64'),
			mapping
		});
		expect(result.rows[0].errors).toContain(
			'Код XLSX должен быть текстом, чтобы сохранить ведущие нули'
		);
	});

	it('rejects encrypted, oversized, malformed-base64 and unsupported ZIP members', () => {
		const { service } = createService();
		const valid = workbook();
		const encrypted = Buffer.from(valid);
		// Mark the first central-directory member as encrypted.
		const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
		encrypted.writeUInt16LE(1, central + 8);
		expect(() =>
			service.inspect(access, {
				workspaceId: access.workspaceId,
				filename: 'catalog.xlsx',
				contentBase64: encrypted.toString('base64')
			})
		).toThrow(BadRequestException);
		expect(() =>
			service.inspect(access, {
				workspaceId: access.workspaceId,
				filename: 'catalog.xlsx',
				contentBase64: '%%%%'
			})
		).toThrow(BadRequestException);
		expect(() =>
			service.inspect(access, {
				workspaceId: access.workspaceId,
				filename: 'catalog.xlsx',
				contentBase64: Buffer.alloc(1_000_001).toString('base64')
			})
		).toThrow(BadRequestException);
	});

	it('parses comma-delimited quoted CSV and escaped quotes without splitting embedded newlines', () => {
		const { service } = createService();
		const text =
			'code,kind,name,unit\r\n001,SERVICE,"Окно, ""длинное""\nвариант",час';
		const inspected = service.inspect(access, {
			workspaceId: access.workspaceId,
			filename: 'catalog.csv',
			contentBase64: Buffer.from(text).toString('base64')
		});
		expect(inspected.sheets[0].sample[0]).toEqual({
			code: '001',
			kind: 'SERVICE',
			name: 'Окно, "длинное"\nвариант',
			unit: 'час'
		});
	});
});
