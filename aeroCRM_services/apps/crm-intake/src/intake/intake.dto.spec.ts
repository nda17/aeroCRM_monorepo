import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import {
	CreateInboxEntryDto,
	CreateIntakeSourceDto,
	InboxListQuery,
	InboxProcessingQuery,
	RejectInboxEntryDto
} from './intake.dto';

const pipe = new ValidationPipe({
	transform: true,
	whitelist: true,
	forbidNonWhitelisted: true,
	validationError: { target: false, value: false }
});
const command = {
	schemaVersion: 1,
	workspaceId: randomUUID(),
	commandId: randomUUID(),
	title: 'Запрос',
	name: 'Анна'
};

describe('Intake DTO boundary', () => {
	it.each([
		{ title: ' ' },
		{ name: 'a'.repeat(201) },
		{ phone: '89000000001' },
		{ email: 'bad email' },
		{ message: 'a'.repeat(5001) },
		{ createdBySubject: 'other' },
		{ status: 'ACCEPTED' },
		{ contactId: randomUUID() },
		{ sourceId: randomUUID() }
	])('rejects invalid or forged manual command fields %j', override => {
		return expect(
			pipe.transform(
				{ ...command, ...override },
				{ type: 'body', metatype: CreateInboxEntryDto }
			)
		).rejects.toBeInstanceOf(BadRequestException);
	});
	it('requires version and rejection reason', async () => {
		await expect(
			pipe.transform(
				{
					schemaVersion: 1,
					workspaceId: command.workspaceId,
					commandId: command.commandId
				},
				{ type: 'body', metatype: RejectInboxEntryDto }
			)
		).rejects.toBeInstanceOf(BadRequestException);
	});
	it('bounds server pagination and allowed status filters', async () => {
		await expect(
			pipe.transform(
				{ workspaceId: command.workspaceId },
				{ type: 'query', metatype: InboxListQuery }
			)
		).resolves.toMatchObject({ page: 1, pageSize: 25 });
		for (const invalid of [
			{ page: 0 },
			{ pageSize: 101 },
			{ status: 'DONE' },
			{ workspaceId: [command.workspaceId] },
			{ search: 'a'.repeat(201) }
		])
			await expect(
				pipe.transform(
					{ workspaceId: command.workspaceId, ...invalid },
					{ type: 'query', metatype: InboxListQuery }
				)
			).rejects.toBeInstanceOf(BadRequestException);
	});
	it('allows only the opt-in shared read view and bounds processing UUID batches', async () => {
		await expect(
			pipe.transform(
				{ workspaceId: command.workspaceId, view: 'shared' },
				{ type: 'query', metatype: InboxListQuery }
			)
		).resolves.toMatchObject({ view: 'shared' });
		const entryIds = Array.from({ length: 100 }, () => randomUUID());
		await expect(
			pipe.transform(
				{
					workspaceId: command.workspaceId,
					view: 'shared',
					entryIds: entryIds.join(',')
				},
				{ type: 'query', metatype: InboxProcessingQuery }
			)
		).resolves.toMatchObject({ entryIds: entryIds.join(',') });
		for (const invalid of [
			{ view: 'all' },
			{ entryIds: '' },
			{ entryIds: `${randomUUID()},` },
			{ entryIds: Array.from({ length: 101 }, () => randomUUID()).join(',') },
			{ entryIds: 'not-a-uuid' }
		])
			await expect(
				pipe.transform(
					{
						workspaceId: command.workspaceId,
						entryIds: randomUUID(),
						...invalid
					},
					{ type: 'query', metatype: InboxProcessingQuery }
				)
			).rejects.toBeInstanceOf(BadRequestException);
	});
	it('never embeds a source credential in validation errors', async () => {
		const token = randomBytes(32).toString('base64url');
		try {
			await pipe.transform(
				{
					schemaVersion: 1,
					workspaceId: command.workspaceId,
					commandId: command.commandId,
					name: '',
					token,
					destinationUrl: 'https://external.example.test'
				},
				{ type: 'body', metatype: CreateIntakeSourceDto }
			);
			throw new Error('Validation must reject the input');
		} catch (error) {
			expect(error).toBeInstanceOf(BadRequestException);
			expect(
				JSON.stringify((error as BadRequestException).getResponse())
			).not.toContain(token);
		}
	});
});
