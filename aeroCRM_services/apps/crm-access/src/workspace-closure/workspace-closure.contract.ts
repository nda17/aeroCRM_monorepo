export const CLOSURE_PARTICIPANT_SERVICES = [
	'crm-access',
	'identity',
	'billing',
	'crm-customers',
	'crm-sales',
	'crm-intake',
	'notification-delivery'
] as const;

export type WorkspaceClosureService =
	(typeof CLOSURE_PARTICIPANT_SERVICES)[number];
export type WorkspaceClosureParticipantState = 'PENDING' | 'FENCED' | 'SETTLED';
export type WorkspaceClosureState = 'CLOSING' | 'CLOSED';

export interface WorkspaceClosureFenceEnvelope {
	schemaVersion: 1;
	closureId: string;
	workspaceId: string;
	generation: '1';
	ownerSubject: string;
	requestedAt: string;
}

export interface WorkspaceClosureCommand {
	schemaVersion: 1;
	commandId: string;
	workspaceId: string;
	expectedVersion: '0';
	confirmationLabel: string;
}

export interface WorkspaceClosureView {
	id: string;
	workspaceId: string;
	displayName: string | null;
	state: WorkspaceClosureState;
	version: string;
	requestedAt: string;
	closedAt: string | null;
	steps: Array<{
		service: WorkspaceClosureService;
		state: WorkspaceClosureParticipantState;
		lastErrorCode: string | null;
	}>;
	financialPendingCount: number;
	priorDispatchCount: number;
	lastErrorCode: string | null;
}

export interface WorkspaceClosureParticipantAck {
	schemaVersion: 1;
	service: WorkspaceClosureService;
	closureId: string;
	workspaceId: string;
	generation: '1';
	state: 'FENCED';
	fencedAt: string;
	financialPendingCount: number;
	priorDispatchCount: number;
}

export interface WorkspaceClosureSettlementAck {
	schemaVersion: 1;
	closureId: string;
	workspaceId: string;
	generation: '1';
	state: 'SETTLING' | 'SETTLED';
	remaining: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: string[]) => {
	const actual = Object.keys(value);
	return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key));
};

const isUuid = (value: unknown): value is string =>
	typeof value === 'string' &&
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const isIsoDate = (value: unknown): value is string =>
	typeof value === 'string' &&
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
	Number.isFinite(Date.parse(value)) &&
	new Date(value).toISOString() === value;

const isPositiveDecimal = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.length <= 19 &&
	/^[1-9][0-9]*$/.test(value);

const isCount = (value: unknown): value is number =>
	typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isNullableBoundedString = (value: unknown, maxLength: number) =>
	value === null ||
	(typeof value === 'string' &&
		value.length > 0 &&
		value.length <= maxLength &&
		!/[\x00-\x1f\x7f]/.test(value));

export const parseClosureCommand = (
	value: unknown
): WorkspaceClosureCommand | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'commandId',
			'workspaceId',
			'expectedVersion',
			'confirmationLabel'
		]) ||
		value.schemaVersion !== 1 ||
		!isUuid(value.commandId) ||
		!isUuid(value.workspaceId) ||
		value.expectedVersion !== '0' ||
		typeof value.confirmationLabel !== 'string' ||
		value.confirmationLabel.length === 0 ||
		value.confirmationLabel.length > 200
	) {
		return null;
	}
	return {
		schemaVersion: 1,
		commandId: value.commandId,
		workspaceId: value.workspaceId,
		expectedVersion: '0',
		confirmationLabel: value.confirmationLabel
	};
};

export const parseClosureFence = (
	value: unknown
): WorkspaceClosureFenceEnvelope | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'closureId',
			'workspaceId',
			'generation',
			'ownerSubject',
			'requestedAt'
		]) ||
		value.schemaVersion !== 1 ||
		!isUuid(value.closureId) ||
		!isUuid(value.workspaceId) ||
		value.generation !== '1' ||
		typeof value.ownerSubject !== 'string' ||
		value.ownerSubject.length === 0 ||
		value.ownerSubject.length > 256 ||
		/[\s\x00-\x1f\x7f]/.test(value.ownerSubject) ||
		!isIsoDate(value.requestedAt)
	) {
		return null;
	}
	return {
		schemaVersion: 1,
		closureId: value.closureId,
		workspaceId: value.workspaceId,
		generation: value.generation,
		ownerSubject: value.ownerSubject,
		requestedAt: value.requestedAt
	};
};

