import {
	hasExactKeys,
	isIsoDate,
	isNonEmptyString,
	isRecord
} from '@/shared/lib/contract'

export const companyStatuses = [
	'ACTIVE',
	'LIQUIDATING',
	'LIQUIDATED',
	'BANKRUPT',
	'REORGANIZING',
	'UNKNOWN'
] as const
export interface CompanyLookupItem {
	name: string
	legalName: string
	inn: string
	kpp: string | null
	ogrn: string | null
	legalAddress: string | null
	entityType: 'LEGAL' | 'INDIVIDUAL'
	status: (typeof companyStatuses)[number]
}
export interface CompanyLookupResult {
	schemaVersion: 1
	provider: string
	queriedAt: string
	inn: string
	items: CompanyLookupItem[]
}

/** Only lookup validates checksums. Manual company entry retains its v1 rules. */
export const isLookupInn = (value: string) => {
	if (!/^(?:\d{10}|\d{12})$/.test(value) || /^0+$/.test(value))
		return false
	const digit = (weights: number[]) =>
		(weights.reduce(
			(sum, weight, index) => sum + weight * Number(value[index]),
			0
		) %
			11) %
		10
	return value.length === 10
		? digit([2, 4, 10, 3, 5, 9, 4, 6, 8]) === Number(value[9])
		: digit([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === Number(value[10]) &&
				digit([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === Number(value[11])
}

export const parseCompanyLookup = (
	value: unknown,
	expectedInn: string
): CompanyLookupResult | null => {
	if (
		!isLookupInn(expectedInn) ||
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'provider',
			'queriedAt',
			'inn',
			'items'
		]) ||
		value.schemaVersion !== 1 ||
		typeof value.provider !== 'string' ||
		!/^[A-Z][A-Z0-9_]{1,31}$/.test(value.provider) ||
		!isIsoDate(value.queriedAt) ||
		value.inn !== expectedInn ||
		!Array.isArray(value.items) ||
		value.items.length > 5
	)
		return null
	const seen = new Set<string>()
	for (const item of value.items) {
		if (
			!isRecord(item) ||
			!hasExactKeys(item, [
				'name',
				'legalName',
				'inn',
				'kpp',
				'ogrn',
				'legalAddress',
				'entityType',
				'status'
			]) ||
			!isNonEmptyString(item.name, 200) ||
			!isNonEmptyString(item.legalName, 2000) ||
			item.inn !== expectedInn ||
			!companyStatuses.includes(
				item.status as CompanyLookupItem['status']
			) ||
			!(
				item.legalAddress === null ||
				isNonEmptyString(item.legalAddress, 2000)
			)
		)
			return null
		if (item.entityType === 'LEGAL') {
			if (
				expectedInn.length !== 10 ||
				!(
					item.kpp === null ||
					(typeof item.kpp === 'string' && /^\d{9}$/.test(item.kpp))
				) ||
				!(
					item.ogrn === null ||
					(typeof item.ogrn === 'string' && /^\d{13}$/.test(item.ogrn))
				)
			)
				return null
		} else if (item.entityType === 'INDIVIDUAL') {
			if (
				expectedInn.length !== 12 ||
				item.kpp !== null ||
				!(
					item.ogrn === null ||
					(typeof item.ogrn === 'string' && /^\d{15}$/.test(item.ogrn))
				)
			)
				return null
		} else return null
		const identity = JSON.stringify([
			item.inn,
			item.kpp,
			item.ogrn,
			item.entityType
		])
		if (seen.has(identity)) return null
		seen.add(identity)
	}
	return value as unknown as CompanyLookupResult
}
