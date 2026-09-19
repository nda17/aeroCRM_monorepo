import {
	hasExactKeys,
	isIsoDate,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'

export type BillingCycle = 'MONTHLY' | 'YEARLY'
export interface BillingPriceSnapshot {
	policyVersion: number
	monthlyPriceMinor: number
	yearlyPriceMinor: number
	additionalSeatMonthlyPriceMinor: number
	additionalSeatYearlyPriceMinor: number
	includedSeats: number
	graceDays: number
}
export interface BillingPeriod {
	id: string
	orderId: string
	version: number
	cycle: BillingCycle
	totalSeats: number
	priceSnapshot: BillingPriceSnapshot
	startsAt: string
	expiresAt: string
	graceUntil: string
	state: 'SCHEDULED' | 'ACTIVE' | 'GRACE' | 'EXPIRED'
}
export interface BillingQuoteRequest {
	schemaVersion: 1
	workspaceId: string
	intent: 'CHECKOUT' | 'SEAT_CHANGE' | 'RENEWAL'
	cycle: BillingCycle
	totalSeats: number
}
export interface BillingQuote {
	schemaVersion: 1
	workspaceId: string
	billingVersion: string
	serverTime: string
	validUntil: string
	intent: BillingQuoteRequest['intent']
	cycle: BillingCycle
	totalSeats: number
	amountMinor: string
	currency: 'RUB'
	priceSnapshot: BillingPriceSnapshot
	startsAt: string
	expiresAt: string
	period: {
		id: string
		version: number
		oldTotalSeats: number
		oldExpiresAt: string
		oldPeriodPriceMinor: string
		newPeriodPriceMinor: string
	} | null
	consent: { version: string; text: string }
}

export const billingInteger = (
	value: unknown,
	min: number,
	max: number
): value is number =>
	Number.isSafeInteger(value) &&
	Number(value) >= min &&
	Number(value) <= max
export const billingVersion = (value: unknown): value is string =>
	typeof value === 'string' &&
	/^(0|[1-9][0-9]{0,18})$/.test(value) &&
	BigInt(value) <= 9223372036854775807n
export const billingMinor = (value: unknown): value is string =>
	typeof value === 'string' &&
	/^[1-9][0-9]{0,12}$/.test(value) &&
	BigInt(value) <= 1000000000000n
export const billingSeats = (value: unknown): value is number =>
	billingInteger(value, 2, 10000)
export const billingEntityVersion = (value: unknown): value is number =>
	billingInteger(value, 1, 2147483646)
export const billingCycle = (value: unknown): value is BillingCycle =>
	value === 'MONTHLY' || value === 'YEARLY'

export const parseBillingPriceSnapshot = (
	value: unknown
): BillingPriceSnapshot | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'policyVersion',
			'monthlyPriceMinor',
			'yearlyPriceMinor',
			'additionalSeatMonthlyPriceMinor',
			'additionalSeatYearlyPriceMinor',
			'includedSeats',
			'graceDays'
		]) ||
		!billingEntityVersion(value.policyVersion) ||
		!billingInteger(value.monthlyPriceMinor, 1, 100000000) ||
		!billingInteger(value.yearlyPriceMinor, 1, 100000000) ||
		!billingInteger(value.additionalSeatMonthlyPriceMinor, 0, 100000000) ||
		!billingInteger(value.additionalSeatYearlyPriceMinor, 0, 100000000) ||
		!billingSeats(value.includedSeats) ||
		value.graceDays !== 3
	)
		return null
	return value as unknown as BillingPriceSnapshot
}

export const parseBillingPeriod = (
	value: unknown
): BillingPeriod | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'id',
			'orderId',
			'version',
			'cycle',
			'totalSeats',
			'priceSnapshot',
			'startsAt',
			'expiresAt',
			'graceUntil',
			'state'
		]) ||
		!isUuidV4(value.id) ||
		!isUuidV4(value.orderId) ||
		!billingEntityVersion(value.version) ||
		!billingCycle(value.cycle) ||
		!billingSeats(value.totalSeats) ||
		!parseBillingPriceSnapshot(value.priceSnapshot) ||
		!isIsoDate(value.startsAt) ||
		!isIsoDate(value.expiresAt) ||
		!isIsoDate(value.graceUntil) ||
		value.startsAt >= value.expiresAt ||
		value.expiresAt > value.graceUntil ||
		!['SCHEDULED', 'ACTIVE', 'GRACE', 'EXPIRED'].includes(
			String(value.state)
		)
	)
		return null
	return value as unknown as BillingPeriod
}

export const validBillingQuoteRequest = (
	value: unknown
): value is BillingQuoteRequest =>
	isRecord(value) &&
	hasExactKeys(value, [
		'schemaVersion',
		'workspaceId',
		'intent',
		'cycle',
		'totalSeats'
	]) &&
	value.schemaVersion === 1 &&
	isUuidV4(value.workspaceId) &&
	(value.intent === 'CHECKOUT' ||
		value.intent === 'SEAT_CHANGE' ||
		value.intent === 'RENEWAL') &&
	billingCycle(value.cycle) &&
	billingSeats(value.totalSeats)

export const parseBillingQuote = (
	value: unknown,
	request: BillingQuoteRequest
): BillingQuote | null => {
	if (
		!validBillingQuoteRequest(request) ||
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'billingVersion',
			'serverTime',
			'validUntil',
			'intent',
			'cycle',
			'totalSeats',
			'amountMinor',
			'currency',
			'priceSnapshot',
			'startsAt',
			'expiresAt',
			'period',
			'consent'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== request.workspaceId ||
		value.intent !== request.intent ||
		value.cycle !== request.cycle ||
		value.totalSeats !== request.totalSeats ||
		!billingVersion(value.billingVersion) ||
		!isIsoDate(value.serverTime) ||
		!isIsoDate(value.validUntil) ||
		value.validUntil <= value.serverTime ||
		!billingMinor(value.amountMinor) ||
		value.currency !== 'RUB' ||
		!parseBillingPriceSnapshot(value.priceSnapshot) ||
		!isIsoDate(value.startsAt) ||
		!isIsoDate(value.expiresAt) ||
		value.startsAt >= value.expiresAt ||
		!isRecord(value.consent) ||
		!hasExactKeys(value.consent, ['version', 'text']) ||
		!isNonEmptyString(value.consent.version, 128) ||
		!isNonEmptyString(value.consent.text, 10000)
	)
		return null
	if (request.intent !== 'SEAT_CHANGE') {
		if (value.period !== null) return null
	} else {
		const period = value.period
		if (
			!isRecord(period) ||
			!hasExactKeys(period, [
				'id',
				'version',
				'oldTotalSeats',
				'oldExpiresAt',
				'oldPeriodPriceMinor',
				'newPeriodPriceMinor'
			]) ||
			!isUuidV4(period.id) ||
			!billingEntityVersion(period.version) ||
			!billingSeats(period.oldTotalSeats) ||
			!isIsoDate(period.oldExpiresAt) ||
			!billingMinor(period.oldPeriodPriceMinor) ||
			!billingMinor(period.newPeriodPriceMinor) ||
			period.newPeriodPriceMinor !== value.amountMinor
		)
			return null
	}
	return value as unknown as BillingQuote
}
