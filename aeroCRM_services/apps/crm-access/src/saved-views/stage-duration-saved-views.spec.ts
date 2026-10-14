import { BadRequestException } from '@nestjs/common';
import { SavedViewsService, validateSavedParameters } from './saved-views.service';

const dealParameters = {
	search: '',
	pipelineId: '',
	status: '',
	withoutNextAction: false,
	layout: 'list',
	sort: 'created_desc'
};

describe('stage-duration saved-view feature parameters', () => {
	it('keeps legacy deal parameters readable and requires opt-in for the feature key', () => {
		expect(validateSavedParameters('DEALS', dealParameters)).toEqual(dealParameters);
		expect(() =>
			validateSavedParameters('DEALS', { ...dealParameters, stageOverdue: true })
		).toThrow(BadRequestException);
		expect(
			validateSavedParameters(
				'DEALS',
				{ ...dealParameters, stageOverdue: true },
				'stage-duration'
			)
		).toMatchObject({ stageOverdue: true });
	});

	it('rejects feature use for TASKS and non-boolean feature values', () => {
		expect(() =>
			validateSavedParameters(
				'TASKS',
				{ layout: 'list', period: 'ALL', timeZone: 'UTC', scope: 'MINE' },
				'stage-duration'
			)
		).toThrow(BadRequestException);
		for (const stageOverdue of ['true', 1, null])
			expect(() =>
				validateSavedParameters(
					'DEALS',
					{ ...dealParameters, stageOverdue },
					'stage-duration'
				)
			).toThrow(BadRequestException);
	});
});

describe('stage-duration saved-view service compatibility', () => {
	const workspaceId = '11111111-1111-4111-8111-111111111111';
	const actor = {
		workspaceId,
		subject: 'owner',
		role: 'OWNER',
		state: 'ACTIVE',
		permissions: ['sales:read']
	};
	const featureView = {
		id: '22222222-2222-4222-8222-222222222222',
		workspaceId,
		subject: 'owner',
		scope: 'DEALS',
		name: 'Просроченные по этапу',
		parameters: { ...dealParameters, stageOverdue: true },
		version: 1,
		legacyKey: null,
		archivedAt: null,
		createdAt: new Date('2026-10-01T00:00:00.000Z'),
		updatedAt: new Date('2026-10-01T00:00:00.000Z')
	};

	function serviceWith(rows = [featureView], capacity = 20) {
		const tx = {
			$executeRaw: jest.fn().mockResolvedValue(0),
			crmTeamCommandReceipt: {
				findUnique: jest.fn().mockResolvedValue(null),
				create: jest.fn().mockResolvedValue({})
			},
			crmWorkspaceMember: { findUnique: jest.fn().mockResolvedValue(null) },
			crmSavedView: {
				findMany: jest.fn().mockResolvedValue(rows),
				findFirst: jest.fn().mockResolvedValue(featureView),
				count: jest.fn().mockResolvedValue(capacity),
				create: jest.fn(),
				update: jest.fn()
			}
		};
		const prisma = {
			...tx,
			$transaction: jest.fn(async (run: (transaction: typeof tx) => unknown) => run(tx))
		} as never;
		const authorization = {
			authorize: jest.fn().mockResolvedValue(actor)
		} as never;
		return { service: new SavedViewsService(prisma, authorization), tx };
	}

	it('hides feature views from legacy reads while opted-in reads include them', async () => {
		const { service } = serviceWith();
		const legacy = await service.list('token', { workspaceId, scope: 'DEALS' });
		const optedIn = await service.list('token', {
			workspaceId,
			scope: 'DEALS',
			features: 'stage-duration'
		});

		expect(legacy.items).toEqual([]);
		expect(optedIn.items).toHaveLength(1);
		expect(optedIn.items[0].parameters).toMatchObject({ stageOverdue: true });
	});

	it.each(['rename', 'delete'] as const)(
		'blocks legacy %s of a feature view before any update', async operation => {
			const { service, tx } = serviceWith();
			const command = {
				workspaceId,
				commandId: '33333333-3333-4333-8333-333333333333',
				expectedVersion: 1,
				...(operation === 'rename' ? { name: 'Новое имя' } : {})
			};
			const action = operation === 'rename'
				? service.rename('token', featureView.id, command as never)
				: service.delete('token', featureView.id, command as never);

			await expect(action).rejects.toMatchObject({
				response: { code: 'crm_saved_view_feature_required' }
			});
			expect(tx.crmSavedView.update).not.toHaveBeenCalled();
		}
	);

	it('counts feature rows toward the saved-view quota for legacy creates', async () => {
		const { service, tx } = serviceWith([], 20);
		await expect(service.create('token', {
			workspaceId,
			commandId: '44444444-4444-4444-8444-444444444444',
			scope: 'DEALS',
			name: 'Ещё один вид',
			parameters: dealParameters
		} as never)).rejects.toThrow('Saved view limit reached');
		expect(tx.crmSavedView.count).toHaveBeenCalledWith({
			where: { workspaceId, subject: 'owner', scope: 'DEALS', archivedAt: null }
		});
		expect(tx.crmSavedView.create).not.toHaveBeenCalled();
	});
});
