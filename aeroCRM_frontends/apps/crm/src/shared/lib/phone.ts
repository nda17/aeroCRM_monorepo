import { AsYouType } from 'libphonenumber-js/min'

export const CRM_PHONE_INPUT_PLACEHOLDER = '+7 999 123 45 67'
export const CRM_PHONE_INPUT_MAX_LENGTH = 40
export const CRM_PHONE_INPUT_ERROR =
	'Проверьте правильность ввода номера телефона'

const normalizeCrmPhoneInput = (value: string) => {
	const raw = value.trim()
	if (!raw) return ''
	// Keep unsupported input visible so validation cannot silently change a number.
	if (!/^\+?[\d\s().-]*$/.test(raw)) return raw
	const digits = raw.replace(/\D/g, '')
	if (!digits) return raw.startsWith('+') ? '+' : ''
	if (raw.startsWith('+')) return `+${digits}`
	if (digits.startsWith('8')) return `+7${digits.slice(1)}`
	if (digits.startsWith('7')) return `+${digits}`
	return `+7${digits}`
}

export const formatCrmPhoneInput = (value: string) => {
	const phone = normalizeCrmPhoneInput(value)
	if (!/^\+[0-9]{0,15}$/.test(phone)) return phone
	return new AsYouType().input(phone)
}

export const parseCrmPhoneInput = (value: string) => {
	const phone = normalizeCrmPhoneInput(value)
	// CRM accepts international and landline numbers by its existing API contract.
	return /^\+[1-9][0-9]{6,14}$/.test(phone) ? phone : null
}

export const isCrmPhoneInputValid = (value: string) =>
	!value.trim() || parseCrmPhoneInput(value) !== null
