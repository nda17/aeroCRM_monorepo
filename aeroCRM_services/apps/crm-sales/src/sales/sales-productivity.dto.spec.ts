import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
	BulkAssignmentApplyDto,
	BulkAssignmentPreviewDto,
	LossReportQuery,
	SaveLossReasonsDto,
	TransitionDealV2Dto
} from './sales-productivity.dto';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const commandId = '22222222-2222-4222-8222-222222222222';
const membershipId = '33333333-3333-4333-8333-333333333333';
const dealId = '44444444-4444-4444-8444-444444444444';
const errors = (type: new () => object, input: object) =>
	validate(plainToInstance(type, input), { whitelist: true, forbidNonWhitelisted: true });

const lossReasons = () => ({
	schemaVersion: 1,
	workspaceId,
	commandId,
	actorMembershipId: null,
	expectedVersion: 0,
	reasons: [{ id: dealId, title: 'Price', archived: false }]
});
const transition = () => ({
	schemaVersion: 1,
	workspaceId,
	commandId,
	expectedVersion: 1,
	targetStageId: '55555555-5555-4555-8555-555555555555',
	outcome: 'Lost to competitor',
	actorMembershipId: membershipId,
	lossReason: { id: dealId, settingsVersion: 1 }
});
const preview = () => ({
	schemaVersion: 1,
	workspaceId,
	actorMembershipId: null,
	assignee: { subject: 'employee-1', membershipId },
	deals: [{ id: dealId, expectedVersion: 1 }]
});

describe('sales productivity request DTOs', () => {
	it('accepts and rejects loss-reason settings at schema and field boundaries', async () => {
		expect(await errors(SaveLossReasonsDto, lossReasons())).toHaveLength(0);
		expect(await errors(SaveLossReasonsDto, { ...lossReasons(), actorMembershipId: membershipId })).toHaveLength(0);
		for (const patch of [
			{ actorMembershipId: undefined },
			{ actorMembershipId: 'not-a-uuid' },
			{ schemaVersion: 2 },
			{ expectedVersion: -1 },
			{ expectedVersion: 2147483647 },
			{ reasons: undefined },
			{ reasons: Array.from({ length: 51 }, (_, i) => ({ id: `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`, title: `Reason ${i}`, archived: false })) },
			{ reasons: [{ id: dealId, title: ' \t ', archived: false }] },
			{ reasons: [{ id: dealId, title: 'Bad\nTitle', archived: false }] },
			{ reasons: [{ id: dealId, title: 'Price', archived: 'false' }] },
			{ reasons: [{ id: dealId, title: 'Price', archived: false, extra: 1 }] }
		]) expect(await errors(SaveLossReasonsDto, { ...lossReasons(), ...patch })).not.toHaveLength(0);
		expect(await errors(SaveLossReasonsDto, { ...lossReasons(), reasons: [{ id: dealId, title: 'Price', archived: false }, { id: dealId, title: 'Other', archived: false }] })).not.toHaveLength(0);
		expect(await errors(SaveLossReasonsDto, { ...lossReasons(), reasons: [{ id: dealId, title: 'Price', archived: false }, { id: '66666666-6666-4666-8666-666666666666', title: ' price ', archived: false }] })).not.toHaveLength(0);
	});

	it('requires explicit nullable transition fields and validates nested reason references', async () => {
		expect(await errors(TransitionDealV2Dto, transition())).toHaveLength(0);
		expect(await errors(TransitionDealV2Dto, { ...transition(), actorMembershipId: null, lossReason: null })).toHaveLength(0);
		for (const patch of [
			{ actorMembershipId: undefined },
			{ actorMembershipId: 'unknown' },
			{ lossReason: undefined },
			{ lossReason: {} },
			{ lossReason: { id: dealId, settingsVersion: -1 } },
			{ lossReason: { id: 'bad', settingsVersion: 0 } },
			{ outcome: undefined },
			{ targetStageId: 'bad' }
		]) expect(await errors(TransitionDealV2Dto, { ...transition(), ...patch })).not.toHaveLength(0);
	});

	it('requires a bounded unique preview and a matching apply contract shape', async () => {
		expect(await errors(BulkAssignmentPreviewDto, preview())).toHaveLength(0);
		expect(await errors(BulkAssignmentPreviewDto, { ...preview(), actorMembershipId: membershipId })).toHaveLength(0);
		for (const patch of [
			{ actorMembershipId: undefined },
			{ assignee: undefined },
			{ assignee: { subject: 'employee-1', membershipId: 'bad' } },
			{ deals: [] },
			{ deals: [{ id: dealId, expectedVersion: 0 }] },
			{ deals: [{ id: dealId, expectedVersion: 1 }, { id: dealId, expectedVersion: 2 }] },
			{ deals: Array.from({ length: 26 }, (_, i) => ({ id: `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`, expectedVersion: 1 })) },
			{ unexpected: true }
		]) expect(await errors(BulkAssignmentPreviewDto, { ...preview(), ...patch })).not.toHaveLength(0);
		const apply = { ...preview(), commandId, previewHash: 'a'.repeat(64) };
		expect(await errors(BulkAssignmentApplyDto, apply)).toHaveLength(0);
		for (const patch of [{ commandId: undefined }, { previewHash: 'A'.repeat(64) }, { previewHash: 'f'.repeat(63) }])
			expect(await errors(BulkAssignmentApplyDto, { ...apply, ...patch })).not.toHaveLength(0);
	});

	it('validates loss report filters as paired optional strings and rejects unknown keys', async () => {
		const base = { workspaceId };
		expect(await errors(LossReportQuery, base)).toHaveLength(0);
		expect(await errors(LossReportQuery, { ...base, pipelineId: commandId, lostFrom: '2026-01-01T00:00:00.000Z', lostTo: '2026-12-31T23:59:59.999Z' })).toHaveLength(0);
		for (const patch of [
			{ pipelineId: 'bad' },
			{ lostFrom: null },
			{ lostFrom: '2026-01-01' },
			{ lostTo: 'tomorrow' },
			{ extra: 'rejected' }
		]) expect(await errors(LossReportQuery, { ...base, ...patch })).not.toHaveLength(0);
	});
});
