import { describe, expect, it } from 'vitest'
import {
	billingFulfillmentLabel,
	billingMoney,
	billingOrderLabel
} from './billing-display'

describe('server-authoritative billing presentation', () => {
	it.each([
		['0', '0,00 ₽'],
		['1', '0,01 ₽'],
		['105', '1,05 ₽'],
		['199999', '1\u00a0999,99 ₽'],
		['9007199254740993', '90\u00a0071\u00a0992\u00a0547\u00a0409,93 ₽']
	])(
		'displays exact minor units without floating-point rounding',
		(minor, label) => {
			expect(billingMoney(minor)).toBe(label)
		}
	)
	it.each([
		'-1',
		'01',
		'1.00',
		'1e6',
		' 100',
		'100 ',
		'NaN',
		'9'.repeat(32)
	])('never silently coerces an invalid monetary value', value => {
		expect(() => billingMoney(value)).toThrow('Некорректная сумма WinCRM.')
	})
	it('keeps payment confirmation distinct from scheduled subscription fulfillment', () => {
		expect(billingOrderLabel('SUCCEEDED')).toBe('Оплата подтверждена')
		expect(billingFulfillmentLabel('SCHEDULED')).toBe(
			'Оплаченный период запланирован'
		)
		expect(billingOrderLabel('UNKNOWN')).not.toMatch(/отмен|не списаны/)
	})
})
