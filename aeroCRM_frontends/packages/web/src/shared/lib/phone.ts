import {
	AsYouType,
	parsePhoneNumberFromString
} from 'libphonenumber-js/min'

export const PHONE_INPUT_PLACEHOLDER = '+7 999 123 45 67'
export const PHONE_INPUT_MAX_LENGTH = PHONE_INPUT_PLACEHOLDER.length

const RUSSIAN_NATIONAL_NUMBER_LENGTH = 10
const RUSSIAN_PHONE_DIGITS_LENGTH = 11

const normalizePhoneInput = (value: string) => {
	const raw = value.trim()
	const digits = raw.replace(/\D/g, '')

	if (!raw) return ''
	if (!digits) return raw.startsWith('+') ? '+' : ''
	if (raw.startsWith('+')) {
		return `+${digits.slice(0, RUSSIAN_PHONE_DIGITS_LENGTH)}`
	}
	if (digits.startsWith('8')) {
		return `+7${digits.slice(1, RUSSIAN_PHONE_DIGITS_LENGTH)}`
	}
	if (digits.startsWith('7')) {
		return `+${digits.slice(0, RUSSIAN_PHONE_DIGITS_LENGTH)}`
	}

	return `+7${digits.slice(0, RUSSIAN_NATIONAL_NUMBER_LENGTH)}`
}

export const formatPhoneInput = (value: string) => {
	const raw = normalizePhoneInput(value)
	if (!raw) return ''

	return new AsYouType().input(raw)
}

export const parsePhoneInput = (value: string) => {
	const raw = normalizePhoneInput(value)
	if (!raw) return null

	const phone = parsePhoneNumberFromString(raw)

	return phone?.country === 'RU' &&
		phone.nationalNumber.startsWith('9') &&
		phone.isValid()
		? phone.number
		: null
}

export const isPhoneInputValid = (value: string) =>
	Boolean(parsePhoneInput(value))
