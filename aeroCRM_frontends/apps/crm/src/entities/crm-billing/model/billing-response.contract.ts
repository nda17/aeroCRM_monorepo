import {
	hasExactKeys,
	isIsoDate,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'
import {
	billingCycle,
	billingEntityVersion,
	billingInteger,
	billingMinor,
	billingSeats,
	billingVersion,
	parseBillingPeriod,
	parseBillingPriceSnapshot
} from './billing-values.contract'
import type {
	BillingCommandProof,
	BillingContext,
	BillingHistory,
	BillingOperation,
	BillingOrder,
	BillingOrderResponse,
	BillingRenewal,
	BillingSummary
} from './billing.types'

type RedirectValidator = (value: unknown) => boolean
const none = () => false
const optionalDate = (value: unknown) => value === null || isIsoDate(value)
const optionalId = (value: unknown) => value === null || isUuidV4(value)
const hash = (value: unknown): value is string =>
	typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

// The public API supplies the frozen provider allowlist. Without a validator,
// non-null redirect URLs fail closed; they are never accepted by shape alone.
export const parseBillingOrder = (
	value: unknown,
	workspaceId: string,
	redirect: RedirectValidator = none
): BillingOrder | null => {
	if (
		!isUuidV4(workspaceId) ||
		!isRecord(value) ||
		!hasExactKeys(value, [
			'id',
			'workspaceId',
			'version',
			'kind',
			'state',
			'cycle',
			'totalSeats',
			'amountMinor',
			'currency',
			'policyVersion',
			'confirmationUrl',
			'canVerify',
			'checkoutExpiresAt',
			'createdAt',
			'succeededAt',
			'fulfillment',
			'periodId',
			'startsAt',
			'expiresAt'
		]) ||
		!isUuidV4(value.id) ||
		value.workspaceId !== workspaceId ||
		!billingEntityVersion(value.version) ||
		!['ONE_TIME', 'RECURRING'].includes(String(value.kind)) ||
		!['PENDING', 'SUCCEEDED', 'CANCELLED', 'UNKNOWN'].includes(
			String(value.state)
		) ||
		!billingCycle(value.cycle) ||
		!billingSeats(value.totalSeats) ||
		!billingMinor(value.amountMinor) ||
		value.currency !== 'RUB' ||
		!billingEntityVersion(value.policyVersion) ||
		!(value.confirmationUrl === null || redirect(value.confirmationUrl)) ||
		typeof value.canVerify !== 'boolean' ||
		!isIsoDate(value.checkoutExpiresAt) ||
		!isIsoDate(value.createdAt) ||
		!optionalDate(value.succeededAt) ||
		!['NONE', 'SCHEDULED', 'ACTIVE', 'EXPIRED'].includes(
			String(value.fulfillment)
		) ||
		!optionalId(value.periodId) ||
		!optionalDate(value.startsAt) ||
		!optionalDate(value.expiresAt)
	)
		return null
	if (value.fulfillment === 'NONE') {
		if (
			value.periodId !== null ||
			value.startsAt !== null ||
			value.expiresAt !== null
		)
			return null
	} else if (
		value.state !== 'SUCCEEDED' ||
		value.periodId === null ||
		value.startsAt === null ||
		value.expiresAt === null ||
		Date.parse(String(value.startsAt)) >=
			Date.parse(String(value.expiresAt))
	)
		return null
	if ((value.state === 'SUCCEEDED') !== (value.succeededAt !== null))
		return null
	return value as unknown as BillingOrder
}

export const parseBillingRenewal = (
	value: unknown
): BillingRenewal | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'version',
			'state',
			'canDisable',
			'dispatchPending',
			'nextChargeAt',
			'nextRetryAt',
			'retryAttempt',
			'methodLast4',
			'methodTitle'
		]) ||
		![
			'NONE',
			'ACTIVE',
			'USER_DISABLED',
			'TECHNICAL_PAUSE',
			'PRICE_CONFIRMATION_REQUIRED',
			'REVOKED'
		].includes(String(value.state)) ||
		!(value.state === 'NONE'
			? value.version === 0
			: billingEntityVersion(value.version)) ||
		typeof value.canDisable !== 'boolean' ||
		typeof value.dispatchPending !== 'boolean' ||
		!optionalDate(value.nextChargeAt) ||
		!optionalDate(value.nextRetryAt) ||
		!billingInteger(value.retryAttempt, 0, 2147483646) ||
		!(
			value.methodLast4 === null ||
			(typeof value.methodLast4 === 'string' &&
				/^[0-9]{4}$/.test(value.methodLast4))
		) ||
		!(
			value.methodTitle === null ||
			isNonEmptyString(value.methodTitle, 256)
		)
	)
		return null
	return value as unknown as BillingRenewal
}

