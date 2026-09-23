import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { semanticHash } from '../team/team.util';
import {
	closureParticipants,
	WorkspaceClosureService
} from './workspace-closure.service';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const commandId = '22222222-2222-4222-8222-222222222222';
const ownerMembershipId = '33333333-3333-4333-8333-333333333333';
const command = {
	schemaVersion: 1 as const,
	commandId,
	workspaceId,
	expectedVersion: '0' as const,
	confirmationLabel: 'Студия Север'
};

function harness(options: { enabled?: boolean; existing?: any } = {}) {
	let row: any = options.existing ?? null;
	const findClosure = jest.fn(async ({ where }: { where: Record<string, string> }) => {
		if ('workspaceId' in where) return row?.workspaceId === where.workspaceId ? row : null;
		if ('commandId' in where) return row?.commandId === where.commandId ? row : null;
		if ('id' in where) return row?.id === where.id ? row : null;
		return null;
	});
	const updateMany = jest.fn(async () => ({ count: 1 }));
	const tx = {
		$executeRaw: jest.fn(),
		crmWorkspaceClosure: {
			findUnique: findClosure,
			create: jest.fn(async ({ data }: { data: Record<string, any> }) => {
				row = {
					id: '44444444-4444-4444-8444-444444444444',
					generation: 1n,
					version: 1n,
					leaseToken: null,
					leaseUntil: null,
					financialPendingCount: 0,
					priorDispatchCount: 0,
					lastErrorCode: null,
					closedAt: null,
					...data
				};
				return row;
			}),
			updateMany
		},
		crmWorkspaceBranding: {
			findUnique: jest.fn().mockResolvedValue({ displayName: 'Студия Север' })
		},
		crmWorkspaceAccess: {
			findUnique: jest.fn().mockResolvedValue({ lifecycle: 'ACTIVE' }),
			update: jest.fn()
		},
		crmInvitationIntent: { updateMany: jest.fn() },
		crmAdmission: { updateMany: jest.fn() },
		workspaceClosureFence: { update: jest.fn() },
		crmTeamAudit: { create: jest.fn() }
	};
	const prisma = {
		crmWorkspaceClosure: { findUnique: findClosure, updateMany },
		crmWorkspaceBranding: {
			findUnique: jest.fn().mockResolvedValue({ displayName: 'Студия Север' })
		},
		$transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx))
	};
	const identity = {
		authContext: jest.fn(async (authorization?: string) => ({
			subject: authorization === 'Bearer stranger' ? 'stranger' : 'owner'
		})),
		ownerContext: jest.fn(async (_workspace: string, subject: string) => ({
			ownerSubject: 'owner',
			membership: {
				membershipId: ownerMembershipId,
				role: subject === 'owner' ? 'OWNER' : 'MEMBER'
			}
		})),
		closureOwnerContext: jest.fn(async () => ({ membershipId: ownerMembershipId }))
	};
	const config = {
		get: jest.fn().mockReturnValue(options.enabled === false ? 'false' : 'true')
	} as unknown as ConfigService;
	return {
		service: new WorkspaceClosureService(prisma as never, identity as never, config),
		prisma,
		tx,
		identity,
		row: () => row
	};
}

describe('WorkspaceClosureService durable owner command', () => {
	it('confirms the exact owner label, replays the same command, and rejects changed hashes', async () => {
		const h = harness();
		await expect(
			h.service.create('Bearer owner', { ...command, confirmationLabel: 'Wrong name' })
		).rejects.toBeInstanceOf(ConflictException);
		expect(h.tx.crmWorkspaceClosure.create).not.toHaveBeenCalled();
		expect(h.tx.workspaceClosureFence.update).not.toHaveBeenCalled();

		const created = await h.service.create('Bearer owner', command);
		expect(created.closure).toMatchObject({
			workspaceId,
			displayName: 'Студия Север',
			state: 'CLOSING'
		});
		expect(
			h.tx.$executeRaw.mock.calls.some(([query]) =>
				String(query).includes('crm_access.assert_workspace_open')
			)
		).toBe(true);
		expect(h.tx.workspaceClosureFence.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { workspaceId },
				data: expect.objectContaining({ closureId: created.closure.id, ownerSubject: 'owner' })
			})
		);

		const replay = await h.service.create('Bearer owner', command);
		expect(replay.closure.id).toBe(created.closure.id);
		expect(h.prisma.$transaction).toHaveBeenCalledTimes(2);
		expect(h.prisma.crmWorkspaceClosure.updateMany).toHaveBeenCalledWith({
			where: { id: created.closure.id, state: 'CLOSING' },
			data: { nextAttemptAt: expect.any(Date) }
		});

		await expect(
			h.service.create('Bearer owner', {
				...command,
				confirmationLabel: 'Changed confirmation'
			})
		).rejects.toBeInstanceOf(ConflictException);
		await expect(h.service.create('Bearer stranger', command)).rejects.toBeInstanceOf(
			ForbiddenException
		);
	});

	it('resumes the same durable command while new admission is disabled', async () => {
		const requestedAt = new Date('2026-09-23T12:00:00.000Z');
		const h = harness({
			enabled: false,
			existing: {
				id: '44444444-4444-4444-8444-444444444444',
				workspaceId,
				commandId,
				ownerSubject: 'owner',
				ownerMembershipId,
				requestHash: semanticHash({ subject: 'owner', command }),
				displayNameSnapshot: 'Студия Север',
				state: 'CLOSING',
				version: 3n,
				participants: closureParticipants(requestedAt.toISOString()),
				requestedAt,
				closedAt: null,
				financialPendingCount: 0,
				priorDispatchCount: 0,
				lastErrorCode: null
			}
		});
		expect(h.service.admissionEnabled).toBe(false);
		const resumed = await h.service.create('Bearer owner', command);
		expect(resumed.closure).toMatchObject({ id: h.row().id, state: 'CLOSING' });
		expect(h.prisma.$transaction).not.toHaveBeenCalled();
		expect(h.prisma.crmWorkspaceClosure.updateMany).toHaveBeenCalledWith({
			where: { id: h.row().id, state: 'CLOSING' },
			data: { nextAttemptAt: expect.any(Date) }
		});
	});
});
