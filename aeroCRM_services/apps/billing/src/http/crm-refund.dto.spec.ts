import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import {
	CrmRefundListQueryDto,
	RetryCrmRefundDto,
	ReviewCrmRefundDto
} from './crm-refund.dto';

const pipe = new ValidationPipe({
	transform: true,
	whitelist: true,
	forbidNonWhitelisted: true
});

describe('CRM refund HTTP DTO contracts', () => {
	it('defaults and bounds the paginated filter, with exact status enums', async () => {
		const defaults = await pipe.transform({}, { type: 'query', metatype: CrmRefundListQueryDto });
		expect(defaults).toMatchObject({ page: 1, limit: 20 });
		await expect(pipe.transform({ page: '1000000', limit: '100', reviewStatus: 'PENDING', verificationStatus: 'VERIFIED' },
			{ type: 'query', metatype: CrmRefundListQueryDto })).resolves.toMatchObject({ page: 1_000_000, limit: 100 });
		for (const invalid of [
			{ page: '0' }, { page: '1000001' }, { limit: '101' },
			{ reviewStatus: '' }, { reviewStatus: null }, { verificationStatus: 'UNKNOWN' }
		]) {
			await expect(pipe.transform(invalid, { type: 'query', metatype: CrmRefundListQueryDto })).rejects.toThrow();
		}
	});

	it('accepts only bounded v1 commands and permits multiline review notes', async () => {
		const command = { schemaVersion: 1, commandId: '11111111-1111-4111-8111-111111111111', expectedVersion: 1 };
		await expect(pipe.transform({ ...command, comment: ' Reviewed\nby finance ' },
			{ type: 'body', metatype: ReviewCrmRefundDto })).resolves.toMatchObject({ comment: 'Reviewed\nby finance' });
		await expect(pipe.transform(command, { type: 'body', metatype: RetryCrmRefundDto })).resolves.toBeDefined();
		for (const invalid of [
			{ ...command, schemaVersion: 2 }, { ...command, commandId: 'not-a-uuid' },
			{ ...command, expectedVersion: 0 }, { ...command, expectedVersion: 2_147_483_646 },
			{ ...command, extra: true }
		]) {
			await expect(pipe.transform(invalid, { type: 'body', metatype: RetryCrmRefundDto })).rejects.toThrow();
		}
		for (const comment of ['   ', `bad\tcomment`, 'x'.repeat(2_001)]) {
			await expect(pipe.transform({ ...command, comment }, { type: 'body', metatype: ReviewCrmRefundDto })).rejects.toThrow();
		}
	});
});
