import { axiosInterceptorsRequest } from '@/shared/api'
import type { IAdminUserOverviewActivity } from '@/entities/user'

export type AdminOverviewPaymentStatus =
	| 'PENDING'
	| 'SUCCEEDED'
	| 'CANCELLED'
	| 'EXPIRED'
	| 'UNKNOWN'

export type AdminOverviewAvailability = 'AVAILABLE' | 'UNAVAILABLE'

export interface BillingAdminEntitlementDto {
	workspaceId: string
	productCode: string
	planCode: string
	status: string
	seatLimit: number | null
	graceUntil: string | null
	trialStartedAt: string | null
	effectiveFrom: string
	effectiveUntil: string
	aggregateVersion: string
	sourceSequence: string
}

export interface BillingAdminPaymentDto {
	id: string
	workspaceId: string
	providerPaymentId: string | null
	status: AdminOverviewPaymentStatus
	amountMinor: string
	kind: string
	cycle: string | null
	createdAt: string
	updatedAt: string
}

export interface AdminUserOverview {
	schemaVersion: 2
	subscriptions: {
		status: AdminOverviewAvailability
		items: Array<{
			workspaceId: string
			entitlement: BillingAdminEntitlementDto | null
		}> | null
	}
	payments: {
		status: AdminOverviewAvailability
		total: number | null
		counts: Record<AdminOverviewPaymentStatus, number> | null
		latest: BillingAdminPaymentDto[] | null
	}
	activity: {
		status: AdminOverviewAvailability
		latest: IAdminUserOverviewActivity[] | null
	}
}
export const adminUserOverviewService = {
	async get(userId: string): Promise<AdminUserOverview> {
		const { data } = await axiosInterceptorsRequest.get<AdminUserOverview>(
			`/users/edit/${userId}/overview`
		)
		return data
	}
}
export const formatAdminAmountMinor = (value: string) => {
	if (!/^-?\d+$/.test(value)) return 'Сумма недоступна'
	const negative = value.startsWith('-')
	const digits = (negative ? value.slice(1) : value).padStart(3, '0')
	const major = digits.slice(0, -2).replace(/^0+(?=\d)/, '')
	const grouped = major.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')
	return `${negative ? '-' : ''}${grouped},${digits.slice(-2)}\u00a0₽`
}
