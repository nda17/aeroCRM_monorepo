/** Only the two contracted YooKassa redirect routes, never arbitrary return URLs. */
export const isBillingConfirmationUrl = (
	value: unknown
): value is string => {
	if (
		typeof value !== 'string' ||
		value.length > 2048 ||
		/[\s\\\x00-\x1f\x7f]/.test(value)
	)
		return false
	try {
		const url = new URL(value)
		if (
			url.origin !== 'https://yoomoney.ru' ||
			url.username ||
			url.password ||
			url.hash ||
			![
				'/checkout/payments/v2/contract',
				'/api-pages/v2/payment-confirm/epl'
			].includes(url.pathname)
		)
			return false
		const entries = [...url.searchParams.entries()]
		return (
			entries.length === 1 &&
			entries[0][0] === 'orderId' &&
			/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(entries[0][1])
		)
	} catch {
		return false
	}
}
