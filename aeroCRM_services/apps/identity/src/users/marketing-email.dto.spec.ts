import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { MarketingEmailCommandDto } from './marketing-email.dto';

const pipe = new ValidationPipe({
	transform: true,
	whitelist: true,
	forbidNonWhitelisted: true
});

describe('marketing email command DTO contract', () => {
	const command = {
		schemaVersion: 1,
		commandId: '11111111-1111-4111-8111-111111111111',
		expectedVersion: 0,
		expectedEmailBinding: null,
		enabled: true,
		consentTextVersion: 'marketing-email-v1'
	};

	it('accepts a nullable binding and the documented version bounds', async () => {
		await expect(pipe.transform(command, { type: 'body', metatype: MarketingEmailCommandDto })).resolves.toMatchObject(command);
		await expect(pipe.transform({ ...command, expectedVersion: 2_147_483_646,
			expectedEmailBinding: 'a'.repeat(64) }, { type: 'body', metatype: MarketingEmailCommandDto })).resolves.toBeDefined();
	});

	it('rejects malformed commands, missing fields, and unrecognized properties', async () => {
		const missingBinding: Record<string, unknown> = { ...command };
		delete missingBinding.expectedEmailBinding;
		for (const invalid of [
			{ ...command, schemaVersion: 2 }, { ...command, commandId: 'bad' },
			{ ...command, expectedVersion: -1 }, { ...command, expectedVersion: 2_147_483_647 },
			{ ...command, expectedEmailBinding: 'bad' }, { ...command, enabled: 'true' },
			{ ...command, extra: 1 }, missingBinding
		]) {
			await expect(pipe.transform(invalid, { type: 'body', metatype: MarketingEmailCommandDto })).rejects.toThrow();
		}
	});
});
