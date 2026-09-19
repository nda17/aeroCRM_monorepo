export const CRM_ADMIN_UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface CrmAdminSubscription {
	workspaceId: string
	ownerSubject: string
	entitlementVersion: string
	billingVersion: string
	entitlement: {
		planCode: string
		status: string
		seatLimit: number | null
		effectiveFrom: string
		effectiveUntil: string
		graceUntil: string | null
	}
	period: {
		id: string
		version: number
		startsAt: string
		expiresAt: string
		graceUntil: string
		totalSeats: number
	} | null
	renewal: { status: string; nextChargeAt: string } | null
	extensionTarget: 'ENTITLEMENT' | 'PAID_PERIOD'
	blockedReason: string | null
}

export interface CrmAdminGrantCommand {
	schemaVersion: 1
	commandId: string
	expectedActorSubject: string
	expectedEntitlementVersion: string
	expectedBillingVersion: string
	expectedPeriodId: string | null
	expectedPeriodVersion: number | null
	days: number
	reason: string
}

export class CrmAdminGrantNotSentError extends Error {
	constructor() {
		super('CRM grant authentication changed before dispatch')
		this.name = 'CrmAdminGrantNotSentError'
	}
}

export interface CrmAdminGrant {
	commandId: string
	workspaceId: string
	actorSubject: string
	actorRole: 'ADMIN' | 'DEV'
	days: number
	reason: string
	target: 'ENTITLEMENT' | 'PAID_PERIOD'
	periodId: string | null
	oldExpiresAt: string
	newExpiresAt: string
	createdAt: string
}

export interface CrmAdminGrantResult {
	schemaVersion: 1
	workspaceId: string
	commandId: string
	grant: CrmAdminGrant
	subscription: CrmAdminSubscription
}

export type CrmAdminCommandRecovery = {
	schemaVersion: 1
	workspaceId: string
	commandId: string
	actorSubject: string
} & (
	| { outcome: 'COMMITTED'; result: CrmAdminGrantResult }
	| {
			outcome: 'CANCELLED'
			actorRole: 'ADMIN' | 'DEV'
			cancelledAt: string
	  }
)

export interface CrmAdminPage<T> {
	schemaVersion: 1
	page: number
	pageSize: number
	total: number
	items: T[]
}

const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, maximum = 256): value is string =>
	typeof value === 'string' && value.length > 0 && value.length <= maximum
const subject = (value: unknown): value is string =>
	text(value) && /^\S+$/.test(value)
const uuid = (value: unknown): value is string =>
	typeof value === 'string' && CRM_ADMIN_UUID.test(value)
const integer = (value: unknown, minimum = 1, maximum = 2_147_483_647) =>
	Number.isSafeInteger(value) &&
	(value as number) >= minimum &&
	(value as number) <= maximum
const version = (value: unknown, zero = false): value is string =>
	typeof value === 'string' &&
	(zero ? /^(0|[1-9][0-9]{0,18})$/ : /^[1-9][0-9]{0,18}$/).test(value) &&
	BigInt(value) <= BigInt('9223372036854775807')
const date = (value: unknown): value is string => {
	if (typeof value !== 'string' || value.length !== 24) return false
	const parsed = new Date(value)
	return (
		Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
	)
}
const target = (value: unknown) =>
	value === 'ENTITLEMENT' || value === 'PAID_PERIOD'
const exact = (value: Record<string, unknown>, keys: string[]) =>
	Object.keys(value).length === keys.length &&
	keys.every(key => Object.hasOwn(value, key))

