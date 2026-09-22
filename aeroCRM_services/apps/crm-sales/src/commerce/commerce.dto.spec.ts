import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
	AddPaymentDto,
	CatalogCreateDto,
	CatalogUpdateDto,
	CommerceExportQuery,
	CommerceHistoryQuery,
	CommerceListQuery,
	CommercePeriodQuery,
	CreateQuoteDto,
	ImportPreviewDto,
	ReplaceDealLinesDto
} from './commerce.dto';
import { lineTotal, minor, quantityMilli } from './commerce-core';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const commandId = '22222222-2222-4222-8222-222222222222';
const pipe = new ValidationPipe({
	whitelist: true,
	forbidNonWhitelisted: true,
	forbidUnknownValues: true,
	transform: true
});
const parse = <T>(
	value: object,
	metatype: new () => T,
	type: 'body' | 'query' = 'body'
) => pipe.transform(value, { type, metatype });

describe('commerce request DTOs', () => {
	it('rejects unknown body keys, invalid UUIDs, absent command versions and invalid workspace values', async () => {
		const base = {
			schemaVersion: 1,
			workspaceId,
			commandId,
			kind: 'PRODUCT',
			name: 'Услуга',
			unit: 'час',
			basePriceMinor: null
		};
		await expect(
			parse({ ...base, surprise: true }, CatalogCreateDto)
		).rejects.toBeInstanceOf(BadRequestException);
		await expect(
			parse({ ...base, commandId: 'invalid' }, CatalogCreateDto)
		).rejects.toBeInstanceOf(BadRequestException);
		await expect(
			parse(
				{ ...base, workspaceId: '33333333-3333-3333-3333-333333333333' },
				CatalogCreateDto
			)
		).rejects.toBeInstanceOf(BadRequestException);
		await expect(
			parse({ ...base, schemaVersion: 2 }, CatalogCreateDto)
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it('accepts explicit null catalog price and explicit zero money', async () => {
		await expect(
			parse(
				{
					schemaVersion: 1,
					workspaceId,
					commandId,
					kind: 'SERVICE',
					name: 'Консультация',
					unit: 'услуга',
					basePriceMinor: null
				},
				CatalogCreateDto
			)
		).resolves.toMatchObject({ basePriceMinor: null });
		await expect(
			parse(
				{
					schemaVersion: 1,
					workspaceId,
					commandId,
					expectedVersion: 1,
					lines: [],
					manualAmountMinor: 0
				},
				ReplaceDealLinesDto
			)
		).resolves.toMatchObject({ manualAmountMinor: 0 });
	});

	it('accepts a catalog kind change and rejects unsupported kinds', async () => {
		const command = {
			schemaVersion: 1,
			workspaceId,
			commandId,
			expectedVersion: 1,
			name: 'Кабель',
			unit: 'шт.'
		};
		await expect(
			parse({ ...command, kind: 'SERVICE' }, CatalogUpdateDto)
		).resolves.toMatchObject({ kind: 'SERVICE' });
		await expect(
			parse({ ...command, kind: 'UNKNOWN' }, CatalogUpdateDto)
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it('strictly validates nested lines, comments, quote details, and import mappings', async () => {
		const command = { schemaVersion: 1, workspaceId, commandId };
		await expect(
			parse(
				{ ...command, sellerName: 'Seller', sellerDetails: null },
				CreateQuoteDto
			)
		).rejects.toBeInstanceOf(BadRequestException);
		await expect(
			parse(
				{
					...command,
					kind: 'RECEIPT',
					amountMinor: 1,
					occurredAt: '2026-09-23T10:00:00.000Z',
					comment: null
				},
				AddPaymentDto
			)
		).rejects.toBeInstanceOf(BadRequestException);
		await expect(
			parse(
				{
					...command,
					expectedVersion: 1,
					lines: [
						{
							kind: 'SERVICE',
							name: 'Услуга',
							unit: 'час',
							quantity: '0.001',
							unitPriceMinor: 100,
							extra: true
						}
					]
				},
				ReplaceDealLinesDto
			)
		).rejects.toBeInstanceOf(BadRequestException);
		await expect(
			parse(
				{
					workspaceId,
					filename: 'catalog.csv',
					contentBase64: 'Y29kZSxraW5k',
					sheet: null,
					mapping: { code: 'code', kind: 'kind', name: 'name', unit: 'unit' }
				},
				ImportPreviewDto
			)
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it('rejects unexpected query fields and ambiguous boolean query values', async () => {
		await expect(
			parse(
				{ workspaceId, page: '2', unexpected: '1' },
				CommerceListQuery,
				'query'
			)
		).rejects.toBeInstanceOf(BadRequestException);
		for (const includeArchived of ['false', 'TRUE', '', null, true])
			await expect(
				parse({ workspaceId, includeArchived }, CommerceListQuery, 'query')
			).rejects.toBeInstanceOf(BadRequestException);
		await expect(
			parse({ workspaceId, format: 'xml' }, CommerceExportQuery, 'query')
		).rejects.toBeInstanceOf(BadRequestException);
		await expect(
			parse({ workspaceId, dealId: null }, CommerceHistoryQuery, 'query')
		).rejects.toBeInstanceOf(BadRequestException);
		await expect(
			parse(
				{ workspaceId, from: '2026-09-01', to: '2026-09-02' },
				CommercePeriodQuery,
				'query'
			)
		).rejects.toBeInstanceOf(BadRequestException);
	});
});

describe('commerce money arithmetic', () => {
	it.each([
		['0.001', '1'],
		['1.2', '1200'],
		['999999999.999', '999999999999']
	])('parses exact quantity %s', (value, milli) => {
		expect(quantityMilli(value).toString()).toBe(milli);
	});

	it.each(['0', '00.1', '1.0000', '-1', '1e2', '1000000000'])(
		'rejects invalid quantity %s',
		value => {
			expect(() => quantityMilli(value)).toThrow(BadRequestException);
		}
	);

	it('rounds half up in integer arithmetic, applies discounts, and retains explicit zero', () => {
		expect(lineTotal('0.001', 500, 0)).toBe(1);
		expect(lineTotal('1.005', 100, 0)).toBe(101);
		expect(lineTotal('2.500', 101, 2)).toBe(251);
		expect(minor(0, 'Цена')).toBe(0);
		expect(minor(null, 'Цена', true)).toBeNull();
	});

	it('rejects negative discount effect and safe integer overflow', () => {
		expect(() => lineTotal('1', 100, 101)).toThrow(BadRequestException);
		expect(() => lineTotal('999999999.999', 2147483647, 0)).toThrow(
			BadRequestException
		);
		expect(() => minor(2147483648, 'Цена')).toThrow(BadRequestException);
	});
});
