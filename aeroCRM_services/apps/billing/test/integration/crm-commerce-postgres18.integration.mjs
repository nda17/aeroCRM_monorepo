import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/billing-client');
const { CrmCommerceService } = require('../../dist/src/domain/crm-commerce.service.js');
const { crmCommerceRequestHash } = require('../../dist/src/domain/crm-commerce.helpers.js');

assert.equal(process.env.BILLING_INTEGRATION_ALLOW_MUTATION, 'true');
process.env.BILLING_CRM_PAYMENTS_ENABLED = 'true';
process.env.CRM_FRONTEND_ORIGIN = 'http://localhost:3001';

const databaseUrl = required('BILLING_TEST_DATABASE_URL');
const runtimeRole = required('BILLING_TEST_RUNTIME_ROLE');
const url = new URL(databaseUrl);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
assert.match(url.pathname, /^\/aerocrm_billing_test(?:_[a-z0-9]+)*$/);
assert.equal(decodeURIComponent(url.username), runtimeRole);
assert.equal(url.searchParams.get('schema'), 'billing');

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const actorSubject = `billing-owner-${randomUUID()}`;
const workspaceId = randomUUID();
const policy = {
	version: 1,
	monthlyPriceMinor: 99000,
	yearlyPriceMinor: 990000,
	additionalSeatMonthlyPriceMinor: 29000,
	additionalSeatYearlyPriceMinor: 290000,
	includedSeats: 2,
	trialSeatLimit: 5,
	trialDays: 10,
	graceDays: 3
};
const snapshot = {
	policyVersion: 1,
	monthlyPriceMinor: policy.monthlyPriceMinor,
	yearlyPriceMinor: policy.yearlyPriceMinor,
	additionalSeatMonthlyPriceMinor: policy.additionalSeatMonthlyPriceMinor,
	additionalSeatYearlyPriceMinor: policy.additionalSeatYearlyPriceMinor,
	includedSeats: policy.includedSeats,
	graceDays: policy.graceDays
};
const cryptoStub = {
	encrypt: value => `synthetic:${value}`
};
const service = new CrmCommerceService(prisma, cryptoStub);
let phase = 'preflight';

const checkout = (commandId = randomUUID()) => {
	const dto = {
		schemaVersion: 1,
		workspaceId,
		actorSubject,
		commandId,
		expectedBillingVersion: '0',
		expectedPolicyVersion: policy.version,
		cycle: 'MONTHLY',
		totalSeats: 2,
		autoRenew: false,
		consentVersion: null,
		capacityFence: {
			operationId: commandId,
			requestHash: '',
			fenceRevision: 1,
			targetSeats: 2
		}
	};
	dto.capacityFence.requestHash = crmCommerceRequestHash(
		'AEROCRM_CHECKOUT',
		dto
	);
	return dto;
};

const seatChange = (commandId, periodId, expectedBillingVersion, seats) => {
	const dto = {
		schemaVersion: 1,
		workspaceId,
		actorSubject,
		commandId,
		expectedBillingVersion,
		expectedPeriodId: periodId,
		expectedPeriodVersion: 1,
		newTotalSeats: seats,
		capacityFence: {
			operationId: commandId,
			requestHash: '',
			fenceRevision: 1,
			targetSeats: seats
		}
	};
	dto.capacityFence.requestHash = crmCommerceRequestHash(
		'AEROCRM_SEAT_CHANGE',
		dto
	);
	return dto;
};

const invalidOrder = (patch = {}) => ({
	id: randomUUID(),
	workspaceId,
	ownerSubject: actorSubject,
	commandId: randomUUID(),
	capacityCommandId: randomUUID(),
	capacityFence: {
		operationId: randomUUID(),
		requestHash: 'a'.repeat(64),
		fenceRevision: 1,
		targetSeats: 2
	},
	kind: 'ONE_TIME',
	status: 'PENDING',
	cycle: 'MONTHLY',
	totalSeats: 2,
	amountMinor: 99000n,
	currency: 'RUB',
	policyVersion: 1,
	priceSnapshot: snapshot,
	autoRenew: false,
	consentVersion: null,
	consentText: null,
	consentedAt: null,
	providerPaymentId: null,
	providerIdempotencyKey: createHash('sha256')
		.update(randomUUID())
		.digest('hex'),
	checkoutExpiresAt: new Date(Date.now() + 3600000),
	...patch
});

const expectDeferredInsertRollback = async (patch, id) => {
	await assert.rejects(
		prisma.$transaction(async tx => {
			await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
			await tx.crmOrder.create({ data: invalidOrder({ id, ...patch }) });
		}),
		error => ['P2003', '23503'].includes(error?.code) || error?.meta?.code === '23503'
	);
	assert.equal(await prisma.crmOrder.count({ where: { id } }), 0);
};

