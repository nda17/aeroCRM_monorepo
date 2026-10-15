import { ForbiddenException } from '@nestjs/common';
import type { SalesAccess } from '../sales/sales-access';
import { BulkAssignmentService } from './bulk-assignment.service';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const dealId = '22222222-2222-4222-8222-222222222222';
const secondDealId = '33333333-3333-4333-8333-333333333333';
const commandId = '44444444-4444-4444-8444-444444444444';
const actorMembershipId = '55555555-5555-4555-8555-555555555555';
const targetMembershipId = '66666666-6666-4666-8666-666666666666';
const token = 'Bearer test-token';
const access: SalesAccess = {
	schemaVersion: 1,
	workspaceId,
	subject: 'actor-user',
	role: 'OWNER',
	state: 'ACTIVE',
	dataScope: 'ALL',
	teamIds: [],
	permissions: ['sales:read', 'sales:write']
};
const target = { subject: 'target-user', membershipId: targetMembershipId };
const deal = (id = dealId) => ({
	id,
	workspaceId,
	title: `Deal ${id}`,
	version: 2,
	teamId: null,
	stageId: '77777777-7777-4777-8777-777777777777',
	assignedToSubject: 'old-owner'
});
const selection = (ids = [dealId]) => ({
	schemaVersion: 1 as const,
	workspaceId,
	actorMembershipId,
	assignee: target,
	deals: ids.map(id => ({ id, expectedVersion: 2 }))
});

function fixture() {
	let deals = [deal()];
	let tasks: Array<Record<string, unknown>> = [];
	const commands = new Map<string, Record<string, unknown>>();
	let failSecondDeal = false;
	const tx = {
		$executeRaw: jest.fn().mockResolvedValue(1),
		$queryRaw: jest.fn(async () => deals.map(row => ({ id: row.id }))),
		bulkAssignmentCommand: {
			findUnique: jest.fn(async ({ where }) => commands.get(where.commandId) ?? null),
			create: jest.fn(async ({ data }) => { commands.set(data.commandId, data); return data; })
		},
		deal: {
			findMany: jest.fn(async ({ where }) => deals.filter(row => where.AND[1].id.in.includes(row.id)).map(row => ({ ...row }))),
			updateMany: jest.fn(async ({ where, data }) => {
				const id = where.AND[1].id;
				if (failSecondDeal && id === secondDealId) return { count: 0 };
				const row = deals.find(item => item.id === id);
				if (!row) return { count: 0 };
				const version = row.version + 1;
				Object.assign(row, data, { version });
				return { count: 1 };
			}),
			count: jest.fn(async ({ where }) => where.AND[1].id.in.filter((id: string) => deals.some(row => row.id === id)).length)
		},
		salesTask: {
			findMany: jest.fn(async ({ where }) => tasks.filter(task => where.dealId.in.includes(task.dealId))),
			updateMany: jest.fn(async ({ where, data }) => {
				const selected = tasks.filter(task => task.dealId === where.dealId && task.assignedToSubject === where.assignedToSubject && ['OPEN', 'IN_PROGRESS'].includes(String(task.status)));
				for (const task of selected) Object.assign(task, data, { version: Number(task.version) + 1 });
				return { count: selected.length };
			})
		},
		dealTimeline: { create: jest.fn().mockResolvedValue({}) }
	};
	const prisma = {
		...tx,
		$transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => {
			const beforeDeals = structuredClone(deals);
			const beforeTasks = structuredClone(tasks);
			try { return await callback(tx); }
			catch (error) { deals = beforeDeals; tasks = beforeTasks; throw error; }
		}),
		bulkAssignmentCommand: tx.bulkAssignmentCommand
	};
	const authority = { authorize: jest.fn(async () => access) };
	const actors = { verify: jest.fn().mockResolvedValue(undefined) };
	const assignees = {
		authorize: jest.fn(async (_token, _access, binding) => binding),
		readers: jest.fn(async (_token, _access, bindings: unknown[]) => bindings.map(() => ({ subject: 'reader', dataScope: 'ALL', teamIds: [] })))
	};
	const service = new BulkAssignmentService(prisma as never, authority as never, actors as never, assignees as never);
	return {
		service, tx, prisma, authority, actors, assignees, commands,
		get deals() { return deals; }, setDeals(value: ReturnType<typeof deal>[]) { deals = value; },
		get tasks() { return tasks; }, setTasks(value: Array<Record<string, unknown>>) { tasks = value; },
		failSecondDeal(value: boolean) { failSecondDeal = value; }
	};
}

