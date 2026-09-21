import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import {
	GUARDS_METADATA,
	PATH_METADATA,
	PIPES_METADATA
} from '@nestjs/common/constants';
import {
	BILLING_REQUIRED_ROLES,
	BillingAuthGuard
} from '../auth/billing-auth.guard';
import { CrmAdminSubscriptionController } from './crm-admin-subscription.controller';
import {
	CrmAdminSubscriptionListDto,
	CrmAdminSubscriptionPageDto,
	CancelCrmSubscriptionGrantDto,
	ExtendCrmSubscriptionDaysDto,
	SetCrmSubscriptionSeatsDto
} from './crm-admin-subscription.dto';

const command = {
	schemaVersion: 1,
	commandId: '22222222-2222-4222-8222-222222222222',
	expectedActorSubject: 'operator',
	expectedEntitlementVersion: '1',
	expectedBillingVersion: '0',
	expectedPeriodId: null,
	expectedPeriodVersion: null,
	days: 7,
	reason: '  Компенсация клиенту  '
};
const pipe = new ValidationPipe({
	whitelist: true,
	forbidNonWhitelisted: true,
	transform: true
});

const seatsCommand = {
	schemaVersion: 1,
	commandId: '44444444-4444-4444-8444-444444444444',
	expectedActorSubject: 'operator',
	expectedEntitlementVersion: '7',
	expectedBillingVersion: '12',
	expectedPeriodId: null,
	expectedPeriodVersion: null,
	totalSeats: 6,
	reason: '  Увеличение команды  '
};

