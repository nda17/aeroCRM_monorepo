import { isCommerceQuantity } from '@/entities/sales/model/commerce.contract'
import { describe, expect, it } from 'vitest'
import { quantityInput } from './commerce-form'

describe('commerce deal quantity input', () => {
	it.each([
		['1', '1.000'],
		['1,5', '1.500'],
		['1,25', '1.250'],
		['1.25', '1.250'],
		['1.234', '1.234']
	])('normalizes %s to the API quantity contract', (input, expected) => {
		const quantity = quantityInput(input)

		expect(quantity).toBe(expected)
		expect(isCommerceQuantity(quantity)).toBe(true)
	})

	it.each(['0', '0.000', '-1', '-0,5', '1.2345', '1,2345'])(
		'rejects invalid quantity %s', input => {
			expect(() => quantityInput(input)).toThrow()
		}
	)
})
