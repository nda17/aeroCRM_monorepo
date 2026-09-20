export const CRM_PRICE_FIELDS = [
	'monthlyPriceMinor',
	'yearlyPriceMinor',
	'additionalSeatMonthlyPriceMinor',
	'additionalSeatYearlyPriceMinor'
] as const

export const CRM_SEAT_FIELDS = ['includedSeats', 'trialSeatLimit'] as const

export type CrmPriceField = (typeof CRM_PRICE_FIELDS)[number]
export type CrmSeatField = (typeof CRM_SEAT_FIELDS)[number]
export type CrmPricingField = CrmPriceField | CrmSeatField

export type CrmPricingValues = Record<CrmPricingField, number>

export type CrmPricingSettings = CrmPricingValues & {
	schemaVersion: 1
	productCode: 'AEROCRM'
	version: number
	currency: 'RUB'
	trialDays: 10
	graceDays: 3
	createdAt: string
}

export type CrmPricingDraft = Record<CrmPricingField, string>

export type CrmPricingCommand = CrmPricingValues & {
	schemaVersion: 1
	commandId: string
	expectedVersion: number
}

const MAX_PRICE_MINOR = 100_000_000
const MAX_SEATS = 10_000
export const annualCrmPriceMinor = (monthlyPriceMinor: number): number =>
	Math.round((monthlyPriceMinor * 108) / 1000) * 100
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SETTINGS_KEYS = [
	'schemaVersion',
	'productCode',
	'version',
	'currency',
	...CRM_PRICE_FIELDS,
	...CRM_SEAT_FIELDS,
	'trialDays',
	'graceDays',
	'createdAt'
]

const isIntegerInRange = (
	value: unknown,
	minimum: number,
	maximum: number
): value is number =>
	typeof value === 'number' &&
	Number.isSafeInteger(value) &&
	value >= minimum &&
	value <= maximum

export const parseCrmPricingSettings = (
	value: unknown
): CrmPricingSettings => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Invalid aeroCRM pricing settings')
	}

	const settings = value as Record<string, unknown>
	if (
		Object.keys(settings).length !== SETTINGS_KEYS.length ||
		!SETTINGS_KEYS.every(key =>
			Object.prototype.hasOwnProperty.call(settings, key)
		) ||
		settings.schemaVersion !== 1 ||
		settings.productCode !== 'AEROCRM' ||
		settings.currency !== 'RUB' ||
		!isIntegerInRange(settings.version, 1, Number.MAX_SAFE_INTEGER) ||
		settings.trialDays !== 10 ||
		settings.graceDays !== 3 ||
		!CRM_PRICE_FIELDS.every(key =>
			isIntegerInRange(settings[key], 1, MAX_PRICE_MINOR)
		) ||
		!CRM_SEAT_FIELDS.every(key =>
			isIntegerInRange(settings[key], 2, MAX_SEATS)
		) ||
		typeof settings.createdAt !== 'string' ||
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
			settings.createdAt
		) ||
		!Number.isFinite(Date.parse(settings.createdAt)) ||
		new Date(settings.createdAt).toISOString() !== settings.createdAt
	) {
		throw new Error('Invalid aeroCRM pricing settings')
	}

	return { ...settings } as CrmPricingSettings
}

export const parseCrmRublesInput = (value: string): number | null => {
	const input = value.trim()
	if (!/^\d+(?:[.,]\d{1,2})?$/.test(input)) return null

	const [rubles, kopecks = ''] = input.split(/[.,]/)
	const minor = Number(rubles) * 100 + Number(kopecks.padEnd(2, '0'))
	return isIntegerInRange(minor, 100, MAX_PRICE_MINOR) && minor % 100 === 0
		? minor
		: null
}

export const formatCrmRublesInput = (minor: number): string => {
	const rubles = Math.floor(minor / 100)
	const kopecks = minor % 100
	return kopecks === 0
		? String(rubles)
		: `${rubles},${String(kopecks).padStart(2, '0')}`
}

export const createCrmPricingDraft = (
	settings: CrmPricingValues
): CrmPricingDraft => ({
	monthlyPriceMinor: formatCrmRublesInput(settings.monthlyPriceMinor),
	yearlyPriceMinor: formatCrmRublesInput(
		annualCrmPriceMinor(settings.monthlyPriceMinor)
	),
	additionalSeatMonthlyPriceMinor: formatCrmRublesInput(
		settings.additionalSeatMonthlyPriceMinor
	),
	additionalSeatYearlyPriceMinor: formatCrmRublesInput(
		settings.additionalSeatYearlyPriceMinor
	),
	includedSeats: String(settings.includedSeats),
	trialSeatLimit: String(settings.trialSeatLimit)
})

export const parseCrmPricingDraft = (
	draft: CrmPricingDraft
): CrmPricingValues | null => {
	const values = {} as CrmPricingValues
	for (const key of CRM_PRICE_FIELDS) {
		const value = parseCrmRublesInput(draft[key])
		if (value === null) return null
		values[key] = value
	}
	for (const key of CRM_SEAT_FIELDS) {
		const input = draft[key].trim()
		const value = Number(input)
		if (!/^\d+$/.test(input) || !isIntegerInRange(value, 2, MAX_SEATS)) {
			return null
		}
		values[key] = value
	}
	if (values.yearlyPriceMinor !== annualCrmPriceMinor(values.monthlyPriceMinor))
		return null
	return values
}

export const createCrmPricingCommand = (
	settings: CrmPricingSettings,
	draft: CrmPricingDraft,
	commandId: string,
	pending: CrmPricingCommand | null
): CrmPricingCommand => {
	// An uncertain response can only be retried with the original command.
	if (pending) return pending

	const values = parseCrmPricingDraft(draft)
	if (!values || !UUID_PATTERN.test(commandId)) {
		throw new Error('Invalid aeroCRM pricing command')
	}

	return {
		schemaVersion: 1,
		commandId,
		expectedVersion: settings.version,
		...values
	}
}

export const parseCrmPricingCommandResult = (
	value: unknown,
	command: CrmPricingCommand
): CrmPricingSettings => {
	const settings = parseCrmPricingSettings(value)
	if (
		settings.version !== command.expectedVersion + 1 ||
		![...CRM_PRICE_FIELDS, ...CRM_SEAT_FIELDS].every(
			key => settings[key] === command[key]
		)
	) {
		throw new Error('Unexpected aeroCRM pricing command result')
	}
	return settings
}
