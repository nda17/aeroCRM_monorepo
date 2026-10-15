import { ForbiddenException } from '@nestjs/common';
import type { SalesAccess } from './sales-access';
import { SalesService } from './sales.service';
import type { LossReportQuery, TransitionDealV2Dto } from './sales-productivity.dto';
import type { TransitionDealDto } from './sales.dto';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const dealId = '22222222-2222-4222-8222-222222222222';
const pipelineId = '33333333-3333-4333-8333-333333333333';
const openStageId = '44444444-4444-4444-8444-444444444444';
const lostStageId = '55555555-5555-4555-8555-555555555555';
const reasonId = '11000000-0000-4000-8000-000000000001';
const membershipId = '66666666-6666-4666-8666-666666666666';
const token = 'Bearer test-token';
const access: SalesAccess = {
	schemaVersion: 1,
	workspaceId,
	subject: 'owner-1',
	role: 'OWNER',
	state: 'ACTIVE',
	dataScope: 'ALL',
	teamIds: [],
	permissions: ['sales:read', 'sales:write', 'sales:analytics']
};
const stamp = new Date('2026-10-15T10:00:00.000Z');

function fixture() {
	let currentDeal: Record<string, unknown> = {
		id: dealId,
		workspaceId,
		version: 1,
		title: 'Deal',
		currency: 'RUB',
		amountMinor: 10000,
		pipelineId,
		stageId: openStageId,
		status: 'OPEN',
		contactId: '77777777-7777-4777-8777-777777777777',
		contactName: 'Customer',
		assignedToSubject: access.subject,
		teamId: null,
		archivedAt: null,
		createdAt: stamp,
		updatedAt: stamp,
		lostAt: null,
		lossReasonId: null,
		lossReasonTitle: null,
		nextTaskId: null,
		nextAction: null
	};
	const receipts = new Map<string, Record<string, unknown>>();
	const stageStates = new Map([[openStageId, 'OPEN'], [lostStageId, 'LOST']]);
	let settings: { workspaceId: string; version: number; reasons: Array<{ id: string; title: string; archived: boolean }> } | null = { workspaceId, version: 1, reasons: [{ id: reasonId, title: 'Competitor', archived: false }] };
	let timelineRows: Array<Record<string, unknown>> = [];
	const tx = {
		$executeRaw: jest.fn().mockResolvedValue(1),
		$queryRaw: jest.fn().mockResolvedValue([]),
		salesCommandReceipt: {
			findUnique: jest.fn(async ({ where }) => receipts.get(where.commandId) ?? null),
			create: jest.fn(async ({ data }) => { receipts.set(data.commandId, data); return data; })
		},
		deal: {
			findFirst: jest.fn(async () => ({ ...currentDeal, nextAction: null })),
			updateMany: jest.fn(async ({ data }) => {
				currentDeal = { ...currentDeal, ...data, version: Number(currentDeal.version) + 1, updatedAt: new Date() };
				return { count: 1 };
			}),
			groupBy: jest.fn(async args => { void args; return [{ lossReasonId: reasonId, _count: { id: 2 }, _sum: { amountMinor: 500 } }]; }),
			aggregate: jest.fn(async args => { void args; return { _count: { id: 1 }, _sum: { amountMinor: 300 } }; })
		},
		pipelineStage: {
			findFirst: jest.fn(async ({ where }) => ({
				id: where.id,
				workspaceId,
				pipelineId,
				state: stageStates.get(where.id) ?? 'OPEN'
			}))
		},
		salesTask: {
			updateMany: jest.fn().mockResolvedValue({ count: 1 }),
			create: jest.fn().mockResolvedValue({})
		},
		dealTimeline: {
			create: jest.fn().mockResolvedValue({}),
			count: jest.fn(async () => timelineRows.length),
			findMany: jest.fn(async () => timelineRows)
		},
		lossReasonSettings: { findUnique: jest.fn(async () => settings) },
	};
	const prisma = {
		...tx,
		$transaction: jest.fn(async (callback: ((value: typeof tx) => unknown) | unknown[]) => Array.isArray(callback) ? Promise.all(callback) : (callback as (value: typeof tx) => unknown)(tx)),
		salesCommandReceipt: tx.salesCommandReceipt
	};
	const authority = { authorize: jest.fn(async () => access) };
	const actors = { verify: jest.fn().mockResolvedValue(undefined) };
	const assignees = {
		resolve: jest.fn(async (_token, _access, subject: string) => ({ subject, membershipId }))
	};
	const service = new SalesService(prisma as never, {} as never, assignees as never, {} as never, authority as never, actors as never);
	const transition = (command: string, targetStageId: string, version: number, lossReason: TransitionDealV2Dto['lossReason']): TransitionDealV2Dto => ({
		schemaVersion: 1,
		workspaceId,
		commandId: command,
		expectedVersion: version,
		targetStageId,
		outcome: 'Updated deal status',
		actorMembershipId: membershipId,
		lossReason
	});
	return { service, tx, prisma, authority, actors, receipts, get deal() { return currentDeal; }, setDeal(value: Record<string, unknown>) { currentDeal = { ...currentDeal, ...value }; }, setSettings(value: typeof settings) { settings = value; }, setTimeline(value: typeof timelineRows) { timelineRows = value; }, transition };
}

