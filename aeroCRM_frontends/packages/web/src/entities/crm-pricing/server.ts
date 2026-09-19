import 'server-only'
import { API_URL } from '@/shared/config/api.config'
import type { CrmPricingPolicy } from './index'

export const getCrmPricingPolicy = async (): Promise<CrmPricingPolicy | null> => {
	try {
		const response = await fetch(`${API_URL}/billing-settings/crm/public`, {
			next: { revalidate: 60 }
		})
		if (!response.ok) return null
		const data: unknown = await response.json()
		if (!data || typeof data !== 'object') return null
		const policy = data as Partial<CrmPricingPolicy>
		if (!Number.isInteger(policy.monthlyPriceMinor) || !Number.isInteger(policy.yearlyPriceMinor) || !Number.isInteger(policy.includedSeats) || !Number.isInteger(policy.trialDays)) return null
		return policy as CrmPricingPolicy
	} catch {
		return null
	}
}
