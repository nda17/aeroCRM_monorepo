import { ConflictException } from '@nestjs/common';
import { serializable } from './commerce-core';
import { CommerceService } from './commerce.service';

describe('serializable CommerceCore transactions', () => {
	it.each([
		[
			'PostgreSQL serialization failure',
			{ code: 'P2010', meta: { code: '40001' } }
		],
		['PostgreSQL deadlock', { code: 'P2010', meta: { code: '40P01' } }],
		['Prisma serialization conflict', { code: 'P2034' }]
	])(
		'retries %s and returns the succeeding transaction result',
		async (_label, error) => {
			const run = jest
				.fn()
				.mockRejectedValueOnce(error)
				.mockResolvedValueOnce('committed');

			await expect(serializable(run)).resolves.toBe('committed');
			expect(run).toHaveBeenCalledTimes(2);
		}
	);

	it.each([
		['a different SQLSTATE', { code: 'P2010', meta: { code: '23505' } }],
		['P2010 without metadata', { code: 'P2010' }],
		['a different Prisma code', { code: 'P2002' }]
	])('propagates %s without a retry', async (_label, error) => {
		const run = jest.fn().mockRejectedValue(error);

		await expect(serializable(run)).rejects.toBe(error);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('stops after three conflicts and exposes a conflict exception', async () => {
		const run = jest.fn().mockRejectedValue({
			code: 'P2010',
			meta: { code: '40001' }
		});

		await expect(serializable(run)).rejects.toBeInstanceOf(ConflictException);
		expect(run).toHaveBeenCalledTimes(3);
	});

	it('creates a fresh Prisma transaction callback for every retry', async () => {
		const callbacks: unknown[] = [];
		const tx = {
			$executeRaw: jest.fn().mockResolvedValue(1),
			commerceCommand: {
				findUnique: jest.fn().mockResolvedValue(null),
				create: jest.fn().mockResolvedValue({})
			},
			pipeline: {
				create: jest.fn().mockResolvedValue({
					id: 'pipeline-1',
					workspaceId: 'workspace-1',
					name: 'Pipeline',
					version: 1,
					templateKey: 'custom',
					templateVersion: 1,
					stages: []
				})
			},
			commerceEvent: { create: jest.fn().mockResolvedValue({}) }
		};
		const db = {
			$transaction: jest.fn(
				async (callback: (value: typeof tx) => Promise<unknown>) => {
					callbacks.push(callback);
					if (callbacks.length === 1) {
						throw { code: 'P2010', meta: { code: '40001' } };
					}
					return callback(tx);
				}
			)
		};
		const service = new CommerceService(db as never, {} as never);

		await expect(
			service.createPipeline(
				{
					schemaVersion: 1,
					workspaceId: 'workspace-1',
					subject: 'owner-1',
					role: 'OWNER',
					state: 'ACTIVE',
					dataScope: 'ALL',
					teamIds: [],
					permissions: ['sales:manage-pipelines']
				},
				{
					commandId: 'e9bc501d-c24b-4a4f-b7a0-1f5ce8a90cb7',
					name: 'Pipeline'
				}
			)
		).resolves.toMatchObject({ pipeline: { id: 'pipeline-1' } });

		expect(db.$transaction).toHaveBeenCalledTimes(2);
		expect(callbacks[0]).not.toBe(callbacks[1]);
		expect(tx.pipeline.create).toHaveBeenCalledTimes(1);
	});
});
