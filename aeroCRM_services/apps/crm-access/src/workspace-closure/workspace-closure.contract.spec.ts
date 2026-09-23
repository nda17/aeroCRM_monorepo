import {
	CLOSURE_PARTICIPANT_SERVICES,
	parseClosureCommand,
	parseClosureFence,
	parseClosureView,
	parseIntakeSettlementAck,
	parseParticipantAck
} from './workspace-closure.contract';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const closureId = '22222222-2222-4222-8222-222222222222';
const commandId = '33333333-3333-4333-8333-333333333333';
const binding = { closureId, workspaceId, generation: '1' as const };
const at = '2026-09-23T12:00:00.000Z';

const participantSteps = CLOSURE_PARTICIPANT_SERVICES.map((service) => ({
	service,
	state: 'PENDING',
	lastErrorCode: null
}));

const view = {
	id: closureId,
	workspaceId,
	displayName: 'Студия Север',
	state: 'CLOSING',
	version: '1',
	requestedAt: at,
	closedAt: null,
	steps: participantSteps,
	financialPendingCount: 1,
	priorDispatchCount: 2,
	lastErrorCode: null
};

describe('workspace closure wire contracts', () => {
	it('accepts the version-zero command and rejects additional or unsafe data', () => {
		const command = {
			schemaVersion: 1,
			commandId,
			workspaceId,
			expectedVersion: '0',
			confirmationLabel: 'Студия Север'
		};
		expect(parseClosureCommand(command)).toEqual(command);
		expect(parseClosureCommand({ ...command, extra: true })).toBeNull();
		expect(parseClosureCommand({ ...command, expectedVersion: '1' })).toBeNull();
		expect(parseClosureCommand({ ...command, confirmationLabel: 'x'.repeat(201) })).toBeNull();
	});

	it('accepts exact fence envelope and refuses wrong keys or invalid binding', () => {
		const envelope = {
			schemaVersion: 1,
			...binding,
			ownerSubject: 'owner-subject',
			requestedAt: at
		};
		expect(parseClosureFence(envelope)).toEqual(envelope);
		expect(parseClosureFence({ ...envelope, token: 'secret' })).toBeNull();
		expect(parseClosureFence({ ...envelope, generation: '01' })).toBeNull();
		expect(parseClosureFence({ ...envelope, requestedAt: 'not-a-date' })).toBeNull();
	});

	it('parses strict ClosureView and requires every participant in canonical order', () => {
		expect(parseClosureView(view)).toEqual(view);
		expect(parseClosureView({ ...view, version: '0' })).toBeNull();
		expect(parseClosureView({ ...view, steps: participantSteps.slice(1) })).toBeNull();
		expect(parseClosureView({ ...view, steps: [...participantSteps].reverse() })).toBeNull();
		expect(parseClosureView({ ...view, undisclosed: true })).toBeNull();
	});

	it('binds participant acknowledgments to expected service, closure, workspace, and generation', () => {
		const ack = {
			schemaVersion: 1,
			service: 'billing',
			...binding,
			state: 'FENCED',
			fencedAt: at,
			financialPendingCount: 3,
			priorDispatchCount: 0
		};
		expect(parseParticipantAck(ack, 'billing', binding)).toEqual(ack);
		expect(parseParticipantAck(ack, 'identity', binding)).toBeNull();
		expect(parseParticipantAck({ ...ack, workspaceId: commandId }, 'billing', binding)).toBeNull();
		expect(parseParticipantAck({ ...ack, priorDispatchCount: 1 }, 'billing', binding)).toBeNull();
		expect(parseParticipantAck({ ...ack, internalUrl: 'http://internal' }, 'billing', binding)).toBeNull();
	});

	it('accepts only internally consistent bounded Intake settlement acknowledgments', () => {
		const settling = {
			schemaVersion: 1,
			...binding,
			state: 'SETTLING',
			remaining: 2
		};
		const settled = { ...settling, state: 'SETTLED', remaining: 0 };
		expect(parseIntakeSettlementAck(settling, binding)).toEqual(settling);
		expect(parseIntakeSettlementAck(settled, binding)).toEqual(settled);
		expect(parseIntakeSettlementAck({ ...settled, remaining: 1 }, binding)).toBeNull();
		expect(parseIntakeSettlementAck({ ...settling, remaining: 0 }, binding)).toBeNull();
		expect(parseIntakeSettlementAck({ ...settling, closureId: commandId }, binding)).toBeNull();
	});
});
