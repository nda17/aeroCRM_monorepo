import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { MailAuthority } from './mail-authorization.client';
import { MailTemplatesService } from './mail-templates.service';
import { SaveMailTemplatesDto } from './mail-templates.dto';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const membershipId = '22222222-2222-4222-8222-222222222222';
const commandId = '33333333-3333-4333-8333-333333333333';
const templateId = '44444444-4444-4444-8444-444444444444';
const token = 'Bearer opaque-token';

const authority = (overrides: Partial<MailAuthority> = {}): MailAuthority => ({
	schemaVersion: 1,
	customer: {
		schemaVersion: 1,
		workspaceId,
		subject: 'employee-1',
		role: 'CRM_ADMIN',
		state: 'ACTIVE',
		dataScope: 'ALL',
		teamIds: [],
		permissions: []
	},
	membershipId,
	mailPermissions: ['mail:read', 'mail:manage'],
	...overrides
});
const dto = (): SaveMailTemplatesDto => ({
	schemaVersion: 1,
	workspaceId,
	commandId,
	expectedVersion: 0,
	templates: [{ id: templateId, title: ' Follow up ', subject: ' Next steps ', body: 'Hello\r\n\r\nThanks', archived: false }]
});

function fixture() {
	let settings: { workspaceId: string; version: number; templates: unknown } | null = null;
	const commands = new Map<string, Record<string, unknown>>();
	const tx = {
		$executeRaw: jest.fn().mockResolvedValue(1),
		mailTemplateSettings: {
			findUnique: jest.fn(async () => settings),
			create: jest.fn(async ({ data }) => { settings = data; return data; }),
			updateMany: jest.fn(async ({ where, data }) => {
				if (!settings || settings.version !== where.version) return { count: 0 };
				settings = { ...settings, version: settings.version + 1, templates: data.templates };
				return { count: 1 };
			})
		},
		mailTemplateCommand: {
			findUnique: jest.fn(async ({ where }) => commands.get(where.commandId) ?? null),
			create: jest.fn(async ({ data }) => { commands.set(data.commandId, data); return data; })
		}
	};
	const prisma = {
		$transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx))
	};
	const authorization = { authorize: jest.fn(async () => authority()) };
	return {
		service: new MailTemplatesService(prisma as never, authorization as never),
		tx,
		prisma,
		authorization,
		commands
	};
}

describe('MailTemplatesService', () => {
	it('saves normalized templates atomically and replays the matching receipt', async () => {
		const f = fixture();
		const input = dto();
		const first = await f.service.save(authority(), input, token);
		expect(first).toEqual({
			schemaVersion: 1,
			workspaceId,
			version: 1,
			templates: [{ id: templateId, title: 'Follow up', subject: 'Next steps', body: 'Hello\n\nThanks', archived: false }]
		});
		expect(f.tx.$executeRaw).toHaveBeenCalledTimes(2);
		expect(f.tx.mailTemplateCommand.create).toHaveBeenCalledTimes(1);
		expect(await f.service.save(authority(), input, token)).toEqual(first);
		expect(f.tx.mailTemplateSettings.create).toHaveBeenCalledTimes(1);
		expect(f.tx.mailTemplateCommand.create).toHaveBeenCalledTimes(1);
	});

	it('fails closed on stale version, wrong workspace, and closed workspace', async () => {
		const stale = fixture();
		await stale.service.save(authority(), dto(), token);
		await expect(stale.service.save(authority(), { ...dto(), commandId: '55555555-5555-4555-8555-555555555555' }, token)).rejects.toMatchObject({
			response: { code: 'crm_mail_templates_conflict' }
		});
		const wrongWorkspace = fixture();
		await expect(wrongWorkspace.service.save(authority(), { ...dto(), workspaceId: '55555555-5555-4555-8555-555555555555' }, token)).rejects.toBeInstanceOf(ForbiddenException);
		const closed = fixture();
		closed.tx.$executeRaw.mockRejectedValueOnce(new Error('workspace closed'));
		await expect(closed.service.save(authority(), dto(), token)).rejects.toThrow('workspace closed');
		expect(closed.tx.mailTemplateCommand.create).not.toHaveBeenCalled();
	});

	it('denies read-only and non-admin writers before persistence', async () => {
		const readOnly = fixture();
		await expect(readOnly.service.save(authority({
			customer: { ...authority().customer, state: 'READ_ONLY' }
		}), dto(), token)).rejects.toBeInstanceOf(ForbiddenException);
		const manager = fixture();
		await expect(manager.service.save(authority({
			customer: { ...authority().customer, role: 'MANAGER' }
		}), dto(), token)).rejects.toBeInstanceOf(ForbiddenException);
		expect(readOnly.prisma.$transaction).not.toHaveBeenCalled();
		expect(manager.prisma.$transaction).not.toHaveBeenCalled();
	});

	it('requires fresh authorization to preserve actor and membership and rejects receipt substitution', async () => {
		const changed = fixture();
		changed.authorization.authorize.mockResolvedValue(authority({ membershipId: '55555555-5555-4555-8555-555555555555' }));
		await expect(changed.service.save(authority(), dto(), token)).rejects.toBeInstanceOf(ForbiddenException);
		expect(changed.prisma.$transaction).not.toHaveBeenCalled();

		const replay = fixture();
		await replay.service.save(authority(), dto(), token);
		const prior = replay.commands.get(commandId)!;
		replay.commands.set(commandId, { ...prior, actorMembershipId: '55555555-5555-4555-8555-555555555555' });
		await expect(replay.service.save(authority(), dto(), token)).rejects.toMatchObject({
			response: { code: 'crm_mail_template_command_conflict' }
		});
	});

	it('treats malformed historical and replay receipts as unavailable', async () => {
		const historical = fixture();
		(historical as unknown as { tx: { mailTemplateSettings: { findUnique: jest.Mock } } }).tx.mailTemplateSettings.findUnique.mockResolvedValue({
			workspaceId,
			version: 1,
			templates: [{ id: templateId, title: 'ok', subject: 'ok', body: 'ok', archived: false, extra: true }]
		});
		await expect(historical.service.settings(authority(), workspaceId)).rejects.toBeInstanceOf(ServiceUnavailableException);

		const malformedReplay = fixture();
		await malformedReplay.service.save(authority(), dto(), token);
		malformedReplay.commands.set(commandId, { ...malformedReplay.commands.get(commandId), result: { schemaVersion: 2 } });
		await expect(malformedReplay.service.save(authority(), dto(), token)).rejects.toBeInstanceOf(ServiceUnavailableException);
	});
});
