import { ServiceUnavailableException } from '@nestjs/common';
import {
	parseAuditAdminOverview,
	parseBillingAdminOverview
} from './admin-overview';
import { UsersService } from './users.service';

const USER_ID = 'user-1';
const WORKSPACE_ID = 'workspace-1';
const timestamp = '2026-10-01T12:00:00.000Z';

function billingOverview() {
	return {
		schemaVersion: 1,
		ownerSubject: USER_ID,
		workspaces: [
			{
				workspaceId: WORKSPACE_ID,
				entitlement: {
					workspaceId: WORKSPACE_ID,
					productCode: 'CRM',
					planCode: 'TRIAL',
					status: 'ACTIVE',
					seatLimit: null,
					graceUntil: null,
					trialStartedAt: timestamp,
					effectiveFrom: timestamp,
					effectiveUntil: timestamp,
					aggregateVersion: '2',
					sourceSequence: '4'
				}
			},
			{ workspaceId: 'workspace-without-entitlement', entitlement: null }
		],
		paymentCounts: {
			PENDING: 1,
			SUCCEEDED: 2,
			CANCELLED: 0,
			EXPIRED: 0,
			UNKNOWN: 1
		},
		latestPayments: [
			{
				id: 'payment-1',
				workspaceId: WORKSPACE_ID,
				providerPaymentId: null,
				status: 'UNKNOWN',
				amountMinor: '1200',
				kind: 'SUBSCRIPTION',
				cycle: null,
				createdAt: timestamp,
				updatedAt: timestamp
			}
		]
	};
}

describe('admin overview owner contract parsing', () => {
	it('retains workspaces without entitlements and normalizes the payment total', () => {
		expect(parseBillingAdminOverview(billingOverview(), USER_ID)).toEqual({
			subscriptions: {
				status: 'AVAILABLE',
				items: [
					{
						workspaceId: WORKSPACE_ID,
						entitlement: {
							workspaceId: WORKSPACE_ID,
							productCode: 'CRM',
							planCode: 'TRIAL',
							status: 'ACTIVE',
							seatLimit: null,
							graceUntil: null,
							trialStartedAt: timestamp,
							effectiveFrom: timestamp,
							effectiveUntil: timestamp,
							aggregateVersion: '2',
							sourceSequence: '4'
						}
					},
					{ workspaceId: 'workspace-without-entitlement', entitlement: null }
				]
			},
			payments: {
				status: 'AVAILABLE',
				total: 4,
				counts: billingOverview().paymentCounts,
				latest: [
					{
						id: 'payment-1',
						workspaceId: WORKSPACE_ID,
						providerPaymentId: null,
						status: 'UNKNOWN',
						amountMinor: '1200',
						kind: 'SUBSCRIPTION',
						cycle: null,
						createdAt: timestamp,
						updatedAt: timestamp
					}
				]
			}
		});
	});

	it.each([
		[
			'wrong owner',
			(value: ReturnType<typeof billingOverview>) => ({
				...value,
				ownerSubject: 'other-user'
			})
		],
		[
			'unsupported schema',
			(value: ReturnType<typeof billingOverview>) => ({
				...value,
				schemaVersion: 2
			})
		],
		[
			'entitlement workspace mismatch',
			(value: ReturnType<typeof billingOverview>) => ({
				...value,
				workspaces: [
					{
						...value.workspaces[0],
						entitlement: {
							...value.workspaces[0].entitlement!,
							workspaceId: 'other-workspace'
						}
					}
				]
			})
		],
		[
			'duplicate workspaces',
			(value: ReturnType<typeof billingOverview>) => ({
				...value,
				workspaces: [value.workspaces[0], value.workspaces[0]]
			})
		],
		[
			'invalid payment status',
			(value: ReturnType<typeof billingOverview>) => ({
				...value,
				latestPayments: [{ ...value.latestPayments[0], status: 'REFUNDED' }]
			})
		],
		[
			'BigInt aggregate version instead of a decimal string',
			(value: ReturnType<typeof billingOverview>) => ({
				...value,
				workspaces: [
					{
						...value.workspaces[0],
						entitlement: {
							...value.workspaces[0].entitlement!,
							aggregateVersion: 2n
						}
					}
				]
			})
		],
		[
			'BigInt payment amount instead of a decimal string',
			(value: ReturnType<typeof billingOverview>) => ({
				...value,
				latestPayments: [{ ...value.latestPayments[0], amountMinor: 1200n }]
			})
		]
	])('rejects %s', (_label, transform) => {
		expect(() =>
			parseBillingAdminOverview(transform(billingOverview()), USER_ID)
		).toThrow(ServiceUnavailableException);
	});

	it('keeps the healthy owner section available when the other owner is unavailable', async () => {
		const owners = {
			billingOverview: jest.fn().mockResolvedValue(billingOverview()),
			adminOverview: jest
				.fn()
				.mockRejectedValue(new Error('audit owner unavailable'))
		};
		const service = new UsersService(
			{} as never,
			{} as never,
			{} as never,
			owners as never
		);
		jest.spyOn(service, 'adminGet').mockResolvedValue({} as never);

		await expect(service.adminOverview(USER_ID)).resolves.toEqual({
			schemaVersion: 2,
			subscriptions: expect.objectContaining({ status: 'AVAILABLE' }),
			payments: expect.objectContaining({ status: 'AVAILABLE' }),
			activity: { status: 'UNAVAILABLE', latest: null }
		});
	});

	it('keeps audit activity available when Billing is unavailable', async () => {
		const owners = {
			billingOverview: jest
				.fn()
				.mockRejectedValue(new Error('billing owner unavailable')),
			adminOverview: jest.fn().mockResolvedValue({ latest: [] })
		};
		const service = new UsersService(
			{} as never,
			{} as never,
			{} as never,
			owners as never
		);
		jest.spyOn(service, 'adminGet').mockResolvedValue({} as never);

		await expect(service.adminOverview(USER_ID)).resolves.toEqual({
			schemaVersion: 2,
			subscriptions: { status: 'UNAVAILABLE', items: null },
			payments: {
				status: 'UNAVAILABLE',
				total: null,
				counts: null,
				latest: null
			},
			activity: { status: 'AVAILABLE', latest: [] }
		});
	});

	it('rejects malformed audit roles and accepts the public target/admin roles', () => {
		expect(parseAuditAdminOverview({ latest: [] })).toEqual({
			status: 'AVAILABLE',
			latest: []
		});
		expect(() =>
			parseAuditAdminOverview({ latest: [{ role: 'USER' }] })
		).toThrow(ServiceUnavailableException);
	});
});