describe('SalesService productivity transitions', () => {
	it('records the first LOST timestamp, preserves it on LOST to LOST, and clears loss state on reopen', async () => {
		const f = fixture();
		const first = await f.service.transitionV2(access, dealId, f.transition('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', lostStageId, 1, { id: reasonId, settingsVersion: 1 }), token);
		const firstUpdate = f.tx.deal.updateMany.mock.calls[0][0].data;
		expect(firstUpdate).toMatchObject({ status: 'LOST', lossReasonId: reasonId, lossReasonTitle: 'Competitor' });
		expect(firstUpdate.lostAt).toBeInstanceOf(Date);
		const lostAt = firstUpdate.lostAt as Date;
		const repeated = await f.service.transitionV2(access, dealId, f.transition('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', lostStageId, 2, { id: reasonId, settingsVersion: 1 }), token);
		const repeatedUpdate = f.tx.deal.updateMany.mock.calls[1][0].data;
		expect(repeatedUpdate.lostAt).toBe(lostAt);
		expect(repeatedUpdate).toMatchObject({ lossReasonId: reasonId, lossReasonTitle: 'Competitor' });
		await f.service.transitionV2(access, dealId, {
			...f.transition('cccccccc-cccc-4ccc-8ccc-cccccccccccc', openStageId, 3, null),
			nextTask: { title: 'Call back', dueAt: '2026-10-20T09:00:00.000Z' }
		}, token);
		expect(f.tx.deal.updateMany.mock.calls[2][0].data).toMatchObject({ status: 'OPEN', lostAt: null, lossReasonId: null, lossReasonTitle: null });
		expect(f.tx.salesTask.create).toHaveBeenCalledTimes(1);
		expect(first).toMatchObject({ schemaVersion: 1, deal: { status: 'LOST' } });
		expect(repeated).toMatchObject({ schemaVersion: 1, deal: { status: 'LOST' } });
	});

	it('rejects a closed transition without a valid current loss reason or actor membership', async () => {
		const f = fixture();
		await expect(f.service.transitionV2(access, dealId, f.transition('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', lostStageId, 1, null), token)).rejects.toThrow();
		f.actors.verify.mockRejectedValueOnce(new ForbiddenException());
		await expect(f.service.transitionV2(access, dealId, f.transition('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', lostStageId, 1, { id: reasonId, settingsVersion: 1 }), token)).rejects.toBeInstanceOf(ForbiddenException);
		expect(f.tx.deal.updateMany).not.toHaveBeenCalled();
		expect(f.tx.salesCommandReceipt.create).not.toHaveBeenCalled();
	});

	it('replays the same command only after fresh actor membership verification', async () => {
		const f = fixture();
		const dto = f.transition('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', lostStageId, 1, { id: reasonId, settingsVersion: 1 });
		const saved = await f.service.transitionV2(access, dealId, dto, token);
		const replay = await f.service.transitionV2(access, dealId, dto, token);
		expect(replay).toEqual(saved);
		expect(f.actors.verify).toHaveBeenCalledTimes(2);
		expect(f.tx.deal.updateMany).toHaveBeenCalledTimes(1);
		f.actors.verify.mockRejectedValueOnce(new ForbiddenException());
		await expect(f.service.transitionV2(access, dealId, dto, token)).rejects.toBeInstanceOf(ForbiddenException);
		expect(f.tx.deal.updateMany).toHaveBeenCalledTimes(1);
	});

	it('serves the stored loss snapshot after its reason is renamed or archived', async () => {
		const f = fixture();
		const lostAt = new Date('2026-09-10T08:00:00.000Z');
		f.setDeal({ status: 'LOST', lostAt, lossReasonId: reasonId, lossReasonTitle: 'Original reason' });
		const result = await f.service.loss(access, dealId, 'ARCHIVED');
		expect(result).toMatchObject({
			status: 'LOST',
			lostAt: lostAt.toISOString(),
			reason: { id: reasonId, title: 'Original reason' }
		});
		expect(f.prisma.deal.findFirst).toHaveBeenCalledWith(expect.objectContaining({
			where: expect.objectContaining({ AND: expect.arrayContaining([expect.objectContaining({ archivedAt: { not: null } })]) })
		}));
	});

	it('keeps legacy v1 LOST transitions date-stamped without requiring a reason', async () => {
		const f = fixture();
		const dto: TransitionDealDto = {
			schemaVersion: 1,
			workspaceId,
			commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			expectedVersion: 1,
			targetStageId: lostStageId,
			outcome: 'Legacy close'
		};
		await f.service.transition(access, dealId, dto, token);
		expect(f.tx.deal.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'LOST', lossReasonId: null, lossReasonTitle: null });
		expect(f.tx.deal.updateMany.mock.calls[0][0].data.lostAt).toBeInstanceOf(Date);
	});

	it('rejects stale or archived selected reasons before changing a deal', async () => {
		for (const settings of [
			{ workspaceId, version: 2, reasons: [{ id: reasonId, title: 'Competitor', archived: false }] },
			{ workspaceId, version: 1, reasons: [{ id: reasonId, title: 'Competitor', archived: true }] }
		]) {
			const f = fixture();
			f.setSettings(settings);
			await expect(f.service.transitionV2(access, dealId, f.transition('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', lostStageId, 1, { id: reasonId, settingsVersion: 1 }), token)).rejects.toMatchObject({ response: { code: 'crm_loss_reason_conflict' } });
			expect(f.tx.deal.updateMany).not.toHaveBeenCalled();
		}
	});

	it('masks loss details on timeline v3 and includes them on v4', async () => {
		const f = fixture();
		const row = {
			id: '88888888-8888-4888-8888-888888888888',
			dealId,
			kind: 'TRANSITIONED',
			actorSubject: access.subject,
			outcome: 'Lost',
			fromStageId: openStageId,
			toStageId: lostStageId,
			details: { loss: { lostAt: stamp.toISOString(), reason: { id: reasonId, title: 'Competitor' } } },
			createdAt: stamp
		};
		f.setTimeline([row]);
		const query = { workspaceId, page: 1, pageSize: 20 };
		expect((await f.service.timelineV3(access, dealId, query)).items[0].details).toBeNull();
		expect((await f.service.timelineV4(access, dealId, query)).items[0].details).toEqual(row.details);
	});

	it('reports current LOST rows with known dates and separates unknown dates', async () => {
		const f = fixture();
		const report = await f.service.lossReport(access, { workspaceId } as LossReportQuery);
		expect(report).toMatchObject({
			population: 'CURRENT_LOST',
			totals: { count: 2, amountMinor: 500 },
			reasons: [{ reasonId, title: 'Competitor', count: 2, amountMinor: 500 }],
			unknownDate: { count: 1, amountMinor: 300 }
		});
		const knownFilter = (f.tx.deal.groupBy.mock.calls[0][0] as { where: { AND: unknown[] } }).where.AND[1] as { lostAt: unknown };
		expect(knownFilter.lostAt).toEqual({ not: null });
		const unknownFilter = (f.tx.deal.aggregate.mock.calls[0][0] as { where: { AND: unknown[] } }).where.AND[1] as { lostAt: unknown };
		expect(unknownFilter.lostAt).toBeNull();
	});
});
