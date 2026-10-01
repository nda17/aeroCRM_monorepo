import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseImportFile } from './import-parser';
import { encodedFile, tamperCentralChecksum, xlsxFixture } from './import-parser.fixtures';

const csv = (text: string) => encodedFile('google-contacts.csv', Buffer.from(text, 'utf8'));
const xlsx = (bytes = xlsxFixture()) => encodedFile('google-contacts.xlsx', bytes);

function expectBothReject(input: Record<string, unknown>, strict = true) {
	expect(() => parseImportFile(input, strict)).toThrow();
}

describe('Sales import file parser', () => {
	it('keeps the Customers and Sales parser sources byte-identical', () => {
		const customersSource = readFileSync(join(__dirname, 'import-parser.ts'));
		const salesSource = readFileSync(
			join(__dirname, '../../../crm-customers/src/imports/import-parser.ts')
		);
		expect(customersSource.equals(salesSource)).toBe(true);
	});

	it('strictly parses Google CSV', () => {
		const input = csv('\uFEFFName;Email\r\n"Alice Smith";alice@example.com\r\n');
		const customers = parseImportFile(input, true);
		expect(customers.sheets[0]).toMatchObject({
			headers: ['Name', 'Email'],
			rows: [{ Name: 'Alice Smith', Email: 'alice@example.com' }],
			rowNumbers: [2],
			formulaRows: []
		});
	});

	it('strictly parses Google XLSX shared strings', () => {
		const input = xlsx();
		const customers = parseImportFile(input, true);
		expect(customers.sheets[0]).toMatchObject({
			name: 'Contacts',
			headers: ['Name', 'Email'],
			rows: [{ Name: 'Alice', Email: 'alice@example.com' }],
			rowNumbers: [2]
		});
	});

	it('preserves catalog leniency for formula cells while strict import mode rejects them', () => {
		const input = xlsx(
			xlsxFixture({
				sheets: [
					{
						name: 'Deals',
						xml: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>'
					}
				]
			})
		);
		expect(parseImportFile(input, false).sheets[0].formulaRows).toEqual([2]);
		expect(() => parseImportFile(input, true)).toThrow();
	});

	it('rejects ragged, invalid UTF-8, over-limit, and oversized-header CSVs in strict mode', () => {
		expectBothReject(csv('Name,Email\nAlice\n'));
		expectBothReject(encodedFile('contacts.csv', Buffer.from([0xff, 0xfe])));
		expectBothReject(encodedFile('contacts.csv', Buffer.alloc(1_000_001, 97)));
		expectBothReject(csv(`${'N'.repeat(201)},Email\nAlice,a@example.com\n`));
	});

	it('enforces the strict total row limit across sheets', () => {
		const firstRows = Array.from({ length: 251 }, (_, index) =>
			index === 0
				? '<row r="1"><c r="A1" t="s"><v>0</v></c></row>'
				: `<row r="${index + 1}"><c r="A${index + 1}" t="s"><v>1</v></c></row>`
		).join('');
		const secondRows = Array.from({ length: 252 }, (_, index) =>
			index === 0
				? '<row r="1"><c r="A1" t="s"><v>0</v></c></row>'
				: `<row r="${index + 1}"><c r="A${index + 1}" t="s"><v>1</v></c></row>`
		).join('');
		const input = xlsx(
			xlsxFixture({
				sharedStrings: ['Name', 'Alice'],
				sheets: [
					{ name: 'One', xml: `<worksheet><sheetData>${firstRows}</sheetData></worksheet>` },
					{ name: 'Two', xml: `<worksheet><sheetData>${secondRows}</sheetData></worksheet>` }
				]
			})
		);
		expectBothReject(input);
	});

	it.each([
		['missing cell reference', '<row r="1"><c t="s"><v>0</v></c></row>'],
		['invalid cell reference', '<row r="1"><c r="1A" t="s"><v>0</v></c></row>'],
		['cell and row mismatch', '<row r="1"><c r="A2" t="s"><v>0</v></c></row>'],
		[
			'duplicate cell reference',
			'<row r="1"><c r="A1" t="s"><v>0</v></c><c r="A1" t="s"><v>1</v></c></row>'
		]
	])('rejects XLSX with %s', (_label, row) => {
		expectBothReject(
			xlsx(
				xlsxFixture({
					sheets: [{ name: 'Broken', xml: `<worksheet><sheetData>${row}</sheetData></worksheet>` }]
				})
			)
		);
	});

	it('rejects invalid shared-string indices', () => {
		expectBothReject(
			xlsx(
				xlsxFixture({
					sheets: [
						{
							name: 'Broken',
							xml: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>4</v></c></row></sheetData></worksheet>'
						}
					]
				})
			)
		);
	});

	it.each([
		['a value', '<c r="C2" t="s"><v>2</v></c>'],
		['a formula', '<c r="C2"><f>1+1</f></c>']
	])('rejects %s in an XLSX column beyond the headers', (_label, extraCell) => {
		const input = xlsx(
			xlsxFixture({
				sharedStrings: ['Name', 'Alice'],
				sheets: [
					{
						name: 'Broken',
						xml: `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c>${extraCell}</row></sheetData></worksheet>`
					}
				]
			})
		);
		expectBothReject(input);
	});

	it('caps expanded shared-string text at 4 MB', () => {
		const largeValue = 'x'.repeat(10_000);
		const rows = Array.from({ length: 501 }, (_, index) =>
			index === 0
				? '<row r="1"><c r="A1" t="s"><v>0</v></c></row>'
				: `<row r="${index + 1}"><c r="A${index + 1}" t="s"><v>1</v></c></row>`
		).join('');
		expectBothReject(
			xlsx(
				xlsxFixture({
					sharedStrings: ['Name', largeValue],
					sheets: [{ name: 'Large', xml: `<worksheet><sheetData>${rows}</sheetData></worksheet>` }]
				})
			)
		);
	});

	it('rejects invalid UTF-8 in XML and relationship parts', () => {
		expectBothReject(
			xlsx(xlsxFixture({ workbook: Buffer.from([0x3c, 0xff, 0x3e]) }))
		);
		expectBothReject(
			xlsx(xlsxFixture({ relationships: Buffer.from([0x3c, 0xff, 0x3e]) }))
		);
	});

	it('rejects XLSX entries whose declared CRC does not match their content', () => {
		const archive = tamperCentralChecksum(xlsxFixture(), 'xl/workbook.xml');
		expectBothReject(xlsx(archive));
	});
});
