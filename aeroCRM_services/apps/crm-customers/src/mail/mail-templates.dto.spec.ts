import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SaveMailTemplatesDto } from './mail-templates.dto';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const commandId = '22222222-2222-4222-8222-222222222222';
const templateId = '33333333-3333-4333-8333-333333333333';
const valid = () => ({
	schemaVersion: 1,
	workspaceId,
	commandId,
	expectedVersion: 0,
	templates: [{
		id: templateId,
		title: 'Follow up',
		subject: 'Next steps',
		body: 'Hello,\n\nThanks',
		archived: false
	}]
});
const errors = (input: object) => validate(plainToInstance(SaveMailTemplatesDto, input), {
	whitelist: true,
	forbidNonWhitelisted: true
});

describe('SaveMailTemplatesDto', () => {
	it('accepts a complete schema-v1 command and an empty template collection', async () => {
		expect(await errors(valid())).toHaveLength(0);
		expect(await errors({ ...valid(), templates: [] })).toHaveLength(0);
	});

	it.each([
		{ schemaVersion: undefined },
		{ schemaVersion: 2 },
		{ workspaceId: undefined },
		{ workspaceId: 'not-a-uuid' },
		{ commandId: undefined },
		{ expectedVersion: undefined },
		{ expectedVersion: -1 },
		{ expectedVersion: 2147483647 },
		{ expectedVersion: 1.5 },
		{ templates: undefined },
		{ unexpected: true }
	])('rejects missing, unsupported, or malformed command fields: %o', async patch => {
		expect(await errors({ ...valid(), ...patch })).not.toHaveLength(0);
	});

	it.each([
		{ id: undefined },
		{ id: '33333333-3333-3333-8333-333333333333' },
		{ title: undefined },
		{ title: ' \t ' },
		{ title: 'bad\nline' },
		{ subject: 'bad\r\nBcc: x@example.org' },
		{ body: ' \n ' },
		{ body: 'bad\u0001text' },
		{ archived: undefined },
		{ archived: 'false' },
		{ extra: 'rejected' }
	])('validates each nested template field without optional gaps: %o', async patch => {
		const template = { ...valid().templates[0], ...patch };
		expect(await errors({ ...valid(), templates: [template] })).not.toHaveLength(0);
	});

	it('enforces text bounds and the 100-template maximum', async () => {
		expect(await errors({ ...valid(), templates: [{ ...valid().templates[0], title: 'x'.repeat(201) }] })).not.toHaveLength(0);
		expect(await errors({ ...valid(), templates: [{ ...valid().templates[0], subject: 'x'.repeat(301) }] })).not.toHaveLength(0);
		expect(await errors({ ...valid(), templates: [{ ...valid().templates[0], body: 'x'.repeat(4001) }] })).not.toHaveLength(0);
		expect(await errors({ ...valid(), templates: Array.from({ length: 101 }, (_, i) => ({ ...valid().templates[0], id: `33333333-3333-4333-8333-${String(i).padStart(12, '0')}` })) })).not.toHaveLength(0);
	});
});
