import {
	BadRequestException,
	ConflictException,
	NotFoundException
} from '@nestjs/common';
import { CrmAdminSubscriptionService } from './crm-admin-subscription.service';
import type { BillingActor } from '../auth/billing-request';
import type { SetCrmSubscriptionSeatsDto } from '../http/crm-admin-subscription.dto';
import { billingCommandRequestHash } from './billing-command-idempotency';

const W = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';
const actor = (subject = 'admin@example'): BillingActor =>
	({
		subject,
		active: true,
		sessionId: 'session',
		roles: ['ADMIN']
	}) as BillingActor;
const dto = (patch: Partial<SetCrmSubscriptionSeatsDto> = {}) =>
	({
		schemaVersion: 1 as const,
		commandId: C,
		expectedActorSubject: 'admin@example',
		expectedEntitlementVersion: '1',
		expectedBillingVersion: '0',
		expectedPeriodId: null,
		expectedPeriodVersion: null,
		totalSeats: 8,
		reason: 'Set administrative seat limit',
		...patch
	}) as SetCrmSubscriptionSeatsDto;

function harness(options: {
	receipt?: Record<string, unknown> | null;
	state?: Record<string, unknown>;
}) {
	const access = {
		context: jest.fn().mockResolvedValue({
			usedSeats: 2,
			pendingOperationId: null
		}),
		prepare: jest.fn(),
		synchronize: jest.fn()
	};
	const prisma: Record<string, any> = {
		$transaction: jest.fn(async (work: (tx: unknown) => unknown) =>
			work(prisma)
		),
		$executeRaw: jest.fn().mockResolvedValue(1),
		billingCommandReceipt: {
			findUnique: jest.fn().mockResolvedValue(options.receipt ?? null)
		},
		crmAdminSeatAdjustment: {
			findUniqueOrThrow: jest.fn()
		}
	};
	const service = new CrmAdminSubscriptionService(
		prisma as never,
		access as never
	);
	if (options.state)
		(service as unknown as { seatState: jest.Mock }).seatState = jest
			.fn()
			.mockResolvedValue(options.state);
	return { service, access, prisma };
}

async function expectCode(action: () => Promise<unknown>, code: string) {
	try {
		await action();
		throw new Error(`Expected ${code}`);
	} catch (error) {
		expect(error).toBeInstanceOf(ConflictException);
		expect((error as ConflictException).getResponse()).toMatchObject({ code });
	}
}

describe('CRM administrative seat command safety', () => {
	it('replays an exact receipt before reading current CAS or preparing another access operation', async () => {
		const command = dto({ totalSeats: 9 });
		const requestHash = billingCommandRequestHash('ADMIN_SET_AEROCRM_SEATS', {
			...command,
			workspaceId: W,
			actorSubject: 'admin@example'
		});
		const receipt = {
			commandType: 'ADMIN_SET_AEROCRM_SEATS',
			requestHash,
			requestHashVersion: 1,
			result: { schemaVersion: 1, workspaceId: W, commandId: C }
		};
		const h = harness({ receipt });

		await expect(
			h.service.setSeats(W, command, { actor: actor() })
		).resolves.toEqual(receipt.result);
		expect(h.access.context).not.toHaveBeenCalled();
		expect(h.access.prepare).not.toHaveBeenCalled();
		expect(h.prisma.$transaction).not.toHaveBeenCalled();
	});

	it('rejects actor drift and an unpaired period CAS before any read or access write', async () => {
		const h = harness({});
		await expectCode(
			() =>
				h.service.setSeats(W, dto(), { actor: actor('different@example') }),
			'crm_admin_subscription_actor_changed'
		);
		await expect(
			h.service.setSeats(
				W,
				dto({ expectedPeriodId: C }),
				{ actor: actor() }
			)
		).rejects.toBeInstanceOf(BadRequestException);
		expect(h.prisma.billingCommandReceipt.findUnique).not.toHaveBeenCalled();
		expect(h.access.context).not.toHaveBeenCalled();
	});

	it('enforces both entitlement and billing CAS versions before reserving capacity', async () => {
		const h = harness({
			state: {
				subscription: {
					entitlementVersion: '2',
					billingVersion: '3',
					period: null
				},
				minimumSeats: 2,
				currentTotalSeats: 6,
				blockedReason: null
			}
		});

		await expectCode(
			() => h.service.setSeats(W, dto(), { actor: actor() }),
			'crm_admin_subscription_version_conflict'
		);
		expect(h.access.prepare).not.toHaveBeenCalled();
	});

	it.each([
		['occupied floor', 'crm_admin_seats_below_minimum', { totalSeats: 4 }],
		['renewal active', 'crm_admin_seats_renewal_active', { totalSeats: 9 }],
		['pending operation', 'crm_admin_subscription_operation_pending', { totalSeats: 9 }],
		['unchanged target', 'crm_admin_seats_unchanged', { totalSeats: 6 }]
	])(
		'rejects %s without creating a second durable operation',
		async (_label, code, patch) => {
			const h = harness({
				state: {
					subscription: {
						entitlementVersion: '1',
						billingVersion: '0',
						period: null
					},
					minimumSeats: patch.totalSeats === 4 ? 5 : 2,
					currentTotalSeats: 6,
					blockedReason: code.includes('unchanged') ? null : code
				}
			});
			await expectCode(
				() => h.service.setSeats(W, dto(patch), { actor: actor() }),
				code
			);
			expect(h.access.prepare).not.toHaveBeenCalled();
		}
	);

	it('does not execute a cancelled command and keeps the cancellation tombstone actor-bound', async () => {
		const receipt = {
			commandType: 'CANCEL_ADMIN_SET_AEROCRM_SEATS',
			requestHash: 'a'.repeat(64),
			requestHashVersion: 1,
			result: {
				schemaVersion: 1,
				workspaceId: W,
				commandId: C,
				actorSubject: 'admin@example',
				outcome: 'CANCELLED',
				actorRole: 'ADMIN',
				cancelledAt: '2026-09-21T12:00:00.000Z'
			}
		};
		const h = harness({ receipt });

		await expectCode(
			() => h.service.setSeats(W, dto(), { actor: actor() }),
			'crm_admin_seats_cancelled'
		);
		await expectCode(
			() =>
				h.service.setSeats(
					W,
					dto({ expectedActorSubject: 'other@example' }),
					{ actor: actor('other@example') }
				),
			'crm_admin_subscription_command_conflict'
		);
		expect(h.access.context).not.toHaveBeenCalled();
	});

	it('keeps unknown command recovery nonterminal and rejects a proof for another workspace', async () => {
		const h = harness({});
		await expect(h.service.seatCommand(W, C, actor())).rejects.toBeInstanceOf(
			NotFoundException
		);

		const proof = {
			commandType: 'ADMIN_SET_AEROCRM_SEATS',
			result: {
				schemaVersion: 1,
				workspaceId: W,
				commandId: C,
				adjustment: { actorSubject: 'admin@example' }
			}
		};
		h.prisma.billingCommandReceipt.findUnique.mockResolvedValue(proof);
		await expectCode(
			() => h.service.seatCommand(C, C, actor()),
			'crm_admin_subscription_command_conflict'
		);
	});
});
