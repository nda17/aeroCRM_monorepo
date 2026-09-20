const wholeRubles = new Intl.NumberFormat('ru-RU', {
	maximumFractionDigits: 0
})

/** Display server minor units exactly. Never calculate a quote in the browser. */
export const billingMoney = (minor: string) => {
	if (!/^(0|[1-9][0-9]{0,30})$/.test(minor))
		throw new Error('Некорректная сумма aeroCRM.')
	const value = BigInt(minor)
	const kopecks = value % 100n
	const fraction = kopecks === 0n ? '' : `,${String(kopecks).padStart(2, '0')}`
	return `${wholeRubles.format(value / 100n)}${fraction} ₽`
}

export const billingDate = (iso: string) =>
	new Intl.DateTimeFormat('ru-RU', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	}).format(new Date(iso))

export const billingCycleLabel = (cycle: 'MONTHLY' | 'YEARLY') =>
	cycle === 'MONTHLY' ? 'Месяц' : 'Год'

export const billingOrderLabel = (
	state: 'PENDING' | 'SUCCEEDED' | 'CANCELLED' | 'UNKNOWN'
) =>
	({
		PENDING: 'Ожидает оплаты или подтверждения',
		SUCCEEDED: 'Оплата подтверждена',
		CANCELLED: 'Платёж отменён',
		UNKNOWN: 'Результат платежа уточняется'
	})[state]

export const billingFulfillmentLabel = (
	state: 'NONE' | 'SCHEDULED' | 'ACTIVE' | 'EXPIRED'
) =>
	({
		NONE: 'Оплаченный период ещё не подтверждён',
		SCHEDULED: 'Оплаченный период запланирован',
		ACTIVE: 'Оплаченный период действует',
		EXPIRED: 'Оплаченный период завершён'
	})[state]