export function parseCrmAdminSubscription(
	value: unknown
): CrmAdminSubscription {
	if (
		!record(value) ||
		!exact(value, [
			'workspaceId',
			'ownerSubject',
			'entitlementVersion',
			'billingVersion',
			'entitlement',
			'period',
			'renewal',
			'extensionTarget',
			'blockedReason'
		]) ||
		!uuid(value.workspaceId) ||
		!subject(value.ownerSubject) ||
		!version(value.entitlementVersion) ||
		!version(value.billingVersion, true) ||
		!target(value.extensionTarget) ||
		!(value.blockedReason === null || text(value.blockedReason, 128))
	)
		throw new Error('Invalid CRM admin subscription')
	const entitlement = value.entitlement
	if (
		!record(entitlement) ||
		!exact(entitlement, [
			'planCode',
			'status',
			'seatLimit',
			'effectiveFrom',
			'effectiveUntil',
			'graceUntil'
		]) ||
		!text(entitlement.planCode, 32) ||
		![
			'ACTIVE',
			'GRACE',
			'READ_ONLY',
			'SUSPENDED',
			'EXPIRED',
			'CANCELLED'
		].includes(String(entitlement.status)) ||
		!(
			entitlement.seatLimit === null || integer(entitlement.seatLimit, 2)
		) ||
		!date(entitlement.effectiveFrom) ||
		!date(entitlement.effectiveUntil) ||
		!(entitlement.graceUntil === null || date(entitlement.graceUntil))
	)
		throw new Error('Invalid CRM admin entitlement')
	const period = value.period
	if (
		period !== null &&
		(!record(period) ||
			!exact(period, [
				'id',
				'version',
				'startsAt',
				'expiresAt',
				'graceUntil',
				'totalSeats'
			]) ||
			!uuid(period.id) ||
			!integer(period.version) ||
			!date(period.startsAt) ||
			!date(period.expiresAt) ||
			!date(period.graceUntil) ||
			!integer(period.totalSeats, 2))
	)
		throw new Error('Invalid CRM admin paid period')
	const renewal = value.renewal
	if (
		renewal !== null &&
		(!record(renewal) ||
			!exact(renewal, ['status', 'nextChargeAt']) ||
			!text(renewal.status, 32) ||
			!date(renewal.nextChargeAt))
	)
		throw new Error('Invalid CRM admin renewal')
	if ((value.extensionTarget === 'PAID_PERIOD') !== (period !== null))
		throw new Error('Mismatched CRM admin extension target')
	return value as unknown as CrmAdminSubscription
}

export function parseCrmAdminSubscriptionDetail(
	value: unknown,
	workspaceId: string
) {
	if (
		!record(value) ||
		value.schemaVersion !== 1 ||
		!exact(value, ['schemaVersion', 'subscription'])
	)
		throw new Error('Invalid CRM admin detail')
	const subscription = parseCrmAdminSubscription(value.subscription)
	if (subscription.workspaceId !== workspaceId)
		throw new Error('Unexpected CRM admin workspace')
	return subscription
}

export function createCrmAdminGrantCommand(
	subscription: CrmAdminSubscription,
	daysInput: string,
	reasonInput: string,
	commandId: string,
	actorSubject: string
): CrmAdminGrantCommand {
	const days = Number(daysInput)
	const reason = reasonInput.trim()
	parseCrmAdminSubscription(subscription)
	if (
		!uuid(commandId) ||
		!subject(actorSubject) ||
		!/^\d+$/.test(daysInput.trim()) ||
		!integer(days, 1, 3650) ||
		reason.length < 3 ||
		reason.length > 1000 ||
		subscription.blockedReason
	)
		throw new Error('Invalid CRM admin grant command')
	return {
		schemaVersion: 1,
		commandId,
		expectedActorSubject: actorSubject,
		expectedEntitlementVersion: subscription.entitlementVersion,
		expectedBillingVersion: subscription.billingVersion,
		expectedPeriodId: subscription.period?.id ?? null,
		expectedPeriodVersion: subscription.period?.version ?? null,
		days,
		reason
	}
}

export function parseCrmAdminGrant(value: unknown): CrmAdminGrant {
	if (
		!record(value) ||
		!exact(value, [
			'commandId',
			'workspaceId',
			'actorSubject',
			'actorRole',
			'days',
			'reason',
			'target',
			'periodId',
			'oldExpiresAt',
			'newExpiresAt',
			'createdAt'
		]) ||
		!uuid(value.commandId) ||
		!uuid(value.workspaceId) ||
		!subject(value.actorSubject) ||
		!['ADMIN', 'DEV'].includes(String(value.actorRole)) ||
		!integer(value.days, 1, 3650) ||
		!text(value.reason, 1000) ||
		value.reason.trim().length < 3 ||
		!target(value.target) ||
		!(value.periodId === null || uuid(value.periodId)) ||
		!date(value.oldExpiresAt) ||
		!date(value.newExpiresAt) ||
		!date(value.createdAt) ||
		(value.target === 'PAID_PERIOD') !== (value.periodId !== null) ||
		value.newExpiresAt <= value.oldExpiresAt
	)
		throw new Error('Invalid CRM admin grant receipt')
	return value as unknown as CrmAdminGrant
}

