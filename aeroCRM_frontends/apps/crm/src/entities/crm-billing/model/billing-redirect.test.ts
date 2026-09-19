import { describe, expect, it } from 'vitest'
import { isBillingConfirmationUrl } from './billing-redirect'

describe('YooKassa confirmation URL boundary', () => {
	it.each([
		'/checkout/payments/v2/contract',
		'/api-pages/v2/payment-confirm/epl'
	])(
		'accepts only contracted paths and a provider object reference',
		path => {
			expect(
				isBillingConfirmationUrl(
					`https://yoomoney.ru${path}?orderId=synthetic-provider:1`
				)
			).toBe(true)
			expect(
				isBillingConfirmationUrl(
					`https://YOOMONEY.RU${path}?orderId=provider%3A1`
				)
			).toBe(true)
		}
	)
	it.each([
		'http://yoomoney.ru/checkout/payments/v2/contract?orderId=id',
		'https://evil.invalid/checkout/payments/v2/contract?orderId=id',
		'https://yoomoney.ru.evil.invalid/checkout/payments/v2/contract?orderId=id',
		'https://user@yoomoney.ru/checkout/payments/v2/contract?orderId=id',
		'https://yoomoney.ru:444/checkout/payments/v2/contract?orderId=id',
		'https://yoomoney.ru/checkout/payments/v2/contract?orderId=id#return',
		'https://yoomoney.ru/checkout/payments/v2/contract?orderId=id&orderId=id',
		'https://yoomoney.ru/checkout/payments/v2/contract?orderId=id&returnUrl=evil',
		'https://yoomoney.ru/checkout/payments/v2/contract?orderId=%253A',
		'https://yoomoney.ru/checkout/payments/v2/contract?orderId=id%0A',
		'https://yoomoney.ru/checkout/payments/v2/contract?orderId=.',
		'https://yoomoney.ru/checkout/payments/v2/contract?orderId=' +
			'a'.repeat(129),
		'https://yoomoney.ru/checkout/payments/v2/contract?orderId=id\n',
		'https://yoomoney.ru/checkout/payments/v2/contract?orderId=id ',
		'https://yoomoney.ru\\evil/checkout/payments/v2/contract?orderId=id',
		'https://yoomoney.ru/other?orderId=id',
		'http://localhost:4444/checkout?orderId=id',
		'javascript:alert(1)',
		'/checkout/payments/v2/contract?orderId=id'
	])('rejects untrusted redirects without fallback navigation', value => {
		expect(isBillingConfirmationUrl(value)).toBe(false)
	})
})