export const parseClosureView = (value: unknown): WorkspaceClosureView | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'id',
			'workspaceId',
			'displayName',
			'state',
			'version',
			'requestedAt',
			'closedAt',
			'steps',
			'financialPendingCount',
			'priorDispatchCount',
			'lastErrorCode'
		]) ||
		!isUuid(value.id) ||
		!isUuid(value.workspaceId) ||
		!isNullableBoundedString(value.displayName, 200) ||
		(value.state !== 'CLOSING' && value.state !== 'CLOSED') ||
		!isPositiveDecimal(value.version) ||
		!isIsoDate(value.requestedAt) ||
		!(value.closedAt === null || isIsoDate(value.closedAt)) ||
		(value.state === 'CLOSED') !== (value.closedAt !== null) ||
		!Array.isArray(value.steps) ||
		value.steps.length !== CLOSURE_PARTICIPANT_SERVICES.length ||
		!isCount(value.financialPendingCount) ||
		!isCount(value.priorDispatchCount) ||
		!isNullableBoundedString(value.lastErrorCode, 80)
	) {
		return null;
	}

	const steps: WorkspaceClosureView['steps'] = [];
	for (const [index, rawStep] of value.steps.entries()) {
		if (
			!isRecord(rawStep) ||
			!hasExactKeys(rawStep, ['service', 'state', 'lastErrorCode']) ||
			rawStep.service !== CLOSURE_PARTICIPANT_SERVICES[index] ||
			(rawStep.state !== 'PENDING' &&
				rawStep.state !== 'FENCED' &&
				rawStep.state !== 'SETTLED') ||
			!isNullableBoundedString(rawStep.lastErrorCode, 80)
		) {
			return null;
		}
		steps.push({
			service: CLOSURE_PARTICIPANT_SERVICES[index],
			state: rawStep.state as WorkspaceClosureParticipantState,
			lastErrorCode: rawStep.lastErrorCode as string | null
		});
	}
	if (
		value.state === 'CLOSED' &&
		(steps.some(step => step.state === 'PENDING') ||
			steps.find(step => step.service === 'crm-intake')?.state !== 'SETTLED')
	) {
		return null;
	}

	return {
		id: value.id,
		workspaceId: value.workspaceId,
		displayName: value.displayName as string | null,
		state: value.state,
		version: value.version,
		requestedAt: value.requestedAt,
		closedAt: value.closedAt,
		steps,
		financialPendingCount: value.financialPendingCount,
		priorDispatchCount: value.priorDispatchCount,
		lastErrorCode: value.lastErrorCode as string | null
	};
};

export const parseParticipantAck = (
	value: unknown,
	expectedService: WorkspaceClosureService,
	expectedEnvelope: Pick<
		WorkspaceClosureFenceEnvelope,
		'closureId' | 'workspaceId' | 'generation'
	>
): WorkspaceClosureParticipantAck | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'service',
			'closureId',
			'workspaceId',
			'generation',
			'state',
			'fencedAt',
			'financialPendingCount',
			'priorDispatchCount'
		]) ||
		value.schemaVersion !== 1 ||
		value.service !== expectedService ||
		value.closureId !== expectedEnvelope.closureId ||
		value.workspaceId !== expectedEnvelope.workspaceId ||
		value.generation !== expectedEnvelope.generation ||
		value.state !== 'FENCED' ||
		!isIsoDate(value.fencedAt) ||
		!isCount(value.financialPendingCount) ||
		!isCount(value.priorDispatchCount) ||
		(expectedService !== 'billing' && value.financialPendingCount !== 0) ||
		(expectedService !== 'notification-delivery' && value.priorDispatchCount !== 0)
	) {
		return null;
	}
	return value as unknown as WorkspaceClosureParticipantAck;
};

export const parseIntakeSettlementAck = (
	value: unknown,
	expectedEnvelope: Pick<
		WorkspaceClosureFenceEnvelope,
		'closureId' | 'workspaceId' | 'generation'
	>
): WorkspaceClosureSettlementAck | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'closureId',
			'workspaceId',
			'generation',
			'state',
			'remaining'
		]) ||
		value.schemaVersion !== 1 ||
		value.closureId !== expectedEnvelope.closureId ||
		value.workspaceId !== expectedEnvelope.workspaceId ||
		value.generation !== expectedEnvelope.generation ||
		(value.state !== 'SETTLING' && value.state !== 'SETTLED') ||
		!isCount(value.remaining) ||
		(value.state === 'SETTLED' && value.remaining !== 0) ||
		(value.state === 'SETTLING' && value.remaining === 0)
	) {
		return null;
	}
	return value as unknown as WorkspaceClosureSettlementAck;
};
