import {
	CRM_ADMIN_UUID,
	parseCrmAdminPage,
	parseCrmAdminSubscription,
	type CrmAdminGrantCommand,
	type CrmAdminSubscription
} from './crm-subscriptions.contract'

export interface CrmAdminSeatsContext {
	schemaVersion: 1
	subscription: CrmAdminSubscription
	capacity: {
		usedSeats: number
		minimumSeats: number
		maximumSeats: 10000
	}
	canSetSeats: boolean
	blockedReason: string | null
}
export type CrmAdminSeatsCommand = Omit<CrmAdminGrantCommand, 'days'> & {
	totalSeats: number
}
export interface CrmAdminSeatAdjustment {
	commandId: string
	workspaceId: string
	actorSubject: string
	actorRole: 'ADMIN' | 'DEV'
	reason: string
	target: 'ENTITLEMENT' | 'PAID_PERIOD'
	periodId: string | null
	oldTotalSeats: number
	newTotalSeats: number
	effectiveUntil: string
	createdAt: string
}
export interface CrmAdminSeatsResult {
	schemaVersion: 1
	workspaceId: string
	commandId: string
	adjustment: CrmAdminSeatAdjustment
	subscription: CrmAdminSubscription
}
export type CrmAdminSeatsRecovery = {
	schemaVersion: 1
	workspaceId: string
	commandId: string
	actorSubject: string
} & (
	| { outcome: 'COMMITTED'; result: CrmAdminSeatsResult }
	| {
			outcome: 'CANCELLED'
			actorRole: 'ADMIN' | 'DEV'
			cancelledAt: string
	  }
)

const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
const exact = (value: Record<string, unknown>, keys: string[]) =>
	Object.keys(value).length === keys.length &&
	keys.every(key => Object.hasOwn(value, key))
const integer = (value: unknown, minimum: number, maximum = 10000) =>
	Number.isSafeInteger(value) &&
	(value as number) >= minimum &&
	(value as number) <= maximum
const uuid = (value: unknown): value is string =>
	typeof value === 'string' && CRM_ADMIN_UUID.test(value)
const subject = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.length > 0 &&
	value.length <= 256 &&
	/^\S+$/.test(value)
const date = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.length === 24 &&
	Number.isFinite(Date.parse(value)) &&
	new Date(value).toISOString() === value

export function parseCrmAdminSeatsContext(
	value: unknown,
	workspaceId: string
): CrmAdminSeatsContext {
	if (
		!record(value) ||
		!exact(value, [
			'schemaVersion',
			'subscription',
			'capacity',
			'canSetSeats',
			'blockedReason'
		]) ||
		value.schemaVersion !== 1 ||
		!record(value.capacity) ||
		!exact(value.capacity, [
			'usedSeats',
			'minimumSeats',
			'maximumSeats'
		]) ||
		!integer(value.capacity.usedSeats, 1) ||
		!integer(value.capacity.minimumSeats, 2) ||
		(value.capacity.minimumSeats as number) <
			(value.capacity.usedSeats as number) ||
		value.capacity.maximumSeats !== 10000 ||
		typeof value.canSetSeats !== 'boolean' ||
		!(
			value.blockedReason === null ||
			(typeof value.blockedReason === 'string' &&
				value.blockedReason.length > 0)
		) ||
		value.canSetSeats !== (value.blockedReason === null)
	)
		throw new Error('Invalid CRM admin seats context')
	const subscription = parseCrmAdminSubscription(value.subscription)
	if (subscription.workspaceId !== workspaceId)
		throw new Error('Unexpected CRM admin seats workspace')
	return { ...value, subscription } as CrmAdminSeatsContext
}

export function createCrmAdminSeatsCommand(
	context: CrmAdminSeatsContext,
	seatsInput: string,
	reasonInput: string,
	commandId: string,
	actorSubject: string
): CrmAdminSeatsCommand {
	parseCrmAdminSeatsContext(context, context.subscription.workspaceId)
	const totalSeats = Number(seatsInput)
	const reason = reasonInput.trim()
	if (
		!context.canSetSeats ||
		!uuid(commandId) ||
		!subject(actorSubject) ||
		!/^\d+$/.test(seatsInput.trim()) ||
		!integer(totalSeats, context.capacity.minimumSeats) ||
		totalSeats === context.subscription.entitlement.seatLimit ||
		reason.length < 3 ||
		reason.length > 1000
	)
		throw new Error('Invalid CRM admin seats command')
	return {
		schemaVersion: 1,
		commandId,
		expectedActorSubject: actorSubject,
		expectedEntitlementVersion: context.subscription.entitlementVersion,
		expectedBillingVersion: context.subscription.billingVersion,
		expectedPeriodId: context.subscription.period?.id ?? null,
		expectedPeriodVersion: context.subscription.period?.version ?? null,
		totalSeats,
		reason
	}
}

