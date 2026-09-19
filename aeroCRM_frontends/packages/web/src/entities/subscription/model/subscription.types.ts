export type Plan = 'TRIAL' | 'EASY' | 'HARD'
export type BillingPeriod = 'MONTHLY' | 'YEARLY'
export type SubscriptionStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELLED'

export interface Subscription {
	id: string
	userId: string
	plan: Plan
	billingPeriod: BillingPeriod | null
	status: SubscriptionStatus
	startsAt: string
	expiresAt: string | null
	leadsThisPeriod: number
	periodResetsAt: string | null
	createdAt: string
	updatedAt: string
}
