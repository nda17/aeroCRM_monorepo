import { InternalCommandsService } from './internal-commands.service';

const dto = {
	schemaVersion: 1,
	commandId: 'd9e3a88c-e82e-4b05-a895-f273a5582545',
	userId: 'owner-1',
	reason: 'USER_DEACTIVATION',
	actorId: 'admin-1',
	actorRole: 'ADMIN' as const,
	occurredAt: '2026-09-20T10:00:00.000Z'
};
const workspaceId = '817a23b1-3f56-42b2-81e1-ea61bcf96710';
const order = {
	id: '3a946037-cba8-4a97-a6c1-74a6e40dcd25',
	workspaceId,
	ownerSubject: dto.userId,
	status: 'PENDING',
	providerPaymentId: null
};

function fixture(sent: boolean) {
	const renewal = {
		workspaceId,
		status: 'ACTIVE',
		version: 4,
		paymentMethodCiphertext: 'v1:encrypted-provider-method'
	};
	const operation = {
		id: '3a946037-cba8-4a97-a6c1-74a6e40dcd26',
		status: 'PENDING',
		providerPaymentId: null,
		firstDispatchAt: sent ? new Date() : null,
		dispatchAttempt: sent ? 1 : 0
	};
	const tx = {
		$executeRaw: jest.fn().mockResolvedValue(1),
		crmCommerceAccount: {
			findMany: jest.fn().mockResolvedValue([{ workspaceId }]),
			update: jest.fn().mockResolvedValue({})
		},
		crmAutoRenewal: {
			findUnique: jest.fn().mockResolvedValue(renewal),
			update: jest.fn().mockResolvedValue({ ...renewal, status: 'REVOKED', version: 5 })
		},
		crmAutoRenewalConsent: { create: jest.fn().mockResolvedValue({}) },
		crmOrder: {
			findMany: jest.fn().mockResolvedValue([order]),
			update: jest.fn().mockResolvedValue({})
		},
		crmProviderOperation: {
			findFirst: jest.fn().mockResolvedValue(operation),
			update: jest.fn().mockResolvedValue({})
		},
		crmCommerceCommand: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
		outboxEvent: { create: jest.fn().mockResolvedValue({}) }
	};
	return tx;
}

describe('CRM owner deactivation payment fence', () => {
	it('revokes renewal while preserving ciphertext and cancels a never-dispatched order', async () => {
		const tx = fixture(false);
		const service = new InternalCommandsService({} as never);
		const result = await (service as any).revokeCrmOwner(tx, dto);
		expect(result).toMatchObject({ revokedRenewals: 1, cancelledOrders: 1, unknownOrders: 0 });
		expect(tx.crmCommerceAccount.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerSubject: dto.userId } }));
		expect(tx.crmAutoRenewal.update.mock.calls[0][0].data).toMatchObject({ status: 'REVOKED', dispatchPending: false });
		expect(tx.crmAutoRenewal.update.mock.calls[0][0].data).not.toHaveProperty('paymentMethodCiphertext');
		expect(tx.crmOrder.update.mock.calls[0][0].data).toMatchObject({ status: 'CANCELLED', autoRenew: false, confirmationUrl: null });
		expect(tx.crmProviderOperation.update.mock.calls[0][0].data).toMatchObject({ status: 'FAILED', leaseToken: null });
		expect(tx.crmAutoRenewalConsent.create).toHaveBeenCalledTimes(1);
		expect(tx.outboxEvent.create).toHaveBeenCalledTimes(1);
	});

	it('keeps a potentially dispatched order for reconciliation and prevents renewal resurrection', async () => {
		const tx = fixture(true);
		const service = new InternalCommandsService({} as never);
		const result = await (service as any).revokeCrmOwner(tx, dto);
		expect(result).toMatchObject({ cancelledOrders: 0, unknownOrders: 1 });
		expect(tx.crmOrder.update.mock.calls[0][0].data).toMatchObject({ status: 'UNKNOWN', autoRenew: false, confirmationUrl: null });
		expect(tx.crmProviderOperation.update.mock.calls[0][0].data).toMatchObject({ status: 'UNKNOWN' });
		expect(tx.crmCommerceCommand.updateMany).not.toHaveBeenCalled();
	});
});
