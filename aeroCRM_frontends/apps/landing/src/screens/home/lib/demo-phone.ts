import {
	AsYouType,
	parsePhoneNumberFromString
} from 'libphonenumber-js/min'

export const DEMO_PHONE_PLACEHOLDER = '+7 999 123-45-67'

const normalizePhoneInput = (value: string) => {
	const raw = value.trim()
	const digits = raw.replace(/\D/g, '')

	if (raw.startsWith('+')) return raw
	if (raw.startsWith('8') && digits.length >= 10) {
		return `7${digits.slice(1)}`
	}

	return raw
}

export const formatDemoPhone = (value: string) => {
	const raw = normalizePhoneInput(value)
	if (!raw) return ''

	const formatter = raw.startsWith('+')
		? new AsYouType()
		: new AsYouType('RU')

	return formatter.input(raw)
}

export const parseDemoPhone = (value: string) => {
	const raw = normalizePhoneInput(value)
	if (!raw) return null

	const phone = parsePhoneNumberFromString(
		raw,
		raw.startsWith('+') ? undefined : 'RU'
	)

	return phone?.isValid() ? phone.number : null
}

export const isDemoPhoneValid = (value: string) =>
	Boolean(parseDemoPhone(value))
