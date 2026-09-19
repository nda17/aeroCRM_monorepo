import type {
	BillingPeriod,
	Plan
} from '@/entities/subscription/model/subscription.types'

export type PaidPlan = Extract<Plan, 'EASY' | 'HARD'>

export interface TariffPrice {
	id: string
	plan: PaidPlan
	billingPeriod: BillingPeriod
	amount: number
	createdAt: string
	updatedAt: string
}

export interface TariffPriceInput {
	plan: PaidPlan
	billingPeriod: BillingPeriod
	amount: number
}

export type TariffPriceMap = Record<
	PaidPlan,
	Record<BillingPeriod, number>
>

export const DEFAULT_TARIFF_PRICE_MAP: TariffPriceMap = {
	EASY: {
		MONTHLY: 990,
		YEARLY: 4680
	},
	HARD: {
		MONTHLY: 1690,
		YEARLY: 9480
	}
}

export const PAID_PLANS: PaidPlan[] = ['EASY', 'HARD']
export const TARIFF_BILLING_PERIODS: BillingPeriod[] = [
	'MONTHLY',
	'YEARLY'
]

export const createTariffPriceMap = (
	prices?: TariffPrice[] | null
): TariffPriceMap => {
	const map: TariffPriceMap = {
		EASY: { ...DEFAULT_TARIFF_PRICE_MAP.EASY },
		HARD: { ...DEFAULT_TARIFF_PRICE_MAP.HARD }
	}

	prices?.forEach(price => {
		map[price.plan][price.billingPeriod] = price.amount
	})

	return map
}

export const tariffPriceMapToInput = (
	priceMap: TariffPriceMap
): TariffPriceInput[] =>
	PAID_PLANS.flatMap(plan =>
		TARIFF_BILLING_PERIODS.map(billingPeriod => ({
			plan,
			billingPeriod,
			amount: priceMap[plan][billingPeriod]
		}))
	)
