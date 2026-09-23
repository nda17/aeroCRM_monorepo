import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import {
	WorkspaceClosureService,
	type ClosureEnvelope
} from './workspace-closure.controller';

const workspaceId = randomUUID();
const closureId = randomUUID();
const requestedAt = '2026-09-23T12:00:00.000Z';
const closedAt = new Date('2026-09-23T12:01:00.000Z');
const binding: ClosureEnvelope = {
	schemaVersion: 1,
	closureId,
	workspaceId,
	generation: '1',
	ownerSubject: 'owner-1',
	requestedAt
};

function setup() {
	const candidate = {
		id: randomUUID(),
		workspaceId,
		entryId: randomUUID(),
		actorSubject: 'actor-1',
		status: 'RUNNING',
		version: 3,
		generation: 1,
		mode: 'EXECUTE',
		contactOperationId: randomUUID(),
		salesOperationId: randomUUID(),
		contactCommandId: randomUUID(),
		salesCommandId: randomUUID(),
		contactPayloadHash: 'a'.repeat(64),
		salesPayloadHash: 'b'.repeat(64),
		contactPayload: { mode: 'CREATE', name: 'Contact' },
		salesPayload: { title: 'Deal' },
		createdAt: closedAt
	};
	const contactId = randomUUID();
	const fence = {
		workspaceId,
		closureId,
		generation: 1n,
		ownerSubject: binding.ownerSubject,
		requestedAt: new Date(requestedAt),
		fencedAt: closedAt
	};
	const contactBinding = {
		schemaVersion: 1,
		workspaceId,
		workflowId: candidate.id,
		operationId: candidate.contactOperationId,
		actorSubject: candidate.actorSubject,
		payloadHash: candidate.contactPayloadHash
	};
	const salesBinding = {
		...contactBinding,
		operationId: candidate.salesOperationId,
		payloadHash: candidate.salesPayloadHash
	};
	const contactProof = {
		...contactBinding,
		state: 'COMMITTED',
		result: { contactId, contactName: 'Contact', contactVersion: 1 },
		committedAt: closedAt.toISOString()
	};
	const salesProof = {
		...salesBinding,
		state: 'COMMITTED',
		result: {
			contactId,
			dealId: randomUUID(),
			firstTaskId: randomUUID()
		},
		committedAt: closedAt.toISOString()
	};
	const tx = {
		$executeRaw: jest.fn().mockResolvedValue(1),
		$queryRaw: jest.fn().mockResolvedValue([]),
		workspaceClosureFence: { findUnique: jest.fn().mockResolvedValue(fence) },
		acceptance: {
			findUnique: jest.fn().mockResolvedValue(candidate),
			updateMany: jest.fn().mockResolvedValue({ count: 1 })
		},
		inboxEntry: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
		intakeActivity: { create: jest.fn().mockResolvedValue({}) }
	};
	const prisma = {
		...tx,
		workspaceClosureFence: { findUnique: jest.fn().mockResolvedValue(fence) },
		acceptance: {
			findMany: jest.fn().mockResolvedValue([candidate]),
			count: jest.fn().mockResolvedValue(0)
		},
		$transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx))
	};
	const operations = {
		request: jest.fn(async (target: string, action: string, proofBinding: unknown) => {
			if (action !== 'read' || !proofBinding || typeof proofBinding !== 'object')
				throw new Error('Unexpected operation proof request');
			return target === 'customers' ? contactProof : salesProof;
		})
	};
	const service = new WorkspaceClosureService(prisma as never, operations as never);
	return { candidate, contactProof, salesProof, tx, prisma, operations, service };
}

describe('CRM Intake workspace closure settlement proofs', () => {
	it('completes only a matching exact committed contact and sales proof after fencing', async () => {
		const c = setup();
		await expect(
			c.service.settle({
				...binding,
				customersFencedAt: closedAt.toISOString(),
				salesFencedAt: closedAt.toISOString()
			} as unknown as ClosureEnvelope)
		).resolves.toMatchObject({ state: 'SETTLED', remaining: 0 });
		expect(c.operations.request.mock.calls.map(call => `${call[0]}:${call[1]}`)).toEqual([
			'sales:read',
			'customers:read'
		]);
		expect(c.tx.acceptance.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ id: c.candidate.id }),
				data: expect.objectContaining({
					status: 'COMPLETED',
					contactProof: c.contactProof,
					salesProof: c.salesProof
				})
			})
		);
		expect(c.tx.inboxEntry.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ status: 'ACCEPTED' }) })
		);
	});

	it('does not terminalize when a committed Sales proof names a different existing contact', async () => {
		const c = setup();
		c.operations.request.mockImplementation(async (target: string) =>
			target === 'customers'
				? c.contactProof
				: {
						...c.salesProof,
						result: { ...c.salesProof.result, contactId: randomUUID() }
					}
		);
		await expect(
			c.service.settle({
				...binding,
				customersFencedAt: closedAt.toISOString(),
				salesFencedAt: closedAt.toISOString()
			} as unknown as ClosureEnvelope)
		).rejects.toBeInstanceOf(ConflictException);
		expect(c.tx.acceptance.updateMany).not.toHaveBeenCalled();
		expect(c.tx.inboxEntry.updateMany).not.toHaveBeenCalled();
		expect(c.tx.intakeActivity.create).not.toHaveBeenCalled();
	});
});