export function parseCrmAdminGrantResult(
	value: unknown,
	workspaceId: string,
	commandId: string,
	actorSubject: string,
	command?: CrmAdminGrantCommand
): CrmAdminGrantResult {
	if (
		!record(value) ||
		!exact(value, [
			'schemaVersion',
			'workspaceId',
			'commandId',
			'grant',
			'subscription'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		value.commandId !== commandId
	)
		throw new Error('Invalid CRM admin command result')
	const grant = parseCrmAdminGrant(value.grant)
	const subscription = parseCrmAdminSubscription(value.subscription)
	if (
		grant.workspaceId !== workspaceId ||
		grant.commandId !== commandId ||
		grant.actorSubject !== actorSubject ||
		subscription.workspaceId !== workspaceId ||
		(command &&
			(command.expectedActorSubject !== actorSubject ||
				grant.days !== command.days ||
				grant.reason !== command.reason ||
				grant.periodId !== command.expectedPeriodId)) ||
		(grant.target === 'PAID_PERIOD'
			? subscription.period?.id !== grant.periodId ||
				subscription.period.expiresAt !== grant.newExpiresAt
			: subscription.entitlement.effectiveUntil !== grant.newExpiresAt)
	)
		throw new Error('Unexpected CRM admin command result')
	return { schemaVersion: 1, workspaceId, commandId, grant, subscription }
}

export function parseCrmAdminCommandRecovery(
	value: unknown,
	workspaceId: string,
	commandId: string,
	actorSubject: string
): CrmAdminCommandRecovery {
	if (
		!record(value) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		value.commandId !== commandId ||
		value.actorSubject !== actorSubject
	)
		throw new Error('Unexpected CRM admin recovery binding')
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
	) {
		return {
			schemaVersion: 1,
			workspaceId,
			commandId,
			actorSubject,
			outcome: 'COMMITTED',
			result: parseCrmAdminGrantResult(
				value.result,
				workspaceId,
				commandId,
				actorSubject
			)
		}
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
	) {
		return {
			schemaVersion: 1,
			workspaceId,
			commandId,
			actorSubject,
			outcome: 'CANCELLED',
			actorRole: value.actorRole,
			cancelledAt: value.cancelledAt
		}
	}
	throw new Error('Invalid CRM admin terminal recovery proof')
}

export function parseCrmAdminPage<T>(
	value: unknown,
	parseItem: (item: unknown) => T,
	page: number,
	pageSize: number
): CrmAdminPage<T> {
	if (
		!record(value) ||
		!exact(value, [
			'schemaVersion',
			'page',
			'pageSize',
			'total',
			'items'
		]) ||
		value.schemaVersion !== 1 ||
		value.page !== page ||
		value.pageSize !== pageSize ||
		!integer(value.total, 0, Number.MAX_SAFE_INTEGER) ||
		!Array.isArray(value.items) ||
		value.items.length > pageSize ||
		value.items.length > (value.total as number)
	)
		throw new Error('Invalid CRM admin page')
	return {
		schemaVersion: 1,
		page,
		pageSize,
		total: value.total as number,
		items: value.items.map(parseItem)
	}
}

export function parseCrmAdminHistory(
	value: unknown,
	workspaceId: string,
	page: number,
	pageSize: number
) {
	if (!record(value) || value.workspaceId !== workspaceId)
		throw new Error('Unexpected CRM admin history workspace')
	const { workspaceId: responseWorkspace, ...response } = value
	const history = parseCrmAdminPage(
		response,
		parseCrmAdminGrant,
		page,
		pageSize
	)
	if (history.items.some(item => item.workspaceId !== responseWorkspace))
		throw new Error('Unexpected CRM admin history entry')
	return history
}