export function parseCrmAdminSeatAdjustment(
	value: unknown
): CrmAdminSeatAdjustment {
	if (
		!record(value) ||
		!exact(value, [
			'commandId',
			'workspaceId',
			'actorSubject',
			'actorRole',
			'reason',
			'target',
			'periodId',
			'oldTotalSeats',
			'newTotalSeats',
			'effectiveUntil',
			'createdAt'
		]) ||
		!uuid(value.commandId) ||
		!uuid(value.workspaceId) ||
		!subject(value.actorSubject) ||
		!['ADMIN', 'DEV'].includes(String(value.actorRole)) ||
		typeof value.reason !== 'string' ||
		value.reason.trim().length < 3 ||
		value.reason.length > 1000 ||
		!['ENTITLEMENT', 'PAID_PERIOD'].includes(String(value.target)) ||
		!(value.periodId === null || uuid(value.periodId)) ||
		(value.target === 'PAID_PERIOD') !== (value.periodId !== null) ||
		!integer(value.oldTotalSeats, 1) ||
		!integer(value.newTotalSeats, 2) ||
		value.oldTotalSeats === value.newTotalSeats ||
		!date(value.effectiveUntil) ||
		!date(value.createdAt)
	)
		throw new Error('Invalid CRM admin seat adjustment')
	return value as unknown as CrmAdminSeatAdjustment
}

export function parseCrmAdminSeatsResult(
	value: unknown,
	workspaceId: string,
	commandId: string,
	actorSubject: string,
	command?: CrmAdminSeatsCommand
): CrmAdminSeatsResult {
	if (
		!record(value) ||
		!exact(value, [
			'schemaVersion',
			'workspaceId',
			'commandId',
			'adjustment',
			'subscription'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		value.commandId !== commandId
	)
		throw new Error('Invalid CRM admin seats result')
	const adjustment = parseCrmAdminSeatAdjustment(value.adjustment)
	const subscription = parseCrmAdminSubscription(value.subscription)
	if (
		adjustment.workspaceId !== workspaceId ||
		adjustment.commandId !== commandId ||
		adjustment.actorSubject !== actorSubject ||
		subscription.workspaceId !== workspaceId ||
		subscription.entitlement.seatLimit !== adjustment.newTotalSeats ||
		(command &&
			(command.expectedActorSubject !== actorSubject ||
				command.totalSeats !== adjustment.newTotalSeats ||
				command.reason !== adjustment.reason ||
				command.expectedPeriodId !== adjustment.periodId)) ||
		(adjustment.target === 'PAID_PERIOD'
			? subscription.period?.id !== adjustment.periodId ||
				subscription.period.totalSeats !== adjustment.newTotalSeats ||
				subscription.period.expiresAt !== adjustment.effectiveUntil
			: subscription.entitlement.effectiveUntil !==
				adjustment.effectiveUntil)
	)
		throw new Error('Unexpected CRM admin seats result')
	return {
		schemaVersion: 1,
		workspaceId,
		commandId,
		adjustment,
		subscription
	}
}

export function parseCrmAdminSeatsRecovery(
	value: unknown,
	workspaceId: string,
	commandId: string,
	actorSubject: string
): CrmAdminSeatsRecovery {
	if (
		!record(value) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		value.commandId !== commandId ||
		value.actorSubject !== actorSubject
	)
		throw new Error('Unexpected CRM admin seats recovery binding')
	if (
		value.outcome === 'COMMITTED' &&
		exact(value, [
			'schemaVersion',
			'workspaceId',
			'commandId',
			'actorSubject',
			'outcome',
			'result'
		])
	)
		return {
			schemaVersion: 1,
			workspaceId,
			commandId,
			actorSubject,
			outcome: 'COMMITTED',
			result: parseCrmAdminSeatsResult(
				value.result,
				workspaceId,
				commandId,
				actorSubject
			)
		}
	if (
		value.outcome === 'CANCELLED' &&
		exact(value, [
			'schemaVersion',
			'workspaceId',
			'commandId',
			'actorSubject',
			'outcome',
			'actorRole',
			'cancelledAt'
		]) &&
		(value.actorRole === 'ADMIN' || value.actorRole === 'DEV') &&
		date(value.cancelledAt)
	)
		return {
			schemaVersion: 1,
			workspaceId,
			commandId,
			actorSubject,
			outcome: 'CANCELLED',
			actorRole: value.actorRole,
			cancelledAt: value.cancelledAt
		}
	throw new Error('Invalid CRM admin seats terminal proof')
}

export function parseCrmAdminSeatsHistory(
	value: unknown,
	workspaceId: string,
	page: number,
	pageSize: number
) {
	const result = parseCrmAdminPage(
		value,
		parseCrmAdminSeatAdjustment,
		page,
		pageSize
	)
	if (
		result.items.some(item => item.workspaceId !== workspaceId) ||
		new Set(result.items.map(item => item.commandId)).size !==
			result.items.length
	)
		throw new Error('Unexpected CRM admin seats history')
	return result
}
