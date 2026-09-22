export const COMMERCE_MAX_MINOR = 2147483647

export const moneyInput = (minor: number | null) =>
	minor === null ? '' : (minor / 100).toFixed(2)

export const parseMoneyInput = (
	input: string,
	optional = false
): number | null => {
	const value = input.trim().replace(',', '.')
	if (!value && optional) return null
	if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(value))
		throw new Error(
			'Укажите неотрицательную сумму с точностью до копейки.'
		)
	const [whole, fraction = ''] = value.split('.')
	const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
	if (!Number.isSafeInteger(minor) || minor > COMMERCE_MAX_MINOR)
		throw new Error('Сумма не должна превышать 21 474 836,47 ₽.')
	return minor
}

export const quantityInput = (input: string) => {
	const value = input.trim().replace(',', '.')
	if (
		!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/.test(value) ||
		Number(value) <= 0
	)
		throw new Error(
			'Количество должно быть больше нуля, до трёх знаков после запятой.'
		)
	return value
}

export const commerceFormError = (error: unknown) =>
	error instanceof Error ? error.message : 'Проверьте введённые данные.'

export const downloadCommerceBlob = (blob: Blob, filename: string) => {
	const url = URL.createObjectURL(blob)
	const link = document.createElement('a')
	try {
		link.href = url
		link.download = filename
		document.body.appendChild(link)
		link.click()
	} finally {
		link.remove()
		window.setTimeout(() => URL.revokeObjectURL(url), 1000)
	}
}
