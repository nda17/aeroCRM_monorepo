import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MailIntakeService } from './mail-intake.service';

describe('MailIntakeService processing lookup', () => {
	it('reauthorizes the source message and withholds a private copied entry ID', async () => {
		const workspaceId = randomUUID();
		const messageId = randomUUID();
		const entryId = randomUUID();
		const context = {
			schemaVersion: 1 as const,
			workspaceId,
			subject: 'staff-reader',
			role: 'EMPLOYEE' as const,
			state: 'ACTIVE' as const,
			dataScope: 'OWN' as const,
			teamIds: [],
			permissions: ['intake:read']
		};
		const source = {
			entryId,
			actorSubject: 'staff-copying',
			createdAt: new Date('2026-10-12T10:00:00.000Z')
		};
		const authorization = {
			authorize: jest.fn().mockResolvedValue(context)
		};
		const mail = {
			source: jest.fn().mockResolvedValue({ schemaVersion: 1 })
		};
		const tx = {
			inboxEntry: { findFirst: jest.fn().mockResolvedValue(null) },
			acceptance: { findFirst: jest.fn().mockResolvedValue(null) }
		};
		const prisma = {
			mailIntakeSource: {
				findUnique: jest.fn().mockResolvedValue(source)
			},
			...tx,
			$transaction: jest.fn(input => Promise.all(input))
		};
		const service = new MailIntakeService(
			prisma as never,
			authorization as never,
			mail as never
		);

		await expect(
			service.processing('Bearer user', workspaceId, messageId)
		).resolves.toEqual({
			schemaVersion: 1,
			workspaceId,
			messageId,
			copy: {
				entryId: null,
				canOpen: false,
				actorSubject: source.actorSubject,
				createdAt: source.createdAt.toISOString(),
				acceptance: null
			}
		});
		expect(mail.source).toHaveBeenCalledWith(
			'Bearer user',
			workspaceId,
			messageId,
			context.subject
		);
		expect(tx.inboxEntry.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					AND: [
						expect.objectContaining({
							workspaceId,
							createdBySubject: context.subject
						}),
						{ id: entryId }
					]
				}
			})
		);
	});

	it('returns no copy facts when source reauthorization fails', async () => {
		const workspaceId = randomUUID();
		const messageId = randomUUID();
		const authorization = {
			authorize: jest.fn().mockResolvedValue({
				schemaVersion: 1,
				workspaceId,
				subject: 'staff',
				role: 'EMPLOYEE',
				state: 'ACTIVE',
				dataScope: 'ALL',
				teamIds: [],
				permissions: ['intake:read']
			})
		};
		const mail = {
			source: jest.fn().mockRejectedValue(new ForbiddenException())
		};
		const prisma = {
			mailIntakeSource: { findUnique: jest.fn() },
			$transaction: jest.fn()
		};
		const service = new MailIntakeService(
			prisma as never,
			authorization as never,
			mail as never
		);

		await expect(
			service.processing('Bearer user', workspaceId, messageId)
		).rejects.toBeInstanceOf(ForbiddenException);
		expect(prisma.mailIntakeSource.findUnique).not.toHaveBeenCalled();
	});
});
