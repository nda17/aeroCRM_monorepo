import { CrmCommerceService } from './crm-commerce.service';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const orderId = '22222222-2222-4222-8222-222222222222';
const commandId = '33333333-3333-4333-8333-333333333333';
const operationId = '44444444-4444-4444-8444-444444444444';
const eventId = '55555555-5555-4555-8555-555555555555';
const leaseToken = '66666666-6666-4666-8666-666666666666';
const now = new Date();
const priceSnapshot = {
	policyVersion: 1,
	monthlyPriceMinor: 99000,
	yearlyPriceMinor: 990000,
	additionalSeatMonthlyPriceMinor: 29000,
	additionalSeatYearlyPriceMinor: 290000,
	includedSeats: 2,
	graceDays: 3
};

describe('Billing late success after workspace closure', () => {
	it('records a captured payment without reactivating entitlement or creating renewal when no renewal row exists', async () => {
		const paidOrder = {
			id: orderId,
			workspaceId,
			ownerSubject: 'owner-1',
			commandId,
			capacityCommandId: commandId,
			capacityFence: { operationId: commandId, requestHash: 'a'.repeat(64), fenceRevision: 1, targetSeats: 2 },
			version: 1,
			kind: 'RECURRING',
			status: 'PENDING',
			cycle: 'MONTHLY',
			totalSeats: 2,
			amountMinor: 99000n,
			currency: 'RUB',
			policyVersion: 1,
			priceSnapshot,
			autoRenew: true,
			consentVersion: 1,
			consentText: 'renew monthly',
			consentedAt: now,
			customerEmail: 'owner@example.test',
			customerPhone: null,
			providerPaymentId: null,
			providerIdempotencyKey: 'b'.repeat(64),
			providerStatus: null,
			confirmationUrl: null,
			checkoutExpiresAt: new Date(now.getTime() + 60_000),
			succeededAt: null,
			cancellationReason: null,
			recurringCycleKey: 'renewal-cycle-1',
			recurringAttempt: 1,
			expectedRenewalVersion: 1,
			createdAt: now,
			updatedAt: now
		};
		const operation = {
			id: operationId,
			workspaceId,
			orderId,
			kind: 'CREATE',
			status: 'PROCESSING',
			version: 2,
			idempotencyKey: 'c'.repeat(64),
			providerPaymentId: null,
			firstDispatchAt: now,
			dispatchAttempt: 1,
			retryAttempt: 0,
			availableAt: now,
			leaseToken,
			leaseUntil: new Date(Date.now() + 60_000),
			pendingEventId: eventId,
			outboxId: eventId,
			requestSnapshot: {},
			lastErrorCode: null,
			createdAt: now,
			updatedAt: now,
			order: paidOrder
		};
		const tx = {
			$executeRaw: jest.fn().mockResolvedValue(1),
			$queryRaw: jest.fn().mockResolvedValue([{ closed: true }]),
			crmProviderOperation: {
				findUnique: jest.fn().mockResolvedValue(null),
				findUniqueOrThrow: jest.fn().mockResolvedValue(operation),
				create: jest.fn().mockImplementation(async ({ data }) => ({ ...data, version: 1 })),
				update: jest.fn().mockResolvedValue({}),
				updateMany: jest.fn().mockResolvedValue({ count: 1 })
			},
			crmProviderDelivery: {
				upsert: jest.fn().mockResolvedValue({}),
				update: jest.fn().mockResolvedValue({})
			},
			crmOrder: {
				update: jest.fn().mockImplementation(async ({ data }) => ({ ...paidOrder, ...data, version: 2 }))
			},
			crmCommerceAccount: {
				findUniqueOrThrow: jest.fn().mockResolvedValue({ workspaceId, ownerSubject: 'owner-1', version: 1n }),
				update: jest.fn().mockResolvedValue({})
			},
			crmPaidPeriod: {
				findFirst: jest.fn().mockResolvedValue(null),
				create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'paid-period-1', ...data }))
			},
			crmEntitlement: {
				findUnique: jest.fn().mockResolvedValue(null),
				create: jest.fn().mockResolvedValue({})
			},
			crmCommerceCommand: {
				findUniqueOrThrow: jest.fn().mockResolvedValue({ commandId, commandType: 'CRM_RENEWAL', requestHash: 'd'.repeat(64) }),
				update: jest.fn().mockResolvedValue({})
			},
			crmAutoRenewal: {
				findUnique: jest.fn().mockResolvedValue(null),
				upsert: jest.fn().mockResolvedValue({}),
				update: jest.fn().mockResolvedValue({})
			},
			billingCommandReceipt: { create: jest.fn().mockResolvedValue({}) },
			billingSourceSequence: { upsert: jest.fn().mockResolvedValue({ nextValue: 2n }) },
			outboxEvent: { create: jest.fn().mockResolvedValue({}) }
		};
		const prisma = {
			...tx,
			crmProviderOperation: tx.crmProviderOperation,
			$transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx))
		};
		const service = new CrmCommerceService(prisma as never, { encrypt: jest.fn() } as never);

		await service.settleProviderOperation(
			{ operationId, eventId, leaseToken, version: 2 },
			{
				id: 'provider-payment-1',
				metadata: {
					productCode: 'AEROCRM',
					paymentId: orderId,
					plan: 'AEROCRM',
					billingPeriod: 'MONTHLY',
					kind: 'RECURRING'
				},
				amount: { currency: 'RUB', value: '990.00' },
				status: 'succeeded',
				paid: true,
				captured_at: now.toISOString()
			}
		);

		expect(tx.crmOrder.update).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCEEDED' }) })
		);
		expect(tx.crmPaidPeriod.create).toHaveBeenCalledTimes(1);
		expect(tx.crmEntitlement.create).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ status: 'SUSPENDED' }) })
		);
		expect(tx.crmAutoRenewal.findUnique).toHaveBeenCalledWith({ where: { workspaceId } });
		expect(tx.crmAutoRenewal.upsert).not.toHaveBeenCalled();
		expect(tx.crmAutoRenewal.update).not.toHaveBeenCalled();
	});
});