describe('BulkAssignmentService', () => {
	it('rejects stale previews after task membership changes', async () => {
		const f = fixture();
		const preview = await f.service.preview(access, selection(), token);
		f.setTasks([{ id: '88888888-8888-4888-8888-888888888888', dealId, version: 1, status: 'OPEN', assignedToSubject: 'old-owner', assignedToMembershipId: null }]);
		await expect(f.service.apply(access, { ...selection(), commandId, previewHash: preview.previewHash }, token)).rejects.toMatchObject({
			response: { code: 'crm_bulk_assignment_preview_stale' }
		});
		expect(f.deals[0].assignedToSubject).toBe('old-owner');
		expect(f.tx.bulkAssignmentCommand.create).not.toHaveBeenCalled();
	});

	it('checks fresh actor and target authorization before an assignment', async () => {
		const f = fixture();
		f.authority.authorize.mockResolvedValue({ ...access, state: 'READ_ONLY' });
		await expect(f.service.preview(access, selection(), token)).rejects.toBeInstanceOf(ForbiddenException);
		f.authority.authorize.mockResolvedValue(access);
		f.assignees.authorize.mockResolvedValue({ subject: 'different-user', membershipId: targetMembershipId });
		await expect(f.service.preview(access, selection(), token)).rejects.toMatchObject({
			response: { code: 'crm_bulk_assignment_target_conflict' }
		});
		expect(f.deals[0].assignedToSubject).toBe('old-owner');
	});

	it('rolls back the whole batch when a later deal update loses its version race', async () => {
		const f = fixture();
		f.setDeals([deal(), deal(secondDealId)]);
		const preview = await f.service.preview(access, selection([dealId, secondDealId]), token);
		f.failSecondDeal(true);
		await expect(f.service.apply(access, {
			...selection([dealId, secondDealId]), commandId, previewHash: preview.previewHash
		}, token)).rejects.toMatchObject({ response: { code: 'crm_bulk_assignment_conflict' } });
		expect(f.deals.map(row => row.assignedToSubject)).toEqual(['old-owner', 'old-owner']);
		expect(f.tx.bulkAssignmentCommand.create).not.toHaveBeenCalled();
	});

	it('replays the original receipt only after membership verification for the same actor binding', async () => {
		const f = fixture();
		const preview = await f.service.preview(access, selection(), token);
		const dto = { ...selection(), commandId, previewHash: preview.previewHash };
		const saved = await f.service.apply(access, dto, token);
		expect(f.commands.get(commandId)?.result).toEqual(saved);
		expect(saved).toMatchObject({ schemaVersion: 1, workspaceId, commandId, assignee: target, deals: [{ id: dealId, version: 3, transferredTaskCount: 0 }], transferredTaskCount: 0 });
		const replay = await f.service.apply(access, dto, token);
		expect(replay).toEqual(saved);
		expect(f.actors.verify.mock.calls.length).toBeGreaterThan(1);
		expect(f.tx.deal.updateMany).toHaveBeenCalledTimes(1);
		f.actors.verify.mockRejectedValueOnce(new ForbiddenException());
		await expect(f.service.apply(access, dto, token)).rejects.toBeInstanceOf(ForbiddenException);
		expect(f.tx.deal.updateMany).toHaveBeenCalledTimes(1);
	});
});
