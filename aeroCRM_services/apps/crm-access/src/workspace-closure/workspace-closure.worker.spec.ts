import { WorkspaceClosureWorker } from './workspace-closure.worker';
import { closureParticipants } from './workspace-closure.service';
import { CLOSURE_PARTICIPANT_SERVICES } from './workspace-closure.contract';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const closureId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-09-23T12:00:00.000Z');

function harness(options: { failBilling?: boolean; settleIntake?: boolean } = {}) {
	const row: any = {
		id: closureId,
		workspaceId,
		ownerSubject: 'owner',
		ownerMembershipId: '33333333-3333-4333-8333-333333333333',
		commandId: '44444444-4444-4444-8444-444444444444',
		requestHash: 'a'.repeat(64),
		displayNameSnapshot: 'Студия Север',
		generation: 1n,
		state: 'CLOSING',
		version: 1n,
		participants: closureParticipants(now.toISOString()),
		leaseToken: null,
		leaseUntil: null,
		nextAttemptAt: now,
		lastErrorCode: null,
		requestedAt: now,
		closedAt: null,
		financialPendingCount: 0,
		priorDispatchCount: 0
	};
	const due = jest.fn(async () =>
		row.state === 'CLOSING' &&
		row.nextAttemptAt <= new Date() &&
		(!row.leaseUntil || row.leaseUntil < new Date())
			? [{ id: row.id, version: row.version }]
			: []
	);
	const update = jest.fn(async ({ where, data }: any) => {
		if (where.id !== row.id) return { count: 0 };
		if (where.version !== undefined && where.version !== row.version) return { count: 0 };
		if (where.state !== undefined && where.state !== row.state) return { count: 0 };
		if (where.leaseToken !== undefined && where.leaseToken !== row.leaseToken) return { count: 0 };
		for (const [key, value] of Object.entries(data)) {
			if (key === 'version' && value && typeof value === 'object')
				row.version += BigInt((value as { increment: number }).increment);
			else if (key === 'financialPendingCount' || key === 'priorDispatchCount')
				row[key] = value;
			else if (key === 'participants') row[key] = structuredClone(value);
			else row[key] = value;
		}
		return { count: 1 };
	});
	const findUnique = jest.fn(async () => row);
	const auditCreate = jest.fn();
	const tx = {
		crmWorkspaceClosure: {
			updateMany: update,
			findUniqueOrThrow: jest.fn(async () => row)
		},
		crmTeamAudit: { create: auditCreate }
	};
	const prisma = {
		crmWorkspaceClosure: { findMany: due, findUnique, updateMany: update },
		$transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx))
	};
	const fenced: string[] = [];
	let settlementAttempts = 0;
	const client = {
		fence: jest.fn(async (service: (typeof CLOSURE_PARTICIPANT_SERVICES)[number]) => {
			fenced.push(service);
			if (service === 'billing' && options.failBilling)
				throw new Error('billing is temporarily unavailable');
			return {
				schemaVersion: 1,
				service,
				closureId,
				workspaceId,
				generation: '1',
				state: 'FENCED' as const,
				fencedAt: new Date().toISOString(),
				financialPendingCount:
					service === 'billing' ? 3 : service === 'crm-sales' ? 2 : 0,
				priorDispatchCount: service === 'notification-delivery' ? 4 : 0
			};
		}),
		settleIntake: jest.fn(async () => {
			settlementAttempts++;
			return {
				schemaVersion: 1,
				closureId,
				workspaceId,
				generation: '1',
				state:
					options.settleIntake && settlementAttempts > 1
						? ('SETTLED' as const)
						: ('SETTLING' as const),
				remaining: options.settleIntake && settlementAttempts > 1 ? 0 : 1
			};
		})
	};
	const worker = new WorkspaceClosureWorker(
		prisma as never,
		client as never,
		{ workerEnabled: false } as never
	);
	return { worker, client, prisma, row: () => row, fenced, auditCreate };
}

describe('WorkspaceClosureWorker participant acknowledgments', () => {
	beforeEach(() => {
		jest.useFakeTimers();
		jest.setSystemTime(now);
	});
	afterEach(() => jest.useRealTimers());

	it('records an unavailable participant and continues fencing the remaining services', async () => {
		const h = harness({ failBilling: true, settleIntake: true });
		await h.worker.tick();
		const participants = h.row().participants;
		expect(h.row().state).toBe('CLOSING');
		expect(participants.billing).toMatchObject({
			state: 'PENDING',
			lastErrorCode: 'CLOSURE_PARTICIPANT_UNAVAILABLE'
		});
		expect(participants['crm-customers'].state).toBe('SETTLED');
		expect(participants['crm-sales'].state).toBe('SETTLED');
		expect(participants['notification-delivery'].state).toBe('SETTLED');
		expect(h.fenced).toContain('notification-delivery');
		expect(h.row().lastErrorCode).toBe('CLOSURE_PARTICIPANT_UNAVAILABLE');
	});

	it('waits for Intake settlement, then closes with persisted acknowledgments and stable counts', async () => {
		const h = harness({ settleIntake: true });
		await h.worker.tick();
		expect(h.row().state).toBe('CLOSING');
		expect(h.row().participants['crm-intake'].state).toBe('FENCED');
		expect(h.row().financialPendingCount).toBe(5);
		expect(h.row().priorDispatchCount).toBe(4);
		const firstFenceCalls = h.client.fence.mock.calls.length;

		await jest.advanceTimersByTimeAsync(6000);
		await h.worker.tick();
		expect(h.row().state).toBe('CLOSED');
		expect(h.row().participants['crm-intake'].state).toBe('SETTLED');
		expect(h.row().financialPendingCount).toBe(5);
		expect(h.row().priorDispatchCount).toBe(4);
		expect(h.client.fence).toHaveBeenCalledTimes(firstFenceCalls);
		expect(h.client.settleIntake).toHaveBeenCalledTimes(2);
		expect(h.auditCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ action: 'WORKSPACE_CLOSURE_CLOSED' })
			})
		);
	});
});
