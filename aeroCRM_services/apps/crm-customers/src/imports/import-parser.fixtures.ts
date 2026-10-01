import { deflateRawSync } from 'node:zlib';

type Entry = { name: string; data: Buffer };
type SheetInput = { name?: string; xml: string | Buffer };

function crc32(bytes: Buffer): number {
	let value = 0xffffffff;
	for (const byte of bytes) {
		value ^= byte;
		for (let bit = 0; bit < 8; bit++)
			value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
	}
	return (value ^ 0xffffffff) >>> 0;
}

function encode(value: string | Buffer): Buffer {
	return Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
}

function zip(entries: Entry[]): Buffer {
	const local: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;
	for (const entry of entries) {
		const name = Buffer.from(entry.name, 'utf8');
		const compressed = deflateRawSync(entry.data);
		const checksum = crc32(entry.data);
		const localHeader = Buffer.alloc(30);
		localHeader.writeUInt32LE(0x04034b50, 0);
		localHeader.writeUInt16LE(20, 4);
		localHeader.writeUInt16LE(8, 8);
		localHeader.writeUInt32LE(checksum, 14);
		localHeader.writeUInt32LE(compressed.length, 18);
		localHeader.writeUInt32LE(entry.data.length, 22);
		localHeader.writeUInt16LE(name.length, 26);
		local.push(localHeader, name, compressed);

		const centralHeader = Buffer.alloc(46);
		centralHeader.writeUInt32LE(0x02014b50, 0);
		centralHeader.writeUInt16LE(20, 4);
		centralHeader.writeUInt16LE(20, 6);
		centralHeader.writeUInt16LE(8, 10);
		centralHeader.writeUInt32LE(checksum, 16);
		centralHeader.writeUInt32LE(compressed.length, 20);
		centralHeader.writeUInt32LE(entry.data.length, 24);
		centralHeader.writeUInt16LE(name.length, 28);
		centralHeader.writeUInt32LE(offset, 42);
		central.push(centralHeader, name);
		offset += localHeader.length + name.length + compressed.length;
	}
	const centralBytes = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralBytes.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...local, centralBytes, end]);
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

export function xlsxFixture(options: {
	sheets?: SheetInput[];
	sharedStrings?: string[];
	workbook?: string | Buffer;
	relationships?: string | Buffer;
	extraEntries?: Record<string, string | Buffer>;
} = {}): Buffer {
	const sheets = options.sheets || [
		{
			name: 'Contacts',
			xml: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row></sheetData></worksheet>'
		}
	];
	const shared = options.sharedStrings || ['Name', 'Email', 'Alice', 'alice@example.com'];
	const workbook =
		options.workbook ||
		`<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
			.map(
				(sheet, index) =>
					`<sheet name="${escapeXml(sheet.name || `Sheet ${index + 1}`)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
			)
			.join('')}</sheets></workbook>`;
	const relationships =
		options.relationships ||
		`<Relationships>${sheets
			.map(
				(_, index) =>
					`<Relationship Id="rId${index + 1}" Target="worksheets/sheet${index + 1}.xml" Type="worksheet"/>`
			)
			.join('')}</Relationships>`;
	const entries: Entry[] = [
		{ name: '[Content_Types].xml', data: encode('<Types/>') },
		{ name: '_rels/.rels', data: encode('<Relationships/>') },
		{ name: 'xl/workbook.xml', data: encode(workbook) },
		{ name: 'xl/_rels/workbook.xml.rels', data: encode(relationships) },
		{
			name: 'xl/sharedStrings.xml',
			data: encode(
				`<sst>${shared.map(value => `<si><t>${escapeXml(value)}</t></si>`).join('')}</sst>`
			)
		},
		...sheets.map((sheet, index) => ({
			name: `xl/worksheets/sheet${index + 1}.xml`,
			data: encode(sheet.xml)
		}))
	];
	for (const [name, data] of Object.entries(options.extraEntries || {}))
		entries.push({ name, data: encode(data) });
	return zip(entries);
}

export function tamperCentralChecksum(zipBytes: Buffer, filename: string): Buffer {
	const tampered = Buffer.from(zipBytes);
	let end = -1;
	for (let index = tampered.length - 22; index >= Math.max(0, tampered.length - 65_557); index--) {
		if (tampered.readUInt32LE(index) === 0x06054b50) {
			end = index;
			break;
		}
	}
	if (end < 0) throw new Error('ZIP end record not found');
	let cursor = tampered.readUInt32LE(end + 16);
	while (cursor + 46 <= tampered.length && tampered.readUInt32LE(cursor) === 0x02014b50) {
		const nameLength = tampered.readUInt16LE(cursor + 28);
		const extraLength = tampered.readUInt16LE(cursor + 30);
		const commentLength = tampered.readUInt16LE(cursor + 32);
		const name = tampered.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
		if (name === filename) {
			tampered.writeUInt32LE((tampered.readUInt32LE(cursor + 16) ^ 1) >>> 0, cursor + 16);
			return tampered;
		}
		cursor += 46 + nameLength + extraLength + commentLength;
	}
	throw new Error(`ZIP entry not found: ${filename}`);
}

export function encodedFile(filename: string, bytes: Buffer): Record<string, unknown> {
	return { filename, contentBase64: bytes.toString('base64') };
}
