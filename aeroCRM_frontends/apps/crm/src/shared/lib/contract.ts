const UUID_V4_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const isRecord = (
	value: unknown
): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

export const hasExactKeys = (
	value: Record<string, unknown>,
	keys: readonly string[]
) => {
	const actualKeys = Object.keys(value)
	return (
		actualKeys.length === keys.length &&
		keys.every(key => Object.hasOwn(value, key))
	)
}

export const isUuidV4 = (value: unknown): value is string =>
	typeof value === 'string' && UUID_V4_PATTERN.test(value)

export const isNonEmptyString = (
	value: unknown,
	maxLength: number
): value is string =>
	typeof value === 'string' &&
	value.length <= maxLength &&
	value.trim().length > 0

export const isIsoDate = (value: unknown): value is string =>
	typeof value === 'string' &&
	Number.isFinite(Date.parse(value)) &&
	new Date(value).toISOString() === value

export const isPositiveDecimal = (value: unknown): value is string =>
	typeof value === 'string' && /^[1-9][0-9]*$/.test(value)
