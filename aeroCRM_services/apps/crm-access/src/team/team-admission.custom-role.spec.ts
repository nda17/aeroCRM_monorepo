import { randomUUID } from 'node:crypto';
import { CrmTeamAdmissionService } from './team-admission.service';

describe('CRM CUSTOM invitation admission safety', () => {
	it('revokes a registration when the bound role is archived after Identity registration', async () => {
		const workspaceId = randomUUID();
		const invitationId = randomUUID();
		const customRoleId = randomUUID();
		const intent = {
			id: invitationId,
			workspaceId,
			status: 'REGISTERING',
			role: 'CUSTOM',
			customRoleId,
			inviterSubject: 'owner',
			expiresAt: new Date(Date.now() + 60_000),
			version: 3
		};
		const updateMany = jest.fn();
		const prisma = {
			crmInvitationIntent: {
				findFirst: jest.fn().mockResolvedValue(intent),
				findUniqueOrThrow: jest
					.fn()
					.mockResolvedValue({ ...intent, status: 'REVOKED' }),
				updateMany
			},
			crmCustomRole: {
				findFirst: jest
					.fn()
					.mockResolvedValueOnce({ id: customRoleId })
					.mockResolvedValueOnce(null)
			},
			$executeRaw: jest.fn(),
			$transaction: jest
				.fn()
				.mockImplementation(async callback => callback(prisma))
		};
		const invitations = {
			create: jest.fn().mockResolvedValue({ version: 8 }),
			revoke: jest.fn().mockResolvedValue(undefined)
		};
		const service = new CrmTeamAdmissionService(
			prisma as never,
			{
				authorizeSubject: jest.fn().mockResolvedValue({
					workspaceId,
					subject: 'owner',
					role: 'OWNER',
					state: 'ACTIVE',
					permissions: ['access:manage-team']
				})
			} as never,
			{} as never,
			{} as never,
			invitations as never,
			{ manageRole: jest.fn() } as never,
			{} as never
		);

		await service.provision(workspaceId, invitationId);

		expect(updateMany).toHaveBeenCalledWith({
			where: {
				id: invitationId,
				workspaceId,
				status: 'REGISTERING',
				version: 3
			},
			data: expect.objectContaining({
				status: 'REVOKED',
				version: { increment: 1 },
				revokeCommandId: expect.stringMatching(
					/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
				)
			})
		});
		expect(invitations.revoke).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'REVOKED' })
		);
	});
});