try {
	phase = 'preflight';
	const [server] = await prisma.$queryRaw`
		SELECT current_setting('server_version_num')::integer AS version,
		       current_user AS role
	`;
	assert.ok(server.version >= 180000 && server.version < 190000);
	assert.equal(server.role, runtimeRole);
	const [role] = await prisma.$queryRaw`
		SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
		FROM pg_roles WHERE rolname = current_user
	`;
	assert.ok(Object.values(role).every(value => value === false));
	const constraints = await prisma.$queryRaw`
		SELECT conname, condeferrable, condeferred
		FROM pg_constraint
		WHERE conname IN (
			'crm_orders_capacity_command_id_workspace_id_owner_subject_fkey',
			'crm_commerce_accounts_capacity_owner_fkey'
		)
		ORDER BY conname
	`;
	assert.equal(constraints.length, 2);
	assert.ok(constraints.every(row => row.condeferrable && row.condeferred));

	await prisma.crmCommercialPolicy.create({ data: policy });
	await prisma.identityContactProjection.create({
		data: { userId: actorSubject, status: 'ACTIVE', email: 'owner@example.test' }
	});

	phase = 'checkout-replay-and-provider-durability';
	const checkoutCommand = checkout();
	const first = await service.checkout(checkoutCommand);
	const replay = await service.checkout(checkoutCommand);
	assert.equal(first.status, 'PENDING');
	assert.equal(replay.status, 'PENDING');
	assert.equal(replay.order.id, first.order.id);
	assert.equal(
		await prisma.crmCommerceCommand.count({ where: { commandId: checkoutCommand.commandId } }),
		1
	);
	assert.equal(
		await prisma.crmOrder.count({ where: { commandId: checkoutCommand.commandId } }),
		1
	);
	assert.equal(
		await prisma.crmProviderOperation.count({ where: { orderId: first.order.id } }),
		1
	);
	assert.equal(
		await prisma.outboxEvent.count({ where: { aggregateId: { not: '' } } }),
		1
	);
	const order = await prisma.crmOrder.findUniqueOrThrow({
		where: { id: first.order.id }
	});
	assert.equal(order.autoRenew, false);
	assert.equal(order.customerEmail, 'owner@example.test');
	assert.equal(order.capacityCommandId, checkoutCommand.commandId);
	assert.equal(order.capacityFence.operationId, checkoutCommand.commandId);

	phase = 'change-seats-deferred-capacity-binding';
	await prisma.crmOrder.update({
		where: { id: order.id },
		data: { status: 'SUCCEEDED', succeededAt: new Date() }
	});
	const periodId = randomUUID();
	await prisma.crmPaidPeriod.create({
		data: {
			id: periodId,
			workspaceId,
			orderId: order.id,
			version: 1,
			cycle: 'MONTHLY',
			totalSeats: 2,
			originalSeats: 2,
			priceSnapshot: snapshot,
			startsAt: new Date(Date.now() - 86400000),
			expiresAt: new Date(Date.now() + 86400000 * 30),
			originalExpiresAt: new Date(Date.now() + 86400000 * 30),
			graceUntil: new Date(Date.now() + 86400000 * 33)
		}
	});
	const change = seatChange(randomUUID(), periodId, '2', 3);
	const changed = await service.changeSeats(change);
	assert.equal(changed.status, 'COMMITTED');
	assert.equal(changed.period.totalSeats, 3);
	assert.equal(
		await prisma.crmCommerceCommand.count({ where: { commandId: change.commandId } }),
		1
	);
	const account = await prisma.crmCommerceAccount.findUniqueOrThrow({
		where: { workspaceId }
	});
	assert.equal(account.capacityCommandId, change.commandId);
	assert.equal(account.ownerSubject, actorSubject);
	const changedPeriod = await prisma.crmPaidPeriod.findUniqueOrThrow({
		where: { id: periodId }
	});
	assert.equal(changedPeriod.totalSeats, 3);

	phase = 'dangling-owner-workspace-fk-rollback';
	const danglingId = randomUUID();
	await expectDeferredInsertRollback(
		{ capacityCommandId: randomUUID() },
		danglingId
	);
	const wrongOwnerId = randomUUID();
	await expectDeferredInsertRollback(
		{ capacityCommandId: checkoutCommand.commandId, ownerSubject: 'different-owner' },
		wrongOwnerId
	);
	const wrongWorkspace = randomUUID();
	await prisma.crmCommerceAccount.create({
		data: { workspaceId: wrongWorkspace, ownerSubject: actorSubject, version: 1n }
	});
	const wrongWorkspaceId = randomUUID();
	try {
		await expectDeferredInsertRollback(
			{
				workspaceId: wrongWorkspace,
				capacityCommandId: checkoutCommand.commandId
			},
			wrongWorkspaceId
		);
	} finally {
		await prisma.crmCommerceAccount.delete({ where: { workspaceId: wrongWorkspace } });
	}

	phase = 'immutable-binding-survives-rollback';
	const before = await prisma.crmOrder.findUniqueOrThrow({
		where: { id: order.id }
	});
	await assert.rejects(
		prisma.$transaction(async tx => {
			await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
			await tx.crmOrder.update({
				where: { id: order.id },
				data: {
					capacityCommandId: randomUUID(),
					capacityFence: { ...before.capacityFence, operationId: randomUUID() }
				}
			});
		}),
		error =>
			error?.message?.includes('aeroCRM order purchase snapshot is immutable') ||
			error?.meta?.database_error?.includes(
				'aeroCRM order purchase snapshot is immutable'
			)
	);
	const after = await prisma.crmOrder.findUniqueOrThrow({
		where: { id: order.id }
	});
	assert.equal(after.ownerSubject, before.ownerSubject);
	assert.equal(after.workspaceId, before.workspaceId);
	assert.equal(after.capacityCommandId, checkoutCommand.commandId);
	assert.deepEqual(after.capacityFence, before.capacityFence);

	console.log(
		'PASS aeroCRM Billing PostgreSQL18: deferred capacity FKs, checkout replay, durable provider outbox, seat change, wrong-owner/workspace rollback and immutable bindings'
	);
} catch (error) {
	console.error(
		JSON.stringify({
			phase,
			name: error?.name,
			code: error?.code,
			sqlState: error?.meta?.code,
			message: error?.message
		})
	);
	process.exitCode = 1;
} finally {
	await prisma.$disconnect();
}

function required(name) {
	const value = process.env[name]?.trim();
	assert.ok(value, `${name} is required`);
	return value;
}
