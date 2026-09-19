import { hasExactKeys, isIsoDate, isRecord } from '@/shared/lib/contract'

export interface CrmCommercialPolicy {
	schemaVersion: 1
	productCode: 'WINCRM'
	version: number
	currency: 'RUB'
	monthlyPriceMinor: number
	yearlyPriceMinor: number
	additionalSeatMonthlyPriceMinor: number
	additionalSeatYearlyPriceMinor: number
	includedSeats: number
	trialSeatLimit: number
	trialDays: 5
	graceDays: 3
	createdAt: string
}

const prices = [
	'monthlyPriceMinor',
	'yearlyPriceMinor',
	'additionalSeatMonthlyPriceMinor',
	'additionalSeatYearlyPriceMinor'
] as const
const integer = (value: unknown, min: number, max: number) =>
	Number.isSafeInteger(value) &&
	Number(value) >= min &&
	Number(value) <= max

/** Published product policy, never a subscription snapshot or payment quote. */
export const parseCrmCommercialPolicy = (
	value: unknown
): CrmCommercialPolicy | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'productCode',
			'version',
			'currency',
			...prices,
			'includedSeats',
			'trialSeatLimit',
			'trialDays',
			'graceDays',
			'createdAt'
		]) ||
		value.schemaVersion !== 1 ||
		value.productCode !== 'WINCRM' ||
		value.currency !== 'RUB' ||
		!integer(value.version, 1, Number.MAX_SAFE_INTEGER) ||
		!prices.every(key => integer(value[key], 1, 100_000_000)) ||
		!integer(value.includedSeats, 2, 10_000) ||
		!integer(value.trialSeatLimit, 2, 10_000) ||
		value.trialDays !== 5 ||
		value.graceDays !== 3 ||
		!isIsoDate(value.createdAt)
	)
		return null
	return value as unknown as CrmCommercialPolicy
}
