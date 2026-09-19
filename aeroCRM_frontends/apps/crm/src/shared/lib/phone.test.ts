import { describe, expect, it } from 'vitest'
import {
	formatCrmPhoneInput,
	isCrmPhoneInputValid,
	parseCrmPhoneInput
} from './phone'

describe('CRM phone input', () => {
	it.each(['+79991234567', '8 (999) 123-45-67', '9991234567'])(
		'formats Russian input %s like the authentication form',
		value => {
			expect(formatCrmPhoneInput(value)).toBe('+7 999 123 45 67')
			expect(parseCrmPhoneInput(value)).toBe('+79991234567')
		}
	)
	it.each([
		'+74951234567',
		'+442079460018',
		'+12025550123',
		'+998901234567',
		'+1234567',
		'+123456789012345'
	])('preserves existing international E164 number %s', phone => {
		expect(parseCrmPhoneInput(formatCrmPhoneInput(phone))).toBe(phone)
	})
	it.each([
		'+',
		'+7',
		'+123456',
		'+0123456789',
		'+1234567890123456',
		'+7 999 123 45 67 доб. 123',
		'+7 999 123 45 67 +123',
		'call 79991234567'
	])('does not silently truncate or rewrite invalid input %s', value => {
		const formatted = formatCrmPhoneInput(value)
		expect(isCrmPhoneInputValid(formatted)).toBe(false)
		expect(parseCrmPhoneInput(formatted)).toBeNull()
	})
	it('keeps optional empty input empty and allows clearing a formatted number', () => {
		expect(formatCrmPhoneInput('')).toBe('')
		expect(isCrmPhoneInputValid('')).toBe(true)
		expect(parseCrmPhoneInput('')).toBeNull()
		expect(formatCrmPhoneInput('+7')).toBe('+7')
	})
})