export const parseBillingSummary = (
	value: unknown,
	workspaceId: string,
	redirect: RedirectValidator = none
): BillingSummary | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'billingVersion',
			'serverTime',
			'policy',
			'trial',
			'period',
			'pendingOrder',
			'renewal'
		]) ||
		value.schemaVersion !== 1 ||
		!isUuidV4(workspaceId) ||
		value.workspaceId !== workspaceId ||
		!billingVersion(value.billingVersion) ||
		!isIsoDate(value.serverTime) ||
		!parseBillingPriceSnapshot(value.policy) ||
		!(value.period === null || parseBillingPeriod(value.period)) ||
		!(
			value.pendingOrder === null ||
			parseBillingOrder(value.pendingOrder, workspaceId, redirect)
		) ||
		!parseBillingRenewal(value.renewal)
	)
		return null
	if (value.trial !== null) {
		const trial = value.trial
		if (
			!isRecord(trial) ||
			!hasExactKeys(trial, ['startsAt', 'expiresAt', 'seatLimit']) ||
			!isIsoDate(trial.startsAt) ||
			!isIsoDate(trial.expiresAt) ||
			Date.parse(trial.startsAt) >= Date.parse(trial.expiresAt) ||
			!billingSeats(trial.seatLimit)
		)
			return null
	}
	return value as unknown as BillingSummary
}

export const parseBillingContext = (
	value: unknown,
	workspaceId: string,
	actorSubject: string,
	redirect: RedirectValidator = none
): BillingContext | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'actorSubject',
			'billing',
			'capacity',
			'capabilities'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		!isNonEmptyString(actorSubject, 256) ||
		value.actorSubject !== actorSubject ||
		!parseBillingSummary(value.billing, workspaceId, redirect)
	)
		return null
	const capacity = value.capacity
	const capabilities = value.capabilities
	if (
		!isRecord(capacity) ||
		!hasExactKeys(capacity, [
			'usedSeats',
			'admissionCeiling',
			'pendingOperationId'
		]) ||
		!billingInteger(capacity.usedSeats, 1, Number.MAX_SAFE_INTEGER) ||
		!(
			capacity.admissionCeiling === null ||
			billingSeats(capacity.admissionCeiling)
		) ||
		!optionalId(capacity.pendingOperationId) ||
		!isRecord(capabilities) ||
		!hasExactKeys(capabilities, [
			'quote',
			'checkout',
			'changeSeats',
			'disableAutoRenew',
			'confirmRenewalPrice'
		]) ||
		!Object.values(capabilities).every(item => typeof item === 'boolean')
	)
		return null
	return value as unknown as BillingContext
}

const parseProof = (
	value: unknown,
	workspaceId: string,
	commandId: string,
	requestHash: string,
	redirect: RedirectValidator
): BillingCommandProof | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'commandId',
			'requestHash',
			'status',
			'billingVersion',
			'releaseFence',
			'holdUntil',
			'order',
			'period'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		value.commandId !== commandId ||
		value.requestHash !== requestHash ||
		!['PENDING', 'COMMITTED', 'CANCELLED'].includes(
			String(value.status)
		) ||
		!billingVersion(value.billingVersion) ||
		typeof value.releaseFence !== 'boolean' ||
		!optionalDate(value.holdUntil) ||
		!(
			value.order === null ||
			parseBillingOrder(value.order, workspaceId, redirect)
		) ||
		!(value.period === null || parseBillingPeriod(value.period))
	)
		return null
	return value as unknown as BillingCommandProof
}

export const parseBillingOperation = (
	value: unknown,
	workspaceId: string,
	commandId: string,
	redirect: RedirectValidator = none
): BillingOperation | null => {
	if (
		!isUuidV4(workspaceId) ||
		!isUuidV4(commandId) ||
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'commandId',
			'state',
			'requestHash',
			'billing'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		value.commandId !== commandId ||
		!['PENDING', 'COMMITTED', 'CANCELLED', 'NOT_STARTED'].includes(
			String(value.state)
		)
	)
		return null
	if (value.state === 'NOT_STARTED') {
		if (value.requestHash !== null || value.billing !== null) return null
	} else {
		if (!hash(value.requestHash)) return null
		if (value.billing === null) {
			if (value.state !== 'PENDING') return null
		} else {
			const proof = parseProof(
				value.billing,
				workspaceId,
				commandId,
				value.requestHash,
				redirect
			)
			if (!proof || proof.status !== value.state) return null
		}
	}
	return value as unknown as BillingOperation
}

export const parseBillingOrderResponse = (
	value: unknown,
	workspaceId: string,
	orderId: string,
	redirect: RedirectValidator = none
): BillingOrderResponse | null => {
	if (
		!isUuidV4(orderId) ||
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'serverTime',
			'order'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		!isIsoDate(value.serverTime)
	)
		return null
	const order = parseBillingOrder(value.order, workspaceId, redirect)
	if (!order || order.id !== orderId) return null
	return value as unknown as BillingOrderResponse
}

export const parseBillingHistory = (
	value: unknown,
	workspaceId: string,
	page: number,
	pageSize: number,
	redirect: RedirectValidator = none
): BillingHistory | null => {
	if (
		!billingInteger(page, 1, 1000000) ||
		!billingInteger(pageSize, 1, 100) ||
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'page',
			'pageSize',
			'total',
			'items'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		value.page !== page ||
		value.pageSize !== pageSize ||
		!billingInteger(value.total, 0, Number.MAX_SAFE_INTEGER) ||
		!Array.isArray(value.items) ||
		value.items.length > pageSize ||
		!value.items.every(item =>
			parseBillingOrder(item, workspaceId, redirect)
		) ||
		new Set(value.items.map(item => (item as BillingOrder).id)).size !==
			value.items.length
	)
		return null
	return value as unknown as BillingHistory
}