describe('CRM administrative subscription HTTP contract', () => {
	it('guards every endpoint by actual service ADMIN or DEV, not CRM workspace roles', () => {
		expect(
			Reflect.getMetadata(PATH_METADATA, CrmAdminSubscriptionController)
		).toBe('subscriptions/admin/crm');
		expect(
			Reflect.getMetadata(
				BILLING_REQUIRED_ROLES,
				CrmAdminSubscriptionController
			)
		).toEqual(['ADMIN', 'DEV']);
		expect(
			Reflect.getMetadata(GUARDS_METADATA, CrmAdminSubscriptionController)
		).toEqual([BillingAuthGuard]);
		expect(
			Reflect.getMetadata(PIPES_METADATA, CrmAdminSubscriptionController)
		).toHaveLength(1);
	});

	it('accepts and normalizes the reason while retaining explicit nullable period CAS', async () => {
		const value = await pipe.transform(command, {
			type: 'body',
			metatype: ExtendCrmSubscriptionDaysDto
		});
		expect(value).toMatchObject({
			reason: 'Компенсация клиенту',
			expectedPeriodId: null,
			expectedPeriodVersion: null,
			days: 7
		});
	});

	it('accepts bounded target seat counts and normalizes the admin command', async () => {
		for (const totalSeats of [2, 10_000, 6, 3]) {
			const value = await pipe.transform(
				{ ...seatsCommand, totalSeats },
				{ type: 'body', metatype: SetCrmSubscriptionSeatsDto }
			);
			expect(value).toMatchObject({
				totalSeats,
				reason: 'Увеличение команды',
				expectedEntitlementVersion: '7',
				expectedBillingVersion: '12',
				expectedPeriodId: null,
				expectedPeriodVersion: null
			});
		}
		await expect(
			pipe.transform(
				{
					...seatsCommand,
					expectedPeriodId: '33333333-3333-4333-8333-333333333333',
					expectedPeriodVersion: 4
				},
				{ type: 'body', metatype: SetCrmSubscriptionSeatsDto }
			)
		).resolves.toMatchObject({
			expectedPeriodId: '33333333-3333-4333-8333-333333333333',
			expectedPeriodVersion: 4
		});
	});

	it.each([
		['missing command id', { commandId: undefined }],
		['invalid command id', { commandId: 'not-a-uuid' }],
		['wrong schema version', { schemaVersion: 2 }],
		['missing actor subject', { expectedActorSubject: undefined }],
		['actor with whitespace', { expectedActorSubject: 'admin operator' }],
		['number entitlement version', { expectedEntitlementVersion: 7 }],
		['zero entitlement version', { expectedEntitlementVersion: '0' }],
		['negative billing version', { expectedBillingVersion: '-1' }],
		['number billing version', { expectedBillingVersion: 12 }],
		[
			'invalid expected period id',
			{ expectedPeriodId: 'not-a-uuid' }
		],
		['invalid expected period version', { expectedPeriodVersion: 0 }],
		['missing expected period id', { expectedPeriodId: undefined }],
		['missing expected period version', { expectedPeriodVersion: undefined }],
		['fractional seats', { totalSeats: 2.5 }],
		['below minimum seats', { totalSeats: 1 }],
		['above maximum seats', { totalSeats: 10_001 }],
		['blank reason', { reason: '   ' }],
		['short reason', { reason: 'ab' }],
		['oversize reason', { reason: 'x'.repeat(1001) }],
		['unknown field', { billingStatus: 'SUCCEEDED' }]
	])('rejects seat command with %s', async (_label, patch) => {
		await expect(
			pipe.transform(
				{ ...seatsCommand, ...patch },
				{ type: 'body', metatype: SetCrmSubscriptionSeatsDto }
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it.each([
		['missing actor', { ...command, expectedActorSubject: undefined }],
		['empty actor', { ...command, expectedActorSubject: '' }],
		[
			'invalid actor',
			{ ...command, expectedActorSubject: 'admin operator' }
		],
		['unknown field', { ...command, paymentStatus: 'SUCCEEDED' }],
		['actor injection', { ...command, actorSubject: 'victim' }],
		['zero days', { ...command, days: 0 }],
		['negative days', { ...command, days: -1 }],
		['fractional days', { ...command, days: 1.5 }],
		['too many days', { ...command, days: 3651 }],
		['blank reason', { ...command, reason: '   ' }],
		['oversize reason', { ...command, reason: 'x'.repeat(1001) }],
		['number version', { ...command, expectedBillingVersion: 1 }],
		['negative version', { ...command, expectedEntitlementVersion: '-1' }],
		['missing period id', { ...command, expectedPeriodId: undefined }],
		[
			'missing period version',
			{ ...command, expectedPeriodVersion: undefined }
		],
		['invalid command', { ...command, commandId: 'not-a-uuid' }]
	])('rejects %s', async (_label, value) => {
		await expect(
			pipe.transform(value, {
				type: 'body',
				metatype: ExtendCrmSubscriptionDaysDto
			})
		).rejects.toMatchObject({ status: 400 });
	});

	it('parses bounded server pagination and rejects unknown history filters', async () => {
		expect(
			await pipe.transform(
				{ page: '2', pageSize: '10', ownerSubject: 'owner' },
				{ type: 'query', metatype: CrmAdminSubscriptionListDto }
			)
		).toMatchObject({ page: 2, pageSize: 10 });
		for (const value of [
			{ page: 0 },
			{ pageSize: 101 },
			{ ownerSubject: 'owner' }
		])
			await expect(
				pipe.transform(value, {
					type: 'query',
					metatype: CrmAdminSubscriptionPageDto
				})
			).rejects.toMatchObject({ status: 400 });
	});

	it('rejects a missing or mismatched key before invoking the domain', () => {
		const service = { extend: jest.fn() };
		const controller = new CrmAdminSubscriptionController(
			service as never
		);
		expect(() =>
			controller.extend(
				'workspace',
				command as never,
				{} as never,
				{} as never,
				'different'
			)
		).toThrow('Idempotency-Key must match commandId');
		expect(service.extend).not.toHaveBeenCalled();
	});

	it('forwards seat commands only with the matching idempotency key and request actor context', () => {
		const service = { setSeats: jest.fn() };
		const controller = new CrmAdminSubscriptionController(
			service as never
		);
		const request = {
			ip: '127.0.0.1',
			socket: { remoteAddress: '::1' },
			get: jest.fn().mockReturnValue('seat-test-agent')
		};
		const billingActor = {
			subject: 'operator',
			active: true,
			sessionId: 'session',
			roles: ['ADMIN']
		};

		controller.setSeats(
			'11111111-1111-4111-8111-111111111111',
			seatsCommand as never,
			billingActor as never,
			request as never,
			seatsCommand.commandId
		);
		expect(service.setSeats).toHaveBeenCalledWith(
			'11111111-1111-4111-8111-111111111111',
			seatsCommand,
			expect.objectContaining({ actor: billingActor, ip: '127.0.0.1' })
		);

		service.setSeats.mockClear();
		expect(() =>
			controller.setSeats(
				'11111111-1111-4111-8111-111111111111',
				seatsCommand as never,
				billingActor as never,
				request as never,
				'different-command'
			)
		).toThrow('Idempotency-Key must match commandId');
		expect(service.setSeats).not.toHaveBeenCalled();
	});

	it('accepts only captured actor cancellation input without new grant fields or a replacement command ID', async () => {
		const valid = { schemaVersion: 1, expectedActorSubject: 'operator' };
		expect(
			await pipe.transform(valid, {
				type: 'body',
				metatype: CancelCrmSubscriptionGrantDto
			})
		).toMatchObject(valid);
		for (const invalid of [
			{ schemaVersion: 1 },
			{ ...valid, commandId: command.commandId },
			{ ...valid, days: 7 }
		])
			await expect(
				pipe.transform(invalid, {
					type: 'body',
					metatype: CancelCrmSubscriptionGrantDto
				})
			).rejects.toMatchObject({ status: 400 });
		const service = { cancel: jest.fn() };
		const controller = new CrmAdminSubscriptionController(
			service as never
		);
		expect(() =>
			controller.cancel(
				'workspace',
				command.commandId,
				valid as never,
				{} as never,
				{} as never,
				'new-id'
			)
		).toThrow('Idempotency-Key must match original commandId');
		expect(service.cancel).not.toHaveBeenCalled();
	});
});
